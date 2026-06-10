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

export interface ResearchFanOutPayload {
  researchId: string;
  slug: string;
  topic: string;
  title: string;
  summary: string;
  /** "ready" when the markdown writeup landed; "failed" otherwise. */
  status: "ready" | "failed";
  initiativeId?: string;
}

/** Row shape written into SharedConversation.messages. */
type ResearchMessageRow = {
  id: string;
  role: "assistant";
  content: string;
  timestamp: string;
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
 */
export async function fanOutResearchToCanvas(
  conversationId: string,
  payload: ResearchFanOutPayload,
): Promise<void> {
  const { researchId, slug, topic, title, summary, status, initiativeId } =
    payload;

  try {
    let didAppend = false;

    await db.$transaction(async (tx) => {
      // Row-level lock against concurrent autosave PUTs — same pattern
      // as fanOutPlannerMessageToCanvas.
      const locked = await tx.$queryRaw<{ messages: unknown }[]>`
        SELECT messages FROM shared_conversations WHERE id = ${conversationId} FOR UPDATE
      `;
      if (locked.length === 0) {
        // Conversation was deleted; nothing to do.
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
          messages: [...existingMessages, newRow] as unknown as never,
          lastMessageAt: new Date(),
        },
      });
      didAppend = true;
    });

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
