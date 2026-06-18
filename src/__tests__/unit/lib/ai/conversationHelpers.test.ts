// @vitest-environment node

import { describe, it, expect } from "vitest";
import { toModelMessages } from "@/lib/ai/conversationHelpers";
import type { StoredMessage } from "@/services/canvas-turn-persistence";

describe("toModelMessages", () => {
  it("converts plain text user and assistant messages", () => {
    const stored: StoredMessage[] = [
      { role: "user", content: "Hello" } as StoredMessage,
      { role: "assistant", content: "Hi there" } as StoredMessage,
    ];
    const result = toModelMessages(stored);
    expect(result).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);
  });

  it("expands assistant message with tool calls and results into 3 ModelMessage entries", () => {
    const stored: StoredMessage[] = [
      {
        role: "assistant",
        content: "Here is what I found.",
        toolCalls: [
          {
            id: "tc1",
            toolName: "search",
            input: { query: "test" },
            output: { results: ["a", "b"] },
          },
        ],
      } as StoredMessage,
    ];

    const result = toModelMessages(stored);

    expect(result).toHaveLength(3);

    // 1. tool-call entry
    expect(result[0]).toEqual({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "tc1",
          toolName: "search",
          input: { query: "test" },
        },
      ],
    });

    // 2. tool-result entry — output without "type" key gets wrapped as json
    expect(result[1]).toEqual({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "tc1",
          toolName: "search",
          output: { type: "json", value: { results: ["a", "b"] } },
        },
      ],
    });

    // 3. trailing assistant text
    expect(result[2]).toEqual({
      role: "assistant",
      content: "Here is what I found.",
    });
  });

  it("omits tool-result message when tool call has no output or errorText", () => {
    const stored: StoredMessage[] = [
      {
        role: "assistant",
        content: null,
        toolCalls: [
          {
            id: "tc2",
            toolName: "no_result_tool",
            input: {},
            // output and errorText intentionally absent
          },
        ],
      } as unknown as StoredMessage,
    ];

    const result = toModelMessages(stored);

    // Only the tool-call entry; no tool-result, no trailing text
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "tc2",
          toolName: "no_result_tool",
          input: {},
        },
      ],
    });
  });

  it("filters out messages with empty content and no toolCalls", () => {
    const stored: StoredMessage[] = [
      { role: "user", content: "   " } as StoredMessage, // whitespace-only → filtered
      { role: "assistant", content: "" } as StoredMessage, // empty string → filtered
      { role: "user", content: "Keep me" } as StoredMessage,
    ];

    const result = toModelMessages(stored);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: "user", content: "Keep me" });
  });

  it("handles a mixed sequence (text, tool turn, text) with correct flat ordering", () => {
    const stored: StoredMessage[] = [
      { role: "user", content: "Start" } as StoredMessage,
      {
        role: "assistant",
        content: "Done searching.",
        toolCalls: [
          {
            id: "tc3",
            toolName: "lookup",
            input: { id: 42 },
            output: { found: true },
          },
        ],
      } as StoredMessage,
      { role: "user", content: "Thanks" } as StoredMessage,
    ];

    const result = toModelMessages(stored);

    // user + tool-call + tool-result + assistant-text + user = 5
    expect(result).toHaveLength(5);
    expect(result[0]).toMatchObject({ role: "user", content: "Start" });
    expect(result[1]).toMatchObject({ role: "assistant" }); // tool-call
    expect(result[2]).toMatchObject({ role: "tool" }); // tool-result
    expect(result[3]).toMatchObject({ role: "assistant", content: "Done searching." });
    expect(result[4]).toMatchObject({ role: "user", content: "Thanks" });
  });

  it("does not wrap output that already has a 'type' key", () => {
    const stored: StoredMessage[] = [
      {
        role: "assistant",
        content: null,
        toolCalls: [
          {
            id: "tc4",
            toolName: "typed_tool",
            input: {},
            output: { type: "text", value: "already typed" },
          },
        ],
      } as unknown as StoredMessage,
    ];

    const result = toModelMessages(stored);
    const toolResultMsg = result.find((m) => m.role === "tool") as any;
    expect(toolResultMsg).toBeDefined();
    // output already has "type" → should NOT be double-wrapped
    expect(toolResultMsg.content[0].output).toEqual({
      type: "text",
      value: "already typed",
    });
  });
});
