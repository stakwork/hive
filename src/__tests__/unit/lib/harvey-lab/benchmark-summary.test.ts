/**
 * Unit tests for src/lib/harvey-lab/benchmark-summary.ts
 *
 * Covers:
 *   - isScoredRun: PENDING/IN_PROGRESS excluded; ERROR/HALTED included with score;
 *     terminal runs without all_pass excluded
 *   - selectScoredRuns: ordering by updatedAt (primary), createdAt (secondary), id
 *     (tiebreaker); window slicing; fewer than SUMMARY_WINDOW runs
 *   - averagePassRate: missing counts excluded; n_total=0 guard; null on empty;
 *     correct mean
 *   - summarize: scoredCount / ratedCount split; correct aggregation
 *   - Constants: PASS_BADGE_CLASS / FAIL_BADGE_CLASS are non-empty strings
 */
import { describe, it, expect } from "vitest";
import { WorkflowStatus } from "@prisma/client";
import {
  SUMMARY_WINDOW,
  PASS_BADGE_CLASS,
  FAIL_BADGE_CLASS,
  isScoredRun,
  selectScoredRuns,
  averagePassRate,
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

  it("returns true for ERROR run with a score (terminal but not COMPLETED)", () => {
    expect(isScoredRun(makeRun({ status: WorkflowStatus.ERROR, all_pass: false }))).toBe(true);
  });

  it("returns true for HALTED run with a score", () => {
    expect(isScoredRun(makeRun({ status: WorkflowStatus.HALTED, all_pass: true }))).toBe(true);
  });

  it("returns false for FAILED run with no all_pass (no score data)", () => {
    const run = makeRun({ status: WorkflowStatus.FAILED });
    delete (run as Partial<BenchmarkRunListRow>).all_pass;
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

// ─── selectScoredRuns ─────────────────────────────────────────────────────────

describe("selectScoredRuns", () => {
  it("filters out PENDING and IN_PROGRESS runs", () => {
    const runs = [
      makeRun({ status: WorkflowStatus.PENDING, all_pass: true }),
      makeRun({ status: WorkflowStatus.IN_PROGRESS, all_pass: false }),
      makeRun({ status: WorkflowStatus.COMPLETED, all_pass: true }),
    ];
    expect(selectScoredRuns(runs)).toHaveLength(1);
  });

  it("includes ERROR and HALTED runs that carry a score", () => {
    const runs = [
      makeRun({ status: WorkflowStatus.ERROR, all_pass: false }),
      makeRun({ status: WorkflowStatus.HALTED, all_pass: true }),
    ];
    expect(selectScoredRuns(runs)).toHaveLength(2);
  });

  it("excludes terminal runs with no all_pass", () => {
    const runs = [
      makeRun({ status: WorkflowStatus.FAILED, all_pass: undefined as unknown as boolean }),
      makeRun({ status: WorkflowStatus.COMPLETED, all_pass: true }),
    ];
    const result = selectScoredRuns(runs);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe(WorkflowStatus.COMPLETED);
  });

  it("returns runs oldest → newest (ascending updatedAt)", () => {
    const older = makeRun({
      updatedAt: new Date("2025-01-01T10:00:00Z").toISOString(),
      createdAt: new Date("2025-01-01T09:00:00Z").toISOString(),
    });
    const newer = makeRun({
      updatedAt: new Date("2025-01-02T10:00:00Z").toISOString(),
      createdAt: new Date("2025-01-02T09:00:00Z").toISOString(),
    });
    // Supply newer first
    const result = selectScoredRuns([newer, older]);
    expect(result[0].id).toBe(older.id);
    expect(result[1].id).toBe(newer.id);
  });

  it("orders by updatedAt even when createdAt diverges in opposite direction", () => {
    // run A created first but updated last → should appear later in the strip
    const runA = makeRun({
      createdAt: new Date("2025-01-01T08:00:00Z").toISOString(),
      updatedAt: new Date("2025-01-03T12:00:00Z").toISOString(),
    });
    // run B created later but updated earlier → should appear first in the strip
    const runB = makeRun({
      createdAt: new Date("2025-01-02T08:00:00Z").toISOString(),
      updatedAt: new Date("2025-01-02T12:00:00Z").toISOString(),
    });
    const result = selectScoredRuns([runA, runB]);
    expect(result[0].id).toBe(runB.id);
    expect(result[1].id).toBe(runA.id);
  });

  it("uses createdAt as secondary sort key when updatedAt is identical", () => {
    const sharedUpdatedAt = new Date("2025-01-05T10:00:00Z").toISOString();
    const earlier = makeRun({
      updatedAt: sharedUpdatedAt,
      createdAt: new Date("2025-01-04T10:00:00Z").toISOString(),
    });
    const later = makeRun({
      updatedAt: sharedUpdatedAt,
      createdAt: new Date("2025-01-05T09:00:00Z").toISOString(),
    });
    const result = selectScoredRuns([later, earlier]);
    expect(result[0].id).toBe(earlier.id);
    expect(result[1].id).toBe(later.id);
  });

  it("uses id as final tiebreaker for determinism when both timestamps are identical", () => {
    const sharedTs = new Date("2025-01-05T10:00:00Z").toISOString();
    const runA = makeRun({ id: "aaa-run", updatedAt: sharedTs, createdAt: sharedTs });
    const runB = makeRun({ id: "zzz-run", updatedAt: sharedTs, createdAt: sharedTs });
    // Supply in reverse alphabetical order
    const result1 = selectScoredRuns([runB, runA]);
    const result2 = selectScoredRuns([runA, runB]);
    // Both orderings must yield the same deterministic result
    expect(result1.map((r) => r.id)).toEqual(result2.map((r) => r.id));
    // aaa < zzz alphabetically → aaa is the older position
    expect(result1[0].id).toBe("aaa-run");
    expect(result1[1].id).toBe("zzz-run");
  });

  it("returns at most SUMMARY_WINDOW runs", () => {
    const runs = Array.from({ length: 15 }, (_, i) =>
      makeRun({
        updatedAt: new Date(1_700_000_000_000 + i * 1000).toISOString(),
      }),
    );
    expect(selectScoredRuns(runs)).toHaveLength(SUMMARY_WINDOW);
  });

  it("returns the LAST N (most recent) when more than window exist", () => {
    const base = 1_700_000_000_000;
    const runs = Array.from({ length: 15 }, (_, i) =>
      makeRun({
        id: `ordered-${i}`,
        updatedAt: new Date(base + i * 1000).toISOString(),
      }),
    );
    const result = selectScoredRuns(runs);
    // Should include runs 5..14 (the 10 newest), still oldest-first
    expect(result[0].id).toBe("ordered-5");
    expect(result[result.length - 1].id).toBe("ordered-14");
  });

  it("returns fewer than SUMMARY_WINDOW when not enough scored runs exist", () => {
    const runs = [makeRun(), makeRun()];
    expect(selectScoredRuns(runs)).toHaveLength(2);
  });

  it("returns empty array when no scored runs exist", () => {
    const runs = [
      makeRun({ status: WorkflowStatus.PENDING, all_pass: true }),
      makeRun({ status: WorkflowStatus.IN_PROGRESS, all_pass: false }),
    ];
    expect(selectScoredRuns(runs)).toHaveLength(0);
  });

  it("respects a custom windowSize argument", () => {
    const runs = Array.from({ length: 8 }, () => makeRun());
    expect(selectScoredRuns(runs, 3)).toHaveLength(3);
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

// ─── summarize ────────────────────────────────────────────────────────────────

describe("summarize", () => {
  it("returns zero counts and null averagePassRate for empty runs", () => {
    const result = summarize([]);
    expect(result.pips).toHaveLength(0);
    expect(result.scoredCount).toBe(0);
    expect(result.ratedCount).toBe(0);
    expect(result.averagePassRate).toBeNull();
  });

  it("returns zero counts and null averagePassRate for only PENDING/IN_PROGRESS runs", () => {
    const runs = [
      makeRun({ status: WorkflowStatus.PENDING, all_pass: true }),
      makeRun({ status: WorkflowStatus.IN_PROGRESS, all_pass: false }),
    ];
    const result = summarize(runs);
    expect(result.pips).toHaveLength(0);
    expect(result.scoredCount).toBe(0);
    expect(result.averagePassRate).toBeNull();
  });

  it("scoredCount equals pips.length", () => {
    const runs = [makeRun(), makeRun(), makeRun()];
    const result = summarize(runs);
    expect(result.scoredCount).toBe(result.pips.length);
  });

  it("ratedCount reflects only runs with valid n_passed/n_total", () => {
    const runs = [
      makeRun({ n_passed: 5, n_total: 10 }),               // rated
      makeRun({ n_passed: undefined, n_total: undefined, all_pass: true }), // pips but not rated
      makeRun({ n_passed: 0, n_total: 0, all_pass: false }), // not rated (n_total=0)
    ];
    const result = summarize(runs);
    expect(result.scoredCount).toBe(3);  // all three are scored
    expect(result.ratedCount).toBe(1);   // only the first qualifies for the average
  });

  it("averagePassRate is computed from rated runs only", () => {
    const runs = [
      makeRun({ n_passed: 4, n_total: 8 }),   // 0.5
      makeRun({ n_passed: undefined, n_total: undefined, all_pass: true }), // pips only
    ];
    const result = summarize(runs);
    expect(result.averagePassRate).toBeCloseTo(0.5);
    expect(result.ratedCount).toBe(1);
    expect(result.scoredCount).toBe(2);
  });

  it("passes custom windowSize to selectScoredRuns", () => {
    const runs = Array.from({ length: 8 }, () => makeRun());
    const result = summarize(runs, 3);
    expect(result.pips).toHaveLength(3);
    expect(result.scoredCount).toBe(3);
  });

  it("pips are in oldest-to-newest order", () => {
    const runs = [
      makeRun({ id: "new-run", updatedAt: new Date("2025-02-01T00:00:00Z").toISOString() }),
      makeRun({ id: "old-run", updatedAt: new Date("2025-01-01T00:00:00Z").toISOString() }),
    ];
    const result = summarize(runs);
    expect(result.pips[0].id).toBe("old-run");
    expect(result.pips[1].id).toBe("new-run");
  });
});
