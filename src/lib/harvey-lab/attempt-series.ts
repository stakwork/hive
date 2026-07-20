/**
 * attempt-series.ts
 *
 * Data-shaping helpers for the Recursion tab's hill-climb chart.
 * Reads from EvalTriggerOutput Jarvis graph nodes (NOT from LEGAL_BENCHMARK_RUNNER
 * StakworkRun rows — those do not accumulate per attempt and are not the source
 * of truth for the hill-climb chart).
 */

import type { EvalTriggerOutput } from "@/lib/harvey-lab/eval-normalizers";

export interface AttemptPoint {
  /** Number of criteria that passed in this attempt */
  n_passed: number;
  /** Total number of criteria in this attempt */
  n_total: number;
  /** True for the earliest output (the baseline run) */
  isBaseline: boolean;
  /** 0-based chronological index within the task's series */
  attemptIndex: number;
}

/**
 * Convert an ordered EvalTriggerOutput[] (as returned by sortAttemptsChronologically
 * via useEvalRunHistory.attempts) into the AttemptPoint[] series consumed by
 * HillClimbChart.
 *
 * Drops any output that lacks n_passed / n_total (should not reach this point, but safe).
 */
export function buildAttemptPointSeries(outputs: EvalTriggerOutput[]): AttemptPoint[] {
  const valid = outputs.filter(
    (o): o is EvalTriggerOutput & { n_passed: number; n_total: number } =>
      o.n_passed !== undefined && o.n_total !== undefined,
  );

  return valid.map((o, i) => ({
    n_passed: o.n_passed,
    n_total: o.n_total,
    isBaseline: i === 0,
    attemptIndex: i,
  }));
}
