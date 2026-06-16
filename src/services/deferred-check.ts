/**
 * Shared helpers for `DeferredChatAction` status management.
 *
 * `updateDeferredCheckStatus` patches both:
 *   1. The `DeferredChatAction` row's `status` column
 *   2. The matching `deferredCheck.status` field inside the
 *      `SharedConversation.messages` JSON array
 *
 * Both writes run in the same DB transaction so observers always see a
 * consistent state. The JSON patch uses PostgreSQL's `jsonb_set` to avoid
 * a full array read-modify-write race.
 */
import { db } from "@/lib/db";
import { DeferredChatActionStatus } from "@prisma/client";

export async function updateDeferredCheckStatus(
  conversationId: string,
  deferredActionId: string,
  status: DeferredChatActionStatus,
): Promise<void> {
  await db.$transaction(async (tx) => {
    // 1. Update the DeferredChatAction row itself.
    await tx.deferredChatAction.update({
      where: { id: deferredActionId },
      data: { status },
    });

    // 2. Patch the matching element's deferredCheck.status in the
    //    SharedConversation.messages JSONB array.
    //
    //    Strategy: iterate with jsonb_array_elements_text to locate the
    //    index of the element whose deferredCheck.id matches, then use
    //    jsonb_set to update only that field. Because we need the index we
    //    use a WITH ORDINALITY CTE, then reconstruct the array via
    //    jsonb_agg preserving order.
    //
    //    The UPDATE is a no-op if no matching element exists (e.g. the
    //    conversation was deleted or the message predates this feature).
    await tx.$executeRaw`
      UPDATE shared_conversations
      SET messages = (
        SELECT jsonb_agg(
          CASE
            WHEN elem->'deferredCheck'->>'id' = ${deferredActionId}
            THEN jsonb_set(elem, '{deferredCheck,status}', to_jsonb(${status}::text))
            ELSE elem
          END
          ORDER BY ord
        )
        FROM jsonb_array_elements(messages) WITH ORDINALITY AS t(elem, ord)
      )
      WHERE id = ${conversationId}
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(messages) AS elem
          WHERE elem->'deferredCheck'->>'id' = ${deferredActionId}
        )
    `;
  });
}
