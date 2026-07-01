/**
 * Unit tests for sanitizeAndCompleteToolCalls (message-sanitizer).
 *
 * Focus: a persisted tool-result whose `output` field is missing/nullish
 * (produced when a tool-call's args fail to parse) must be repaired into a
 * valid `{ type: "json", value: ... }` shape. Otherwise it poisons the
 * entire conversation — every subsequent turn throws AI_InvalidPromptError
 * ("messages do not match the ModelMessage[] schema").
 */

import { describe, test, expect, vi } from "vitest";
import type { ModelMessage } from "ai";

// swarmFetch is only reached for orphaned tool-CALLS (no matching result);
// none of these cases exercise it, but the import must resolve.
vi.mock("@/lib/ai/concepts", () => ({ swarmFetch: vi.fn() }));

import { sanitizeAndCompleteToolCalls } from "@/lib/ai/message-sanitizer";

function toolResultPart(msg: ModelMessage) {
  const content = msg.content as Array<Record<string, unknown>>;
  return content[0];
}

describe("sanitizeAndCompleteToolCalls — missing output repair", () => {
  test("backfills a tool-result whose output is entirely missing", async () => {
    // Mirrors the real corruption: an assistant tool-call paired with a
    // tool-result that has NO `output` key.
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "propose_feature",
            input: "{ malformed json",
          } as never,
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "propose_feature",
            // no `output`
          } as never,
        ],
      },
    ];

    const out = await sanitizeAndCompleteToolCalls(messages, "http://swarm", "key");

    const toolMsg = out.find((m) => m.role === "tool")!;
    const part = toolResultPart(toolMsg) as { output?: { type: string; value: unknown } };
    expect(part.output).toBeDefined();
    expect(part.output?.type).toBe("json");
    expect(part.output?.value).toMatchObject({ error: expect.any(String) });
  });

  test("backfills a tool-result whose output is null", async () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "c2", toolName: "read_canvas", input: {} } as never,
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "c2", toolName: "read_canvas", output: null } as never,
        ],
      },
    ];

    const out = await sanitizeAndCompleteToolCalls(messages, "http://swarm", "key");
    const part = toolResultPart(out.find((m) => m.role === "tool")!) as {
      output?: { type: string };
    };
    expect(part.output?.type).toBe("json");
  });

  test("leaves a well-formed { type, value } output untouched", async () => {
    const good = { type: "json", value: { ok: true } };
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "c3", toolName: "read_canvas", input: {} } as never,
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "c3", toolName: "read_canvas", output: good } as never,
        ],
      },
    ];

    const out = await sanitizeAndCompleteToolCalls(messages, "http://swarm", "key");
    const part = toolResultPart(out.find((m) => m.role === "tool")!) as { output?: unknown };
    expect(part.output).toEqual(good);
  });

  test("wraps a raw string output into { type: json, value }", async () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "c4", toolName: "read_canvas", input: {} } as never,
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "c4", toolName: "read_canvas", output: "hello" } as never,
        ],
      },
    ];

    const out = await sanitizeAndCompleteToolCalls(messages, "http://swarm", "key");
    const part = toolResultPart(out.find((m) => m.role === "tool")!) as {
      output?: { type: string; value: unknown };
    };
    expect(part.output).toEqual({ type: "json", value: "hello" });
  });
});

function assistantToolCallPart(msg: ModelMessage) {
  const content = msg.content as Array<Record<string, unknown>>;
  return content.find((c) => c.type === "tool-call") as { input?: unknown; toolCallId?: string };
}

describe("sanitizeAndCompleteToolCalls — tool-call input normalization", () => {
  test("parses a valid JSON-string input into an object", async () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "propose_feature",
            input: '{"proposalId":"p1","title":"X"}',
          } as never,
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "propose_feature",
            output: { type: "json", value: { ok: true } },
          } as never,
        ],
      },
    ];

    const out = await sanitizeAndCompleteToolCalls(messages, "http://swarm", "key");
    const part = assistantToolCallPart(out.find((m) => m.role === "assistant")!);
    expect(part.input).toEqual({ proposalId: "p1", title: "X" });
  });

  test("coerces an unparseable string input to an empty object", async () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "c2",
            toolName: "propose_feature",
            input: '{ "dependsOnFeatureIds": cmr2i71ez, }', // invalid JSON (unquoted value)
          } as never,
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c2",
            toolName: "propose_feature",
            output: { type: "json", value: { error: "x" } },
          } as never,
        ],
      },
    ];

    const out = await sanitizeAndCompleteToolCalls(messages, "http://swarm", "key");
    const part = assistantToolCallPart(out.find((m) => m.role === "assistant")!);
    expect(part.input).toEqual({});
  });

  test("normalizes the input even when the result was a backfilled placeholder", async () => {
    // Mirrors the real corruption: a tool-call with an unparseable string
    // input AND a missing result. The orphan-repair path creates a placeholder
    // result (keeping the call), so its string input must still be normalized
    // to an object or Anthropic 400s.
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "orphan-1",
            toolName: "propose_feature",
            input: "{ malformed",
          } as never,
        ],
      },
    ];

    const out = await sanitizeAndCompleteToolCalls(messages, "http://swarm", "key");
    const assistant = out.find((m) => m.role === "assistant")!;
    const part = assistantToolCallPart(assistant);
    expect(part.input).toEqual({});
    // and the orphan got a result so the pair is complete
    expect(out.some((m) => m.role === "tool")).toBe(true);
  });

  test("leaves a well-formed object input untouched (same reference)", async () => {
    const input = { a: 1, b: { c: 2 } };
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "c3", toolName: "read_canvas", input } as never,
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c3",
            toolName: "read_canvas",
            output: { type: "json", value: {} },
          } as never,
        ],
      },
    ];

    const out = await sanitizeAndCompleteToolCalls(messages, "http://swarm", "key");
    const part = assistantToolCallPart(out.find((m) => m.role === "assistant")!);
    expect(part.input).toEqual(input);
  });
});
