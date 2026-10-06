/**
 * Canvas research fan-out worker.
 *
 * Appends a `source: { kind: "research" }` row to the owning canvas
 * conversation once a research sub-agent completes (or fails). The row
 * signals the UI to render a `ResearchRunCard` showing the final status
 * (ready / failed) and an "Open research" link.
 *
 * Design mirrors `canvas-planner-fanout.ts`:
 *   - `FOR UPDATE` lock serializes against concurrent autosave PUTs.
 *   - Idempotent on `researchId`: a second call for the same research
 *     is a silent no-op (prevents double-rows on worker retry).
 *   - Non-fatal: failures are logged but never block the caller.
 */

import { db } from "@/lib/db";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";
import type { StoredMessage } from "@/services/canvas-turn-persistence";
import { isRemovedTurn } from "@/lib/canvas/tombstones";

export interface ResearchFanOutPayload {
  researchId: string;
  slug: string;
  topic: string;
  title: string;
  summary: string;
  /** "ready" when the markdown writeup landed; "failed" otherwise. */
  status: "ready" | "failed";
  initiativeId?: string;
  /**
   * Optional sub-agent messages from the research loop's steps.
   * Filtered (code_execution / srvtoolu_ traces stripped) before write.
   */
  subAgentMessages?: StoredMessage[];
  /**
   * The turn that dispatched this research (`dispatch_research`'s
   * caller). When present, the fan-out skips entirely once this turn is
   * tombstoned (the user edited-and-replaced before the sub-agent
   * reported back), and stamps it onto the result row so a LATER edit
   * also removes this row.
   */
  originTurnId?: string;
}

/**
 * Strips assistant messages whose toolCalls contain Anthropic server-side
 * execution traces: any call with toolName === 'code_execution', OR any
 * call whose id is prefixed 'srvtoolu_' and whose toolName is not
 * 'web_search'. These have no counterpart tool-results in the parent
 * conversation and would cause sanitizer orphaned-tool-call warnings on
 * every subsequent canvas turn.
 */
export function filterSubAgentMessages(msgs: StoredMessage[]): StoredMessage[] {
  return msgs.filter((m) => {
    if (m.role !== "assistant" || !m.toolCalls?.length) return true;
    return !m.toolCalls.some(
      (tc) =>
        tc.toolName === "code_execution" ||
        (tc.id.startsWith("srvtoolu_") && tc.toolName !== "web_search"),
    );
  });
}

/** Row shape written into SharedConversation.messages. */
type ResearchMessageRow = {
  id: string;
  role: "assistant";
  content: string;
  timestamp: string;
  originTurnId?: string;
  source: {
    kind: "research";
    researchId: string;
    slug: string;
    topic: string;
    title: string;
    status: string;
    initiativeId?: string;
  };
};

/**
 * Append a research result row to the owning canvas conversation.
 *
 * Idempotent: if a row with `source.researchId === payload.researchId`
 * already exists, this is a silent no-op (safe for worker retries).
 *
 * When `payload.originTurnId` is set and that turn is tombstoned by the
 * time this runs (the user edited-and-replaced the dispatching turn
 * before the sub-agent reported back), the whole append is skipped —
 * the result row is stamped `originTurnId` so a tombstone that fires
 * AFTER this write still removes it on the next cut.
 */
export async function fanOutResearchToCanvas(
  conversationId: string,
  payload: ResearchFanOutPayload,
): Promise<void> {
  const {
    researchId,
    slug,
    topic,
    title,
    summary,
    status,
    initiativeId,
    originTurnId,
  } = payload;

  try {
    let didAppend = false;
    let skippedTombstoned = false;

    const filteredSubAgentMsgs = payload.subAgentMessages
      ? filterSubAgentMessages(payload.subAgentMessages)
      : [];

    await db.$transaction(async (tx) => {
      // Row-level lock against concurrent autosave PUTs — same pattern
      // as fanOutPlannerMessageToCanvas.
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
        ? (locked[0].messages as ResearchMessageRow[])
        : [];

      // Idempotency: skip if already fanned out for this researchId.
      const alreadyFannedOut = existingMessages.some(
        (m) =>
          (m.source as { kind?: string; researchId?: string })?.kind ===
            "research" &&
          (m.source as { researchId?: string })?.researchId === researchId,
      );
      if (alreadyFannedOut) {
        return;
      }

      const newRow: ResearchMessageRow = {
        id: `research-${researchId}`,
        role: "assistant",
        content:
          status === "ready"
            ? `Research ready: **${title}** — ${summary} (slug: \`${slug}\`)`
            : `Research failed for topic: ${topic}`,
        timestamp: new Date().toISOString(),
        ...(originTurnId ? { originTurnId } : {}),
        source: {
          kind: "research",
          researchId,
          slug,
          topic,
          title,
          status,
          ...(initiativeId ? { initiativeId } : {}),
        },
      };

      await tx.sharedConversation.update({
        where: { id: conversationId },
        data: {
          messages: [...existingMessages, ...filteredSubAgentMsgs, newRow] as unknown as never,
          lastMessageAt: new Date(),
        },
      });
      didAppend = true;
    });

    if (skippedTombstoned) {
      console.log("[canvas-turn] tombstoned-write-skipped", {
        conversationId,
        turnId: originTurnId,
        writer: "research",
      });
      return;
    }

    console.log("[canvas-research-fanout]", {
      conversationId,
      researchId,
      slug,
      status,
      didAppend,
    });

    if (didAppend) {
      notifyCanvasConversationUpdated(conversationId, "research");
    }
  } catch (e) {
    console.error(
      "[canvas-research-fanout] fanOutResearchToCanvas failed (non-fatal):",
      {
        conversationId,
        researchId,
        slug,
        error: e instanceof Error ? e.message : String(e),
      },
    );
  }
}
