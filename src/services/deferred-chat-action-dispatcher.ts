/**
 * Dispatcher for due `DeferredChatAction` records.
 *
 * Called by the per-minute cron at `/api/cron/deferred-chat-actions`.
 * For each PENDING action whose `fireAt` has passed, the dispatcher:
 *   1. Claims it via SELECT FOR UPDATE SKIP LOCKED (concurrent-safe)
 *   2. Launches one turn of strut's `orchestrator` — Jamie's engine
 *      (`docs/jamie-engine.md`) — on the originating `SharedConversation`,
 *      with the original query as a check-back message; the reply lands
 *      later through the strut-runs webhook, like a person's message
 *   3. Patches `deferredCheck.status` → "FIRED" in the messages JSON
 *   4. Marks the `DeferredChatAction` row as FIRED
 *   5. Notifies open browser tabs via Pusher
 *
 * The conversation busy with another turn puts the action back to PENDING
 * for the next sweep. A refused launch is written into the conversation as
 * the reply and the action set FAILED; other errors are caught, logged,
 * and set FAILED too — remaining actions continue processing.
 */

import { db } from "@/lib/db";
import { loadUserChatAgentModel } from "@/lib/ai/resolve-model";
import { getBaseUrl } from "@/lib/utils";
import { appendTurnMessages } from "@/services/canvas-turn-persistence";
import { updateDeferredCheckStatus } from "@/services/deferred-check";
import { launchOrchestratorTurn } from "@/services/strut-orchestrator";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";

const LOG_PREFIX = "[DeferredChatActions]";
const MAX_PER_RUN = 10;

export interface DeferredDispatchResult {
  fired: number;
  failed: number;
  errors: string[];
}

/** What the orchestrator is sent when a check-back comes due. */
export function deferredCheckMessage(query: string): string {
  return (
    "[Check-back] Earlier in this conversation a check-back was scheduled for now. " +
    'Look into it again and start your reply with "Checking back as requested…". The request:\n\n' +
    query
  );
}

/**
 * Pick up all DeferredChatAction records that are due and have not yet been
 * processed. Returns counts of fired/failed actions.
 */
export async function dispatchDueActions(): Promise<DeferredDispatchResult> {
  const result: DeferredDispatchResult = { fired: 0, failed: 0, errors: [] };

  console.log(`${LOG_PREFIX} Starting dispatch run`);

  // Fetch up to MAX_PER_RUN due actions. We use a plain findMany here (not
  // FOR UPDATE) since each action is claimed with its own transaction below.
  const due = await db.deferredChatAction.findMany({
    where: {
      status: "PENDING",
      fireAt: { lte: new Date() },
    },
    orderBy: { fireAt: "asc" },
    take: MAX_PER_RUN,
  });

  if (due.length === 0) {
    console.log(`${LOG_PREFIX} Dispatch complete — fired: 0, failed: 0`);
    return result;
  }

  for (const action of due) {
    console.log(
      `${LOG_PREFIX} Dispatching deferredActionId=${action.id} conversationId=${action.conversationId}`,
    );

    try {
      const conversation = await db.sharedConversation.findUnique({
        where: { id: action.conversationId },
        select: {
          id: true,
          userId: true,
          sourceControlOrgId: true,
        },
      });

      if (!conversation) {
        throw new Error(
          `SharedConversation ${action.conversationId} not found`,
        );
      }

      if (!conversation.userId || !conversation.sourceControlOrgId) {
        throw new Error(
          `Conversation ${action.conversationId} is missing userId or orgId — cannot dispatch`,
        );
      }

      // IDOR guard: the conversation must be owned by the same user and org
      // that created the DeferredChatAction. A mismatched conversationId
      // (e.g. from a corrupted row) must never cause the dispatcher to
      // execute a query under a different user's identity or append to
      // another user's conversation.
      if (
        conversation.userId !== action.userId ||
        conversation.sourceControlOrgId !== action.orgId
      ) {
        throw new Error(
          `DeferredChatAction ${action.id} ownership mismatch: ` +
            `action.userId=${action.userId} conversation.userId=${conversation.userId}, ` +
            `action.orgId=${action.orgId} conversation.orgId=${conversation.sourceControlOrgId}`,
        );
      }

      // Attempt to claim the action inside a transaction with SKIP LOCKED
      // so a concurrent cron invocation can't double-fire it.
      let claimed = false;
      await db.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
          SELECT id, status FROM deferred_chat_actions
          WHERE id = ${action.id}
          FOR UPDATE SKIP LOCKED
        `;
        if (locked.length === 0 || locked[0].status !== "PENDING") {
          // Another process claimed it — skip.
          return;
        }
        // Mark as FIRED optimistically inside the transaction so no other
        // worker picks it up while we are running the agent below.
        await tx.deferredChatAction.update({
          where: { id: action.id },
          data: { status: "FIRED", firedAt: new Date() },
        });
        claimed = true;
      });

      if (!claimed) {
        // Another dispatcher already handled this action.
        console.log(
          `${LOG_PREFIX} deferredActionId=${action.id} already claimed by another worker — skipping`,
        );
        continue;
      }

      const userId = conversation.userId;
      const orgId = conversation.sourceControlOrgId;
      const model = await loadUserChatAgentModel(userId);
      const user = await db.user.findUnique({ where: { id: userId }, select: { timezone: true } });
      const launched = await launchOrchestratorTurn({
        userId,
        orgId,
        conversationId: action.conversationId,
        message: deferredCheckMessage(action.query),
        publicBaseUrl: getBaseUrl(null),
        timeZone: user?.timezone ?? undefined,
        ...(model ? { model } : {}),
      });

      if (launched.status === "busy") {
        // A turn is still running on the conversation: the next sweep tries again.
        await db.deferredChatAction.update({
          where: { id: action.id },
          data: { status: "PENDING", firedAt: null },
        });
        console.log(`${LOG_PREFIX} deferredActionId=${action.id} conversation busy — back to PENDING`);
        continue;
      }

      if (launched.status === "error") {
        // No browser is there for a notice: the person reads it in the chat.
        const idPrefix = `deferred-${action.id}-`;
        await appendTurnMessages({
          conversationId: action.conversationId,
          rows: [
            {
              id: `${idPrefix}header`,
              role: "assistant",
              content: `Checking back as requested… but the check could not be sent to strut: ${launched.error}`,
              timestamp: new Date().toISOString(),
            },
          ],
          idPrefix,
          reason: "deferred-check-fired",
        });
        await updateDeferredCheckStatus(action.conversationId, action.id, "FAILED");
        throw new Error(launched.error);
      }

      // Patch deferredCheck.status → FIRED in the conversation JSON and
      // update the DB row status (already set to FIRED in the transaction
      // above, but updateDeferredCheckStatus also patches the JSON).
      await updateDeferredCheckStatus(
        action.conversationId,
        action.id,
        "FIRED",
      );

      // Notify open browser tabs.
      notifyCanvasConversationUpdated(
        action.conversationId,
        "deferred-check-fired",
      );

      console.log(`${LOG_PREFIX} Fired deferredActionId=${action.id}`);
      result.fired++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `${LOG_PREFIX} FAILED deferredActionId=${action.id} error=${message}`,
      );
      result.errors.push(`${action.id}: ${message}`);
      result.failed++;

      // Best-effort: mark the row as FAILED so it doesn't get retried.
      await db.deferredChatAction
        .update({
          where: { id: action.id },
          data: { status: "FAILED" },
        })
        .catch((e) =>
          console.error(
            `${LOG_PREFIX} Failed to mark action as FAILED:`,
            e,
          ),
        );
    }
  }

  console.log(
    `${LOG_PREFIX} Dispatch complete — fired: ${result.fired}, failed: ${result.failed}`,
  );
  return result;
}
