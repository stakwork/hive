import { describe, it, expect } from "vitest";
import {
  chatMessagesToParsedMessages,
  type StoredChatMessage,
} from "@/lib/utils/chat-conversation-log";
import { parseAgentLogStats } from "@/lib/utils/agent-log-stats";
import { buildToolCallIndex, getConsumedResultIds } from "@/lib/utils/agent-log-pairing";

describe("chatMessagesToParsedMessages", () => {
  it("passes through plain user/assistant text", () => {
    const stored: StoredChatMessage[] = [
      { id: "1", role: "user", content: "hello" },
      { id: "2", role: "assistant", content: "hi there" },
    ];
    expect(chatMessagesToParsedMessages(stored)).toEqual([
      { role: "user", content: "hello", timestamp: null },
      { role: "assistant", content: "hi there", timestamp: null },
    ]);
  });

  it("splits a tool batch into a tool-call message + paired tool-result message", () => {
    const stored: StoredChatMessage[] = [
      {
        id: "2",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-1",
            toolName: "list_concepts",
            input: { q: "auth" },
            output: { features: ["a", "b"] },
            status: "output-available",
          },
        ],
      },
    ];

    const out = chatMessagesToParsedMessages(stored);
    expect(out).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "list_concepts",
            input: { q: "auth" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "list_concepts",
            output: { features: ["a", "b"] },
          },
        ],
      },
    ]);
  });

  it("appends trailing assistant text after a tool batch", () => {
    const stored: StoredChatMessage[] = [
      {
        id: "2",
        role: "assistant",
        content: "Here is what I found",
        toolCalls: [{ id: "c1", toolName: "search", input: {}, output: "ok" }],
      },
    ];
    const out = chatMessagesToParsedMessages(stored);
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ role: "assistant", content: "Here is what I found", timestamp: null });
  });

  it("omits the tool-result message when no call resolved, and uses errorText as fallback output", () => {
    const unresolved: StoredChatMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", toolName: "search", input: {}, status: "input-available" }],
      },
    ];
    expect(chatMessagesToParsedMessages(unresolved)).toEqual([
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "c1", toolName: "search", input: {} }],
      },
    ]);

    const errored: StoredChatMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c2", toolName: "search", input: {}, errorText: "boom" }],
      },
    ];
    const out = chatMessagesToParsedMessages(errored);
    expect(out[1]).toEqual({
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "c2", toolName: "search", output: "boom" }],
    });
  });

  it("inlines image attachments as text", () => {
    const stored: StoredChatMessage[] = [
      { role: "user", content: "what is this", imageData: "data:image/png;base64,xxx" },
      { role: "user", content: "", imageData: "data:image/png;base64,yyy" },
    ];
    expect(chatMessagesToParsedMessages(stored)).toEqual([
      { role: "user", content: "[image attached]\nwhat is this", timestamp: null },
      { role: "user", content: "[image attached]", timestamp: null },
    ]);
  });

  it("propagates timestamp from StoredChatMessage to ParsedMessage", () => {
    const stored: StoredChatMessage[] = [
      { role: "user", content: "hello", timestamp: "2024-01-15T10:30:00.000Z" },
      { role: "assistant", content: "hi there", timestamp: "2024-01-15T10:30:05.000Z" },
    ];
    const out = chatMessagesToParsedMessages(stored);
    expect(out[0].timestamp).toBe("2024-01-15T10:30:00.000Z");
    expect(out[1].timestamp).toBe("2024-01-15T10:30:05.000Z");
  });

  it("sets timestamp to null when StoredChatMessage has no timestamp", () => {
    const stored: StoredChatMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    const out = chatMessagesToParsedMessages(stored);
    expect(out[0].timestamp).toBeNull();
    expect(out[1].timestamp).toBeNull();
  });

  it("propagates timestamp to trailing text entry in tool-call batches", () => {
    const stored: StoredChatMessage[] = [
      {
        role: "assistant",
        content: "Here is what I found",
        timestamp: "2024-01-15T10:31:00.000Z",
        toolCalls: [{ id: "c1", toolName: "search", input: {}, output: "ok" }],
      },
    ];
    const out = chatMessagesToParsedMessages(stored);
    // trailing text entry is the 3rd message
    expect(out[2].timestamp).toBe("2024-01-15T10:31:00.000Z");
    // tool-call and tool-result entries have no timestamp
    expect(out[0].timestamp).toBeUndefined();
    expect(out[1].timestamp).toBeUndefined();
  });

  it("attaches graphWalkTrace from a graph_walk source row", () => {
    const stored: StoredChatMessage[] = [
      {
        id: "graph-walk-w1",
        role: "assistant",
        content: "Found 3 File nodes linked to AuthFeature.",
        source: {
          kind: "graph_walk",
          detailConversationId: "gw-conv-w1",
          title: "Files linked to AuthFeature",
          status: "ready",
        },
      },
    ];
    const out = chatMessagesToParsedMessages(stored);
    expect(out).toHaveLength(1);
    expect(out[0].graphWalkTrace).toEqual({
      detailConversationId: "gw-conv-w1",
      title: "Files linked to AuthFeature",
      status: "ready",
    });
  });

  it("does not attach graphWalkTrace when detailConversationId is absent", () => {
    const stored: StoredChatMessage[] = [
      {
        role: "assistant",
        content: "answer",
        source: { kind: "graph_walk", status: "ready" },
      },
    ];
    expect(chatMessagesToParsedMessages(stored)[0].graphWalkTrace).toBeUndefined();
  });

  it("graphWalkTrace survives the JSON.stringify → parseAgentLogStats round-trip", () => {
    const stored: StoredChatMessage[] = [
      {
        role: "assistant",
        content: "answer",
        source: { kind: "graph_walk", detailConversationId: "gw-conv-x" },
      },
    ];
    const parsed = chatMessagesToParsedMessages(stored);
    const { conversation } = parseAgentLogStats(JSON.stringify(parsed));
    expect(conversation[0].graphWalkTrace?.detailConversationId).toBe("gw-conv-x");
  });

  it("produces output the agent-log parser + pairing helpers consume correctly", () => {
    const stored: StoredChatMessage[] = [
      { role: "user", content: "find auth" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call-1", toolName: "list_concepts", input: {}, output: { features: [] } },
        ],
      },
      { role: "assistant", content: "Done" },
    ];

    const parsed = chatMessagesToParsedMessages(stored);
    const json = JSON.stringify(parsed);
    const { conversation, stats } = parseAgentLogStats(json);

    expect(stats.totalToolCalls).toBe(1);
    expect(stats.toolFrequency.list_concepts).toBe(1);

    const index = buildToolCallIndex(conversation);
    const consumed = getConsumedResultIds(conversation);
    // The call is paired with its result, so the standalone result
    // bubble would be suppressed and shown inline under the call.
    expect(index.has("call-1")).toBe(true);
    expect(consumed.has("call-1")).toBe(true);
  });
});
