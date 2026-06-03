import type { ParsedMessage, ToolResultContent } from "./agent-log-stats";

/**
 * Scans all messages in a conversation once and returns a map of
 * toolCallId → ToolResultContent for every tool result found.
 */
export function buildToolCallIndex(
  conversation: ParsedMessage[],
): Map<string, ToolResultContent> {
  const index = new Map<string, ToolResultContent>();

  for (const message of conversation) {
    // Vercel AI SDK style: role="tool" with array content containing tool-result parts
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (
          part != null &&
          typeof part === "object" &&
          part.type === "tool-result" &&
          (part as ToolResultContent).toolCallId
        ) {
          const tr = part as ToolResultContent;
          index.set(tr.toolCallId!, tr);
        }
      }
    }

    // OpenAI style: role="tool" with tool_call_id string and string content
    if (
      message.role === "tool" &&
      message.tool_call_id &&
      typeof message.content === "string"
    ) {
      const synthetic: ToolResultContent = {
        type: "tool-result",
        toolCallId: message.tool_call_id,
        output: message.content,
      };
      index.set(message.tool_call_id, synthetic);
    }
  }

  return index;
}

/**
 * Returns the set of toolCallIds that have a matching tool-call in the conversation.
 * Used to skip standalone result bubbles for paired calls.
 */
export function getConsumedResultIds(conversation: ParsedMessage[]): Set<string> {
  const consumed = new Set<string>();

  for (const message of conversation) {
    // Vercel AI SDK tool-call parts
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (
          part != null &&
          typeof part === "object" &&
          part.type === "tool-call" &&
          (part as { toolCallId?: string }).toolCallId
        ) {
          consumed.add((part as { toolCallId: string }).toolCallId);
        }
      }
    }

    // OpenAI style: assistant message with tool_calls array
    if (Array.isArray(message.tool_calls)) {
      for (const tc of message.tool_calls) {
        if (tc?.id) consumed.add(tc.id);
      }
    }
  }

  return consumed;
}
