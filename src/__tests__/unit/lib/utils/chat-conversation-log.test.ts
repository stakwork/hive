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
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
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
    expect(out[2]).toEqual({ role: "assistant", content: "Here is what I found" });
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
      { role: "user", content: "[image attached]\nwhat is this" },
      { role: "user", content: "[image attached]" },
    ]);
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
