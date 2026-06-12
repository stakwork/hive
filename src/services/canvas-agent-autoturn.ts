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
 * agent is the classifier. The synthetic wake message below only
 * supplies *context* (which feature, which wake reason); the prompt
 * paragraph in `getCanvasPromptSuffix` teaches the agent how to behave
 * when the wakeup is machine-driven.
 *
 * **Gating.** Two layers, both default to a no-op:
 *   1. A per-user opt-in (`User.canvasAutonomousTurns`, default off),
 *      toggled from the gear menu on the canvas Agent chat panel. The
 *      auto-turn acts AS the conversation owner, so the owner's flag is
 *      the one that governs.
 *   2. A global master kill switch — `CANVAS_AUTONOMOUS_TURNS_ENABLED`.
 *      Setting it to `"false"` hard-disables the feature platform-wide
 *      (incident response) regardless of any user's opt-in. Anything
 *      else defers to the per-user flag.
 * When suppressed, this function is a logged no-op — Phase 2's fan-out
 * still copies planner messages into the conversation (the audit trail
 * is real either way), only the *autonomous action* layer is off.
 *
 * Reuses `runCanvasAgent` end-to-end — no new agent logic.
 */

import { tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { runCanvasAgent, type CachedConcepts } from "@/lib/ai/runCanvasAgent";
import {
  messagesFromSteps,
  appendTurnMessages,
  type StoredMessage,
} from "@/services/canvas-turn-persistence";

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

// Stored-message types (`StoredMessage` / `StoredToolCall`) and the
// turn writer (`messagesFromSteps` / `appendTurnMessages`) now live in
// `@/services/canvas-turn-persistence` so the user-driven `/api/ask/quick`
// path and this auto-turn path share one persistence code path.

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

/** Tool names stripped from the persisted transcript (control signals). */
const AUTOTURN_STRIP_TOOLS: ReadonlySet<string> = new Set([STAY_SILENT_TOOL]);

/**
 * Build the short, context-only synthetic wake message that tells the
 * agent WHY it was woken. It does NOT state the user's policy — the
 * agent reads that from the conversation itself.
 *
 * Role is `user`, NOT `system`, on purpose. `runCanvasAgent` already
 * prepends its own leading `system` prompt followed by assistant/tool
 * concept-seeding messages (see `getMultiWorkspacePrefixMessages`). A
 * second `system` message injected here lands *after* those, so the
 * provider sees "multiple system messages separated by user/assistant
 * messages" and Anthropic throws `AI_UnsupportedFunctionalityError`,
 * aborting the whole auto-turn. (The user-driven `/api/ask/quick` path
 * never hits this because its `messages` start with a `user` turn.)
 * Do NOT change this back to `system`.
 *
 * Placement is load-bearing too: the caller appends this message at the
 * TAIL of the model message list, AFTER the full transcript — so the
 * planner's reply is the last *assistant* entry and THIS user message is
 * the last entry overall. That matters because Anthropic treats a
 * conversation ending on an assistant turn as a *prefill to continue*,
 * not a prompt to act on: the model just extends the planner's text
 * (echoing earlier assistant chatter, skipping every tool call) instead
 * of running its wake instructions. We learned this the hard way — an
 * earlier version put the wake note at the HEAD, the array ended on the
 * planner's assistant turn, and the agent reliably emitted a stale
 * narration row with zero tool calls (no `read_feature`, no
 * `send_to_feature_planner`) — i.e. did nothing. Ending on this `user`
 * turn mirrors the working `/api/ask/quick` path, which always ends on
 * the user's just-typed message. Do NOT move this back to the head.
 */
/** The current plan snapshot, loaded fresh each turn in `runAutoTurn`. */
interface PlanSnapshot {
  brief: string | null;
  requirements: string | null;
  architecture: string | null;
  workflowStatus: string | null;
}

/** Render one plan stage as a labelled section, or a clear "not yet written" marker. */
function renderStage(label: string, body: string | null): string {
  const trimmed = body?.trim();
  return trimmed
    ? `### ${label}\n${trimmed}`
    : `### ${label}\n_(not yet written)_`;
}

function buildWakeMessage(
  featureTitle: string,
  featureId: string,
  plan: PlanSnapshot,
  wakeReason: AutoTurnWakeReason,
): ModelMessage {
  // Inject the WHOLE current plan, fresh each turn, so the agent reviews
  // the underling planner's actual work like a real human lead would —
  // not a guess, not a stale assumption. This snapshot is ephemeral: the
  // wake message is never persisted to the conversation (only the agent's
  // own output rows are), so re-injecting the full plan every turn does
  // NOT accumulate copies in history — each turn sees exactly one current
  // snapshot and it's thrown away after the call. This also removes the
  // need for the agent to call `read_feature` (and the bug where it
  // guessed a wrong id, got "Feature not found", and confabulated a
  // "feature was just created" state). `featureId` is still surfaced so a
  // `send_to_feature_planner` reply / chat-history read targets the right
  // feature.
  const planBlock =
    `Current plan snapshot for **${featureTitle}** ` +
    `(featureId: \`${featureId}\`, workflowStatus: ` +
    `${plan.workflowStatus ?? "unknown"}):\n\n` +
    `${renderStage("Brief", plan.brief)}\n\n` +
    `${renderStage("Requirements", plan.requirements)}\n\n` +
    `${renderStage("Architecture", plan.architecture)}`;
  return {
    role: "user",
    content:
      `You were invoked because the planner for feature **${featureTitle}** ` +
      `just posted a message (wake reason: ${wakeReason}). That planner ` +
      "message is the most recent assistant entry above this one — read " +
      "it as the thing you're reacting to now.\n\n" +
      `${planBlock}\n\n` +
      "Review that plan the way a lead reviews an underling's work, then " +
      "follow the user's standing instructions in this conversation. " +
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
            "The snapshot above IS the current state — trust it over any " +
            "assumption that the feature is new (by the time you're woken " +
            "the planner has already run). If `Brief`, `Requirements`, and " +
            "`Architecture` are all written and the architecture looks " +
            "sound, **keep it moving — auto-respond with " +
            "`send_to_feature_planner` telling it to generate the tasks now** " +
            "(unless the user asked to review the plan first). If instead a " +
            "stage is still missing, ask only for the SINGLE next stage " +
            "(requirements, then architecture, then tasks) — the planner runs " +
            "one stage per turn and silently ignores a second ask, so never " +
            "batch (e.g. 'write the architecture and generate the tasks'). " +
            "One ask per round-trip; you'll be woken again when it lands. A " +
            "finished plan that just sits waiting is the failure mode. Don't " +
            "try to *start* tasks — that's the user's button."
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

  // ── Master kill switch ───────────────────────────────────────────
  // `CANVAS_AUTONOMOUS_TURNS_ENABLED=false` hard-disables the feature
  // platform-wide (incident response / ops), regardless of any user's
  // opt-in. Anything else defers to the per-user flag checked in
  // `runAutoTurn` (`User.canvasAutonomousTurns`, default off). Phase 3
  // shipped this as the *only* gate; it is now a master override layered
  // above the user preference. Documented in
  // `docs/plans/canvas-agent-manages-planners.md` Phase 3.
  if (process.env.CANVAS_AUTONOMOUS_TURNS_ENABLED === "false") {
    console.log("[canvas-autoturn] skipped (master kill switch)", {
      conversationId,
      featureId,
      wakeReason,
    });
    return;
  }

  // Concurrency control: a per-PLANNER-MESSAGE claim, NOT a per-conversation
  // lock.
  //
  // History: this used a Postgres session advisory lock
  // (`pg_try_advisory_lock`) keyed on the *conversation*, held across the
  // whole LLM turn, released with a separate `pg_advisory_unlock`. That was
  // doubly broken:
  //   1. LEAK — a session lock belongs to the exact pooled connection that
  //      took it; the separate unlock query often ran on a *different*
  //      pooled connection, where it's a no-op. The lock never released and
  //      stayed held (in a frozen lambda's connection) until that
  //      connection was recycled.
  //   2. HEAD-OF-LINE DROP — keyed per conversation, so a leaked (or merely
  //      in-flight) lock from one stage's turn blocked the NEXT stage's
  //      turn, and the contended turn was silently dropped with no retry. A
  //      finished plan's "completed" wake vanished because an earlier
  //      stage's turn had leaked the conversation lock.
  //
  // The invariant we actually need is narrow: don't let two deliveries of
  // the SAME planner message both run the turn (the agent's
  // `send_to_feature_planner` fires mid-stream, before the append-time
  // idempotency dedup can catch it). Different planner messages — even in
  // the same conversation — SHOULD run concurrently. So we claim per
  // `plannerMessageId`, using the conversation row lock (correct,
  // connection-safe, auto-released at COMMIT), and we NEVER silently drop a
  // needed turn: a lost claim means some other run already owns this exact
  // message. The claim is crash-safe — a stale claim (a run that died
  // mid-turn) expires after `AUTOTURN_CLAIM_STALE_MS` so the wake can be
  // retried rather than wedged forever.
  let claimed = false;
  try {
    claimed = await claimAutoTurn(conversationId, plannerMessageId);
    if (!claimed) {
      console.log("[canvas-autoturn] message already claimed/handled; skipping", {
        conversationId,
        featureId,
        plannerMessageId,
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
    if (claimed) {
      await releaseAutoTurnClaim(conversationId, plannerMessageId).catch((e) =>
        console.error("[canvas-autoturn] claim release failed:", e),
      );
    }
  }
}

/**
 * A claim that has sat unreleased longer than this is treated as stale
 * (the owning run crashed before its `finally` released it) and may be
 * re-claimed, so a dead turn never wedges a planner message forever. Sized
 * comfortably above the worst-case turn wall-clock (LLM + tool round-trips)
 * so it never expires a genuinely in-flight turn.
 */
const AUTOTURN_CLAIM_STALE_MS = 5 * 60 * 1000;

/** Shape of the per-message claim bag stored under `settings.autoTurnClaims`. */
type AutoTurnClaims = Record<string, { claimedAt: number }>;

/**
 * Atomically claim a planner message for an auto-turn. Returns `true` iff
 * THIS caller won the claim and should run the turn.
 *
 * Serialized by the conversation row lock (`SELECT … FOR UPDATE`), the same
 * mechanism `appendTurnMessages` and the fan-out use — so it's correct
 * under Prisma's connection pool (the whole check-and-set runs in one
 * interactive transaction on one connection, and the lock auto-releases at
 * COMMIT; nothing is held across the LLM call). Bails when:
 *   - the conversation row is gone,
 *   - the turn already COMPLETED (a real `autoturn-<id>-*` output row
 *     exists in `messages`), or
 *   - a non-stale claim for this message already exists (a live concurrent
 *     run owns it).
 * Otherwise it records `{ claimedAt: now }` and returns `true`.
 *
 * The claim lives in `settings.autoTurnClaims` (not a `messages` row) so it
 * never pollutes the rendered transcript. The read-modify-write is safe
 * against concurrent `settings` writers because they all serialize on this
 * same row lock; we re-read the latest committed `settings` under the lock
 * and write the full object back, preserving sibling keys (`promptConcepts`,
 * `extraWorkspaceSlugs`). One benign edge: the client autosave PUT replaces
 * `settings` wholesale with the client's copy (which has no `autoTurnClaims`),
 * so an autosave landing mid-turn can erase a live claim. The fallout is
 * minor and self-correcting — at worst a redelivered SAME message re-runs
 * once; the planner ignores a repeated ask and `appendTurnMessages`'
 * `idPrefix` dedup still blocks duplicate output rows. The leak/drop bug this
 * replaces was the real hazard; this claim is the narrow belt-and-suspenders.
 */
async function claimAutoTurn(
  conversationId: string,
  plannerMessageId: string,
): Promise<boolean> {
  const idPrefix = `autoturn-${plannerMessageId}-`;
  let won = false;
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ messages: unknown; settings: unknown }[]>`
      SELECT messages, settings FROM shared_conversations
      WHERE id = ${conversationId} FOR UPDATE
    `;
    if (locked.length === 0) return; // conversation deleted

    // Already completed? A committed output row is the permanent dedup.
    const messages = Array.isArray(locked[0].messages)
      ? (locked[0].messages as StoredMessage[])
      : [];
    if (messages.some((m) => typeof m.id === "string" && m.id.startsWith(idPrefix))) {
      return;
    }

    const settings = (locked[0].settings ?? {}) as {
      autoTurnClaims?: AutoTurnClaims;
    };
    const claims: AutoTurnClaims = { ...(settings.autoTurnClaims ?? {}) };
    const existing = claims[plannerMessageId];
    if (existing && Date.now() - existing.claimedAt < AUTOTURN_CLAIM_STALE_MS) {
      return; // a live run already owns this message
    }

    claims[plannerMessageId] = { claimedAt: Date.now() };
    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: { settings: { ...settings, autoTurnClaims: claims } as never },
    });
    won = true;
  });
  return won;
}

/**
 * Release a claim recorded by {@link claimAutoTurn}. Best-effort and
 * idempotent — the stale-timeout in `claimAutoTurn` is the backstop if this
 * never runs (e.g. the process died). Serialized by the same row lock so it
 * doesn't clobber a concurrent `settings` writer.
 */
async function releaseAutoTurnClaim(
  conversationId: string,
  plannerMessageId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ settings: unknown }[]>`
      SELECT settings FROM shared_conversations
      WHERE id = ${conversationId} FOR UPDATE
    `;
    if (locked.length === 0) return;
    const settings = (locked[0].settings ?? {}) as {
      autoTurnClaims?: AutoTurnClaims;
    };
    if (!settings.autoTurnClaims?.[plannerMessageId]) return;
    const claims: AutoTurnClaims = { ...settings.autoTurnClaims };
    delete claims[plannerMessageId];
    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: { settings: { ...settings, autoTurnClaims: claims } as never },
    });
  });
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
      // The owner's per-user opt-in. The auto-turn acts AS this user, so
      // their preference is the one that governs. Loaded here (one query)
      // and gated below.
      user: { select: { canvasAutonomousTurns: true } },
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

  // ── Per-user opt-in ──────────────────────────────────────────────
  // The normal gate (the master kill switch above only hard-disables
  // platform-wide). The auto-turn acts as the conversation owner, so the
  // owner's `canvasAutonomousTurns` preference decides. Default off — the
  // user enables it from the gear menu on the Agent chat panel.
  if (!conversation.user?.canvasAutonomousTurns) {
    console.log("[canvas-autoturn] skipped (owner opt-out)", {
      conversationId,
      featureId,
      wakeReason,
    });
    return;
  }

  // Load the plan-stage flags alongside the title. We compute a compact
  // status line (which stages are populated + workflowStatus) and inject
  // THAT into the wake message — not the full plan text. The full
  // brief/requirements/architecture bodies are already in the persisted
  // planner messages in history, so re-injecting them would just
  // duplicate context every turn. The status line is the deterministic
  // signal the `completed` decision actually needs (pick the next stage),
  // and the agent can still `read_feature` with the real id below if it
  // wants to inspect a stage's quality.
  const feature = await db.feature.findUnique({
    where: { id: featureId },
    select: {
      title: true,
      brief: true,
      requirements: true,
      architecture: true,
      workflowStatus: true,
      workspace: { select: { slug: true } },
    },
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
    promptConcepts?: unknown;
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

  // The wake message goes at the TAIL, after the full transcript, so the
  // model message list ends on a `user` turn (mirroring the user-driven
  // `/api/ask/quick` path). Ending on the planner's trailing *assistant*
  // turn instead puts Anthropic into prefill/continuation mode and the
  // agent does nothing — see `buildWakeMessage`'s doc comment.
  const modelMessages: ModelMessage[] = [
    ...toModelMessages(storedMessages),
    buildWakeMessage(
      feature.title,
      featureId,
      {
        brief: feature.brief,
        requirements: feature.requirements,
        architecture: feature.architecture,
        workflowStatus: feature.workflowStatus,
      },
      wakeReason,
    ),
  ];

  // Reuse the concepts the user-driven `/api/ask/quick` path already
  // fetched + persisted to `settings.promptConcepts` for this
  // conversation (see `loadOrgCanvasPromptCache` /
  // `persistOrgCanvasPromptCache` in that route). Without this the
  // auto-turn re-hits every workspace's swarm `list_concepts` on every
  // wakeup — slow, and a hard failure when a swarm is offline (the
  // `ConnectTimeoutError`s you see in the logs). A cache hit skips the
  // swarm fetch entirely. Falls back to a fresh fetch when the cache is
  // absent (e.g. the conversation never had a user turn). NOTE: this
  // does NOT skip `buildWorkspaceConfigs` (the per-workspace PAT/swarm
  // lookups) — those run every turn regardless, since the toolset needs
  // live swarm credentials.
  const cachedConcepts =
    settings.promptConcepts &&
    typeof settings.promptConcepts === "object"
      ? (settings.promptConcepts as CachedConcepts)
      : null;

  const { result, cacheableConcepts, cacheHit } = await runCanvasAgent({
    userId: conversation.userId,
    orgId: conversation.sourceControlOrgId,
    workspaceSlugs,
    messages: modelMessages,
    cachedConcepts,
    // Machine-driven, no live UI subscriber on this turn — suppress the
    // "researching" highlight Pusher fan-out.
    silentPusher: true,
    // Let `send_to_feature_planner` lazy-claim ownership as usual (it's
    // already owned by this conversation, so this is a no-op, but keeps
    // the contract identical to the user-driven path).
    currentCanvasConversationId: conversationId,
    additionalTools: buildStaySilentTool({ conversationId, featureId }),
  });

  // Self-heal the concept cache. On a MISS the auto-turn just paid for a
  // fresh per-swarm `list_concepts` fetch — persist it so the NEXT
  // auto-turn (or user turn) reuses it instead of re-hitting every swarm.
  // Without this the auto-turn would re-fetch on every wakeup whenever the
  // conversation hadn't yet had a cache-populating user turn. Guarded on
  // `hasConcepts` so a swarm outage (empty result) never poisons the cache
  // into permanently serving nothing. Fire-and-forget — never block the
  // turn on a cache write. Mirrors `persistOrgCanvasPromptCache` in
  // `/api/ask/quick/route.ts` (same race-safe jsonb `||` merge).
  if (!cacheHit && hasConcepts(cacheableConcepts)) {
    void persistPromptConcepts(conversationId, cacheableConcepts).catch((e) =>
      console.error("[canvas-autoturn] prompt-cache persist failed:", e),
    );
  }

  // Drive the stream to completion (executes tool calls server-side,
  // e.g. `send_to_feature_planner`). `.text` auto-consumes; `.steps`
  // then resolves with the full tool-call trace.
  await result.text;
  const steps = await result.steps;

  const rows = messagesFromSteps(
    steps as Parameters<typeof messagesFromSteps>[0],
    idPrefix,
    AUTOTURN_STRIP_TOOLS,
  );

  await appendTurnMessages({
    conversationId,
    rows,
    idPrefix,
    reason: "autoturn",
  });

  console.log("[canvas-autoturn] completed", {
    conversationId,
    featureId,
    plannerMessageId,
    wakeReason,
    appendedRows: rows.length,
  });
}

/**
 * True when a cache holds at least one concept. Defensive: never cache an
 * empty result (a swarm outage yields an empty list, and caching that
 * would poison the cache into permanently serving nothing). Mirrors the
 * `hasConcepts` guard in `/api/ask/quick/route.ts`.
 */
function hasConcepts(c: CachedConcepts): boolean {
  if (Array.isArray(c.features)) return c.features.length > 0;
  if (c.conceptsByWorkspace) {
    return Object.values(c.conceptsByWorkspace).some(
      (list) => Array.isArray(list) && list.length > 0,
    );
  }
  return false;
}

/**
 * Persist freshly-fetched concepts to `settings.promptConcepts` so the
 * next turn (auto or user-driven) reuses them and skips the per-swarm
 * `list_concepts` fetch. Uses a single jsonb `||` merge (not
 * read-modify-write) so it's race-free against the client autosave's
 * concurrent `settings` writes — both sides merge into the same blob
 * instead of overwriting it. Sibling of `persistOrgCanvasPromptCache` in
 * `/api/ask/quick/route.ts`.
 */
async function persistPromptConcepts(
  conversationId: string,
  concepts: CachedConcepts,
): Promise<void> {
  const patch = JSON.stringify({ promptConcepts: concepts });
  await db.$executeRaw`
    UPDATE shared_conversations
    SET settings = COALESCE(settings, '{}'::jsonb) || ${patch}::jsonb
    WHERE id = ${conversationId}
  `;
}
