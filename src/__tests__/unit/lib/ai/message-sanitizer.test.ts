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
