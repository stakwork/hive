/**
 * Canvas-agent auto-turn (Phase 3 of
 * `docs/plans/canvas-agent-manages-planners.md`).
 *
 * A server-side entry point that wakes the canvas agent WITHOUT an
 * HTTP user, parallel to the user-driven `/api/ask/quick` path. It's
 * called by the fan-out worker (`src/services/canvas-planner-fanout.ts`)
 * after an *actionable* planner ASSISTANT message lands in a canvas
 * conversation — a FORM artifact, a workflow-state transition, or a
 * trailing-`?` question.
 *
 * The agent reads the conversation (the user's standing instructions
 * are already in those messages) and decides one of three things,
 * exactly like it does on a user-driven turn:
 *   - **Auto-respond:** call `send_to_feature_planner` with its answer.
 *   - **Escalate:** write one short note to the user.
 *   - **Stay silent:** call the `stay_silent` tool (terminal no-op).
 *
 * There is deliberately NO policy extractor / classifier here — the
 * agent is the classifier. The synthetic system message below only
 * supplies *context* (which feature, which wake reason); the prompt
 * paragraph in `getCanvasPromptSuffix` teaches the agent how to behave
 * when the wakeup is machine-driven.
 *
 * **Kill switch.** Gated behind `CANVAS_AUTONOMOUS_TURNS_ENABLED`
 * (default off). When off, this function is a logged no-op — Phase 2's
 * fan-out still copies planner messages into the conversation (the
 * audit trail is real either way), only the *autonomous action* layer
 * is suppressed. Flip the env to `"true"` to enable; flip back to
 * disable without a redeploy.
 *
 * Reuses `runCanvasAgent` end-to-end — no new agent logic.
 */

import { tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { runCanvasAgent } from "@/lib/ai/runCanvasAgent";

/** Why the agent was woken. Surfaced verbatim in the synthetic prompt. */
export type AutoTurnWakeReason =
  | "form"
  | "question"
  | "completed"
  | "failed"
  | "halted";

export interface AutoTurnArgs {
  /** `SharedConversation.id` that owns the feature being managed. */
  conversationId: string;
  /** The feature whose planner just posted. */
  featureId: string;
  /** The planner `ChatMessage.id` that triggered this wakeup. */
  plannerMessageId: string;
  /** What kind of signal the planner message carried. */
  wakeReason: AutoTurnWakeReason;
}

/** Tool name for the terminal no-op. Not namespaced. */
export const STAY_SILENT_TOOL = "stay_silent";

/**
 * `stay_silent` — a terminal tool the agent calls on an auto-turn to
 * explicitly do nothing, instead of narrating its non-action as a
 * chat message ("Nothing to do here."). The execute body just logs
 * the optional reason; it's never surfaced in the UI and the call is
 * stripped from the saved transcript by `messagesFromResult` below.
 */
function buildStaySilentTool(ctx: {
  conversationId: string;
  featureId: string;
}): ToolSet {
  return {
    [STAY_SILENT_TOOL]: tool({
      description:
        "Call this as your terminal action when the planner's message " +
        "warrants NO visible response — a pure status update, or a " +
        "decision the user has clearly delegated where a " +
        "`send_to_feature_planner` reply would just be inbox noise. " +
        "This produces no chat message and no planner message. Prefer " +
        "this over writing 'nothing to do here' as a chat message. " +
        "Pass an optional one-line `reason` (logged for debugging, " +
        "never shown to the user).",
      inputSchema: z.object({
        reason: z
          .string()
          .optional()
          .describe(
            "Optional one-line rationale for staying silent. Logged " +
              "only; not surfaced in the UI.",
          ),
      }),
      execute: async ({ reason }: { reason?: string }) => {
        console.log("[canvas-autoturn] stay_silent", {
          conversationId: ctx.conversationId,
          featureId: ctx.featureId,
          reason: reason ?? null,
        });
        return { status: "silent" as const };
      },
    }),
  };
}

// ───────────────────────────────────────────────────────────────────
// Stored-message types (the `CanvasChatMessage` JSON shape inside
// `SharedConversation.messages`). Kept loose — the column is `Json`
// and the canonical render-side type lives in `canvasChatStore.ts`.
// ───────────────────────────────────────────────────────────────────

interface StoredToolCall {
  id: string;
  toolName: string;
  input?: unknown;
  status?: string;
  output?: unknown;
  errorText?: string;
}

interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  toolCalls?: StoredToolCall[];
  source?: { kind: string; featureId?: string; plannerMessageId?: string };
}

/**
 * Server-side mirror of `toModelMessages` from `canvasChatStore.ts`.
 * Converts the stored canvas transcript into AI-SDK `ModelMessage[]`
 * the same way the user-driven `/api/ask/quick` path does, so the
 * agent sees an identical context. Planner-source rows round-trip as
 * plain assistant messages (the agent needs to read them); the
 * `source` marker is irrelevant to the model.
 */
function toModelMessages(messages: StoredMessage[]): ModelMessage[] {
  return messages
    .filter((m) => (m.content?.trim() || m.toolCalls) && m.role)
    .flatMap((m): ModelMessage[] => {
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const out: ModelMessage[] = [];
        out.push({
          role: "assistant",
          content: m.toolCalls.map((tc) => ({
            type: "tool-call" as const,
            toolCallId: tc.id,
            toolName: tc.toolName,
            input: tc.input || {},
          })),
        });
        const toolResults = m.toolCalls.filter(
          (tc) => tc.output !== undefined || tc.errorText !== undefined,
        );
        if (toolResults.length > 0) {
          out.push({
            role: "tool",
            content: toolResults.map((tc) => {
              let wrappedOutput = tc.output;
              if (
                tc.output &&
                typeof tc.output === "object" &&
                !("type" in tc.output)
              ) {
                wrappedOutput = { type: "json", value: tc.output };
              }
              return {
                type: "tool-result" as const,
                toolCallId: tc.id,
                toolName: tc.toolName,
                output: wrappedOutput as never,
              };
            }),
          } as ModelMessage);
        }
        if (m.content) {
          out.push({ role: "assistant", content: m.content });
        }
        return out;
      }
      return [{ role: m.role, content: m.content }];
    });
}

/**
 * Reconstruct the agent's output as `CanvasChatMessage`-shaped rows
 * from the finished stream's `steps`. Mirrors the client-side timeline
 * split in `useSendCanvasChatMessage.ts`: text becomes a text message,
 * tool calls become a tool-call message (so `SubAgentRunCard` can
 * extract `send_to_feature_planner` calls as outbound thread entries).
 *
 * The `stay_silent` tool call is stripped — it's a control signal, not
 * a transcript entry. A turn that did nothing but `stay_silent`
 * produces an empty array, and the caller appends nothing.
 */
function messagesFromSteps(
  steps: Array<{
    text?: string;
    toolCalls?: Array<{ toolCallId: string; toolName: string; input?: unknown }>;
    toolResults?: Array<{ toolCallId: string; output?: unknown; result?: unknown }>;
  }>,
  plannerMessageId: string,
): StoredMessage[] {
  const rows: StoredMessage[] = [];
  let idx = 0;
  const nextId = () => `autoturn-${plannerMessageId}-${idx++}`;
  const now = new Date().toISOString();

  for (const step of steps) {
    if (step.text && step.text.trim()) {
      rows.push({
        id: nextId(),
        role: "assistant",
        content: step.text,
        timestamp: now,
      });
    }

    const calls = step.toolCalls ?? [];
    if (calls.length === 0) continue;

    const resultByCallId = new Map(
      (step.toolResults ?? []).map((r) => [r.toolCallId, r] as const),
    );

    const toolCalls: StoredToolCall[] = calls
      .filter((tc) => tc.toolName !== STAY_SILENT_TOOL)
      .map((tc) => {
        const r = resultByCallId.get(tc.toolCallId);
        const output = r ? (r.output ?? r.result) : undefined;
        const isError =
          !!output &&
          typeof output === "object" &&
          "error" in (output as Record<string, unknown>);
        return {
          id: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.input,
          output,
          status:
            output === undefined
              ? "input-available"
              : isError
                ? "output-error"
                : "output-available",
          ...(isError ? { errorText: "Tool call failed" } : {}),
        };
      });

    if (toolCalls.length > 0) {
      rows.push({
        id: nextId(),
        role: "assistant",
        content: "",
        timestamp: now,
        toolCalls,
      });
    }
  }

  return rows;
}

/**
 * Append agent-produced rows into the canvas conversation under the
 * same row-level lock the fan-out worker and the autosave PUT use, so
 * all three writers serialize on the conversation row. Idempotent on
 * the `autoturn-<plannerMessageId>-` id prefix.
 */
async function appendAutoTurnMessages(
  conversationId: string,
  rows: StoredMessage[],
  plannerMessageId: string,
): Promise<void> {
  if (rows.length === 0) return;
  const idPrefix = `autoturn-${plannerMessageId}-`;

  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ messages: unknown }[]>`
      SELECT messages FROM shared_conversations WHERE id = ${conversationId} FOR UPDATE
    `;
    if (locked.length === 0) return; // conversation deleted mid-turn

    const existing = Array.isArray(locked[0].messages)
      ? (locked[0].messages as StoredMessage[])
      : [];

    // Idempotency: if a prior run for this planner message already
    // committed rows, don't double-append.
    const alreadyAppended = existing.some(
      (m) => typeof m.id === "string" && m.id.startsWith(idPrefix),
    );
    if (alreadyAppended) return;

    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: {
        messages: [...existing, ...rows] as unknown as never,
        lastMessageAt: new Date(),
      },
    });
  });
}

/**
 * Build the short, context-only synthetic system message that tells
 * the agent WHY it was woken. It does NOT state the user's policy —
 * the agent reads that from the conversation itself.
 */
function buildWakeMessage(
  featureTitle: string,
  wakeReason: AutoTurnWakeReason,
): ModelMessage {
  return {
    role: "system",
    content:
      `You were invoked because the planner for feature **${featureTitle}** ` +
      `just posted a message (wake reason: ${wakeReason}). The planner's ` +
      "message is the most recent assistant entry in this conversation, " +
      "marked with `source.kind === \"planner\"`.\n\n" +
      "Follow the user's standing instructions in this conversation. " +
      "Decide one of:\n" +
      "- **Auto-respond:** call `send_to_feature_planner` with your answer. " +
      "Don't write a separate chat message.\n" +
      "- **Escalate:** write one short paragraph to the user framing what " +
      "the planner needs.\n" +
      "- **Stay silent:** call the `stay_silent` tool. Do this when the " +
      "planner's message is a pure status update, or when the user has " +
      "clearly delegated this kind of decision and a " +
      "`send_to_feature_planner` reply would be redundant noise.\n\n" +
      (wakeReason === "form"
        ? "This wake reason is `form`: the planner emitted a structured " +
          "clarifying-question FORM — its explicit *a human must pick* " +
          "signal. NEVER auto-answer a FORM with `send_to_feature_planner`; " +
          "that defeats the planner's escalation. Choose **escalate** (a " +
          "one-paragraph note pointing at the question) or **stay silent** " +
          "(the FORM surfaces to the user directly anyway)."
        : wakeReason === "completed"
          ? "This wake reason is `completed`: the planner finished a run. " +
            "Read the plan via `<slug>__read_feature`. If `brief`, " +
            "`requirements`, and `architecture` are all populated and the " +
            "architecture looks sound, **keep it moving — auto-respond with " +
            "`send_to_feature_planner` telling it to generate the tasks now** " +
            "(unless the user asked to review the plan first). A finished " +
            "plan that just sits waiting is the failure mode. Don't try to " +
            "*start* tasks — that's the user's button."
          : "Default toward escalation or silence unless the user's " +
            "instructions clearly grant you the autonomy to answer."),
  };
}

/**
 * Wake the canvas agent on an actionable planner message. See the file
 * header for the full contract. Failure-tolerant: any error is logged
 * and swallowed — a missed auto-turn just means the user prompts the
 * canvas agent manually later; the planner message is already in the
 * conversation regardless.
 */
export async function invokeCanvasAgentOnPlannerMessage(
  args: AutoTurnArgs,
): Promise<void> {
  const { conversationId, featureId, plannerMessageId, wakeReason } = args;

  // ── Kill switch ──────────────────────────────────────────────────
  // Off by default. When off, this is a logged no-op (Phase 2 fan-out
  // is unaffected). Documented in
  // `docs/plans/canvas-agent-manages-planners.md` Phase 3.
  if (process.env.CANVAS_AUTONOMOUS_TURNS_ENABLED !== "true") {
    console.log("[canvas-autoturn] skipped (disabled via env)", {
      conversationId,
      featureId,
      wakeReason,
    });
    return;
  }

  // Best-effort per-conversation advisory lock so two planners
  // replying near-simultaneously don't both wake the agent on the
  // same conversation and double-respond.
  //
  // CAVEAT: Postgres session advisory locks are tied to a connection.
  // Under Prisma's connection pool, the `pg_try_advisory_lock` and the
  // `pg_advisory_unlock` may land on different pooled connections, so
  // this is *best-effort*, not a hard mutex. That's an acceptable v1
  // tradeoff: the feature is gated behind a kill switch, the worst case
  // is one redundant auto-turn (the agent reads the full conversation
  // and can `stay_silent`), and the lock is never held across the LLM
  // call (which would pin a DB connection for the whole turn). A
  // hardened version (a dedicated lock service or a row-lease) is a
  // future seam.
  const lockKeySql = `canvas-autoturn:${conversationId}`;
  let lockAcquired = false;
  try {
    const lockRows = await db.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${lockKeySql})) AS locked
    `;
    lockAcquired = lockRows[0]?.locked === true;
    if (!lockAcquired) {
      console.log("[canvas-autoturn] lock held; skipping", {
        conversationId,
        featureId,
        wakeReason,
      });
      return;
    }

    await runAutoTurn(args);
  } catch (e) {
    console.error("[canvas-autoturn] failed (non-fatal):", {
      conversationId,
      featureId,
      plannerMessageId,
      wakeReason,
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    if (lockAcquired) {
      try {
        await db.$queryRaw`SELECT pg_advisory_unlock(hashtext(${lockKeySql}))`;
      } catch (e) {
        console.error("[canvas-autoturn] advisory unlock failed:", e);
      }
    }
  }
}

/**
 * The actual turn, factored out so the lock/env wrapper above stays
 * readable. Loads the conversation + feature, rebuilds the canvas-chat
 * context, runs the agent, and appends its output.
 */
async function runAutoTurn(args: AutoTurnArgs): Promise<void> {
  const { conversationId, featureId, plannerMessageId, wakeReason } = args;

  const conversation = await db.sharedConversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      userId: true,
      sourceControlOrgId: true,
      workspaceId: true,
      messages: true,
      settings: true,
      workspace: { select: { slug: true } },
    },
  });

  if (!conversation) {
    console.log("[canvas-autoturn] conversation gone; skipping", {
      conversationId,
    });
    return;
  }
  // Anonymous (public-viewer) conversations have no real user to act
  // as, and a non-canvas conversation has no org — neither can manage
  // planners. Bail.
  if (!conversation.userId || !conversation.sourceControlOrgId) {
    console.log("[canvas-autoturn] conversation not owner+org scoped; skipping", {
      conversationId,
      hasUser: !!conversation.userId,
      hasOrg: !!conversation.sourceControlOrgId,
    });
    return;
  }

  const feature = await db.feature.findUnique({
    where: { id: featureId },
    select: { title: true, workspace: { select: { slug: true } } },
  });
  if (!feature) {
    console.log("[canvas-autoturn] feature gone; skipping", { featureId });
    return;
  }

  // Rebuild the workspace-slug set the user-driven canvas chat used:
  // the conversation's primary workspace slug + the extra slugs the
  // autosave persisted in `settings.extraWorkspaceSlugs`, unioned with
  // the managed feature's workspace slug (so `<slug>__read_feature`
  // is available to the agent). Deduped, capped at 20.
  const settings = (conversation.settings ?? {}) as {
    extraWorkspaceSlugs?: unknown;
  };
  const extraSlugs = Array.isArray(settings.extraWorkspaceSlugs)
    ? settings.extraWorkspaceSlugs.filter(
        (s): s is string => typeof s === "string",
      )
    : [];
  const slugSet = new Set<string>();
  if (conversation.workspace?.slug) slugSet.add(conversation.workspace.slug);
  for (const s of extraSlugs) slugSet.add(s);
  if (feature.workspace?.slug) slugSet.add(feature.workspace.slug);
  const workspaceSlugs = Array.from(slugSet).slice(0, 20);

  if (workspaceSlugs.length === 0) {
    console.log("[canvas-autoturn] no workspace slugs resolved; skipping", {
      conversationId,
      featureId,
    });
    return;
  }

  const storedMessages = Array.isArray(conversation.messages)
    ? (conversation.messages as unknown as StoredMessage[])
    : [];

  // Idempotency short-circuit BEFORE the (expensive) LLM call: if a
  // prior run already committed rows for this planner message, don't
  // re-run.
  const idPrefix = `autoturn-${plannerMessageId}-`;
  if (storedMessages.some((m) => m.id?.startsWith?.(idPrefix))) {
    console.log("[canvas-autoturn] already handled; skipping", {
      conversationId,
      plannerMessageId,
    });
    return;
  }

  const modelMessages: ModelMessage[] = [
    buildWakeMessage(feature.title, wakeReason),
    ...toModelMessages(storedMessages),
  ];

  const { result } = await runCanvasAgent({
    userId: conversation.userId,
    orgId: conversation.sourceControlOrgId,
    workspaceSlugs,
    messages: modelMessages,
    // Machine-driven, no live UI subscriber on this turn — suppress the
    // "researching" highlight Pusher fan-out.
    silentPusher: true,
    // Let `send_to_feature_planner` lazy-claim ownership as usual (it's
    // already owned by this conversation, so this is a no-op, but keeps
    // the contract identical to the user-driven path).
    currentCanvasConversationId: conversationId,
    additionalTools: buildStaySilentTool({ conversationId, featureId }),
  });

  // Drive the stream to completion (executes tool calls server-side,
  // e.g. `send_to_feature_planner`). `.text` auto-consumes; `.steps`
  // then resolves with the full tool-call trace.
  await result.text;
  const steps = await result.steps;

  const rows = messagesFromSteps(
    steps as Parameters<typeof messagesFromSteps>[0],
    plannerMessageId,
  );

  await appendAutoTurnMessages(conversationId, rows, plannerMessageId);

  console.log("[canvas-autoturn] completed", {
    conversationId,
    featureId,
    plannerMessageId,
    wakeReason,
    appendedRows: rows.length,
  });
}
