/**
 * Unit tests for `buildChainModel` — the deterministic backwards-chain
 * builder, focused on the Tier 2 commentary status introduced for hops 1/3/4
 * (assessed / not-yet-assessed / not-traced / not-traced-passed).
 */
import { describe, it, expect } from "vitest";
import { projectBundle } from "@/lib/run-report/project";
import { buildChainModel } from "@/lib/run-report/chain";
import { RUN_REPORT_FIXTURES } from "@/app/api/mock/run-report/fixtures";
import type { RunReportProjection } from "@/lib/run-report/types";

function projectionFor(name: keyof typeof RUN_REPORT_FIXTURES): RunReportProjection {
  const outcome = projectBundle(JSON.stringify(RUN_REPORT_FIXTURES[name]));
  if (outcome.status !== "ok") throw new Error(`fixture ${name} did not project`);
  return outcome.projection as RunReportProjection;
}

function hopsById(projection: RunReportProjection, id: string) {
  const chain = buildChainModel(projection);
  const criterion = chain.criteria.find((c) => c.id === id);
  if (!criterion) throw new Error(`no criterion ${id}`);
  return criterion;
}

describe("buildChainModel — hops 1/3/4 agent assessment (full fixture, R2 fail)", () => {
  const criterion = hopsById(projectionFor("full"), "R2");

  it("hop 1 (q_deliverable_has_it) is assessed with the fixture's answer/evidence", () => {
    const hop1 = criterion.hops.find((h) => h.n === 1)!;
    expect(hop1.commentaryStatus).toBe("assessed");
    expect(hop1.commentary?.answer).toBe("partial");
    expect(hop1.commentary?.evidence).toContain("references section 12");
  });

  it("hop 3 (q_checklist_has_it) is not-traced (R2 fixture has it as not-traced)", () => {
    const hop3 = criterion.hops.find((h) => h.n === 3)!;
    expect(hop3.commentaryStatus).toBe("not-traced");
    expect(hop3.commentary).toBeNull();
  });

  it("hop 4 (q_checklist_matched_rubric) is assessed with 'diverged'", () => {
    const hop4 = criterion.hops.find((h) => h.n === 4)!;
    expect(hop4.commentaryStatus).toBe("assessed");
    expect(hop4.commentary?.answer).toBe("diverged");
  });

  it("deterministic answer/gap/links on hops 1/3/4 are unchanged", () => {
    const hop1 = criterion.hops.find((h) => h.n === 1)!;
    const hop3 = criterion.hops.find((h) => h.n === 3)!;
    const hop4 = criterion.hops.find((h) => h.n === 4)!;
    // Hop 1: the full fixture's source_docs carry no deliverable-shaped doc,
    // so hop 1 is the "no outputs" gap, unaffected by the agent assessment.
    expect(hop1.gap).toBe("deliverable");
    // Hop 3: the full fixture's workfiles carry no checklist.md, so hop 3 is
    // the deterministic checklist gap, unaffected by the agent assessment.
    expect(hop3.gap).toBe("checklist");
    // Hop 4 deterministic text is unchanged (no automatic signal).
    expect(hop4.answer).toContain("No deterministic signal exists");
  });
});

describe("buildChainModel — not-traced never shows as an assessment (R2 hop 3)", () => {
  it("commentary is null when commentaryStatus is not-traced", () => {
    const criterion = hopsById(projectionFor("full"), "R2");
    const hop3 = criterion.hops.find((h) => h.n === 3)!;
    expect(hop3.commentaryStatus).toBe("not-traced");
    expect(hop3.commentary).toBeNull();
  });
});

describe("buildChainModel — hop 2 verification note edge case (R2)", () => {
  it("keeps commentaryNote when q_draft_got_it is not-traced but q_verify_got_it is real", () => {
    const criterion = hopsById(projectionFor("full"), "R2");
    const hop2 = criterion.hops.find((h) => h.n === 2)!;
    expect(hop2.commentaryStatus).toBe("not-traced");
    expect(hop2.commentary).toBeNull();
    expect(hop2.commentaryNote).toBe("Verification: no");
  });

  it("gives no commentaryNote when the verify answer is not-traced", () => {
    // Build directly: R3's q_verify_got_it is "no" (real) in full fixture, so
    // construct a projection where verify is not-traced to prove the note
    // disappears. We do this via a light bundle mutation on top of full.
    const bundle = JSON.parse(JSON.stringify(RUN_REPORT_FIXTURES.full)) as Record<string, unknown>;
    const analysis = bundle.analysis as Record<string, unknown>;
    const traces = analysis.traces as Array<Record<string, unknown>>;
    const r2 = traces.find((t) => t.rubric_id === "R2")!;
    r2.q_verify_got_it = { answer: "not-traced", evidence: "" };
    const outcome = projectBundle(JSON.stringify(bundle));
    if (outcome.status !== "ok") throw new Error("did not project");
    const projection = outcome.projection as RunReportProjection;
    const criterion = hopsById(projection, "R2");
    const hop2 = criterion.hops.find((h) => h.n === 2)!;
    expect(hop2.commentaryNote).toBeUndefined();
  });
});

describe("buildChainModel — with-passed-traces fixture (R1 passed with trace)", () => {
  const criterion = hopsById(projectionFor("with-passed-traces"), "R1");

  it("hops 2/5/6 are not-traced-passed", () => {
    for (const n of [2, 5, 6]) {
      const hop = criterion.hops.find((h) => h.n === n)!;
      expect(hop.commentaryStatus).toBe("not-traced-passed");
      expect(hop.commentary).toBeNull();
    }
  });

  it("hops 1/3/4 are assessed", () => {
    for (const n of [1, 3, 4]) {
      const hop = criterion.hops.find((h) => h.n === n)!;
      expect(hop.commentaryStatus).toBe("assessed");
      expect(hop.commentary).not.toBeNull();
    }
  });

  it("has no commentaryNote and no verdictNote", () => {
    const hop2 = criterion.hops.find((h) => h.n === 2)!;
    expect(hop2.commentaryNote).toBeUndefined();
    expect(criterion.verdictNote).toBeUndefined();
  });
});

describe("buildChainModel — all-pass fixture has no verdictNote", () => {
  it("no criterion carries a verdictNote", () => {
    const chain = buildChainModel(projectionFor("all-pass"));
    for (const criterion of chain.criteria) {
      expect(criterion.verdictNote).toBeUndefined();
    }
  });
});

describe("buildChainModel — unscored R3 behaves like failed R2", () => {
  const criterion = hopsById(projectionFor("full"), "R3");

  it("hops 1/3/4 assessed, hop 4 not-traced per fixture", () => {
    const hop1 = criterion.hops.find((h) => h.n === 1)!;
    const hop3 = criterion.hops.find((h) => h.n === 3)!;
    const hop4 = criterion.hops.find((h) => h.n === 4)!;
    expect(hop1.commentaryStatus).toBe("assessed");
    expect(hop3.commentaryStatus).toBe("assessed");
    expect(hop4.commentaryStatus).toBe("not-traced");
  });

  it("has a verdictNote (unscored keeps root-cause box like failed)", () => {
    expect(criterion.verdictNote).toBeDefined();
    expect(criterion.verdictNote?.rootCause).toContain("Delaware-law");
  });
});

describe("buildChainModel — legacy-traces fixture (missing new fields)", () => {
  it("hops 1/3/4 (the new fields) are not-yet-assessed on every criterion", () => {
    // legacy-traces deletes only the THREE NEW fields; older `q_*` fields
    // (e.g. q_draft_got_it) may still legitimately carry "not-traced" from
    // the base fixture, so only hops 1/3/4 are asserted here.
    const chain = buildChainModel(projectionFor("legacy-traces"));
    for (const criterion of chain.criteria) {
      for (const n of [1, 3, 4]) {
        const hop = criterion.hops.find((h) => h.n === n)!;
        expect(hop.commentaryStatus).toBe("not-yet-assessed");
        expect(hop.commentary).toBeNull();
      }
    }
  });

  it("a passed rubric with no trace stays not-yet-assessed on hops 2/5/6", () => {
    const criterion = hopsById(projectionFor("legacy-traces"), "R1");
    expect(criterion.verdict).toBe("pass");
    for (const n of [2, 5, 6]) {
      const hop = criterion.hops.find((h) => h.n === n)!;
      expect(hop.commentaryStatus).toBe("not-yet-assessed");
    }
  });
});
