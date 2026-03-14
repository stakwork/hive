import { describe, it, expect } from "vitest";
import { parseAgentLogStats } from "@/lib/utils/agent-log-stats";

// Helper to build a JSON string from a bare array
const bare = (messages: unknown[]) => JSON.stringify(messages);
// Helper to build a JSON string from { messages: [...] } wrapper
const wrapped = (messages: unknown[]) => JSON.stringify({ messages });

describe("parseAgentLogStats", () => {
  describe("input formats", () => {
    it("handles bare array input", () => {
      const input = bare([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ]);
      const { conversation, stats } = parseAgentLogStats(input);
      expect(conversation).toHaveLength(2);
      expect(stats.totalMessages).toBe(2);
    });

    it("handles { messages: [] } wrapper input", () => {
      const input = wrapped([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ]);
      const { conversation, stats } = parseAgentLogStats(input);
      expect(conversation).toHaveLength(2);
      expect(stats.totalMessages).toBe(2);
    });

    it("returns zero stats for empty array", () => {
      const { conversation, stats } = parseAgentLogStats(bare([]));
      expect(conversation).toHaveLength(0);
      expect(stats.totalMessages).toBe(0);
      expect(stats.estimatedTokens).toBe(0);
      expect(stats.totalToolCalls).toBe(0);
      expect(stats.toolFrequency).toEqual({});
      expect(stats.bashFrequency).toEqual({});
    });

    it("returns zero stats for invalid JSON", () => {
      const { conversation, stats } = parseAgentLogStats("not json");
      expect(conversation).toHaveLength(0);
      expect(stats.totalMessages).toBe(0);
    });

    it("returns zero stats for JSON with no valid messages", () => {
      const { conversation, stats } = parseAgentLogStats(JSON.stringify({ foo: "bar" }));
      expect(conversation).toHaveLength(0);
      expect(stats.totalMessages).toBe(0);
    });
  });

  describe("tool call counting", () => {
    it("returns zero tool calls when there are none", () => {
      const input = bare([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there, how can I help?" },
      ]);
      const { stats } = parseAgentLogStats(input);
      expect(stats.totalToolCalls).toBe(0);
      expect(stats.toolFrequency).toEqual({});
    });

    it("counts AI SDK format tool calls (content[].type === 'tool-call')", () => {
      const input = bare([
        { role: "user", content: "Run bash" },
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "1", toolName: "bash", input: { cmd: "ls" } },
            { type: "tool-call", toolCallId: "2", toolName: "bash", input: { cmd: "pwd" } },
            { type: "tool-call", toolCallId: "3", toolName: "file_summary", input: {} },
          ],
        },
      ]);
      const { stats } = parseAgentLogStats(input);
      expect(stats.totalToolCalls).toBe(3);
      expect(stats.toolFrequency).toEqual({ bash: 2, file_summary: 1 });
    });

    it("counts OpenAI format tool calls (tool_calls[].type === 'function')", () => {
      const input = bare([
        { role: "user", content: "Do stuff" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "a", type: "function", function: { name: "search", arguments: "{}" } },
            { id: "b", type: "function", function: { name: "search", arguments: "{}" } },
            { id: "c", type: "function", function: { name: "read_file", arguments: "{}" } },
          ],
        },
      ]);
      const { stats } = parseAgentLogStats(input);
      expect(stats.totalToolCalls).toBe(3);
      expect(stats.toolFrequency).toEqual({ search: 2, read_file: 1 });
    });

    it("counts mixed AI SDK and OpenAI format tool calls in the same log", () => {
      const input = bare([
        { role: "user", content: "Mixed" },
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "1", toolName: "bash" },
            { type: "tool-call", toolCallId: "2", toolName: "file_list" },
          ],
        },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "x", type: "function", function: { name: "bash", arguments: "{}" } },
          ],
        },
      ]);
      const { stats } = parseAgentLogStats(input);
      expect(stats.totalToolCalls).toBe(3);
      expect(stats.toolFrequency).toEqual({ bash: 2, file_list: 1 });
    });

    it("ignores tool calls in non-assistant messages", () => {
      const input = bare([
        {
          role: "user",
          content: [
            { type: "tool-call", toolCallId: "1", toolName: "should_not_count" },
          ],
        },
        {
          role: "tool",
          content: [
            { type: "tool-call", toolCallId: "2", toolName: "also_ignored" },
          ],
        },
      ]);
      const { stats } = parseAgentLogStats(input);
      expect(stats.totalToolCalls).toBe(0);
      expect(stats.toolFrequency).toEqual({});
    });
  });

  describe("token estimation", () => {
    it("estimates tokens as Math.ceil(totalChars / 4)", () => {
      // "user" (4) + "Hello world" (11) = 15 chars → ceil(15/4) = 4
      const input = bare([{ role: "user", content: "Hello world" }]);
      const { stats } = parseAgentLogStats(input);
      const expectedChars = "user".length + "Hello world".length;
      expect(stats.estimatedTokens).toBe(Math.ceil(expectedChars / 4));
    });

    it("includes all messages in token count", () => {
      const messages = [
        { role: "user", content: "AAAA" },       // 4 + 4 = 8
        { role: "assistant", content: "BBBBBBBB" }, // 9 + 8 = 17
      ];
      const input = bare(messages);
      const { stats } = parseAgentLogStats(input);
      const totalChars =
        "user".length + "AAAA".length +
        "assistant".length + "BBBBBBBB".length;
      expect(stats.estimatedTokens).toBe(Math.ceil(totalChars / 4));
    });

    it("returns zero tokens for empty conversation", () => {
      const { stats } = parseAgentLogStats(bare([]));
      expect(stats.estimatedTokens).toBe(0);
    });
  });

  describe("bash tool special case", () => {
    it("AI SDK format: 'ls -la /tmp' → bashFrequency: { ls: 1 }", () => {
      const input = bare([
        { role: "user", content: "List files" },
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "1", toolName: "bash", input: { command: "ls -la /tmp" } },
          ],
        },
      ]);
      const { stats } = parseAgentLogStats(input);
      expect(stats.bashFrequency).toEqual({ ls: 1 });
    });

    it("multiple calls produce correct counts", () => {
      const grepCalls = Array.from({ length: 12 }, (_, i) => ({
        type: "tool-call",
        toolCallId: `g${i}`,
        toolName: "bash",
        input: { command: "grep -r pattern ." },
      }));
      const lsCalls = Array.from({ length: 5 }, (_, i) => ({
        type: "tool-call",
        toolCallId: `l${i}`,
        toolName: "bash",
        input: { command: "ls -la" },
      }));
      const catCall = {
        type: "tool-call",
        toolCallId: "c0",
        toolName: "bash",
        input: { command: "cat file.txt" },
      };
      const input = bare([
        { role: "user", content: "Go" },
        { role: "assistant", content: [...grepCalls, ...lsCalls, catCall] },
      ]);
      const { stats } = parseAgentLogStats(input);
      expect(stats.bashFrequency).toEqual({ grep: 12, ls: 5, cat: 1 });
    });

    it("OpenAI format: JSON arguments string with command field is split and counted correctly", () => {
      const input = bare([
        { role: "user", content: "Go" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "a", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "git status" }) } },
            { id: "b", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "git log --oneline" }) } },
          ],
        },
      ]);
      const { stats } = parseAgentLogStats(input);
      expect(stats.bashFrequency).toEqual({ git: 2 });
    });

    it("single-word command with no space → { pwd: 1 }", () => {
      const input = bare([
        { role: "user", content: "Where am I?" },
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "1", toolName: "bash", input: { command: "pwd" } },
          ],
        },
      ]);
      const { stats } = parseAgentLogStats(input);
      expect(stats.bashFrequency).toEqual({ pwd: 1 });
    });

    it("non-bash tool calls do not add any entry to bashFrequency", () => {
      const input = bare([
        { role: "user", content: "Search" },
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "1", toolName: "search", input: { query: "hello" } },
          ],
        },
      ]);
      const { stats } = parseAgentLogStats(input);
      expect(stats.bashFrequency).toEqual({});
      expect(stats.toolFrequency).toEqual({ search: 1 });
    });

    it("missing command field on a bash call is safely skipped (no crash, no entry)", () => {
      const input = bare([
        { role: "user", content: "Run" },
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "1", toolName: "bash", input: {} },
            { type: "tool-call", toolCallId: "2", toolName: "bash", input: null },
            { type: "tool-call", toolCallId: "3", toolName: "bash", input: { command: "" } },
          ],
        },
      ]);
      expect(() => parseAgentLogStats(input)).not.toThrow();
      const { stats } = parseAgentLogStats(input);
      expect(stats.bashFrequency).toEqual({});
      expect(stats.totalToolCalls).toBe(3);
    });

    it("malformed OpenAI arguments string is safely skipped", () => {
      const input = bare([
        { role: "user", content: "Run" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "a", type: "function", function: { name: "bash", arguments: "not-json" } },
          ],
        },
      ]);
      expect(() => parseAgentLogStats(input)).not.toThrow();
      const { stats } = parseAgentLogStats(input);
      expect(stats.bashFrequency).toEqual({});
    });

    it("bashFrequency is {} in the empty/zero-stats result", () => {
      const { stats } = parseAgentLogStats(bare([]));
      expect(stats.bashFrequency).toEqual({});
    });
  });

  describe("conversation passthrough", () => {
    it("preserves message order", () => {
      const messages = [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
        { role: "user", content: "third" },
      ];
      const { conversation } = parseAgentLogStats(bare(messages));
      expect(conversation.map((m) => m.content)).toEqual(["first", "second", "third"]);
    });

    it("filters out invalid messages (no role)", () => {
      const input = bare([
        { role: "user", content: "valid" },
        { content: "no role here" },
        null,
        42,
      ]);
      const { conversation, stats } = parseAgentLogStats(input);
      expect(conversation).toHaveLength(1);
      expect(stats.totalMessages).toBe(1);
    });
  });
});
