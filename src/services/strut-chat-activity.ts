/**
 * Reads what a dispatched strut chat did — the workflows it published, the
 * runs it launched — from the strut that hosts it, for the chat's card in
 * the canvas conversation.
 *
 * Called from strut's turn-end callback (`/api/agent-runs/webhook/strut`),
 * which is when any of it changes: a turn ends having published or launched
 * something, and a detached run's end starts the chat's next turn. So the
 * card is current without a poll.
 *
 * A run the transcript last saw `running` is asked about again — the
 * transcript never learns how a detached run ended.
 *
 * Bounded by one deadline, because strut is waiting on the callback's
 * answer; never throws. Null means "could not read" — the card keeps what
 * the chat's previous row said.
 */

import { logger } from "@/lib/logger";
import {
  projectStrutChatActivity,
  toStrutChatRunStatus,
  type StrutChatActivity,
  type StrutChatRun,
} from "@/lib/strut-chat-activity";
import { STRUT_ACTOR_HEADER } from "@/services/bifrost/strut-delegation";
import { resolveStrutTarget, type StrutTarget } from "@/services/strut-target";

const DEADLINE_MS = 5_000;
const LOG_TAG = "STRUT_CHAT_ACTIVITY";

async function labGet(target: StrutTarget, path: string, signal: AbortSignal): Promise<unknown | null> {
  const res = await fetch(`${target.labBase}${path}`, {
    headers: { "x-api-token": target.swarmApiKey, [STRUT_ACTOR_HEADER]: target.actor },
    cache: "no-store",
    signal,
  });
  return res.ok ? res.json() : null;
}

/** Where the run stands now; the transcript's word when strut does not answer. */
async function refreshRun(target: StrutTarget, run: StrutChatRun, signal: AbortSignal): Promise<StrutChatRun> {
  try {
    const summary = (await labGet(
      target,
      `/workflows/${encodeURIComponent(run.workflow)}/runs/${encodeURIComponent(run.runId)}`,
      signal,
    )) as { status?: unknown } | null;
    return summary ? { ...run, status: toStrutChatRunStatus(summary.status, run.status) } : run;
  } catch {
    return run;
  }
}

export async function readStrutChatActivity(args: {
  workspaceSlug: string;
  userId: string;
  chatId: string;
}): Promise<StrutChatActivity | null> {
  try {
    const resolved = await resolveStrutTarget({
      purpose: "chat",
      workspaceSlug: args.workspaceSlug,
      userId: args.userId,
    });
    if (!resolved.ok) return null;
    const { target } = resolved;

    const signal = AbortSignal.timeout(DEADLINE_MS);
    const chat = (await labGet(target, `/chat/${encodeURIComponent(args.chatId)}`, signal)) as {
      messages?: unknown;
    } | null;
    if (!chat) return null;

    const activity = projectStrutChatActivity(chat.messages);
    const runs = await Promise.all(
      activity.runs.map((run) => (run.status === "running" ? refreshRun(target, run, signal) : run)),
    );
    return { workflows: activity.workflows, runs };
  } catch (err) {
    logger.warn("Strut chat activity unavailable", LOG_TAG, {
      workspaceSlug: args.workspaceSlug,
      chatId: args.chatId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
