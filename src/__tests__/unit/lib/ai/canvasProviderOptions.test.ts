/**
 * Unit tests for `buildCanvasProviderOptions`.
 *
 * Uses the REAL `aieo` package (precedent: models-aieo-parity.test.ts),
 * not a mock, because this test exists specifically to catch the
 * installed aieo version lacking the "fast" low-effort path for
 * Anthropic's 5.5-generation models. If the installed package regresses
 * (or a required version bump is missed), this test fails instead of a
 * manual grep of `node_modules/aieo/dist`.
 */

import { describe, test, expect } from "vitest";
import { buildCanvasProviderOptions } from "@/lib/ai/canvasProviderOptions";

type AnthropicOptions = {
  thinking?: { type?: string };
  effort?: string;
  cacheControl?: { type?: string };
};

function anthropicOptionsFor(modelId?: string): AnthropicOptions {
  const result = buildCanvasProviderOptions("anthropic", modelId) as {
    anthropic?: AnthropicOptions;
  };
  expect(result.anthropic).toBeDefined();
  return result.anthropic!;
}

describe("buildCanvasProviderOptions — anthropic", () => {
  describe("5.5-generation models never get thinking disabled", () => {
    test.each([
      "claude-opus-5-5",
      "anthropic/claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-fable-5",
      "claude-opus-5.5", // dotted id — normalized before the aieo lookup
    ])("%s gets effort: low + cacheControl, no thinking.disabled", (modelId) => {
      const opts = anthropicOptionsFor(modelId);
      expect(opts.thinking?.type).not.toBe("disabled");
      expect(opts.effort).toBe("low");
      expect(opts.cacheControl).toBeDefined();
    });
  });

  describe("older Claude models keep today's behavior", () => {
    test.each(["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"])(
      "%s gets thinking: disabled + ephemeral cache",
      (modelId) => {
        const opts = anthropicOptionsFor(modelId);
        expect(opts.thinking?.type).toBe("disabled");
        expect(opts.cacheControl).toEqual({ type: "ephemeral" });
      },
    );

    test("mock-mode model claude-3-5-sonnet-20241022 gets thinking: disabled", () => {
      const opts = anthropicOptionsFor("claude-3-5-sonnet-20241022");
      expect(opts.thinking?.type).toBe("disabled");
      expect(opts.cacheControl).toEqual({ type: "ephemeral" });
    });
  });

  test("undefined model id resolves to Sonnet 5.5 at low effort (aieo's Anthropic default)", () => {
    const opts = anthropicOptionsFor(undefined);
    expect(opts.thinking?.type).not.toBe("disabled");
    expect(opts.effort).toBe("low");
    expect(opts.cacheControl).toBeDefined();
  });
});

describe("buildCanvasProviderOptions — other providers unchanged", () => {
  test("google keeps thinkingBudget: 24000 (no 'fast' passed through)", () => {
    const result = buildCanvasProviderOptions("google", "gemini-3-pro") as {
      google?: { thinkingConfig?: { thinkingBudget?: number } };
    };
    expect(result.google?.thinkingConfig?.thinkingBudget).toBe(24000);
  });

  test("openrouter keeps its usage flag", () => {
    const result = buildCanvasProviderOptions("openrouter", "some/model") as {
      openrouter?: { usage?: { include?: boolean } };
    };
    expect(result.openrouter?.usage?.include).toBe(true);
  });
});
