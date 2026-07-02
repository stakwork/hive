import type { ParsedMessage } from "./agent-log-stats";

/**
 * The stored shape of a dashboard/canvas chat message inside a
 * `SharedConversation.messages` JSON array. Mirrors the `Message`
 * interface used by `DashboardChat` — text content plus an optional
 * batch of tool calls (each carrying its own input AND output).
 */
export interface StoredChatToolCall {
  id: string;
  toolName: string;
  input?: unknown;
  status?: string;
  output?: unknown;
  errorText?: string;
}

export interface StoredChatMessage {
  id?: string;
  role: "user" | "assistant" | string;
  content?: string;
  imageData?: string;
  toolCalls?: StoredChatToolCall[];
  timestamp?: string | null;
  /**
   * Provenance tag for fanned-out sub-agent rows. For graph-walk
   * results (`kind === "graph_walk"`) `detailConversationId` points at
   * the standalone trace conversation so the detail view can link into
   * it.
   */
  source?: {
    kind?: string;
    detailConversationId?: string;
    title?: string;
    status?: string;
  };
}

/**
 * Convert a SharedConversation's stored chat messages into the
 * `ParsedMessage[]` blob format that the Agent Logs detail view
 * (`LogDetailContent`) renders. This unlocks the rich tool-call view
 * (call args + paired result + stats bar) for chat sessions, which
 * already persist every tool call's input and output — they just
 * weren't being surfaced.
 *
 * The mapping mirrors how `DashboardChat` serializes a turn back to
 * the AI SDK when sending: a tool batch becomes a `tool-call`
 * assistant message + a paired `tool-result` tool message, and text
 * stays a plain string message. `buildToolCallIndex` /
 * `getConsumedResultIds` (used by `LogDetailContent`) then pair each
 * call with its result by `toolCallId`.
 */
export function chatMessagesToParsedMessages(
  messages: StoredChatMessage[],
): ParsedMessage[] {
  const out: ParsedMessage[] = [];

  for (const m of messages) {
    if (!m || typeof m !== "object") continue;

    const toolCalls = Array.isArray(m.toolCalls) ? m.toolCalls : [];

    if (m.role === "assistant" && toolCalls.length > 0) {
      // 1. tool-call message (the calls the agent made)
      out.push({
        role: "assistant",
        content: toolCalls.map((tc) => ({
          type: "tool-call" as const,
          toolCallId: tc.id,
          toolName: tc.toolName,
          input: tc.input,
        })),
      });

      // 2. paired tool-result message (only for calls that resolved)
      const resolved = toolCalls.filter(
        (tc) => tc.output !== undefined || tc.errorText !== undefined,
      );
      if (resolved.length > 0) {
        out.push({
          role: "tool",
          content: resolved.map((tc) => ({
            type: "tool-result" as const,
            toolCallId: tc.id,
            toolName: tc.toolName,
            // Prefer the real output; fall back to the error text so a
            // failed call still shows *something* in the result pane.
            output:
              tc.output !== undefined
                ? (tc.output as { type: string; value: string } | string)
                : (tc.errorText as string),
          })),
        });
      }

      // 3. any trailing assistant text that accompanied the batch
      if (m.content) {
        out.push({ role: "assistant", content: m.content, timestamp: m.timestamp ?? null });
      }
      continue;
    }

    // Plain text message (user or assistant). Note image attachments
    // inline since the log view is text-only.
    let content = typeof m.content === "string" ? m.content : "";
    if (m.imageData) {
      content = content ? `[image attached]\n${content}` : "[image attached]";
    }
    const parsed: ParsedMessage = { role: m.role, content, timestamp: m.timestamp ?? null };
    // Graph-walk result rows carry a link down into their standalone
    // tool-call trace conversation — surface it so the detail view can
    // render a "view trace" drill-in.
    if (m.source?.kind === "graph_walk" && m.source.detailConversationId) {
      parsed.graphWalkTrace = {
        detailConversationId: m.source.detailConversationId,
        title: m.source.title,
        status: m.source.status,
      };
    }
    out.push(parsed);
  }

  return out;
}
