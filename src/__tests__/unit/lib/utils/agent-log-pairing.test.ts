import { describe, test, expect } from "vitest";
import { buildToolCallIndex, getConsumedResultIds } from "@/lib/utils/agent-log-pairing";
import type { ParsedMessage, ToolResultContent } from "@/lib/utils/agent-log-stats";

const makeToolCallMsg = (toolCallId: string, toolName: string): ParsedMessage => ({
  role: "assistant",
  content: [
    { type: "tool-call", toolCallId, toolName, input: { key: "value" } },
  ],
});

const makeToolResultMsg = (toolCallId: string, output: string): ParsedMessage => ({
  role: "tool",
  content: [
    { type: "tool-result", toolCallId, toolName: "someTool", output },
  ],
});

const makeOpenAIAssistantMsg = (id: string, name: string): ParsedMessage => ({
  role: "assistant",
  tool_calls: [
    { id, type: "function", function: { name, arguments: '{"x":1}' } },
  ],
});

const makeOpenAIToolResultMsg = (tool_call_id: string, content: string): ParsedMessage => ({
  role: "tool",
  tool_call_id,
  content,
});

describe("buildToolCallIndex", () => {
  test("returns empty map for empty conversation", () => {
    const index = buildToolCallIndex([]);
    expect(index.size).toBe(0);
  });

  test("indexes Vercel AI SDK tool-result by toolCallId", () => {
    const conversation: ParsedMessage[] = [
      makeToolCallMsg("call-1", "bash"),
      makeToolResultMsg("call-1", "output text"),
    ];
    const index = buildToolCallIndex(conversation);
    expect(index.has("call-1")).toBe(true);
    const result = index.get("call-1") as ToolResultContent;
    expect(result.type).toBe("tool-result");
    expect(result.output).toBe("output text");
  });

  test("indexes OpenAI-style tool result by tool_call_id", () => {
    const conversation: ParsedMessage[] = [
      makeOpenAIAssistantMsg("oai-1", "my_tool"),
      makeOpenAIToolResultMsg("oai-1", "oai output"),
    ];
    const index = buildToolCallIndex(conversation);
    expect(index.has("oai-1")).toBe(true);
    const result = index.get("oai-1") as ToolResultContent;
    expect(result.toolCallId).toBe("oai-1");
    expect(result.output).toBe("oai output");
  });

  test("indexes multiple tool results", () => {
    const conversation: ParsedMessage[] = [
      makeToolCallMsg("call-1", "bash"),
      makeToolCallMsg("call-2", "read_file"),
      makeToolResultMsg("call-1", "bash output"),
      makeToolResultMsg("call-2", "file content"),
    ];
    const index = buildToolCallIndex(conversation);
    expect(index.size).toBe(2);
    expect(index.get("call-1")?.output).toBe("bash output");
    expect(index.get("call-2")?.output).toBe("file content");
  });

  test("ignores tool-result parts without toolCallId", () => {
    const conversation: ParsedMessage[] = [
      {
        role: "tool",
        content: [{ type: "tool-result", output: "no id" }],
      },
    ];
    const index = buildToolCallIndex(conversation);
    expect(index.size).toBe(0);
  });

  test("ignores messages without array content for tool results", () => {
    const conversation: ParsedMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ];
    const index = buildToolCallIndex(conversation);
    expect(index.size).toBe(0);
  });
});

describe("getConsumedResultIds", () => {
  test("returns empty set for empty conversation", () => {
    const consumed = getConsumedResultIds([]);
    expect(consumed.size).toBe(0);
  });

  test("adds toolCallId from Vercel AI SDK tool-call parts", () => {
    const conversation: ParsedMessage[] = [makeToolCallMsg("call-1", "bash")];
    const consumed = getConsumedResultIds(conversation);
    expect(consumed.has("call-1")).toBe(true);
  });

  test("adds id from OpenAI-style tool_calls array", () => {
    const conversation: ParsedMessage[] = [makeOpenAIAssistantMsg("oai-1", "my_tool")];
    const consumed = getConsumedResultIds(conversation);
    expect(consumed.has("oai-1")).toBe(true);
  });

  test("collects multiple tool call ids", () => {
    const conversation: ParsedMessage[] = [
      makeToolCallMsg("call-1", "bash"),
      makeToolCallMsg("call-2", "read_file"),
      makeOpenAIAssistantMsg("oai-1", "some_fn"),
    ];
    const consumed = getConsumedResultIds(conversation);
    expect(consumed.size).toBe(3);
    expect(consumed.has("call-1")).toBe(true);
    expect(consumed.has("call-2")).toBe(true);
    expect(consumed.has("oai-1")).toBe(true);
  });

  test("ignores tool_calls entries without id", () => {
    const conversation: ParsedMessage[] = [
      {
        role: "assistant",
        tool_calls: [{ type: "function", function: { name: "fn" } }],
      },
    ];
    const consumed = getConsumedResultIds(conversation);
    expect(consumed.size).toBe(0);
  });

  test("does not include tool-result ids (only tool-call ids)", () => {
    const conversation: ParsedMessage[] = [
      makeToolCallMsg("call-1", "bash"),
      makeToolResultMsg("call-1", "output"),
    ];
    const consumed = getConsumedResultIds(conversation);
    // Should have call-1 from the tool-call, not duplicated from result
    expect(consumed.has("call-1")).toBe(true);
    expect(consumed.size).toBe(1);
  });
});
