import { describe, it, expect, vi } from "vitest";
import { parseAgentLogStats } from "@/lib/utils/agent-log-stats";

// Mock gpt-tokenizer so tests are fast and deterministic.
// We use a simple char-based stub: 1 token per char, so estimateTokens(str) === str.length.
vi.mock("gpt-tokenizer", () => ({
  encode: (text: string) => Array.from(text),
}));

// Helper to build a JSON string from a bare array
const bare = (messages: unknown[]) => JSON.stringify(messages);
// Helper to build a JSON string from { messages: [...] } wrapper
const wrapped = (messages: unknown[]) => JSON.stringify({ messages });
// Helper to build a JSON string from the new { sessionId, messages, config } shape
const newShape = (messages: unknown[], config?: unknown, sessionId?: string) =>
  JSON.stringify({ sessionId: sessionId ?? "sess-1", messages, config });

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
      expect(stats.developerShellFrequency).toEqual({});
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
    // With our mock, encode(str) returns Array.from(str), so estimateTokens(str) === str.length.
    // The new implementation sums estimateTokens(role + content + reasoning) per message.

    it("estimates tokens using the tokenizer (not chars ÷ 4)", () => {
      // "user" (4) + "Hello world" (11) = 15 tokens with our stub
      const input = bare([{ role: "user", content: "Hello world" }]);
      const { stats } = parseAgentLogStats(input);
      const expectedTokens = ("user" + "Hello world").length;
      expect(stats.estimatedTokens).toBe(expectedTokens);
      // Ensure it is NOT the old chars/4 formula
      expect(stats.estimatedTokens).not.toBe(Math.ceil(("user" + "Hello world").length / 4));
    });

    it("includes all messages in token count", () => {
      const messages = [
        { role: "user", content: "AAAA" },
        { role: "assistant", content: "BBBBBBBB" },
      ];
      const input = bare(messages);
      const { stats } = parseAgentLogStats(input);
      const expectedTokens =
        ("user" + "AAAA").length +
        ("assistant" + "BBBBBBBB").length;
      expect(stats.estimatedTokens).toBe(expectedTokens);
    });

    it("includes reasoning in the token count", () => {
      const input = bare([{ role: "assistant", content: "Answer", reasoning: "Thinking" }]);
      const { stats } = parseAgentLogStats(input);
      const expectedTokens = ("assistant" + "Answer" + "Thinking").length;
      expect(stats.estimatedTokens).toBe(expectedTokens);
    });

    it("includes array content (JSON.stringify) in the token count", () => {
      const contentArr = [{ type: "text", text: "hi" }];
      const input = bare([{ role: "assistant", content: contentArr }]);
      const { stats } = parseAgentLogStats(input);
      const expectedTokens = ("assistant" + JSON.stringify(contentArr)).length;
      expect(stats.estimatedTokens).toBe(expectedTokens);
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

  describe("developer__shell tool special case", () => {
    it("AI SDK format: 'ls -la /tmp' → developerShellFrequency: { ls: 1 }", () => {
      const input = bare([
        { role: "user", content: "List files" },
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "1", toolName: "developer__shell", input: { command: "ls -la /tmp" } },
          ],
        },
      ]);
      const { stats } = parseAgentLogStats(input);
      expect(stats.developerShellFrequency).toEqual({ ls: 1 });
      expect(stats.bashFrequency).toEqual({});
    });

    it("AI SDK format: multiple calls produce correct counts", () => {
      const input = bare([
        { role: "user", content: "Go" },
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "1", toolName: "developer__shell", input: { command: "npm run test" } },
            { type: "tool-call", toolCallId: "2", toolName: "developer__shell", input: { command: "npm install" } },
            { type: "tool-call", toolCallId: "3", toolName: "developer__shell", input: { command: "rg pattern ." } },
          ],
        },
      ]);
      const { stats } = parseAgentLogStats(input);
      expect(stats.developerShellFrequency).toEqual({ npm: 2, rg: 1 });
      expect(stats.bashFrequency).toEqual({});
    });

    it("OpenAI format: JSON arguments string with command field is split and counted correctly", () => {
      const input = bare([
        { role: "user", content: "Go" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "a", type: "function", function: { name: "developer__shell", arguments: JSON.stringify({ command: "git status" }) } },
            { id: "b", type: "function", function: { name: "developer__shell", arguments: JSON.stringify({ command: "git log --oneline" }) } },
          ],
        },
      ]);
      const { stats } = parseAgentLogStats(input);
      expect(stats.developerShellFrequency).toEqual({ git: 2 });
      expect(stats.bashFrequency).toEqual({});
    });

    it("developer__shell does not affect bashFrequency and bash does not affect developerShellFrequency", () => {
      const input = bare([
        { role: "user", content: "Mixed" },
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "1", toolName: "bash", input: { command: "ls -la" } },
            { type: "tool-call", toolCallId: "2", toolName: "developer__shell", input: { command: "rg pattern ." } },
          ],
        },
      ]);
      const { stats } = parseAgentLogStats(input);
      expect(stats.bashFrequency).toEqual({ ls: 1 });
      expect(stats.developerShellFrequency).toEqual({ rg: 1 });
    });

    it("missing command field on a developer__shell call is safely skipped", () => {
      const input = bare([
        { role: "user", content: "Run" },
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "1", toolName: "developer__shell", input: {} },
            { type: "tool-call", toolCallId: "2", toolName: "developer__shell", input: null },
            { type: "tool-call", toolCallId: "3", toolName: "developer__shell", input: { command: "" } },
          ],
        },
      ]);
      expect(() => parseAgentLogStats(input)).not.toThrow();
      const { stats } = parseAgentLogStats(input);
      expect(stats.developerShellFrequency).toEqual({});
      expect(stats.totalToolCalls).toBe(3);
    });

    it("malformed OpenAI arguments string for developer__shell is safely skipped", () => {
      const input = bare([
        { role: "user", content: "Run" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "a", type: "function", function: { name: "developer__shell", arguments: "not-json" } },
          ],
        },
      ]);
      expect(() => parseAgentLogStats(input)).not.toThrow();
      const { stats } = parseAgentLogStats(input);
      expect(stats.developerShellFrequency).toEqual({});
    });

    it("developerShellFrequency is {} in the empty/zero-stats result", () => {
      const { stats } = parseAgentLogStats(bare([]));
      expect(stats.developerShellFrequency).toEqual({});
    });
  });

  describe("config extraction", () => {
    const sampleMessages = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
    ];

    it("extracts config from new { sessionId, messages, config } shape", () => {
      const config = {
        model: "claude-sonnet-4-6",
        provider: "anthropic",
        source: "repo_agent",
        repos: [{ name: "stakwork/hive" }],
        temperature: 0,
        tools: { bash: true },
        toolsConfig: {},
        schema: null,
        providerConfig: {},
      };
      const input = newShape(sampleMessages, config);
      const result = parseAgentLogStats(input);
      expect(result.config).toMatchObject({
        model: "claude-sonnet-4-6",
        provider: "anthropic",
        source: "repo_agent",
        temperature: 0,
      });
      expect(result.config?.repos).toHaveLength(1);
    });

    it("handles partial config — missing fields are simply absent, no error", () => {
      const partialConfig = { model: "gpt-4o", repos: [] };
      const input = newShape(sampleMessages, partialConfig);
      const result = parseAgentLogStats(input);
      expect(result.config).toBeDefined();
      expect(result.config?.model).toBe("gpt-4o");
      expect(result.config?.provider).toBeUndefined();
      expect(result.config?.repos).toEqual([]);
    });

    it("returns config=undefined for legacy bare-array blob", () => {
      const input = bare(sampleMessages);
      const result = parseAgentLogStats(input);
      expect(result.config).toBeUndefined();
    });

    it("returns config=undefined for legacy { messages } blob (no config key)", () => {
      const input = wrapped(sampleMessages);
      const result = parseAgentLogStats(input);
      expect(result.config).toBeUndefined();
    });

    it("returns config=undefined when config key is null (null normalized to undefined)", () => {
      const input = JSON.stringify({ sessionId: "s1", messages: sampleMessages, config: null });
      const result = parseAgentLogStats(input);
      // null config is normalized to undefined via ?? operator
      expect(result.config).toBeUndefined();
    });

    it("still returns valid conversation and stats alongside config", () => {
      const config = { model: "claude-opus-4", provider: "anthropic" };
      const input = newShape(sampleMessages, config);
      const result = parseAgentLogStats(input);
      expect(result.conversation).toHaveLength(2);
      expect(result.stats.totalMessages).toBe(2);
      expect(result.config?.model).toBe("claude-opus-4");
    });

    it("returns config when messages array is empty (zero-stat result still carries config)", () => {
      const config = { model: "gpt-4o" };
      const input = newShape([], config);
      const result = parseAgentLogStats(input);
      expect(result.stats.totalMessages).toBe(0);
      expect(result.config?.model).toBe("gpt-4o");
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
