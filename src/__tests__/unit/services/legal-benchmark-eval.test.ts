/**
 * Unit tests for resolveBenchmarkModels (pure function exported from legal-benchmark-eval.ts)
 *
 * Covers:
 *  1. model prefers requestedModel > model > DEFAULT_BENCHMARK_MODEL
 *  2. Bare model values get "anthropic/" prefix; already-prefixed pass through unchanged
 *  3. judgeModel prefers requestedJudgeModel > judge_model > DEFAULT_JUDGE_MODEL, verbatim (no prefix)
 *  4. Non-Anthropic bare judge model passes through unchanged
 *  5. usedDefaultModel / usedDefaultJudgeModel flags
 *  6. null / undefined runResult → both defaults used
 *  7. runResult with no relevant fields → both defaults used
 */

import { describe, test, expect } from "vitest";
import { resolveBenchmarkModels } from "@/services/legal-benchmark-eval";
import { DEFAULT_BENCHMARK_MODEL, DEFAULT_JUDGE_MODEL } from "@/lib/ai/models";

describe("resolveBenchmarkModels", () => {
  // ── model resolution ─────────────────────────────────────────────────────

  test("prefers requestedModel over model over DEFAULT_BENCHMARK_MODEL", () => {
    const result = resolveBenchmarkModels({
      requestedModel: "claude-opus-4-5",
      model: "claude-sonnet-4-6",
    } as Parameters<typeof resolveBenchmarkModels>[0]);

    // requestedModel wins
    expect(result.model).toContain("claude-opus-4-5");
    expect(result.usedDefaultModel).toBe(false);
  });

  test("falls back to model when requestedModel is absent", () => {
    const result = resolveBenchmarkModels({
      model: "claude-sonnet-4-6",
    } as Parameters<typeof resolveBenchmarkModels>[0]);

    expect(result.model).toContain("claude-sonnet-4-6");
    expect(result.usedDefaultModel).toBe(false);
  });

  test("falls back to DEFAULT_BENCHMARK_MODEL when neither requestedModel nor model is present", () => {
    const result = resolveBenchmarkModels({} as Parameters<typeof resolveBenchmarkModels>[0]);

    expect(result.model).toBe(DEFAULT_BENCHMARK_MODEL);
    expect(result.usedDefaultModel).toBe(true);
  });

  // ── provider prefix normalization on model ───────────────────────────────

  test("bare model string gets anthropic/ prefix prepended", () => {
    const result = resolveBenchmarkModels({
      requestedModel: "claude-opus-4-5",
    } as Parameters<typeof resolveBenchmarkModels>[0]);

    expect(result.model).toBe("anthropic/claude-opus-4-5");
  });

  test("already-prefixed model string passes through unchanged", () => {
    const result = resolveBenchmarkModels({
      requestedModel: "anthropic/claude-sonnet-5",
    } as Parameters<typeof resolveBenchmarkModels>[0]);

    expect(result.model).toBe("anthropic/claude-sonnet-5");
  });

  test("DEFAULT_BENCHMARK_MODEL (already prefixed) passes through unchanged when used", () => {
    const result = resolveBenchmarkModels(null);

    // DEFAULT_BENCHMARK_MODEL is already "anthropic/..." — must not double-prefix
    expect(result.model).toBe(DEFAULT_BENCHMARK_MODEL);
    expect(result.model.startsWith("anthropic/")).toBe(true);
    expect(result.model.split("/").length).toBe(2); // exactly one "/"
  });

  // ── judgeModel resolution (no prefix manipulation) ───────────────────────

  test("prefers requestedJudgeModel over judge_model over DEFAULT_JUDGE_MODEL", () => {
    const result = resolveBenchmarkModels({
      requestedJudgeModel: "claude-sonnet-4-6",
      judge_model: "gpt-4o",
    } as Parameters<typeof resolveBenchmarkModels>[0]);

    expect(result.judgeModel).toBe("claude-sonnet-4-6");
    expect(result.usedDefaultJudgeModel).toBe(false);
  });

  test("falls back to judge_model when requestedJudgeModel is absent", () => {
    const result = resolveBenchmarkModels({
      judge_model: "gpt-4o",
    } as Parameters<typeof resolveBenchmarkModels>[0]);

    expect(result.judgeModel).toBe("gpt-4o");
    expect(result.usedDefaultJudgeModel).toBe(false);
  });

  test("falls back to DEFAULT_JUDGE_MODEL when neither requestedJudgeModel nor judge_model is present", () => {
    const result = resolveBenchmarkModels({} as Parameters<typeof resolveBenchmarkModels>[0]);

    expect(result.judgeModel).toBe(DEFAULT_JUDGE_MODEL);
    expect(result.usedDefaultJudgeModel).toBe(true);
  });

  test("non-Anthropic bare judge model id passes through verbatim (no prefix added)", () => {
    const result = resolveBenchmarkModels({
      judge_model: "gpt-4o",
    } as Parameters<typeof resolveBenchmarkModels>[0]);

    // Must NOT have "anthropic/" prepended
    expect(result.judgeModel).toBe("gpt-4o");
    expect(result.judgeModel).not.toContain("anthropic/");
  });

  test("cross-provider prefixed judge model passes through verbatim", () => {
    const result = resolveBenchmarkModels({
      requestedJudgeModel: "openai/gpt-4o",
    } as Parameters<typeof resolveBenchmarkModels>[0]);

    expect(result.judgeModel).toBe("openai/gpt-4o");
  });

  // ── usedDefault flags ─────────────────────────────────────────────────────

  test("usedDefaultModel=false, usedDefaultJudgeModel=false when both resolved from source run", () => {
    const result = resolveBenchmarkModels({
      requestedModel: "claude-opus-4-5",
      requestedJudgeModel: "gpt-4o",
    } as Parameters<typeof resolveBenchmarkModels>[0]);

    expect(result.usedDefaultModel).toBe(false);
    expect(result.usedDefaultJudgeModel).toBe(false);
  });

  test("usedDefaultModel=true, usedDefaultJudgeModel=true when runResult is null", () => {
    const result = resolveBenchmarkModels(null);

    expect(result.usedDefaultModel).toBe(true);
    expect(result.usedDefaultJudgeModel).toBe(true);
  });

  test("usedDefaultModel=true, usedDefaultJudgeModel=true when runResult is undefined", () => {
    const result = resolveBenchmarkModels(undefined);

    expect(result.usedDefaultModel).toBe(true);
    expect(result.usedDefaultJudgeModel).toBe(true);
  });

  test("usedDefaultModel=true, usedDefaultJudgeModel=true when runResult has no model fields", () => {
    const result = resolveBenchmarkModels({
      score: 1,
      n_passed: 1,
      n_total: 2,
    } as Parameters<typeof resolveBenchmarkModels>[0]);

    expect(result.usedDefaultModel).toBe(true);
    expect(result.usedDefaultJudgeModel).toBe(true);
  });

  test("usedDefaultModel=false when only model (not requestedModel) is set", () => {
    const result = resolveBenchmarkModels({
      model: "claude-haiku-4-5",
    } as Parameters<typeof resolveBenchmarkModels>[0]);

    expect(result.usedDefaultModel).toBe(false);
  });

  test("usedDefaultJudgeModel=false when only judge_model (not requestedJudgeModel) is set", () => {
    const result = resolveBenchmarkModels({
      judge_model: "gpt-4o",
    } as Parameters<typeof resolveBenchmarkModels>[0]);

    expect(result.usedDefaultJudgeModel).toBe(false);
  });

  // ── all four permutations of presence/absence ────────────────────────────

  test("permutation: both requestedModel and requestedJudgeModel present", () => {
    const result = resolveBenchmarkModels({
      requestedModel: "claude-opus-4-5",
      requestedJudgeModel: "claude-sonnet-4-6",
    } as Parameters<typeof resolveBenchmarkModels>[0]);

    expect(result.model).toBe("anthropic/claude-opus-4-5");
    expect(result.judgeModel).toBe("claude-sonnet-4-6");
    expect(result.usedDefaultModel).toBe(false);
    expect(result.usedDefaultJudgeModel).toBe(false);
  });

  test("permutation: requestedModel present, requestedJudgeModel absent (falls back to judge_model)", () => {
    const result = resolveBenchmarkModels({
      requestedModel: "claude-opus-4-5",
      judge_model: "gpt-4o",
    } as Parameters<typeof resolveBenchmarkModels>[0]);

    expect(result.model).toBe("anthropic/claude-opus-4-5");
    expect(result.judgeModel).toBe("gpt-4o");
    expect(result.usedDefaultModel).toBe(false);
    expect(result.usedDefaultJudgeModel).toBe(false);
  });

  test("permutation: requestedModel absent (falls back to model), requestedJudgeModel present", () => {
    const result = resolveBenchmarkModels({
      model: "claude-sonnet-5",
      requestedJudgeModel: "claude-sonnet-4-6",
    } as Parameters<typeof resolveBenchmarkModels>[0]);

    expect(result.model).toBe("anthropic/claude-sonnet-5");
    expect(result.judgeModel).toBe("claude-sonnet-4-6");
    expect(result.usedDefaultModel).toBe(false);
    expect(result.usedDefaultJudgeModel).toBe(false);
  });

  test("permutation: both requestedModel and requestedJudgeModel absent → both defaults", () => {
    const result = resolveBenchmarkModels({
      model: undefined,
      requestedModel: undefined,
      judge_model: undefined,
      requestedJudgeModel: undefined,
    } as Parameters<typeof resolveBenchmarkModels>[0]);

    expect(result.model).toBe(DEFAULT_BENCHMARK_MODEL);
    expect(result.judgeModel).toBe(DEFAULT_JUDGE_MODEL);
    expect(result.usedDefaultModel).toBe(true);
    expect(result.usedDefaultJudgeModel).toBe(true);
  });
});
