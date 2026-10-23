/**
 * The gate every wake of an org conversation runs behind — today the one
 * wake there is: a job's turn landed and strut's orchestrator, which
 * answers Jamie (`docs/jamie-engine.md`), is woken on it
 * (`strut-orchestrator-wake.ts`).
 *
 * **Gates** (`runGatedAutoTurn`):
 *   1. the `CANVAS_AUTONOMOUS_TURNS_ENABLED=false` master kill switch;
 *   2. a per-conversation claim, so a redelivered callback never runs the
 *      wake twice at once (`canvas-agent-autoturn.ts`);
 *   3. an owner + org scoped conversation (a workspace dashboard chat is
 *      never woken);
 *   4. the wake's own idempotency mark;
 *   5. the loop breaker.
 *
 * There is no per-user opt-in. `User.canvasAutonomousTurns` gated Hive's
 * own canvas agent acting as the user on its own; that agent no longer
 * answers Jamie, and the orchestrator's wake is how a job's reply reaches
 * the agent that answers next.
 *
 * **Loop breaker.** Two agents that can wake each other can cycle: a job
 * lands → the wake → the orchestrator continues the job → it lands → …
 * Each round is an orchestrator turn plus a job turn (which has a shell
 * and runs workflows). Past `MAX_CONSECUTIVE_STRUT_DISPATCHES` rounds with
 * no human message in between, the wake is skipped and the user takes it
 * from there.
 */

import { db } from "@/lib/db";
import { claimAutoTurn, releaseAutoTurnClaim } from "@/services/canvas-agent-autoturn";
import type { StoredMessage } from "@/services/canvas-turn-persistence";

/** How a job turn ended — `JobTurnOutcome` in `strut-runs/job-turn.ts`, repeated so this module stays light. */
export type JobWakeOutcome = "success" | "error" | "cancelled" | "lost";

/** See the file header. A build → test → fix loop needs 2–3. */
export const MAX_CONSECUTIVE_STRUT_DISPATCHES = 4;

// ─── The gate ─────────────────────────────────────────────────────────────

/** The conversation as the gate found it — what a wake's turn runs on. */
export interface GatedConversation {
  /** The owner: the turn acts AS this user. */
  userId: string;
  orgId: string;
  /** The conversation's own workspace slug, when it has one. */
  workspaceSlug: string | null;
  settings: unknown;
  messages: StoredMessage[];
}

/** What every wake is gated on, whatever it runs. */
export interface AutoTurnGate {
  /** Log prefix. */
  tag: string;
  conversationId: string;
  /** The claim + idempotency key. */
  wakeId: string;
  /** What this wake is about — logged with every line. */
  about: Record<string, unknown>;
  /** This wake's output is already in the conversation (its permanent dedup). */
  alreadyHandled: (messages: StoredMessage[]) => boolean;
  /** Rounds of the loop in the transcript tail — past `MAX_CONSECUTIVE_STRUT_DISPATCHES` the wake is skipped. */
  trailingLaunches: (messages: StoredMessage[]) => number;
}

/**
 * Run a wake behind the gates (file header): the master kill switch, the
 * per-conversation claim, an owner + org scoped conversation, the wake's
 * own idempotency mark, the loop breaker. `run` is the turn itself; whatever it throws is logged, never thrown. The claim is
 * released either way.
 */
export async function runGatedAutoTurn(
  gate: AutoTurnGate,
  run: (conversation: GatedConversation) => Promise<void>,
): Promise<void> {
  const { tag, conversationId, wakeId, about } = gate;

  if (process.env.CANVAS_AUTONOMOUS_TURNS_ENABLED === "false") {
    console.log(`[${tag}] skipped (master kill switch)`, { conversationId, wakeId });
    return;
  }

  let claimed = false;
  try {
    claimed = await claimAutoTurn(conversationId, wakeId);
    if (!claimed) {
      console.log(`[${tag}] already claimed/handled; skipping`, { conversationId, wakeId });
      return;
    }
    const conversation = await loadGatedConversation(gate);
    if (conversation) await run(conversation);
  } catch (e) {
    console.error(`[${tag}] failed (non-fatal):`, {
      conversationId,
      wakeId,
      ...about,
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    if (claimed) {
      await releaseAutoTurnClaim(conversationId, wakeId).catch((e) =>
        console.error(`[${tag}] claim release failed:`, e),
      );
    }
  }
}

/** The conversation, if the wake may run on it (null = a gate said no, logged). */
async function loadGatedConversation(gate: AutoTurnGate): Promise<GatedConversation | null> {
  const { tag, conversationId, wakeId, about } = gate;

  const conversation = await db.sharedConversation.findUnique({
    where: { id: conversationId },
    select: {
      userId: true,
      sourceControlOrgId: true,
      messages: true,
      settings: true,
      workspace: { select: { slug: true } },
    },
  });
  if (!conversation?.userId || !conversation.sourceControlOrgId) {
    console.log(`[${tag}] conversation gone or not owner+org scoped; skipping`, { conversationId });
    return null;
  }
  const messages = Array.isArray(conversation.messages) ? (conversation.messages as unknown as StoredMessage[]) : [];

  if (gate.alreadyHandled(messages)) return null;

  const trailing = gate.trailingLaunches(messages);
  if (trailing >= MAX_CONSECUTIVE_STRUT_DISPATCHES) {
    console.error(
      `[${tag}] LOOP BREAKER tripped — too many consecutive strut launches with no human message between; skipping this wake.`,
      { conversationId, wakeId, ...about, trailing },
    );
    return null;
  }

  return {
    userId: conversation.userId,
    orgId: conversation.sourceControlOrgId,
    workspaceSlug: conversation.workspace?.slug ?? null,
    settings: conversation.settings,
    messages,
  };
}
