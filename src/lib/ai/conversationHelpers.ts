/**
 * Shared helpers for SharedConversation rows used by both
 * workspace-scoped and org-scoped conversation API routes.
 */

/** Generate a title from the first user message (max 50 chars). */
export function generateTitle(messages: unknown[]): string {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "Untitled Conversation";
  }

  const firstUserMessage = messages.find((msg: any) => msg.role === "user");
  if (!firstUserMessage) return "Untitled Conversation";

  let text = "";
  const m = firstUserMessage as any;
  if (typeof m.content === "string") {
    text = m.content;
  } else if (Array.isArray(m.content)) {
    const textPart = m.content.find((part: any) => part.type === "text");
    text = textPart?.text || "";
  }

  const trimmed = text.trim();
  if (!trimmed) return "Untitled Conversation";
  return trimmed.length > 50 ? trimmed.substring(0, 50) + "..." : trimmed;
}

/** Return a short preview string from the first user message. */
export function getMessagePreview(messages: unknown[]): string | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;

  const firstUserMessage = messages.find((msg: any) => msg.role === "user");
  if (!firstUserMessage) return null;

  let text = "";
  const m = firstUserMessage as any;
  if (typeof m.content === "string") {
    text = m.content;
  } else if (Array.isArray(m.content)) {
    const textPart = m.content.find((part: any) => part.type === "text");
    text = textPart?.text || "";
  }

  return text.trim() || null;
}

/** Extract a Date from the last message's `createdAt`, falling back to now. */
export function getLastMessageTimestamp(messages: unknown[]): Date {
  if (!Array.isArray(messages) || messages.length === 0) return new Date();
  const lastMessage = messages[messages.length - 1] as any;
  if (lastMessage?.createdAt) return new Date(lastMessage.createdAt);
  return new Date();
}
