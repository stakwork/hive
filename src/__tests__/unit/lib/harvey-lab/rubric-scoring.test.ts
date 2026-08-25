import { describe, it, expect } from "vitest";
import {
  buildContestedIndex,
  criterionStatus,
  computeBenchmarkScore,
  formatBenchmarkScore,
  rosterSummary,
  contestedOriginIndex,
  contestedOrigin,
  contestedOriginToken,
  type GraphRubric,
  type ContestedOriginInfo,
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

// ─── contestedOriginIndex ─────────────────────────────────────────────────────

describe("contestedOriginIndex", () => {
  it("returns available=false and empty sets for null/undefined/empty rosters", () => {
    expect(contestedOriginIndex(null)).toEqual({ ids: new Set(), titles: new Set(), available: false });
    expect(contestedOriginIndex(undefined)).toEqual({ ids: new Set(), titles: new Set(), available: false });
    expect(contestedOriginIndex([])).toEqual({ ids: new Set(), titles: new Set(), available: false });
  });

  it("indexes contested rubrics into separate id and title sets, normalized", () => {
    const idx = contestedOriginIndex([
      rubric("C-001", true, "Signature Block"),
      rubric("C-002", false, "Date Line"),
      rubric("C-003", true, "Notary Seal"),
    ]);
    expect(idx.available).toBe(true);
    expect(idx.ids.has("c-001")).toBe(true);
    expect(idx.ids.has("c-003")).toBe(true);
    expect(idx.ids.has("c-002")).toBe(false);
    expect(idx.titles.has("signature block")).toBe(true);
    expect(idx.titles.has("notary seal")).toBe(true);
    expect(idx.titles.has("date line")).toBe(false);
  });

  it("does NOT merge ids and titles into one set (keeps them separate)", () => {
    // id "C-001" should be in ids, not in titles; name "Signature Block" in titles, not ids
    const idx = contestedOriginIndex([rubric("C-001", true, "Signature Block")]);
    expect(idx.ids.has("c-001")).toBe(true);
    expect(idx.ids.has("signature block")).toBe(false);
    expect(idx.titles.has("signature block")).toBe(true);
    expect(idx.titles.has("c-001")).toBe(false);
  });

  it("marks available=true for a non-empty roster even if no rubric is contested", () => {
    const idx = contestedOriginIndex([rubric("C-001", false)]);
    expect(idx.available).toBe(true);
    expect(idx.ids.size).toBe(0);
    expect(idx.titles.size).toBe(0);
  });
});

// ─── contestedOriginToken ─────────────────────────────────────────────────────

describe("contestedOriginToken", () => {
  const makeInfo = (overrides: Partial<ContestedOriginInfo>): ContestedOriginInfo => ({
    inRun: false,
    roster: false,
    rosterAvailable: true,
    matchedBy: null,
    ...overrides,
  });

  it("returns null when neither inRun nor roster", () => {
    expect(contestedOriginToken(makeInfo({ inRun: false, roster: false }))).toBeNull();
  });

  it("returns 'in-run' when inRun=true, roster=false, rosterAvailable=true", () => {
    expect(contestedOriginToken(makeInfo({ inRun: true, roster: false, rosterAvailable: true }))).toBe("in-run");
  });

  it("returns 'roster' when inRun=false, roster=true, rosterAvailable=true", () => {
    expect(contestedOriginToken(makeInfo({ inRun: false, roster: true, rosterAvailable: true }))).toBe("roster");
  });

  it("returns 'both' when inRun=true and roster=true, rosterAvailable=true", () => {
    expect(contestedOriginToken(makeInfo({ inRun: true, roster: true, rosterAvailable: true }))).toBe("both");
  });

  it("returns 'unknown' when rosterAvailable=false and inRun=true (cannot verify roster miss)", () => {
    expect(contestedOriginToken(makeInfo({ inRun: true, roster: false, rosterAvailable: false }))).toBe("unknown");
  });

  it("returns 'unknown' when rosterAvailable=false and roster=true (impossible in practice but defensive)", () => {
    // roster=true cannot happen when rosterAvailable=false (contestedOrigin guards this),
    // but the token function itself degrades safely if called with these values directly.
    expect(contestedOriginToken(makeInfo({ inRun: false, roster: true, rosterAvailable: false }))).toBe("unknown");
  });

  it("returns 'unknown' when rosterAvailable=false and both are true", () => {
    expect(contestedOriginToken(makeInfo({ inRun: true, roster: true, rosterAvailable: false }))).toBe("unknown");
  });
});

// ─── contestedOrigin ─────────────────────────────────────────────────────────

describe("contestedOrigin", () => {
  it("returns null when criterion is not contested in any source", () => {
    const idx = contestedOriginIndex([rubric("C-001", false)]);
    const c = criterion("C-002", "pass");
    expect(contestedOrigin(c, idx)).toBeNull();
  });

  it("roster-only: returns inRun=false, roster=true, matchedBy='id' on id match", () => {
    const idx = contestedOriginIndex([rubric("C-001", true, "My Rubric")]);
    const c = criterion("C-001", "fail");
    const info = contestedOrigin(c, idx);
    expect(info).not.toBeNull();
    expect(info!.inRun).toBe(false);
    expect(info!.roster).toBe(true);
    expect(info!.rosterAvailable).toBe(true);
    expect(info!.matchedBy).toBe("id");
    // Token collapses to "roster"
    expect(contestedOriginToken(info!)).toBe("roster");
  });

  it("roster-only via title match: matchedBy='title' when id differs but title normalizes to contested name", () => {
    // The roster has a rubric with id "uuid-xyz" and name "Rubric C-004".
    // The criterion has id "C-004" and title "Rubric C-004" — id does NOT match the roster id,
    // but the title normalizes onto the roster name.
    const idx = contestedOriginIndex([rubric("uuid-xyz", true, "Rubric C-004")]);
    const c = criterion("C-004", "fail");
    // c.title = "Rubric C-004" (from the criterion() factory: title = `Rubric ${id}`)
    const info = contestedOrigin(c, idx);
    expect(info).not.toBeNull();
    expect(info!.roster).toBe(true);
    expect(info!.matchedBy).toBe("title");
    expect(info!.inRun).toBe(false);
    expect(contestedOriginToken(info!)).toBe("roster");
  });

  it("cross-field collision: criterion title matches a contested rubric's name even though they are unrelated", () => {
    // A criterion titled "Rubric C-007" collides with an unrelated contested rubric
    // that happens to have name "Rubric C-007". matchedBy must be "title" (not "id").
    const idx = contestedOriginIndex([
      rubric("unrelated-uuid", true, "Rubric C-007"), // contested, unrelated to C-007
    ]);
    const c = { id: "C-007", title: "Rubric C-007", verdict: "pass" }; // not in-run-contested
    const info = contestedOrigin(c, idx);
    expect(info).not.toBeNull();
    expect(info!.matchedBy).toBe("title");
    expect(info!.inRun).toBe(false);
    expect(info!.roster).toBe(true);
  });

  it("in-run-only: inRun=true, roster=false when run has contested flag and roster has none", () => {
    const idx = contestedOriginIndex([rubric("C-002", false)]); // nothing contested
    const c = criterion("C-001", "fail", { contested: true });
    const info = contestedOrigin(c, idx);
    expect(info).not.toBeNull();
    expect(info!.inRun).toBe(true);
    expect(info!.roster).toBe(false);
    expect(info!.matchedBy).toBe(null);
    expect(contestedOriginToken(info!)).toBe("in-run");
  });

  it("both: inRun=true and roster=true when run flags contested AND roster marks the criterion", () => {
    const idx = contestedOriginIndex([rubric("C-001", true)]);
    const c = criterion("C-001", "fail", { contested: true });
    const info = contestedOrigin(c, idx);
    expect(info).not.toBeNull();
    expect(info!.inRun).toBe(true);
    expect(info!.roster).toBe(true);
    expect(info!.matchedBy).toBe("id");
    expect(contestedOriginToken(info!)).toBe("both");
  });

  it("roster unavailable (null): in-run criterion tokenizes to 'unknown', never 'in-run'", () => {
    const idx = contestedOriginIndex(null); // roster not available
    const c = criterion("C-001", "fail", { contested: true }); // in-run flag present
    const info = contestedOrigin(c, idx);
    expect(info).not.toBeNull();
    expect(info!.inRun).toBe(true);
    expect(info!.rosterAvailable).toBe(false);
    // The token must degrade to "unknown" — not "in-run" — because we cannot
    // confirm the roster would have missed this criterion.
    expect(contestedOriginToken(info!)).toBe("unknown");
  });

  it("roster unavailable (empty): same 'unknown' degradation", () => {
    const idx = contestedOriginIndex([]);
    const c = criterion("C-001", "fail", { contested: true });
    const info = contestedOrigin(c, idx);
    expect(info).not.toBeNull();
    expect(info!.rosterAvailable).toBe(false);
    expect(contestedOriginToken(info!)).toBe("unknown");
  });

  it("roster-hit with a real pass verdict still tokenizes as 'roster'", () => {
    // A criterion that the roster marks contested but this run's judge returned
    // a real 'pass' verdict and did NOT flag contested.
    const idx = contestedOriginIndex([rubric("C-003", true)]);
    const c = criterion("C-003", "pass"); // no in-run contested flag
    const info = contestedOrigin(c, idx);
    expect(info).not.toBeNull();
    expect(info!.roster).toBe(true);
    expect(info!.inRun).toBe(false);
    expect(contestedOriginToken(info!)).toBe("roster");
  });
});

// ─── Score regression (pinning) ───────────────────────────────────────────────

describe("score regression: origin resolver does not affect computeBenchmarkScore or rosterSummary", () => {
  it("computeBenchmarkScore output is byte-identical regardless of origin resolver presence", () => {
    const contestedIds = ["C-001", "C-002", "C-003"];
    const graph = roster(10, contestedIds);
    const criteria = graph.map((r) =>
      criterion(r.id, contestedIds.includes(r.id) ? "fail" : "pass"),
    );

    const score = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph });
    // These values come purely from buildContestedIndex / criterionStatus, not from origin.
    expect(score).toEqual({
      passed: 7,
      denominator: 7,
      contested: 3,
      total: 10,
      allPass: true,
      source: "graph",
    });

    // Building the origin index for the same roster should not change these numbers.
    const _originIdx = contestedOriginIndex(graph);
    const _origins = criteria.map((c) => contestedOrigin(c, _originIdx));
    // Re-compute — must be identical.
    const score2 = computeBenchmarkScore({ criteriaResults: criteria, graphRubrics: graph });
    expect(score2).toEqual(score);
  });

  it("rosterSummary output is byte-identical regardless of origin resolver presence", () => {
    const graph = roster(20, ["C-001", "C-004", "C-007", "C-010"]);
    const summary = rosterSummary(graph);
    expect(summary).toEqual({ total: 20, contested: 4, denominator: 16 });

    // Building an origin index must not mutate the roster or alter rosterSummary.
    const _originIdx = contestedOriginIndex(graph);
    expect(rosterSummary(graph)).toEqual(summary);
  });
});

// ─── contestReasonIndex / contestExcerptIndex ─────────────────────────────────

import { contestReasonIndex, contestExcerptIndex } from "@/lib/harvey-lab/rubric-scoring";

const rubricWithReason = (id: string, reason: string | null, excerpt: string | null = null): GraphRubric => ({
  ref_id: `ref-${id}`,
  id,
  name: `Rubric ${id}`,
  contested: true,
  contestReason: reason,
  contestExcerpt: excerpt,
});

describe("contestReasonIndex", () => {
  it("returns empty map for null/undefined/empty rosters", () => {
    expect(contestReasonIndex(null).size).toBe(0);
    expect(contestReasonIndex(undefined).size).toBe(0);
    expect(contestReasonIndex([]).size).toBe(0);
  });

  it("only indexes contested rubrics with a non-empty contestReason", () => {
    const rs = [
      rubricWithReason("C-001", "Definition is ambiguous"),
      rubricWithReason("C-002", null),
      { ref_id: "ref-3", id: "C-003", name: "Non-contested", contested: false },
    ];
    const idx = contestReasonIndex(rs as GraphRubric[]);
    expect(idx.has("c-001")).toBe(true);
    expect(idx.get("c-001")).toBe("Definition is ambiguous");
    expect(idx.has("c-002")).toBe(false); // null reason
    expect(idx.has("c-003")).toBe(false); // not contested
  });

  it("indexes by normalized id AND by normalized name", () => {
    const rs = [rubricWithReason("C-007", "Scope loop detected")];
    rs[0].name = "Identify threshold triggers";
    const idx = contestReasonIndex(rs as GraphRubric[]);
    expect(idx.has("c-007")).toBe(true);
    expect(idx.has("identify threshold triggers")).toBe(true);
    expect(idx.get("c-007")).toBe("Scope loop detected");
  });

  it("skips entries with empty-string contestReason after trim", () => {
    const rs = [rubricWithReason("C-010", "   ")];
    const idx = contestReasonIndex(rs as GraphRubric[]);
    expect(idx.has("c-010")).toBe(false);
  });
});

describe("contestExcerptIndex", () => {
  it("returns empty map for null/undefined/empty rosters", () => {
    expect(contestExcerptIndex(null).size).toBe(0);
    expect(contestExcerptIndex(undefined).size).toBe(0);
    expect(contestExcerptIndex([]).size).toBe(0);
  });

  it("only indexes contested rubrics with a non-empty contestExcerpt", () => {
    const rs = [
      rubricWithReason("C-001", "Reason", "Excerpt text"),
      rubricWithReason("C-002", "Reason", null),
    ];
    const idx = contestExcerptIndex(rs as GraphRubric[]);
    expect(idx.has("c-001")).toBe(true);
    expect(idx.get("c-001")).toBe("Excerpt text");
    expect(idx.has("c-002")).toBe(false);
  });
});
