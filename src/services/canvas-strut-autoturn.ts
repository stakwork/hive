/**
 * Canvas-agent auto-turn for a dispatched strut chat.
 *
 * Wakes the canvas agent — with no HTTP user — once strut reports a
 * dispatched chat SETTLED (see `/api/agent-runs/webhook/strut`). Strut's
 * reply is already in the conversation (`canvas-strut-fanout.ts`); the agent
 * reads it and, following the user's standing instructions, continues the
 * strut chat, reports to the user, or stays silent.
 *
 * Sibling of `canvas-agent-autoturn.ts` (the planner wake) and deliberately
 * thin: it reuses that module's per-message claim, the concept cache, and
 * `runCanvasAgent` end-to-end. Only SETTLED posts wake the agent — an
 * interim "I'll report back" turn is shown to the user but costs no turn.
 *
 * **Gating** — the same two layers as the planner wake, both default off:
 *   1. the conversation owner's `User.canvasAutonomousTurns` opt-in (the
 *      turn acts AS that user);
 *   2. the `CANVAS_AUTONOMOUS_TURNS_ENABLED=false` master kill switch.
 *
 * **Loop breaker.** Two agents that can wake each other can cycle: strut
 * settles → this wakes the agent → it dispatches strut again → … Each round
 * is a canvas turn plus a strut turn (which has a shell and runs workflows).
 * Past `MAX_CONSECUTIVE_STRUT_DISPATCHES` dispatches with no human message
 * in between, the wake is skipped and the user takes it from there.
 */

import { tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { runCanvasAgent, type CachedConcepts } from "@/lib/ai/runCanvasAgent";
import { toModelMessages } from "@/lib/ai/conversationHelpers";
import { DISPATCH_STRUT_TOOL } from "@/lib/ai/strutTools";
import {
  STAY_SILENT_TOOL,
  claimAutoTurn,
  releaseAutoTurnClaim,
  hasConcepts,
  persistPromptConcepts,
} from "@/services/canvas-agent-autoturn";
import { messagesFromSteps, appendTurnMessages, type StoredMessage } from "@/services/canvas-turn-persistence";

export interface StrutAutoTurnArgs {
  /** `SharedConversation.id` the dispatch came from. */
  conversationId: string;
  /** The settled fan-out row's id — the claim + idempotency key. */
  wakeId: string;
  workspaceSlug: string;
  chatId: string;
  title: string;
  /** Strut's final turn errored. */
  failed: boolean;
  /**
   * This deployment's swarm-reachable base URL, from the webhook request's
   * `host` header — what a `dispatch_strut` made on THIS turn builds its
   * callback URL from (see `CapabilityContext.publicBaseUrl`).
   */
  publicBaseUrl: string;
}

/** See the file header. A build → test → fix loop needs 2–3. */
export const MAX_CONSECUTIVE_STRUT_DISPATCHES = 4;

/**
 * `dispatch_strut` calls in the transcript tail, scanning back to the first
 * human message (which resets the window: a user who is steering is never
 * throttled).
 */
export function countTrailingStrutDispatches(messages: StoredMessage[]): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") break;
    for (const tc of m.toolCalls ?? []) {
      if (tc.toolName === DISPATCH_STRUT_TOOL) count++;
    }
  }
  return count;
}

function buildStaySilentTool(ctx: { conversationId: string; chatId: string }): ToolSet {
  return {
    [STAY_SILENT_TOOL]: tool({
      description:
        "Call this as your terminal action when strut's reply needs NO visible response from you — " +
        "it already says everything the user needs and nothing is left to drive. Produces no chat message. " +
        "Prefer this over restating strut's reply.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Optional one-line rationale. Logged only."),
      }),
      execute: async ({ reason }: { reason?: string }) => {
        console.log("[canvas-strut-autoturn] stay_silent", { ...ctx, reason: reason ?? null });
        return { status: "silent" as const };
      },
    }),
  };
}

/**
 * The synthetic wake message. Role `user` and placed at the TAIL of the
 * model messages — both load-bearing; see `buildWakeMessage` in
 * `canvas-agent-autoturn.ts`. Never persisted.
 */
function buildWakeMessage(args: StrutAutoTurnArgs): ModelMessage {
  return {
    role: "user",
    content:
      `You were invoked because the strut chat \`${args.chatId}\` on workspace \`${args.workspaceSlug}\` ` +
      `("${args.title}") — which you dispatched — has ${args.failed ? "ended in an error" : "settled: strut is done and idle"}. ` +
      "Its replies are the most recent assistant entries above this one; read them as the thing you're reacting to now.\n\n" +
      "Follow the user's standing instructions in this conversation. Decide one of:\n" +
      `- **Continue:** call \`${DISPATCH_STRUT_TOOL}\` with \`chatId: "${args.chatId}"\` — ONLY when the user's request is ` +
      "not yet met and the next step is clearly within what they asked for (e.g. they asked for a workflow that passes its test and the run failed).\n" +
      "- **Report:** write one short paragraph telling the user the outcome, or what strut needs from them. " +
      "Don't restate strut's reply — it is already in the conversation.\n" +
      `- **Stay silent:** call \`${STAY_SILENT_TOOL}\` when strut's reply already says it all.\n\n` +
      "Default toward reporting or silence. Strut runs real code on the swarm; never widen the task on your own.",
  };
}

export async function invokeCanvasAgentOnStrutSettled(args: StrutAutoTurnArgs): Promise<void> {
  const { conversationId, wakeId } = args;

  if (process.env.CANVAS_AUTONOMOUS_TURNS_ENABLED === "false") {
    console.log("[canvas-strut-autoturn] skipped (master kill switch)", { conversationId, wakeId });
    return;
  }

  let claimed = false;
  try {
    claimed = await claimAutoTurn(conversationId, wakeId);
    if (!claimed) {
      console.log("[canvas-strut-autoturn] already claimed/handled; skipping", { conversationId, wakeId });
      return;
    }
    await runStrutAutoTurn(args);
  } catch (e) {
    console.error("[canvas-strut-autoturn] failed (non-fatal):", {
      conversationId,
      wakeId,
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    if (claimed) {
      await releaseAutoTurnClaim(conversationId, wakeId).catch((e) =>
        console.error("[canvas-strut-autoturn] claim release failed:", e),
      );
    }
  }
}

async function runStrutAutoTurn(args: StrutAutoTurnArgs): Promise<void> {
  const { conversationId, wakeId, workspaceSlug, chatId } = args;

  const conversation = await db.sharedConversation.findUnique({
    where: { id: conversationId },
    select: {
      userId: true,
      sourceControlOrgId: true,
      messages: true,
      settings: true,
      workspace: { select: { slug: true } },
      user: { select: { canvasAutonomousTurns: true } },
    },
  });
  if (!conversation?.userId || !conversation.sourceControlOrgId) {
    console.log("[canvas-strut-autoturn] conversation gone or not owner+org scoped; skipping", { conversationId });
    return;
  }
  if (!conversation.user?.canvasAutonomousTurns) {
    console.log("[canvas-strut-autoturn] skipped (autonomous turns off)", { conversationId });
    return;
  }

  const storedMessages = Array.isArray(conversation.messages)
    ? (conversation.messages as unknown as StoredMessage[])
    : [];

  const idPrefix = `autoturn-${wakeId}-`;
  if (storedMessages.some((m) => m.id?.startsWith?.(idPrefix))) return;

  const trailing = countTrailingStrutDispatches(storedMessages);
  if (trailing >= MAX_CONSECUTIVE_STRUT_DISPATCHES) {
    console.error(
      "[canvas-strut-autoturn] LOOP BREAKER tripped — too many consecutive strut dispatches with no human " +
        "message between; skipping this wake.",
      { conversationId, wakeId, chatId, trailing },
    );
    return;
  }

  // The slug set the user-driven canvas chat used, plus the dispatched
  // workspace. Deduped, capped at 20 — as in the planner wake.
  const settings = (conversation.settings ?? {}) as { extraWorkspaceSlugs?: unknown; promptConcepts?: unknown };
  const slugSet = new Set<string>();
  if (conversation.workspace?.slug) slugSet.add(conversation.workspace.slug);
  if (Array.isArray(settings.extraWorkspaceSlugs)) {
    for (const s of settings.extraWorkspaceSlugs) if (typeof s === "string") slugSet.add(s);
  }
  slugSet.add(workspaceSlug);
  const workspaceSlugs = Array.from(slugSet).slice(0, 20);

  const cachedConcepts =
    settings.promptConcepts && typeof settings.promptConcepts === "object"
      ? (settings.promptConcepts as CachedConcepts)
      : null;

  const { result, cacheableConcepts, cacheHit } = await runCanvasAgent({
    userId: conversation.userId,
    orgId: conversation.sourceControlOrgId,
    workspaceSlugs,
    messages: [...toModelMessages(storedMessages), buildWakeMessage(args)],
    cachedConcepts,
    silentPusher: true,
    currentCanvasConversationId: conversationId,
    publicBaseUrl: args.publicBaseUrl,
    additionalTools: buildStaySilentTool({ conversationId, chatId }),
  });

  if (!cacheHit && hasConcepts(cacheableConcepts)) {
    void persistPromptConcepts(conversationId, cacheableConcepts).catch((e) =>
      console.error("[canvas-strut-autoturn] prompt-cache persist failed:", e),
    );
  }

  await result.text;
  const steps = await result.steps;
  const rows = messagesFromSteps(
    steps as Parameters<typeof messagesFromSteps>[0],
    idPrefix,
    new Set([STAY_SILENT_TOOL]),
  );
  await appendTurnMessages({ conversationId, rows, idPrefix, reason: "autoturn" });

  console.log("[canvas-strut-autoturn] completed", { conversationId, wakeId, chatId, appendedRows: rows.length });
}
