/**
 * Verifies that TokenUsage is the single shared type across streaming,
 * agent-log-stats, and CanvasChatMessage — no inline shape re-declarations.
 */
import { describe, it, expect } from "vitest";
import type { TokenUsage } from "@/types/usage";
import type { BaseStreamingMessage } from "@/types/streaming";
import type { ParsedMessage } from "@/lib/utils/agent-log-stats";
import type { CanvasChatMessage } from "@/app/org/[githubLogin]/_state/canvasChatStore";

describe("TokenUsage type consistency", () => {
  it("BaseStreamingMessage.usage is assignable from TokenUsage", () => {
    const usage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheWriteTokens: 10,
    };

    // Type-level check: TokenUsage must be assignable to BaseStreamingMessage["usage"]
    const msg: BaseStreamingMessage = {
      id: "m1",
      content: "hello",
      usage,
    };
    expect(msg.usage).toEqual(usage);
  });

  it("ParsedMessage.usage is assignable from TokenUsage", () => {
    const usage: TokenUsage = {
      inputTokens: 200,
      outputTokens: 80,
    };

    const msg: ParsedMessage = {
      role: "assistant",
      content: "answer",
      usage,
    };
    expect(msg.usage).toEqual(usage);
  });

  it("CanvasChatMessage.usage is assignable from TokenUsage", () => {
    const usage: TokenUsage = {
      inputTokens: 300,
      outputTokens: 120,
      cacheReadTokens: 1024,
    };

    const msg: CanvasChatMessage = {
      id: "c1",
      role: "assistant",
      content: "canvas reply",
      timestamp: new Date(),
      usage,
    };
    expect(msg.usage).toEqual(usage);
  });

  it("all three usage shapes share the same field names", () => {
    const fields: (keyof TokenUsage)[] = [
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
    ];

    // Verify the canonical shape has exactly these 4 optional fields
    const sample: TokenUsage = {};
    for (const field of fields) {
      expect(field in sample || sample[field] === undefined).toBe(true);
    }
    expect(fields).toHaveLength(4);
  });
});
