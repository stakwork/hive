/**
 * Shared utilities for clarifying-question answer detection.
 * Used by FeaturePlanChat (canvas sidebar) and ChatArea (full plan page).
 */

/**
 * Returns the "reply" message for a clarifying-question message.
 * Priority:
 *   1. Explicit replyId match (form-submit path — preserves Q&A pairs)
 *   2. First USER-role message that appears after the question in the array
 *      (canvas-agent answer via send_to_feature_planner, or free-form text)
 */
export function findClarifyingReply<T extends { id: string; role: string; replyId?: string | null }>(
  messages: T[],
  questionMessageId: string,
): T | undefined {
  const explicit = messages.find((m) => m.replyId === questionMessageId);
  if (explicit) return explicit;
  const qIdx = messages.findIndex((m) => m.id === questionMessageId);
  if (qIdx === -1) return undefined;
  return messages.find((m, i) => i > qIdx && m.role === "USER");
}

/**
 * True when at least one PLAN/ask_clarifying_questions artifact has
 * no subsequent answer (explicit replyId OR any later USER message).
 */
export function hasPendingClarifyingQuestions(
  messages: {
    id: string;
    role: string;
    replyId?: string | null;
    artifacts?: { type: string; content?: unknown }[];
  }[],
  isClarifyingQuestions: (c: unknown) => boolean,
): boolean {
  return messages.some((m, idx) => {
    const hasClarifying = (m.artifacts ?? []).some(
      (a) => a.type === "PLAN" && isClarifyingQuestions(a.content),
    );
    if (!hasClarifying) return false;
    if (messages.some((r) => r.replyId === m.id)) return false;
    return !messages.some((r, i) => i > idx && r.role === "USER");
  });
}
