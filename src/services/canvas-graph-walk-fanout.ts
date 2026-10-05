/**
 * Canvas graph-walk fan-out.
 *
 * Appends a `source: { kind: "graph_walk" }` row to the owning canvas
 * conversation once a graph-walk sub-agent completes (or fails). The
 * row renders as a normal assistant bubble in SidebarChat (no special
 * card component required for MVP — the `content` field carries the
 * synthesized answer).
 *
 * Design mirrors `canvas-research-fanout.ts`:
 *   - `FOR UPDATE` lock serializes against concurrent autosave PUTs.
 *   - Idempotent on `graphWalkId`: a second call for the same walk is
 *     a silent no-op (prevents double-rows on worker retry).
 *   - Non-fatal: failures are logged but never block the caller.
 */

import { db } from "@/lib/db";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";
import { isRemovedTurn } from "@/lib/canvas/tombstones";

export interface GraphWalkFanOutPayload {
  graphWalkId: string;
  title: string;
  answer: string;
  /** "ready" when the sub-agent produced an answer; "failed" otherwise. */
  status: "ready" | "failed";
  /**
   * Id of the standalone (history-hidden, `source: "graph-walk"`)
   * SharedConversation row that holds the sub-agent's full tool-call
   * trace. Stashed on the result bubble's `source` so the UI can
   * deep-link to "view graph walk trace". Absent when the trace write
   * failed (non-fatal — the answer bubble still lands).
   */
  detailConversationId?: string;
  /**
   * The turn that dispatched this graph walk (`dispatch_graph_walk`'s
   * caller). When present, the fan-out skips entirely once this turn is
   * tombstoned, and stamps it onto the result row so a LATER edit also
   * removes this row.
   */
  originTurnId?: string;
};

/** Row shape written into SharedConversation.messages. */
type GraphWalkMessageRow = {
  id: string;
  role: "assistant";
  content: string;
  timestamp: string;
  originTurnId?: string;
  source: {
    kind: "graph_walk";
    graphWalkId: string;
    title: string;
    status: string;
    detailConversationId?: string;
  };
};

/**
 * Append a graph-walk result row to the owning canvas conversation.
 *
 * Idempotent: if a row with `source.graphWalkId === payload.graphWalkId`
 * already exists, this is a silent no-op (safe for worker retries).
 *
 * When `payload.originTurnId` is set and that turn is tombstoned by the
 * time this runs, the whole append is skipped (see `fanOutResearchToCanvas`
 * for the identical pattern).
 */
export async function fanOutGraphWalkToCanvas(
  conversationId: string,
  payload: GraphWalkFanOutPayload,
): Promise<void> {
  const {
    graphWalkId,
    title,
    answer,
    status,
    detailConversationId,
    originTurnId,
  } = payload;

  try {
    let didAppend = false;
    let skippedTombstoned = false;

    await db.$transaction(async (tx) => {
      // Row-level lock against concurrent autosave PUTs — same pattern
      // as fanOutResearchToCanvas / fanOutPlannerMessageToCanvas.
      const locked = await tx.$queryRaw<{ messages: unknown; settings: unknown }[]>`
        SELECT messages, settings FROM shared_conversations WHERE id = ${conversationId} FOR UPDATE
      `;
      if (locked.length === 0) {
        // Conversation was deleted; nothing to do.
        return;
      }

      if (originTurnId && isRemovedTurn(locked[0].settings, originTurnId)) {
        skippedTombstoned = true;
        return;
      }

      const existingMessages = Array.isArray(locked[0].messages)
        ? (locked[0].messages as GraphWalkMessageRow[])
        : [];

      // Idempotency: skip if already fanned out for this graphWalkId.
      const alreadyFannedOut = existingMessages.some(
        (m) =>
          (m.source as { kind?: string; graphWalkId?: string })?.kind ===
            "graph_walk" &&
          (m.source as { graphWalkId?: string })?.graphWalkId === graphWalkId,
      );
      if (alreadyFannedOut) {
        return;
      }

      const newRow: GraphWalkMessageRow = {
        id: `graph-walk-${graphWalkId}`,
        role: "assistant",
        content:
          status === "ready"
            ? answer
            : `Graph walk failed for: ${title}`,
        timestamp: new Date().toISOString(),
        ...(originTurnId ? { originTurnId } : {}),
        source: {
          kind: "graph_walk",
          graphWalkId,
          title,
          status,
          ...(detailConversationId ? { detailConversationId } : {}),
        },
      };

      await tx.sharedConversation.update({
        where: { id: conversationId },
        data: {
          messages: [...existingMessages, newRow] as unknown as never,
          lastMessageAt: new Date(),
        },
      });
      didAppend = true;
    });

    if (skippedTombstoned) {
      console.log("[canvas-turn] tombstoned-write-skipped", {
        conversationId,
        turnId: originTurnId,
        writer: "graph-walk",
      });
      return;
    }

    console.log("[canvas-graph-walk-fanout]", {
      conversationId,
      graphWalkId,
      title,
      status,
      didAppend,
    });

    if (didAppend) {
      notifyCanvasConversationUpdated(conversationId, "graph_walk");
    }
  } catch (e) {
    console.error(
      "[canvas-graph-walk-fanout] fanOutGraphWalkToCanvas failed (non-fatal):",
      {
        conversationId,
        graphWalkId,
        title,
        error: e instanceof Error ? e.message : String(e),
      },
    );
  }
}
