/**
 * Unit tests for src/lib/harvey-lab/benchmark-summary.ts
 *
 * Covers:
 *   - isScoredRun: PENDING/IN_PROGRESS excluded; COMPLETED-only rule;
 *     FAILED/HALTED excluded even when they carry a score;
 *     terminal runs without all_pass excluded
 *   - selectWindowRows: window counted in scored runs, unscored rows carried
 *     along, cut position, fewer scored runs than the window
 *   - averagePassRate: missing counts excluded; n_total=0 guard; null on empty;
 *     correct mean
 *   - passRate: run-level P/F rate over the supplied rows; null on empty
 *   - summarize: scoredCount / ratedCount split; correct aggregation
 *   - Constants: WINDOW_OPTIONS, PASS_BADGE_CLASS / FAIL_BADGE_CLASS
 */
import { describe, it, expect } from "vitest";
import { WorkflowStatus } from "@prisma/client";
import {
  RUN_LIST_LIMIT,
  SUMMARY_WINDOW,
  WINDOW_OPTIONS,
  PASS_BADGE_CLASS,
  FAIL_BADGE_CLASS,
  isScoredRun,
  selectWindowRows,
  averagePassRate,
  passRate,
  summarize,
} from "@/lib/harvey-lab/benchmark-summary";
import type { BenchmarkRunListRow } from "@/hooks/useLegalBenchmarkRunList";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _seq = 0;
function makeRun(
  overrides: Partial<BenchmarkRunListRow> = {},
): BenchmarkRunListRow {
  _seq += 1;
  return {
    id: `run-${_seq}`,
    workspaceId: "ws-1",
    runType: "manual",
    status: WorkflowStatus.COMPLETED,
    projectId: null,
    taskSlug: `task-${_seq}`,
    taskTitle: `Task ${_seq}`,
    createdAt: new Date(1_700_000_000_000 + _seq * 1000).toISOString(),
    updatedAt: new Date(1_700_000_000_000 + _seq * 1000).toISOString(),
    all_pass: true,
    n_passed: 5,
    n_total: 10,
    ...overrides,
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe("constants", () => {
  it("SUMMARY_WINDOW is 10", () => {
    expect(SUMMARY_WINDOW).toBe(10);
  });

  it("WINDOW_OPTIONS offers 10/25/50/100 in ascending order", () => {
    expect([...WINDOW_OPTIONS]).toEqual([10, 25, 50, 100]);
  });

  it("SUMMARY_WINDOW is one of WINDOW_OPTIONS", () => {
    expect(WINDOW_OPTIONS).toContain(SUMMARY_WINDOW);
  });

  // Guards the "no refetch on window change" contract: every option must be
  // servable from the single already-fetched payload.
  it("largest window does not exceed the run-list fetch limit", () => {
    expect(Math.max(...WINDOW_OPTIONS)).toBeLessThanOrEqual(RUN_LIST_LIMIT);
  });

  it("PASS_BADGE_CLASS is a non-empty string containing green", () => {
    expect(typeof PASS_BADGE_CLASS).toBe("string");
    expect(PASS_BADGE_CLASS.length).toBeGreaterThan(0);
    expect(PASS_BADGE_CLASS).toContain("green");
  });

  it("FAIL_BADGE_CLASS is a non-empty string containing red", () => {
    expect(typeof FAIL_BADGE_CLASS).toBe("string");
    expect(FAIL_BADGE_CLASS.length).toBeGreaterThan(0);
    expect(FAIL_BADGE_CLASS).toContain("red");
  });
});

// ─── isScoredRun ─────────────────────────────────────────────────────────────

describe("isScoredRun", () => {
  it("returns false for PENDING runs", () => {
    expect(isScoredRun(makeRun({ status: WorkflowStatus.PENDING, all_pass: true }))).toBe(false);
  });

  it("returns false for IN_PROGRESS runs", () => {
    expect(isScoredRun(makeRun({ status: WorkflowStatus.IN_PROGRESS, all_pass: true }))).toBe(false);
  });

  it("returns true for COMPLETED run with all_pass=true", () => {
    expect(isScoredRun(makeRun({ status: WorkflowStatus.COMPLETED, all_pass: true }))).toBe(true);
  });

  it("returns true for COMPLETED run with all_pass=false", () => {
    expect(isScoredRun(makeRun({ status: WorkflowStatus.COMPLETED, all_pass: false }))).toBe(true);
  });

  // COMPLETED-only rule: FAILED and HALTED are excluded even when they carry a score.
  // These are the assertions most likely to be regressed — named explicitly.
  it("returns false for FAILED run even when it carries a valid score (COMPLETED-only rule)", () => {
    expect(
      isScoredRun(
        makeRun({ status: WorkflowStatus.FAILED, all_pass: false, n_passed: 3, n_total: 5 }),
      ),
    ).toBe(false);
  });

  it("returns false for HALTED run even when it carries a valid score (COMPLETED-only rule)", () => {
    expect(
      isScoredRun(
        makeRun({ status: WorkflowStatus.HALTED, all_pass: true, n_passed: 5, n_total: 5 }),
      ),
    ).toBe(false);
  });

  it("returns false for FAILED run with no all_pass (no score data)", () => {
    const run = makeRun({ status: WorkflowStatus.FAILED });
    expect(isScoredRun({ ...run, all_pass: undefined as unknown as boolean })).toBe(false);
  });

  it("returns false for COMPLETED run where all_pass is absent (legacy no-score row)", () => {
    const run = { ...makeRun(), all_pass: undefined } as BenchmarkRunListRow;
    expect(isScoredRun(run)).toBe(false);
  });

  it("returns false for COMPLETED run where all_pass is null (not a boolean)", () => {
    const run = { ...makeRun(), all_pass: null } as unknown as BenchmarkRunListRow;
    expect(isScoredRun(run)).toBe(false);
  });
});

// ─── selectWindowRows ─────────────────────────────────────────────────────────

describe("selectWindowRows", () => {
  const scored = (id: string) => makeRun({ id, all_pass: true });
  const unscored = (id: string) =>
    makeRun({ id, status: WorkflowStatus.FAILED, all_pass: undefined });

  it("returns every row when fewer scored runs than the window exist", () => {
    const runs = [scored("a"), unscored("b"), scored("c")];
    expect(selectWindowRows(runs, 10).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(selectWindowRows([], 10)).toEqual([]);
  });

  it("cuts at the Nth scored run, counting only scored runs", () => {
    const runs = [scored("s1"), scored("s2"), scored("s3"), scored("s4")];
    expect(selectWindowRows(runs, 2).map((r) => r.id)).toEqual(["s1", "s2"]);
  });

  // The point of the whole design: the table shows every state, the rate doesn't.
  it("carries unscored rows that sit inside the span", () => {
    const runs = [
      scored("s1"),
      unscored("f1"),
      unscored("f2"),
      scored("s2"),
      scored("s3"),
    ];
    // Window of 2 scored runs reaches s2, dragging f1/f2 along
    expect(selectWindowRows(runs, 2).map((r) => r.id)).toEqual([
      "s1",
      "f1",
      "f2",
      "s2",
    ]);
  });

  it("excludes unscored rows that trail past the cut", () => {
    const runs = [scored("s1"), scored("s2"), unscored("f1"), scored("s3")];
    // The cut lands on s2 — f1 is older than the window and stays out
    expect(selectWindowRows(runs, 2).map((r) => r.id)).toEqual(["s1", "s2"]);
  });

  it("counts PENDING and IN_PROGRESS rows as unscored", () => {
    const runs = [
      makeRun({ id: "p1", status: WorkflowStatus.PENDING, all_pass: undefined }),
      makeRun({ id: "i1", status: WorkflowStatus.IN_PROGRESS, all_pass: undefined }),
      scored("s1"),
    ];
    expect(selectWindowRows(runs, 1).map((r) => r.id)).toEqual(["p1", "i1", "s1"]);
  });

  it("defaults to SUMMARY_WINDOW scored runs", () => {
    const runs = Array.from({ length: 15 }, (_, i) => scored(`s${i}`));
    expect(selectWindowRows(runs)).toHaveLength(SUMMARY_WINDOW);
  });

  it("returns an empty array for a non-positive window", () => {
    expect(selectWindowRows([scored("s1")], 0)).toEqual([]);
  });

  it("leaves the input array untouched", () => {
    const runs = [scored("s1"), scored("s2"), scored("s3")];
    selectWindowRows(runs, 1);
    expect(runs.map((r) => r.id)).toEqual(["s1", "s2", "s3"]);
  });
});

// ─── averagePassRate ──────────────────────────────────────────────────────────

describe("averagePassRate", () => {
  it("returns null for an empty array", () => {
    expect(averagePassRate([])).toBeNull();
  });

  it("returns null when no run has n_total > 0", () => {
    const runs = [makeRun({ n_passed: undefined, n_total: undefined })];
    expect(averagePassRate(runs)).toBeNull();
  });

  it("returns null when all runs have n_total = 0 (divide-by-zero guard)", () => {
    const runs = [makeRun({ n_passed: 0, n_total: 0 })];
    expect(averagePassRate(runs)).toBeNull();
  });

  it("never returns NaN or Infinity", () => {
    const result = averagePassRate([makeRun({ n_passed: 0, n_total: 0 })]);
    expect(result).toBeNull();
    // Ensuring the guard prevents division by zero
    const result2 = averagePassRate([]);
    expect(result2).toBeNull();
  });

  it("computes correct mean for a single run", () => {
    const runs = [makeRun({ n_passed: 3, n_total: 4 })];
    expect(averagePassRate(runs)).toBeCloseTo(0.75);
  });

  it("computes correct mean across multiple runs", () => {
    const runs = [
      makeRun({ n_passed: 2, n_total: 4 }),  // 0.5
      makeRun({ n_passed: 3, n_total: 4 }),  // 0.75
    ];
    // mean(0.5, 0.75) = 0.625
    expect(averagePassRate(runs)).toBeCloseTo(0.625);
  });

  it("skips runs with missing n_passed or n_total when averaging", () => {
    const runs = [
      makeRun({ n_passed: undefined, n_total: undefined, all_pass: true }),
      makeRun({ n_passed: 4, n_total: 4 }),
    ];
    // Only the second run qualifies: 4/4 = 1.0
    expect(averagePassRate(runs)).toBeCloseTo(1.0);
  });

  it("skips runs with n_total = 0 when averaging (even with n_passed = 0)", () => {
    const runs = [
      makeRun({ n_passed: 0, n_total: 0 }),
      makeRun({ n_passed: 2, n_total: 4 }),
    ];
    // Only second run qualifies: 0.5
    expect(averagePassRate(runs)).toBeCloseTo(0.5);
  });

  it("returns null when only missing-count and zero-total runs are present", () => {
    const runs = [
      makeRun({ n_passed: undefined, n_total: undefined, all_pass: true }),
      makeRun({ n_passed: 0, n_total: 0 }),
    ];
    expect(averagePassRate(runs)).toBeNull();
  });
});

// ─── passRate ─────────────────────────────────────────────────────────────────

describe("passRate", () => {
  it("returns null for an empty array", () => {
    expect(passRate([])).toBeNull();
  });

  it("returns 1 when every run fully passed", () => {
    expect(passRate([makeRun({ all_pass: true }), makeRun({ all_pass: true })])).toBe(1);
  });

  it("returns 0 when no run fully passed", () => {
    expect(passRate([makeRun({ all_pass: false }), makeRun({ all_pass: false })])).toBe(0);
  });

  it("computes the run-level fraction (2 of 5 passed → 0.4)", () => {
    const runs = [
      makeRun({ all_pass: true }),
      makeRun({ all_pass: true }),
      makeRun({ all_pass: false }),
      makeRun({ all_pass: false }),
      makeRun({ all_pass: false }),
    ];
    expect(passRate(runs)).toBeCloseTo(0.4);
  });

  it("ignores criteria counts entirely (a near-miss run counts as a fail)", () => {
    // 9/10 criteria passed but all_pass=false → contributes 0 to the run-level rate
    const runs = [makeRun({ all_pass: false, n_passed: 9, n_total: 10 })];
    expect(passRate(runs)).toBe(0);
  });

  it("treats a non-boolean all_pass as a fail rather than counting it as a pass", () => {
    const runs = [
      { ...makeRun(), all_pass: undefined } as BenchmarkRunListRow,
      makeRun({ all_pass: true }),
    ];
    expect(passRate(runs)).toBeCloseTo(0.5);
  });
});

// ─── summarize ────────────────────────────────────────────────────────────────

describe("summarize", () => {
  it("returns zero counts and null rates for empty runs", () => {
    const result = summarize([]);
    expect(result.scoredRuns).toHaveLength(0);
    expect(result.scoredCount).toBe(0);
    expect(result.ratedCount).toBe(0);
    expect(result.passCount).toBe(0);
    expect(result.passRate).toBeNull();
    expect(result.averagePassRate).toBeNull();
  });

  it("reports passCount and passRate over the supplied rows", () => {
    const runs = [
      makeRun({ all_pass: true }),
      makeRun({ all_pass: false }),
      makeRun({ all_pass: false }),
      makeRun({ all_pass: false }),
    ];
    const result = summarize(runs);
    expect(result.passCount).toBe(1);
    expect(result.scoredCount).toBe(4);
    expect(result.passRate).toBeCloseTo(0.25);
  });

  it("measures exactly the rows handed in — windowing is the caller's job", () => {
    // Newest-first: 2 recent fails, then 2 older passes
    const runs = [
      makeRun({ all_pass: false }),
      makeRun({ all_pass: false }),
      makeRun({ all_pass: true }),
      makeRun({ all_pass: true }),
    ];
    expect(summarize(selectWindowRows(runs, 2)).passRate).toBe(0);
    expect(summarize(selectWindowRows(runs, 4)).passRate).toBeCloseTo(0.5);
  });

  it("passRate and averagePassRate are independent measures", () => {
    // Every run misses exactly one criterion: 0% run-level, 90% criteria-level
    const runs = Array.from({ length: 3 }, () =>
      makeRun({ all_pass: false, n_passed: 9, n_total: 10 }),
    );
    const result = summarize(runs);
    expect(result.passRate).toBe(0);
    expect(result.averagePassRate).toBeCloseTo(0.9);
  });

  it("returns zero counts and null averagePassRate for only PENDING/IN_PROGRESS runs", () => {
    const runs = [
      makeRun({ status: WorkflowStatus.PENDING, all_pass: true }),
      makeRun({ status: WorkflowStatus.IN_PROGRESS, all_pass: false }),
    ];
    const result = summarize(runs);
    expect(result.scoredRuns).toHaveLength(0);
    expect(result.scoredCount).toBe(0);
    expect(result.averagePassRate).toBeNull();
  });

  it("scoredCount equals scoredRuns.length", () => {
    const runs = [makeRun(), makeRun(), makeRun()];
    const result = summarize(runs);
    expect(result.scoredCount).toBe(result.scoredRuns.length);
  });

  it("ratedCount reflects only runs with valid n_passed/n_total", () => {
    const runs = [
      makeRun({ n_passed: 5, n_total: 10 }),               // rated
      makeRun({ n_passed: undefined, n_total: undefined, all_pass: true }), // counted but not rated
      makeRun({ n_passed: 0, n_total: 0, all_pass: false }), // not rated (n_total=0)
    ];
    const result = summarize(runs);
    expect(result.scoredCount).toBe(3);  // all three are scored
    expect(result.ratedCount).toBe(1);   // only the first qualifies for the average
  });

  it("averagePassRate is computed from rated runs only", () => {
    const runs = [
      makeRun({ n_passed: 4, n_total: 8 }),   // 0.5
      makeRun({ n_passed: undefined, n_total: undefined, all_pass: true }), // counted only
    ];
    const result = summarize(runs);
    expect(result.averagePassRate).toBeCloseTo(0.5);
    expect(result.ratedCount).toBe(1);
    expect(result.scoredCount).toBe(2);
  });

  it("drops unscored rows from scoredRuns but keeps the given order", () => {
    const runs = [
      makeRun({ id: "newest" }),
      makeRun({ id: "failed", status: WorkflowStatus.FAILED, all_pass: undefined }),
      makeRun({ id: "oldest" }),
    ];
    const result = summarize(runs);
    expect(result.scoredRuns.map((r) => r.id)).toEqual(["newest", "oldest"]);
  });
});
