/**
 * Thin wrapper around `canvas-active-runs` that also fires Pusher
 * events for run-active state changes. Kept separate so test workers
 * that test the core service can import `canvas-active-runs` directly
 * without pulling in Pusher / Next.js server deps.
 */
export {
  setActiveRun as _setActiveRunCore,
  clearActiveRun as _clearActiveRunCore,
  isAbortRequestedForRun,
} from "./canvas-active-runs";

import {
  setActiveRun as setActiveRunCore,
  clearActiveRun as clearActiveRunCore,
  type ActiveRunEntry,
} from "./canvas-active-runs";
import {
  pusherServer,
  PUSHER_EVENTS,
  getCanvasConversationChannelName,
} from "@/lib/pusher";

/**
 * Register an active run and optionally broadcast run-active = true.
 * Consumes any pending-abort intent for the given turnId.
 */
export async function setActiveRun(
  conversationId: string,
  entry: ActiveRunEntry,
  turnId: string,
): Promise<{ abortSelf: boolean }> {
  // Stamp the turnId onto the entry — the core `setActiveRun` matches it
  // against a pending-abort intent (Stop pressed before this run had a
  // request_id to abort) and returns the consumed intent on a match.
  const result = await setActiveRunCore(conversationId, {
    ...entry,
    turnId,
  });

  // Intent consumed (turnId match) → flag this run abortRequested so the
  // poll loop cancels it on its next cycle.
  if (result.pendingAbortIntent && result.pendingAbortIntent.turnId === turnId) {
    const { requestAbortForAllRuns } = await import("./canvas-active-runs");
    await requestAbortForAllRuns(conversationId);
    return { abortSelf: true };
  }
  return { abortSelf: false };
}

/**
 * Clear a run entry and return wasLast (for Pusher run-ended broadcast).
 */
export async function clearActiveRun(
  conversationId: string,
  requestId: string,
): Promise<{ wasLast: boolean }> {
  return clearActiveRunCore(conversationId, requestId);
}

/**
 * Broadcast the run-active boolean to all participants in the conversation
 * channel. Payload is ONLY `{ active: boolean }` — no correlators.
 * Fire-and-forget; never throws.
 */
export async function notifyRunActive(
  conversationId: string,
  active: boolean,
): Promise<void> {
  try {
    await pusherServer.trigger(
      getCanvasConversationChannelName(conversationId),
      PUSHER_EVENTS.CANVAS_RUN_ACTIVE,
      { active },
    );
  } catch (err) {
    console.error("[canvas-active-runs] notifyRunActive Pusher trigger failed (non-fatal):", err);
  }
}
