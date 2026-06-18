/**
 * Shared helpers for SharedConversation rows used by both
 * workspace-scoped and org-scoped conversation API routes.
 */

import type { ModelMessage } from "ai";
import type { StoredMessage } from "@/services/canvas-turn-persistence";

/**
 * Converts stored canvas/conversation messages into AI SDK `ModelMessage[]`.
 * Filters out empty messages, expands assistant tool-call turns into the
 * three-part shape the AI SDK expects (tool-call, tool-result, text).
 */
export function toModelMessages(messages: StoredMessage[]): ModelMessage[] {
  return messages
    .filter((m) => (m.content?.trim() || m.toolCalls) && m.role)
    .flatMap((m): ModelMessage[] => {
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const out: ModelMessage[] = [];
        out.push({
          role: "assistant",
          content: m.toolCalls.map((tc) => ({
            type: "tool-call" as const,
            toolCallId: tc.id,
            toolName: tc.toolName,
            input: tc.input || {},
          })),
        });
        const toolResults = m.toolCalls.filter(
          (tc) => tc.output !== undefined || tc.errorText !== undefined,
        );
        if (toolResults.length > 0) {
          out.push({
            role: "tool",
            content: toolResults.map((tc) => {
              let wrappedOutput = tc.output;
              if (
                tc.output &&
                typeof tc.output === "object" &&
                !("type" in tc.output)
              ) {
                wrappedOutput = { type: "json", value: tc.output };
              }
              return {
                type: "tool-result" as const,
                toolCallId: tc.id,
                toolName: tc.toolName,
                output: wrappedOutput as never,
              };
            }),
          } as ModelMessage);
        }
        if (m.content) {
          out.push({ role: "assistant", content: m.content });
        }
        return out;
      }
      return [{ role: m.role, content: m.content }];
    });
}

/** Placeholder title for a conversation with no usable first user message. */
export const UNTITLED_CONVERSATION = "Untitled Conversation";

/**
 * Upper bound for stored titles. This is a storage guard, not a display
 * concern — UIs truncate titles visually (CSS `truncate`) so the title is
 * stored whole (no trailing ellipsis) up to this generous single-line cap.
 */
export const TITLE_MAX_LENGTH = 200;

/**
 * Generate a title from the first user message.
 *
 * The full message text is used (whitespace collapsed to a single line) up to
 * {@link TITLE_MAX_LENGTH} characters, with no trailing ellipsis. Display
 * surfaces are responsible for visually truncating long titles.
 */
export function generateTitle(messages: unknown[]): string {
  if (!Array.isArray(messages) || messages.length === 0) {
    return UNTITLED_CONVERSATION;
  }

  const firstUserMessage = messages.find((msg: any) => msg.role === "user");
  if (!firstUserMessage) return UNTITLED_CONVERSATION;

  let text = "";
  const m = firstUserMessage as any;
  if (typeof m.content === "string") {
    text = m.content;
  } else if (Array.isArray(m.content)) {
    const textPart = m.content.find((part: any) => part.type === "text");
    text = textPart?.text || "";
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return UNTITLED_CONVERSATION;
  return normalized.slice(0, TITLE_MAX_LENGTH);
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
