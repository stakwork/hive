/**
 * Unit tests for buildAttemptPointSeries.
 *
 * The previous test file covered buildAttemptSeries / buildAttemptSeriesFromMapped,
 * which grouped LEGAL_BENCHMARK_RUNNER StakworkRun rows — that data path has been
 * removed. The source of truth is now EvalTriggerOutput Jarvis graph nodes, sorted
 * by sortAttemptsChronologically (tested in eval-normalizers.test.ts).
 */
import { describe, it, expect } from "vitest";
import { buildAttemptPointSeries } from "@/lib/harvey-lab/attempt-series";
import type { EvalTriggerOutput } from "@/lib/harvey-lab/eval-normalizers";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOutput(
  overrides: Partial<EvalTriggerOutput> & { n_passed: number; n_total: number },
): EvalTriggerOutput {
  return {
    ref_id: `out-${Math.random()}`,
    attempt_number: 0,
    result: "pass",
    score: 1,
    ...overrides,
  };
}

// ── buildAttemptPointSeries ───────────────────────────────────────────────────

describe("buildAttemptPointSeries", () => {
  it("returns empty array for empty input", () => {
    expect(buildAttemptPointSeries([])).toEqual([]);
  });

  it("maps n_passed / n_total from each output", () => {
    const outputs = [
      makeOutput({ n_passed: 14, n_total: 42 }),
      makeOutput({ n_passed: 28, n_total: 42 }),
      makeOutput({ n_passed: 38, n_total: 42 }),
    ];
    const series = buildAttemptPointSeries(outputs);
    expect(series).toHaveLength(3);
    expect(series[0].n_passed).toBe(14);
    expect(series[1].n_passed).toBe(28);
    expect(series[2].n_passed).toBe(38);
    expect(series.every((p) => p.n_total === 42)).toBe(true);
  });

  it("marks the first point as isBaseline: true, rest false", () => {
    const outputs = [
      makeOutput({ n_passed: 10, n_total: 20 }),
      makeOutput({ n_passed: 15, n_total: 20 }),
      makeOutput({ n_passed: 20, n_total: 20 }),
    ];
    const series = buildAttemptPointSeries(outputs);
    expect(series[0].isBaseline).toBe(true);
    expect(series[1].isBaseline).toBe(false);
    expect(series[2].isBaseline).toBe(false);
  });

  it("assigns 0-based attemptIndex", () => {
    const outputs = [
      makeOutput({ n_passed: 5, n_total: 10 }),
      makeOutput({ n_passed: 8, n_total: 10 }),
    ];
    const series = buildAttemptPointSeries(outputs);
    expect(series[0].attemptIndex).toBe(0);
    expect(series[1].attemptIndex).toBe(1);
  });

  it("drops outputs that lack n_passed or n_total", () => {
    const outputs: EvalTriggerOutput[] = [
      makeOutput({ n_passed: 10, n_total: 42 }),
      { ref_id: "no-counts", attempt_number: 1, result: "pass", score: 0 }, // missing n_passed/n_total
      makeOutput({ n_passed: 20, n_total: 42 }),
    ];
    const series = buildAttemptPointSeries(outputs);
    expect(series).toHaveLength(2);
    expect(series[0].n_passed).toBe(10);
    expect(series[1].n_passed).toBe(20);
  });

  it("single-point series has isBaseline: true and attemptIndex: 0", () => {
    const outputs = [makeOutput({ n_passed: 14, n_total: 42 })];
    const series = buildAttemptPointSeries(outputs);
    expect(series).toHaveLength(1);
    expect(series[0].isBaseline).toBe(true);
    expect(series[0].attemptIndex).toBe(0);
  });
});
