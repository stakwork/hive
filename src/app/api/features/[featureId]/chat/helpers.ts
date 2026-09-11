import { ChatRole } from "@/lib/chat";

/**
 * Resolve which message to resend on retry, mirroring the client-side
 * branching in PlanChatView.handleRetry:
 *   - If any ASSISTANT message exists → resend the most recent USER message.
 *   - If no ASSISTANT message exists yet → resend the very first message.
 * Returns null when there is nothing resendable.
 */
export function resolveRetryMessage(
  messages: { role: string; message: string }[],
): string | null {
  if (messages.length === 0) return null;

  const hasAssistant = messages.some((m) => m.role === ChatRole.ASSISTANT);
  if (hasAssistant) {
    // Most recent USER message (history is asc, so reverse search)
    const userMsg = [...messages].reverse().find((m) => m.role === ChatRole.USER);
    return userMsg?.message ?? null;
  }
  // No assistant reply yet — resend the very first message
  return messages[0].message ?? null;
}
