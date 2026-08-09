import { WorkflowStatus } from "@prisma/client";
import type { BenchmarkRunListRow } from "@/hooks/useLegalBenchmarkRunList";

/**
 * How many runs one run-list fetch pulls. 100 is the hard server cap in
 * /api/stakwork/runs, so it is also the widest window the dropdown can offer.
 *
 * Lives here rather than beside the fetch in useLegalBenchmarkRunList because
 * it is half of the WINDOW_OPTIONS contract below — and because test suites
 * routinely mock the hook module, which would leave this undefined.
 */
export const RUN_LIST_LIMIT = 100;

/**
 * Window sizes offered in the Runs-tab dropdown, in display order.
 * The window counts SCORED runs: "Last 25" means the 25 most recent completed,
 * judged runs. The table then lists every run in that span whatever its state —
 * PENDING and FAILED rows stay visible for context, they just don't move the
 * rate. See selectWindowRows.
 *
 * The largest option must stay <= RUN_LIST_LIMIT (the run-list fetch size, and
 * the hard cap of /api/stakwork/runs) — every option is served from the single
 * already-loaded payload, so changing the window never triggers a refetch.
 */
export const WINDOW_OPTIONS = [10, 25, 50, 100] as const;

export type SummaryWindow = (typeof WINDOW_OPTIONS)[number];

/** Default window — the 10 most recent scored runs. */
export const SUMMARY_WINDOW: SummaryWindow = 10;

/**
 * Tailwind class string for a passing score badge.
 * Shared with ScoreCell in BenchmarkRunsHistory.tsx so the summary strip and
 * the Runs table use exactly the same colour language.
 */
export const PASS_BADGE_CLASS =
  "border-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";

/**
 * Tailwind class string for a failing score badge.
 * Shared with ScoreCell in BenchmarkRunsHistory.tsx so the summary strip and
 * the Runs table use exactly the same colour language.
 */
export const FAIL_BADGE_CLASS =
  "border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";

/**
 * Returns true when a run counts toward the rolling summary.
 * COMPLETED-only — the strip is a clean-runs-only quality signal.
 *
 * Intentional divergences (do NOT "fix" one to match the other):
 *
 * 1. ScoreCell in BenchmarkRunsHistory.tsx uses a LOOSER predicate: it excludes
 *    only PENDING/IN_PROGRESS, then requires a boolean all_pass. Consequence: a
 *    FAILED or HALTED run that was judged before it died will still show a
 *    PASS/FAIL badge in the Runs table but will NOT be counted here. This is
 *    intentional — the strip counts clean completions only.
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
 * Rows the Runs table should list for a window of `windowSize` scored runs.
 *
 * `runs` must be newest-first (the order /api/stakwork/runs returns). Walks
 * from the newest until it has seen `windowSize` scored runs, then cuts — so
 * the slice contains exactly that many scored runs plus every unscored run
 * (PENDING, FAILED, judged-but-dead) interleaved among them. That keeps the
 * table honest about what happened while the rate stays over completed runs
 * only.
 *
 * Returns every run when fewer than `windowSize` scored runs exist: there is
 * no older data to hold back.
 */
export function selectWindowRows(
  runs: BenchmarkRunListRow[],
  windowSize: number = SUMMARY_WINDOW,
): BenchmarkRunListRow[] {
  if (windowSize <= 0) return [];

  let scoredSeen = 0;
  for (let i = 0; i < runs.length; i++) {
    if (isScoredRun(runs[i])) {
      scoredSeen += 1;
      if (scoredSeen === windowSize) return runs.slice(0, i + 1);
    }
  }
  return runs;
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

/**
 * Fraction of scored runs that passed every criterion (all_pass === true).
 * This is the headline "rolling pass rate" — a run-level P/F rate, distinct
 * from averagePassRate above, which is criteria-level.
 *
 * Returns null for an empty window (avoids 0/0 reaching the rendered label).
 */
export function passRate(scored: BenchmarkRunListRow[]): number | null {
  if (scored.length === 0) return null;
  return scored.filter((r) => r.all_pass === true).length / scored.length;
}

export interface BenchmarkSummary {
  /** The scored subset of the supplied rows, in the order they were given. */
  scoredRuns: BenchmarkRunListRow[];
  /** Fraction of those scored runs that fully passed; null when none are scored. */
  passRate: number | null;
  /** Number of scored runs that fully passed. */
  passCount: number;
  /** Mean of n_passed/n_total across rated runs; null when no run qualifies. */
  averagePassRate: number | null;
  /** Number of scored runs (= scoredRuns.length). */
  scoredCount: number;
  /** Number of scored runs that also qualify for the criteria average (n_total > 0). */
  ratedCount: number;
}

/**
 * Summarise exactly the rows handed in — the caller (the Runs table) has already
 * applied the task filter and the window, so what is measured is always what is
 * on screen. Rows that never got a score (PENDING, FAILED-before-judging) drop
 * out here, which is why scoredCount is usually smaller than the row count.
 *
 * Separates the two populations so the component never has to reconcile them:
 * - passRate/scoredCount derive from all_pass (boolean gate)
 * - averagePassRate/ratedCount derive from n_passed/n_total (numeric gate)
 * A run with missing counts still contributes to the pass rate without
 * contributing to the criteria average — that is a legitimate, intentional state.
 */
export function summarize(runs: BenchmarkRunListRow[]): BenchmarkSummary {
  const scoredRuns = runs.filter(isScoredRun);
  const ratedCount = scoredRuns.filter(
    (r) =>
      typeof r.n_passed === "number" &&
      typeof r.n_total === "number" &&
      r.n_total > 0,
  ).length;

  return {
    scoredRuns,
    passRate: passRate(scoredRuns),
    passCount: scoredRuns.filter((r) => r.all_pass === true).length,
    averagePassRate: averagePassRate(scoredRuns),
    scoredCount: scoredRuns.length,
    ratedCount,
  };
}
