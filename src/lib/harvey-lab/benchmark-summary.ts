import { WorkflowStatus } from "@prisma/client";
import type { BenchmarkRunListRow } from "@/hooks/useLegalBenchmarkRunList";

/** Fixed window size for the rolling summary strip — always the last 10 scored runs. */
export const SUMMARY_WINDOW = 10;

/**
 * Tailwind class string for a passing score badge.
 * Lifted from ScoreCell in BenchmarkRunsHistory.tsx so both the pip strip and
 * the Runs table use exactly the same colour language.
 */
export const PASS_BADGE_CLASS =
  "border-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";

/**
 * Tailwind class string for a failing score badge.
 * Lifted from ScoreCell in BenchmarkRunsHistory.tsx so both the pip strip and
 * the Runs table use exactly the same colour language.
 */
export const FAIL_BADGE_CLASS =
  "border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";

/**
 * Returns true when a run should appear as a pip in the rolling summary strip.
 * COMPLETED-only — the strip is a clean-runs-only quality signal.
 *
 * Intentional divergences (do NOT "fix" one to match the other):
 *
 * 1. ScoreCell in BenchmarkRunsHistory.tsx uses a LOOSER predicate: it excludes
 *    only PENDING/IN_PROGRESS, then requires a boolean all_pass. Consequence: a
 *    FAILED or HALTED run that was judged before it died will still show a
 *    PASS/FAIL badge in the Runs table but will NOT appear as a pip here. This
 *    is intentional — the strip counts clean completions only.
 *
 * 2. toChartAttempts in BenchmarkRunsHistory.tsx uses a THIRD, even looser
 *    predicate (counts present, no status check) for the hill-climb chart.
 *    Also pre-existing and out of scope.
 *
 * Note: WorkflowStatus.ERROR is never assigned to a StakworkRun — mapStakworkStatus
 * in src/utils/conversions.ts maps Stakwork "error"/"failed" → FAILED and
 * "halted"/"paused"/"stopped" → HALTED — so no ERROR branch is needed.
 */
export function isScoredRun(run: BenchmarkRunListRow): boolean {
  return (
    run.status === WorkflowStatus.COMPLETED && typeof run.all_pass === "boolean"
  );
}

/**
 * Filter to only scored runs, sort oldest → newest, and return the last
 * `windowSize` entries (preserving oldest-first order within the window).
 *
 * Sort key priority:
 *   1. updatedAt (primary) — closest proxy for completion time; runs finish
 *      out-of-order so createdAt would mis-place a newly-scored older run.
 *   2. createdAt (secondary) — stable fallback when updatedAt is identical.
 *   3. id (final tiebreaker) — required for determinism when batch-launched
 *      runs share near-identical timestamps; without it pip order is
 *      nondeterministic across refetches.
 */
export function selectScoredRuns(
  runs: BenchmarkRunListRow[],
  windowSize = SUMMARY_WINDOW,
): BenchmarkRunListRow[] {
  const scored = runs.filter(isScoredRun);

  scored.sort((a, b) => {
    const updatedDiff =
      new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    if (updatedDiff !== 0) return updatedDiff;

    const createdDiff =
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (createdDiff !== 0) return createdDiff;

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // Return the last windowSize entries, preserving oldest → newest order.
  return scored.slice(-windowSize);
}

/**
 * Compute the mean criteria pass-rate across runs that have both n_passed and
 * n_total present with n_total > 0.
 *
 * Returns null when no qualifying run exists (avoids NaN/Infinity reaching the
 * rendered NN% label).
 */
export function averagePassRate(scored: BenchmarkRunListRow[]): number | null {
  const qualifying = scored.filter(
    (r) =>
      typeof r.n_passed === "number" &&
      typeof r.n_total === "number" &&
      r.n_total > 0,
  );

  if (qualifying.length === 0) return null;

  const sum = qualifying.reduce(
    (acc, r) => acc + (r.n_passed as number) / (r.n_total as number),
    0,
  );
  return sum / qualifying.length;
}

export interface BenchmarkSummary {
  /** The up-to-SUMMARY_WINDOW most-recent scored runs, oldest → newest. */
  pips: BenchmarkRunListRow[];
  /** Mean of n_passed/n_total across rated runs; null when no run qualifies. */
  averagePassRate: number | null;
  /** Number of scored runs in the window (= pips.length). */
  scoredCount: number;
  /** Number of pips that also qualify for the pass-rate average (n_total > 0). */
  ratedCount: number;
}

/**
 * Single entry-point for the summary strip component.
 * Separates the two populations so the component never has to reconcile them:
 * - pips/scoredCount derive from all_pass (boolean gate)
 * - averagePassRate/ratedCount derive from n_passed/n_total (numeric gate)
 * A run with missing counts pips without contributing to the average — that is
 * a legitimate, intentional state.
 */
export function summarize(
  runs: BenchmarkRunListRow[],
  windowSize = SUMMARY_WINDOW,
): BenchmarkSummary {
  const pips = selectScoredRuns(runs, windowSize);
  const ratedCount = pips.filter(
    (r) =>
      typeof r.n_passed === "number" &&
      typeof r.n_total === "number" &&
      r.n_total > 0,
  ).length;

  return {
    pips,
    averagePassRate: averagePassRate(pips),
    scoredCount: pips.length,
    ratedCount,
  };
}
