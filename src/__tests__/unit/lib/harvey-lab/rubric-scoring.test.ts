import { describe, it, expect } from "vitest";
import {
  buildContestedIndex,
  criterionStatus,
  computeBenchmarkScore,
  formatBenchmarkScore,
  rosterSummary,
  type GraphRubric,
} from "@/lib/harvey-lab/rubric-scoring";

const rubric = (id: string, contested = false, name = `Rubric ${id}`): GraphRubric => ({
  ref_id: `ref-${id}`,
  id,
  name,
  contested,
});

const roster = (total: number, contestedIds: string[] = []): GraphRubric[] =>
  Array.from({ length: total }, (_, i) => {
    const id = `C-${String(i + 1).padStart(3, "0")}`;
    return rubric(id, contestedIds.includes(id));
  });

const criterion = (id: string, verdict: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Rubric ${id}`,
  verdict,
  ...extra,
});

describe("buildContestedIndex", () => {
  it("indexes only contested rubrics, by id and name, normalized", () => {
    const index = buildContestedIndex([
      rubric("C-001", true, "Signature Block"),
      rubric("C-002", false),
    ]);
    expect(index.has("c-001")).toBe(true);
    expect(index.has("signature block")).toBe(true);
    expect(index.has("c-002")).toBe(false);
  });

  it("returns an empty index for null/undefined/empty rosters", () => {
    expect(buildContestedIndex(null).size).toBe(0);
    expect(buildContestedIndex(undefined).size).toBe(0);
    expect(buildContestedIndex([]).size).toBe(0);
  });
});

describe("criterionStatus", () => {
  it("is CONTESTED when the graph marks the id, regardless of verdict", () => {
    const index = buildContestedIndex([rubric("C-001", true)]);
    expect(criterionStatus(criterion("C-001", "pass"), index)).toBe("CONTESTED");
    expect(criterionStatus(criterion("C-001", "fail"), index)).toBe("CONTESTED");
  });

  it("matches contested by title when ids do not line up", () => {
    const index = buildContestedIndex([rubric("uuid-x", true, "Rubric C-004")]);
    expect(criterionStatus(criterion("C-004", "pass"), index)).toBe("CONTESTED");
  });

  it("honours the run-recorded contested flag as fallback", () => {
    const index = new Set<string>();
    expect(criterionStatus(criterion("C-002", "pass", { contested: true }), index)).toBe(
      "CONTESTED",
    );
    expect(criterionStatus(criterion("C-002", "pass", { contested: "true" }), index)).toBe(
      "CONTESTED",
    );
  });

  it("is PASS/FAIL by verdict prefix when not contested", () => {
    const index = new Set<string>();
    expect(criterionStatus(criterion("C-003", "Pass"), index)).toBe("PASS");
    expect(criterionStatus(criterion("C-003", "PASSED"), index)).toBe("PASS");
    expect(criterionStatus(criterion("C-003", "fail"), index)).toBe("FAIL");
    expect(criterionStatus(criterion("C-003", ""), index)).toBe("FAIL");
  });
});

describe("rosterSummary", () => {
  it("summarises total/contested/denominator", () => {
    expect(rosterSummary(roster(50, ["C-001", "C-002", "C-003", "C-004", "C-005", "C-006", "C-007"]))).toEqual({
      total: 50,
      contested: 7,
      denominator: 43,
    });
  });

  it("returns null for null/undefined/empty rosters", () => {
    expect(rosterSummary(null)).toBeNull();
    expect(rosterSummary(undefined)).toBeNull();
    expect(rosterSummary([])).toBeNull();
  });

  it("floors the denominator at zero when everything is contested", () => {
    expect(rosterSummary(roster(2, ["C-001", "C-002"]))).toEqual({
      total: 2,
      contested: 2,
      denominator: 0,
    });
  });
});

describe("computeBenchmarkScore", () => {
  it("returns null when the run carries no score data", () => {
    expect(computeBenchmarkScore({})).toBeNull();
    expect(computeBenchmarkScore({ criteriaResults: [], graphRubrics: [] })).toBeNull();
    // A roster alone describes the task, not this run — no fabricated 0/N.
    expect(computeBenchmarkScore({ graphRubrics: roster(10) })).toBeNull();
  });

  it("drops contested from both sides: 50 rubrics, 7 contested, rest pass → 43/43 (+7, 50 total)", () => {
    const contestedIds = ["C-001", "C-002", "C-003", "C-004", "C-005", "C-006", "C-007"];
    const graph = roster(50, contestedIds);
    const criteria = graph.map((r) =>
      // Contested ones failed in the run; every scorable one passed.
      criterion(r.id, contestedIds.includes(r.id) ? "fail" : "pass"),
    );

    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph });
    expect(score).toEqual({
      passed: 43,
      denominator: 43,
      contested: 7,
      total: 50,
      allPass: true,
      source: "graph",
    });
    expect(formatBenchmarkScore(score!)).toEqual({
      headline: "43/43",
      annotation: "+7 contested · 50 total",
    });
  });

  it("does not let a contested pass inflate the numerator", () => {
    const graph = roster(3, ["C-001"]);
    const criteria = [
      criterion("C-001", "pass"), // contested — excluded even though it passed
      criterion("C-002", "pass"),
      criterion("C-003", "fail"),
    ];
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph });
    expect(score).toMatchObject({ passed: 1, denominator: 2, contested: 1, total: 3, allPass: false });
  });

  it("the graph roster is the denominator even when the run scored fewer criteria", () => {
    const graph = roster(10);
    const criteria = [criterion("C-001", "pass"), criterion("C-002", "pass")];
    const score = computeBenchmarkScore({
      criteriaResults: criteria,
      nPassed: 2,
      nTotal: 2, // runner undercounted — graph wins
      graphRubrics: graph,
    });
    expect(score).toMatchObject({ passed: 2, denominator: 10, total: 10, allPass: false, source: "graph" });
  });

  it("falls back to run data when the graph is unavailable", () => {
    const criteria = [
      criterion("C-001", "pass"),
      criterion("C-002", "fail"),
      criterion("C-003", "pass", { contested: true }),
    ];
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: null });
    expect(score).toMatchObject({
      passed: 1,
      denominator: 2,
      contested: 1,
      total: 3,
      allPass: false,
      source: "run",
    });
  });

  it("falls back to flat counts when per-criterion results are absent", () => {
    const score = computeBenchmarkScore({ nPassed: 5, nTotal: 8 });
    expect(score).toMatchObject({ passed: 5, denominator: 8, contested: 0, total: 8, allPass: false });
  });

  it("clamps flat-count passes to the contested-adjusted denominator", () => {
    const graph = roster(8, ["C-001", "C-002"]);
    const score = computeBenchmarkScore({ nPassed: 8, nTotal: 8, graphRubrics: graph });
    expect(score).toMatchObject({ passed: 6, denominator: 6, contested: 2, total: 8 });
  });

  it("counts a run-recorded contest that the roster does not know about", () => {
    const graph = roster(4); // nothing contested in the graph
    const criteria = [
      criterion("C-001", "pass"),
      criterion("C-002", "pass"),
      criterion("C-003", "pass"),
      criterion("C-004", "fail", { contested: 1 }),
    ];
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph });
    expect(score).toMatchObject({ passed: 3, denominator: 3, contested: 1, total: 4, allPass: true });
  });

  it("never reports allPass on an empty denominator", () => {
    const graph = roster(2, ["C-001", "C-002"]);
    const criteria = [criterion("C-001", "pass"), criterion("C-002", "pass")];
    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph });
    expect(score).toMatchObject({ passed: 0, denominator: 0, contested: 2, allPass: false });
  });

  it("formatBenchmarkScore omits the annotation when nothing is contested", () => {
    const score = computeBenchmarkScore({ nPassed: 3, nTotal: 4 })!;
    expect(formatBenchmarkScore(score)).toEqual({ headline: "3/4", annotation: null });
  });
});
