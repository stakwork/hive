/**
 * Unit tests for rubricBreakdown() and scorableFromRubricRow().
 *
 * Covers:
 * - Partition invariant: pass + fail + contested === total (always)
 * - Clamping/mismatch detection
 * - Unscored roster criteria count as Fail
 * - Disputed overlay semantics (null vs. 0, subset invariant, overlap with Contested)
 * - rubricBreakdown returns null when score is null
 * - Regression locks for rosterSummary, formatBenchmarkScore, denominator, allPass
 * - scorableFromRubricRow adapter field mapping
 */

import { describe, it, expect } from "vitest";
import {
  rubricBreakdown,
  computeBenchmarkScore,
  rosterSummary,
  formatBenchmarkScore,
  type GraphRubric,
  type ScorableCriterion,
  type RubricBreakdown,
} from "@/lib/harvey-lab/rubric-scoring";
import { scorableFromRubricRow } from "@/lib/run-report/rubric-adapter";
import type { RubricRow } from "@/lib/run-report/types";

// ─── Test helpers ─────────────────────────────────────────────────────────────

const rubric = (
  id: string,
  contested = false,
  name = `Rubric ${id}`,
): GraphRubric => ({
  ref_id: `ref-${id}`,
  id,
  name,
  contested,
});

/**
 * Build a roster of N criteria, optionally marking some as contested.
 * IDs follow the pattern C-001, C-002, …
 */
const roster = (total: number, contestedIds: string[] = []): GraphRubric[] =>
  Array.from({ length: total }, (_, i) => {
    const id = `C-${String(i + 1).padStart(3, "0")}`;
    return rubric(id, contestedIds.includes(id));
  });

/**
 * Build a ScorableCriterion. Extra fields allow injecting judge-dispute keys.
 */
const crit = (
  id: string,
  verdict: string,
  extra: Partial<ScorableCriterion> = {},
): ScorableCriterion => ({
  id,
  title: `Rubric ${id}`,
  verdict,
  ...extra,
});

/**
 * Assert the partition invariant: pass + fail + contested === total.
 */
function assertPartition(bd: RubricBreakdown, label = "") {
  const sum = bd.pass + bd.fail + bd.contested;
  expect(sum).toBe(bd.total);
  if (label) {
    // Additional context for debugging
    expect({ label, sum, ...bd }).toMatchObject({ sum: bd.total });
  }
}

// ─── rubricBreakdown: returns null when score is null ────────────────────────

describe("rubricBreakdown: null score", () => {
  it("returns null when score is null", () => {
    expect(rubricBreakdown({ score: null })).toBeNull();
    expect(rubricBreakdown({ score: null, criteria: [], graphRubrics: [] })).toBeNull();
    expect(
      rubricBreakdown({ score: null, criteria: [crit("C-001", "pass")], graphRubrics: roster(5) }),
    ).toBeNull();
  });
});

// ─── Partition invariant ─────────────────────────────────────────────────────

describe("rubricBreakdown: partition invariant pass + fail + contested === total", () => {
  it("holds for a clean run with a full matching roster", () => {
    const graph = roster(10);
    const criteria = graph.map((r) => crit(r.id, "pass"));
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    const bd = rubricBreakdown({ score, criteria, graphRubrics: graph })!;

    assertPartition(bd);
    expect(bd.pass).toBe(10);
    expect(bd.fail).toBe(0);
    expect(bd.contested).toBe(0);
    expect(bd.total).toBe(10);
    expect(bd.clamped).toBe(false);
  });

  it("holds when the roster is larger than the run's scored criteria (unscored → Fail)", () => {
    // Roster has 10, run only scored 3 (all passing). The 7 unscored count as Fail.
    const graph = roster(10);
    const criteria = [
      crit("C-001", "pass"),
      crit("C-002", "pass"),
      crit("C-003", "pass"),
    ];
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    const bd = rubricBreakdown({ score, criteria, graphRubrics: graph })!;

    assertPartition(bd, "roster larger than run");
    expect(bd.total).toBe(10);
    expect(bd.pass).toBe(3);
    expect(bd.fail).toBe(7); // 7 unscored roster criteria count as Fail
    expect(bd.contested).toBe(0);
    expect(bd.clamped).toBe(false);
  });

  it("holds when the run has criteria absent from the roster (run bigger than roster)", () => {
    // Roster has 4, run scored 6. Extra run criteria not in roster are extra passes/fails.
    const graph = roster(4);
    const criteria = [
      crit("C-001", "pass"),
      crit("C-002", "pass"),
      crit("C-003", "pass"),
      crit("C-004", "pass"),
      crit("C-005", "pass"), // not in roster
      crit("C-006", "fail"), // not in roster
    ];
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    const bd = rubricBreakdown({ score, criteria, graphRubrics: graph })!;

    assertPartition(bd, "run bigger than roster");
    // total comes from the roster (score.total = 4)
    expect(bd.total).toBe(4);
    // pass is clamped to scorable (4)
    expect(bd.pass).toBeLessThanOrEqual(bd.total - bd.contested);
    expect(bd.fail).toBeGreaterThanOrEqual(0);
  });

  it("holds for a run with contested criteria (roster-matched)", () => {
    const graph = roster(10, ["C-001", "C-002", "C-003"]);
    const criteria = graph.map((r) =>
      crit(r.id, ["C-001", "C-002", "C-003"].includes(r.id) ? "fail" : "pass"),
    );
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    const bd = rubricBreakdown({ score, criteria, graphRubrics: graph })!;

    assertPartition(bd, "roster-matched contested");
    expect(bd.contested).toBe(3);
    expect(bd.pass).toBe(7);
    expect(bd.fail).toBe(0);
    expect(bd.total).toBe(10);
    expect(bd.clamped).toBe(false);
  });

  it("holds when fail would be negative without construction (the Math.max bug scenario)", () => {
    // 4-criterion roster, all pass in the run → passed=4 from computeBenchmarkScore.
    // If we naively did fail = denominator - passed, that's fine here.
    // The tricky case: run has MORE passes than scorable after contested union.
    // Use a run-recorded contest on a criterion NOT in the roster's contested set.
    const graph = roster(4); // nothing contested in the graph
    const criteria = [
      crit("C-001", "pass"),
      crit("C-002", "pass"),
      crit("C-003", "pass"),
      crit("C-004", "pass", { contested: true }), // run-recorded, not in roster's contested set
    ];
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    // computeBenchmarkScore uses Math.max(rosterContested=0, contestedInRun=1) = 1
    // so denominator = 3, passed = 3, allPass = true
    expect(score.passed).toBe(3);
    expect(score.denominator).toBe(3);

    const bd = rubricBreakdown({ score, criteria, graphRubrics: graph })!;
    assertPartition(bd, "run-recorded contested not in roster");
    // The union finds the 1 run-contested criterion (C-004) not in the roster contested set
    expect(bd.contested).toBe(1);
    expect(bd.total).toBe(4);
    // pass = min(3, scorable=3) = 3; fail = 0
    expect(bd.pass).toBe(3);
    expect(bd.fail).toBe(0);
    expect(bd.fail).toBeGreaterThanOrEqual(0);
    expect(bd.clamped).toBe(false);
  });

  it("clamped=true when pass exceeds scorable", () => {
    // Create a situation where the union contested is higher than what
    // computeBenchmarkScore saw (additional run-contested criteria), making
    // score.passed > scorable.
    // Roster: 5 criteria, none contested. Run: 5 pass, but 2 have run-contested flags.
    // computeBenchmarkScore: Math.max(0, 2)=2 → denominator=3, passed=3 (3 non-contested pass).
    // rubricBreakdown union: same 2, so scorable=3, pass=min(3,3)=3 — no clamp here.
    //
    // To force a clamp we need score.passed > scorable from the union.
    // Scenario: roster has 1 contested; run has 2 contested (1 extra not in roster).
    // computeBenchmarkScore: Math.max(1, 2)=2 → denominator=3, passed=3 (C-004,C-005 pass, C-001 contested by roster, C-002 contested by run, C-003 pass).
    // Wait, Math.max already handles the max case. Let's construct more carefully.
    //
    // Roster: 5 criteria, C-001 contested.
    // Run criteria: C-001 contested(roster), C-002 pass, C-003 pass, C-004 pass, C-005 pass.
    // computeBenchmarkScore: rosterContested=1, contestedInRun=1(C-001), Math.max=1
    //   → denominator=4, passed=4.
    // rubricBreakdown union: rosterContested set = {c-001}. Run-contested: C-001 — already in roster set, so no new addition. union=1.
    //   scorable=4, pass=min(4,4)=4. No clamp.
    //
    // For a clamp, we need the union to add an extra contested not seen by computeBenchmarkScore.
    // computeBenchmarkScore uses Math.max(rosterContested, contestedInRun). The union can only
    // ADD entries. So when union > Math.max, that means there are run-contested criteria the
    // roster doesn't know about AND the count exceeds the roster's own contested count.
    //
    // Example: roster has C-001 contested (rosterContested=1).
    // Run: C-001 contested (already in roster), C-002 pass, C-003 pass, C-004 pass,
    //      C-005 pass with {contested:true} (NOT in roster contested set).
    // computeBenchmarkScore: rosterContested=1, contestedInRun=2, Math.max=2 → denominator=3, passed=3.
    // rubricBreakdown union: starts at rosterContested=1. C-001 in roster contested → skip. C-005 NOT in roster contested → add. union=2.
    // scorable=3, pass=min(3,3)=3. Still no clamp...
    //
    // We need score.passed > scorable from the union. That means union > Math.max from computeBenchmarkScore.
    // But union = rosterContested + (runContested NOT in roster) and Math.max = max(rosterContested, runContested).
    // Let's say rosterContested=1, runContested (total)=2 (1 in roster + 1 new). Math.max=2. Union=2. Same.
    // For union > Math.max: rosterContested=3, runContested=1 (all in roster). Math.max=3. Union=3. Same.
    //
    // The clamp path for pass only fires when score.passed > total - union_contested.
    // Let's force it: 5 criteria, roster contested=[C-001,C-002,C-003] (3 contested).
    // Run: C-001,C-002,C-003 all fail (contested). C-004,C-005 pass. Plus C-006 (not in roster) with contested:true.
    // computeBenchmarkScore: rosterContested=3, contestedInRun=4, Math.max=4 → denominator=1, passed=2.
    // But wait, passed=2 but denominator=1 — this is the exact negative-fail case!
    // rubricBreakdown union: rosterContested=3 (C-001,C-002,C-003 keys). C-004 pass, no contest. C-005 pass, no contest. C-006 contested:true, not in roster keys → add. union=4.
    // But score.total = graphRubrics.length = 5 (not including C-006 since it's not in the roster).
    // scorable = max(0, 5-4)=1, pass=min(2,1)=1 → CLAMPED!
    const graph = roster(5, ["C-001", "C-002", "C-003"]);
    const criteria = [
      crit("C-001", "fail"), // roster-contested
      crit("C-002", "fail"), // roster-contested
      crit("C-003", "fail"), // roster-contested
      crit("C-004", "pass"),
      crit("C-005", "pass"),
      crit("C-006", "fail", { contested: true }), // run-only, not in roster
    ];
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    const bd = rubricBreakdown({ score, criteria, graphRubrics: graph })!;

    assertPartition(bd, "forced clamp scenario");
    expect(bd.clamped).toBe(true);
    expect(bd.fail).toBeGreaterThanOrEqual(0);
  });
});

// ─── Unscored roster criteria count as Fail ──────────────────────────────────

describe("rubricBreakdown: unscored roster criteria count as Fail", () => {
  it("criteria absent from the run are treated as Fail (not Pass)", () => {
    const graph = roster(5);
    // Only 2 of 5 scored, both passing
    const criteria = [crit("C-001", "pass"), crit("C-002", "pass")];
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    // computeBenchmarkScore: passed=2, denominator=5, total=5
    expect(score.passed).toBe(2);
    expect(score.denominator).toBe(5);

    const bd = rubricBreakdown({ score, criteria, graphRubrics: graph })!;
    assertPartition(bd);
    expect(bd.total).toBe(5);
    expect(bd.pass).toBe(2);
    expect(bd.fail).toBe(3); // 3 unscored → Fail
    expect(bd.contested).toBe(0);
  });

  it("unscored contested roster criteria still count as Contested, not Fail", () => {
    // Roster: 5, C-003 contested. Run: only scores C-001, C-002, C-004, C-005 (C-003 absent).
    const graph = roster(5, ["C-003"]);
    const criteria = [
      crit("C-001", "pass"),
      crit("C-002", "pass"),
      crit("C-004", "pass"),
      crit("C-005", "fail"),
    ];
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    const bd = rubricBreakdown({ score, criteria, graphRubrics: graph })!;

    assertPartition(bd);
    expect(bd.total).toBe(5);
    expect(bd.contested).toBe(1); // C-003 contested
    // scorable=4, pass=3 (C-001,C-002,C-004), fail=1 (C-005)
    expect(bd.pass).toBe(3);
    expect(bd.fail).toBe(1);
  });
});

// ─── Disputed overlay ────────────────────────────────────────────────────────

describe("rubricBreakdown: disputed null when no criteria", () => {
  it("disputed is null when criteria is absent", () => {
    const graph = roster(5);
    const score = computeBenchmarkScore({ nPassed: 3, nTotal: 5, graphRubrics: graph })!;
    const bd = rubricBreakdown({ score, graphRubrics: graph })!;
    expect(bd.disputed).toBeNull();
  });

  it("disputed is null when criteria is an empty array", () => {
    const score = computeBenchmarkScore({ nPassed: 3, nTotal: 5 })!;
    const bd = rubricBreakdown({ score, criteria: [] })!;
    expect(bd.disputed).toBeNull();
  });
});

describe("rubricBreakdown: disputed null when no flag keys present", () => {
  it("disputed is null when criteria have no judge-dispute keys at all", () => {
    // Criteria only have id/title/verdict/contested — no flagged/llm_flag_reason/flag_basis keys.
    const graph = roster(3);
    const criteria = graph.map((r) => crit(r.id, "pass"));
    // Verify: none of the criteria carry dispute keys.
    for (const c of criteria) {
      expect("flagged" in c).toBe(false);
      expect("llm_flag_reason" in c).toBe(false);
      expect("flag_basis" in c).toBe(false);
    }

    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    const bd = rubricBreakdown({ score, criteria, graphRubrics: graph })!;
    expect(bd.disputed).toBeNull();
  });
});

describe("rubricBreakdown: disputed === 0 when flag keys present but nothing flagged", () => {
  it("disputed is 0 when flagged key is present but value is false on all criteria", () => {
    const graph = roster(3);
    const criteria = [
      { ...crit("C-001", "fail"), flagged: false },
      { ...crit("C-002", "fail"), flagged: false },
      { ...crit("C-003", "fail"), flagged: false },
    ];
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    const bd = rubricBreakdown({ score, criteria, graphRubrics: graph })!;
    expect(bd.disputed).toBe(0);
  });

  it("disputed is 0 when only llm_flag_reason key is present (empty string, not flagged)", () => {
    // llm_flag_reason key present but value is empty string → resolveJudgeDispute returns null (no prose AND not flagged)
    const graph = roster(2);
    const criteria = [
      { ...crit("C-001", "fail"), llm_flag_reason: "" },
      { ...crit("C-002", "fail"), llm_flag_reason: "" },
    ];
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    const bd = rubricBreakdown({ score, criteria, graphRubrics: graph })!;
    // The key is present → not null. But nothing is flagged → 0.
    expect(bd.disputed).toBe(0);
  });
});

describe("rubricBreakdown: disputed counts correctly when flagged", () => {
  it("counts criteria where flagged=true (or '\"true\"') and verdict is not pass", () => {
    const graph = roster(4);
    const criteria = [
      { ...crit("C-001", "fail"), flagged: true },   // disputed
      { ...crit("C-002", "fail"), flagged: false },   // not disputed
      { ...crit("C-003", "fail"), flagged: "true" },  // disputed (string)
      { ...crit("C-004", "pass"), flagged: true },    // pass → resolveJudgeDispute returns null (verdict gate)
    ];
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    const bd = rubricBreakdown({ score, criteria, graphRubrics: graph })!;
    assertPartition(bd);
    // C-001 and C-003 are disputed; C-004 is a pass so resolveJudgeDispute returns null
    expect(bd.disputed).toBe(2);
  });

  it("restricted to roster-joined criteria when a roster is present", () => {
    // Roster has 3 criteria. Run has 4, with C-004 not in the roster.
    const graph = roster(3); // C-001, C-002, C-003
    const criteria = [
      { ...crit("C-001", "fail"), flagged: true },  // in roster, disputed
      { ...crit("C-002", "fail"), flagged: true },  // in roster, disputed
      { ...crit("C-003", "fail"), flagged: false }, // in roster, not disputed
      { ...crit("C-004", "fail"), flagged: true },  // NOT in roster → excluded from count
    ];
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    const bd = rubricBreakdown({ score, criteria, graphRubrics: graph })!;
    assertPartition(bd);
    // Only C-001 and C-002 join the roster and are disputed
    expect(bd.disputed).toBe(2);
  });

  it("counts all disputed criteria when no roster is present", () => {
    // No graphRubrics — all criteria are counted for disputed
    const criteria = [
      { ...crit("C-001", "fail"), flagged: true },
      { ...crit("C-002", "fail"), flagged: true },
      { ...crit("C-003", "pass"), flagged: true },  // pass → null
    ];
    const score = computeBenchmarkScore({ criteriaResults: criteria })!;
    const bd = rubricBreakdown({ score, criteria })!;
    // No roster means no restriction — 2 disputed (C-001, C-002; C-003 is pass)
    expect(bd.disputed).toBe(2);
  });
});

describe("rubricBreakdown: disputed <= fail + contested always", () => {
  it("disputed is clamped to fail + contested", () => {
    // Construct a scenario where the raw disputed count would exceed fail+contested.
    // This can happen if passing criteria carry flagged=true (resolveJudgeDispute verdict-gates them to null),
    // so disputed is naturally <= fail+contested. The clamp is a safety net.
    // Verify the invariant always holds.
    const graph = roster(5, ["C-003"]);
    const criteria = [
      { ...crit("C-001", "pass"), flagged: true },  // pass → dispute null
      { ...crit("C-002", "pass"), flagged: false },
      { ...crit("C-003", "fail"), flagged: true },  // contested AND disputed
      { ...crit("C-004", "fail"), flagged: true },  // disputed
      { ...crit("C-005", "fail"), flagged: false },
    ];
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    const bd = rubricBreakdown({ score, criteria, graphRubrics: graph })!;
    assertPartition(bd);
    expect(bd.disputed).not.toBeNull();
    expect(bd.disputed!).toBeLessThanOrEqual(bd.fail + bd.contested);
  });

  it("holds when all non-pass criteria are disputed", () => {
    const graph = roster(3);
    const criteria = [
      { ...crit("C-001", "fail"), flagged: true },
      { ...crit("C-002", "fail"), flagged: true },
      { ...crit("C-003", "fail"), flagged: true },
    ];
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    const bd = rubricBreakdown({ score, criteria, graphRubrics: graph })!;
    assertPartition(bd);
    // 3 fails, 0 contested → fail+contested = 3 → disputed = 3
    expect(bd.disputed).toBe(3);
    expect(bd.disputed!).toBeLessThanOrEqual(bd.fail + bd.contested);
  });
});

// ─── Contested + Disputed overlap ────────────────────────────────────────────

describe("rubricBreakdown: a criterion can be both Contested and Disputed simultaneously", () => {
  it("a criterion counted in Contested can also be counted in Disputed", () => {
    // C-001 is contested (in roster) AND flagged=true (disputed).
    // The verdict gate in resolveJudgeDispute passes because verdict is "fail".
    const graph = roster(4, ["C-001"]);
    const criteria = [
      // C-001: contested (roster) AND flagged (dispute) — the overlap case
      { ...crit("C-001", "fail"), flagged: true, llm_flag_reason: "criterion definition is ambiguous" },
      { ...crit("C-002", "pass"), flagged: false },
      { ...crit("C-003", "fail"), flagged: false },
      { ...crit("C-004", "fail"), flagged: true }, // disputed but not contested
    ];
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    const bd = rubricBreakdown({ score, criteria, graphRubrics: graph })!;

    assertPartition(bd);
    // C-001 is contested → goes into Contested bucket
    expect(bd.contested).toBe(1);
    // C-001 (fail verdict) is also disputed — and it's in the roster
    // C-004 is also disputed — and in the roster
    // fail+contested = (4-1-pass_count) ... let's compute:
    // pass = min(score.passed=1, scorable=3) = 1 (C-002)
    // fail = 3-1 = 2 (C-003, C-004)
    // fail+contested = 2+1 = 3
    // C-001 is in roster (joining allowed). resolveJudgeDispute: verdict "fail", flagged true, has prose → isDispute=true
    // C-004 is in roster. resolveJudgeDispute: verdict "fail", flagged true → isDispute=true
    // Raw disputed = 2 (C-001 + C-004). Clamp to fail+contested=3. disputed = 2.
    expect(bd.disputed).toBe(2);
    expect(bd.disputed!).toBeLessThanOrEqual(bd.fail + bd.contested);
    expect(bd.fail).toBe(2);
    // Total = pass + fail + contested = 1 + 2 + 1 = 4 ✓
    expect(bd.total).toBe(4);
  });
});

// ─── totalSource propagation ──────────────────────────────────────────────────

describe("rubricBreakdown: totalSource", () => {
  it("is 'graph' when a graph roster is present", () => {
    const graph = roster(5);
    const criteria = graph.map((r) => crit(r.id, "pass"));
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    const bd = rubricBreakdown({ score, criteria, graphRubrics: graph })!;
    expect(bd.totalSource).toBe("graph");
  });

  it("is 'run' when no graph roster is present", () => {
    const criteria = [crit("C-001", "pass"), crit("C-002", "fail")];
    const score = computeBenchmarkScore({ criteriaResults: criteria })!;
    const bd = rubricBreakdown({ score, criteria })!;
    expect(bd.totalSource).toBe("run");
  });

  it("is 'run' when using flat counts only", () => {
    const score = computeBenchmarkScore({ nPassed: 3, nTotal: 5 })!;
    const bd = rubricBreakdown({ score })!;
    expect(bd.total).toBe(5);
    expect(bd.totalSource).toBe("run");
  });
});

// ─── Regression: rosterSummary unchanged ─────────────────────────────────────

describe("regression: rosterSummary is byte-identical before and after rubricBreakdown calls", () => {
  it("rosterSummary output is unchanged", () => {
    const graph = roster(20, ["C-001", "C-004", "C-007", "C-010"]);
    const before = rosterSummary(graph);
    expect(before).toEqual({ total: 20, contested: 4, denominator: 16 });

    // Run rubricBreakdown — must not mutate roster or affect rosterSummary.
    const criteria = graph.map((r) => crit(r.id, "pass"));
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    rubricBreakdown({ score, criteria, graphRubrics: graph });

    const after = rosterSummary(graph);
    expect(after).toEqual(before);
  });

  it("rosterSummary returns null for null/undefined/empty (unchanged)", () => {
    expect(rosterSummary(null)).toBeNull();
    expect(rosterSummary(undefined)).toBeNull();
    expect(rosterSummary([])).toBeNull();
  });
});

// ─── Regression: formatBenchmarkScore unchanged ──────────────────────────────

describe("regression: formatBenchmarkScore output is unchanged", () => {
  it("formats a clean score correctly", () => {
    const score = computeBenchmarkScore({ nPassed: 43, nTotal: 50 })!;
    expect(formatBenchmarkScore(score)).toEqual({ headline: "43/50", annotation: null });
  });

  it("includes annotation when contested > 0", () => {
    const graph = roster(50, ["C-001", "C-002", "C-003", "C-004", "C-005", "C-006", "C-007"]);
    const criteria = graph.map((r) =>
      crit(r.id, ["C-001", "C-002", "C-003", "C-004", "C-005", "C-006", "C-007"].includes(r.id) ? "fail" : "pass"),
    );
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    // Running rubricBreakdown must not affect formatBenchmarkScore output.
    rubricBreakdown({ score, criteria, graphRubrics: graph });
    expect(formatBenchmarkScore(score)).toEqual({
      headline: "43/43",
      annotation: "+7 contested · 50 total",
    });
  });
});

// ─── Regression: denominator and allPass unchanged ───────────────────────────

describe("regression: computeBenchmarkScore denominator and allPass are unchanged", () => {
  it("denominator and allPass are not mutated by rubricBreakdown", () => {
    const graph = roster(10, ["C-001", "C-002"]);
    const criteria = graph.map((r) => crit(r.id, "pass"));
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    const denomBefore = score.denominator;
    const allPassBefore = score.allPass;
    const passedBefore = score.passed;

    rubricBreakdown({ score, criteria, graphRubrics: graph });

    expect(score.denominator).toBe(denomBefore);
    expect(score.allPass).toBe(allPassBefore);
    expect(score.passed).toBe(passedBefore);
  });

  it("denominator is graph-roster-based when roster is present", () => {
    const graph = roster(10);
    const criteria = [crit("C-001", "pass"), crit("C-002", "pass")];
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph })!;
    expect(score.denominator).toBe(10); // graph wins
    expect(score.source).toBe("graph");
  });
});

// ─── scorableFromRubricRow adapter ───────────────────────────────────────────

describe("scorableFromRubricRow", () => {
  const makeRow = (overrides: Partial<RubricRow> = {}): RubricRow => ({
    id: "C-001",
    title: "Rubric C-001",
    passed: false,
    verdict: "fail",
    reasoning: "Criterion not met",
    matchCriteria: "Check X",
    documentExcerpt: "",
    ...overrides,
  });

  it("maps basic fields correctly", () => {
    const row = makeRow({ id: "C-005", title: "My Title", verdict: "pass" });
    const sc = scorableFromRubricRow(row);
    expect(sc.id).toBe("C-005");
    expect(sc.title).toBe("My Title");
    expect(sc.verdict).toBe("pass");
  });

  it("maps criterionContested → contested", () => {
    const row = makeRow({ criterionContested: true });
    const sc = scorableFromRubricRow(row);
    expect(sc.contested).toBe(true);
  });

  it("maps judgeFlagged → flagged", () => {
    const row = makeRow({ judgeFlagged: true });
    const sc = scorableFromRubricRow(row);
    expect(sc.flagged).toBe(true);
  });

  it("maps judgeFlagReason → llm_flag_reason", () => {
    const row = makeRow({ judgeFlagReason: "This criterion's definition is ambiguous" });
    const sc = scorableFromRubricRow(row);
    expect(sc.llm_flag_reason).toBe("This criterion's definition is ambiguous");
  });

  it("maps judgeFlagBasis → flag_basis", () => {
    const row = makeRow({ judgeFlagBasis: "criterion_ambiguity" });
    const sc = scorableFromRubricRow(row);
    expect(sc.flag_basis).toBe("criterion_ambiguity");
  });

  it("does NOT attach flagged key when judgeFlagged is absent from the row", () => {
    // Key absence is meaningful — must not inject a 'flagged: undefined' key.
    const row = makeRow(); // no judgeFlagged
    const sc = scorableFromRubricRow(row);
    expect(Object.prototype.hasOwnProperty.call(sc, "flagged")).toBe(false);
  });

  it("does NOT attach llm_flag_reason key when judgeFlagReason is absent", () => {
    const row = makeRow();
    const sc = scorableFromRubricRow(row);
    expect(Object.prototype.hasOwnProperty.call(sc, "llm_flag_reason")).toBe(false);
  });

  it("does NOT attach flag_basis key when judgeFlagBasis is absent", () => {
    const row = makeRow();
    const sc = scorableFromRubricRow(row);
    expect(Object.prototype.hasOwnProperty.call(sc, "flag_basis")).toBe(false);
  });

  it("produces a criterion that yields non-zero Disputed when judgeFlagged is set", () => {
    // This is the direct guard against a confident-0 regression:
    // if scorableFromRubricRow fails to map judgeFlagged → flagged, the
    // dispute key will be absent and rubricBreakdown will return disputed=null
    // instead of the correct non-zero count.
    const row = makeRow({
      verdict: "fail",
      judgeFlagged: true,
      judgeFlagReason: "The criterion definition is too vague to score reliably",
    });
    const sc = scorableFromRubricRow(row);

    // The adapter must have mapped the key correctly.
    expect(Object.prototype.hasOwnProperty.call(sc, "flagged")).toBe(true);
    expect(sc.flagged).toBe(true);

    // Confirm that rubricBreakdown sees a non-zero disputed when fed this criterion.
    const score = computeBenchmarkScore({ criteriaResults: [sc] })!;
    const bd = rubricBreakdown({ score, criteria: [sc] })!;
    expect(bd.disputed).not.toBeNull();
    expect(bd.disputed).toBe(1);
  });

  it("a row with all judge-dispute fields set round-trips correctly", () => {
    const row = makeRow({
      verdict: "fail",
      judgeFlagged: true,
      judgeFlagReason: "This criterion is broken",
      judgeFlagBasis: "criterion_ambiguity",
      criterionContested: false,
    });
    const sc = scorableFromRubricRow(row);
    expect(sc.flagged).toBe(true);
    expect(sc.llm_flag_reason).toBe("This criterion is broken");
    expect(sc.flag_basis).toBe("criterion_ambiguity");
    expect(sc.contested).toBe(false);
  });

  it("a row with contested=true and judgeFlagged=true produces a Contested+Disputed criterion", () => {
    // The overlap case via the adapter.
    const row = makeRow({
      verdict: "fail",
      judgeFlagged: true,
      judgeFlagReason: "Contested and disputed",
      criterionContested: true,
    });
    const sc = scorableFromRubricRow(row);
    // Feed into rubricBreakdown to verify overlap works end-to-end.
    const score = computeBenchmarkScore({ criteriaResults: [sc] })!;
    const bd = rubricBreakdown({ score, criteria: [sc] })!;
    assertPartition(bd);
    expect(bd.contested).toBe(1);
    // C-001 with verdict=fail goes to Contested (not Fail).
    // fail+contested = 0+1 = 1. disputed = min(1, 1) = 1.
    expect(bd.disputed).toBe(1);
  });
});
