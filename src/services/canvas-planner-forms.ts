/**
 * Shared utilities for syncing planner-form answers into the owning
 * canvas conversation (`SharedConversation`).
 *
 * Extracted so both answer surfaces can use the same logic:
 *   - `POST /api/orgs/[githubLogin]/planner-forms/answer` (sidebar path)
 *   - `POST /api/features/[featureId]/chat` (feature page path, when replyId is set)
 */
import { db } from "@/lib/db";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";

/** Stored canvas message row shape (the `Json` column is untyped). */
interface CanvasMessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  source: {
    kind: "user-answered-planner-form";
    featureId: string;
    plannerMessageId: string;
  };
}

/**
 * Has this FORM already been answered in the canvas conversation?
 * Scans the `messages` JSON for a `user-answered-planner-form` row
 * matching `plannerMessageId`.
 */
export async function answerAlreadyRecorded(
  conversationId: string,
  plannerMessageId: string,
): Promise<boolean> {
  const row = await db.sharedConversation.findUnique({
    where: { id: conversationId },
    select: { messages: true },
  });
  if (!row || !Array.isArray(row.messages)) return false;
  return (row.messages as unknown as CanvasMessageRow[]).some(
    (m) =>
      m.source?.kind === "user-answered-planner-form" &&
      m.source.plannerMessageId === plannerMessageId,
  );
}

/**
 * Append a `user-answered-planner-form` row under the same row-level
 * lock the planner fan-out and the autosave PUT use, so all writers
 * serialize on the conversation row. Idempotent on `plannerMessageId`.
 */
export async function appendAnswerRow(
  conversationId: string,
  featureId: string,
  plannerMessageId: string,
  answer: string,
): Promise<void> {
  // A compact, human-readable summary for the thread entry / voice
  // surfaces. Full answer already lives in the planner's chat history.
  const summary = answer.length > 140 ? `${answer.slice(0, 137)}…` : answer;

  let didAppend = false;
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ messages: unknown }[]>`
      SELECT messages FROM shared_conversations WHERE id = ${conversationId} FOR UPDATE
    `;
    if (locked.length === 0) return; // conversation deleted

    const existing = Array.isArray(locked[0].messages)
      ? (locked[0].messages as CanvasMessageRow[])
      : [];

    const alreadyAppended = existing.some(
      (m) =>
        m.source?.kind === "user-answered-planner-form" &&
        m.source.plannerMessageId === plannerMessageId,
    );
    if (alreadyAppended) return;

    const newRow: CanvasMessageRow = {
      id: `answered-${plannerMessageId}`,
      role: "user",
      content: `Answered: ${summary}`,
      timestamp: new Date().toISOString(),
      source: {
        kind: "user-answered-planner-form",
        featureId,
        plannerMessageId,
      },
    };

    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: {
        messages: [...existing, newRow] as unknown as never,
        lastMessageAt: new Date(),
      },
    });
    didAppend = true;
  });

  // Live-update any OTHER open browser viewing this conversation (the
  // submitting client hides the FORM locally; this keeps a second tab
  // / device in sync).
  if (didAppend) {
    notifyCanvasConversationUpdated(conversationId, "form-answer");
  }
}
