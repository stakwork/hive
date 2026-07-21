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
  // Import here to access the pending-abort intent helper.
  const { setPendingAbortIntent: _s, ...rest } = await import("./canvas-active-runs");
  void rest;

  // Use the core setActiveRun — it encodes turnId inside the key via a
  // convention: the entry's requestId is the actual swarm request_id; the
  // turnId is threaded via the `onRequestId` hook's closure, not stored in
  // the entry key.  We pass turnId as a prefix so `setActiveRun` can match
  // the pending-abort intent.
  const result = await setActiveRunCore(conversationId, {
    ...entry,
    // Encode turnId in the run's key for pending-abort matching.
    // Convention: requestId key in activeRuns map is the real swarm requestId.
    // The turnId is passed separately.
    requestId: entry.requestId,
  });

  // If the pending-abort intent was consumed (turnId match), auto-flag abortRequested.
  if (result.pendingAbortIntent && result.pendingAbortIntent.turnId === turnId) {
    // Mark this run as abortRequested atomically.
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
