/**
 * Unit tests for `lib/openhealth-benchmarks/improve.ts`: a `StrutRun` row of
 * kind `openhealth_improve` → what the run viewer shows.
 */

import { describe, it, expect } from "vitest";
import { StrutRunStatus } from "@prisma/client";
import {
  describeScoringError,
  improveOutcomeOf,
  toOpenHealthImprovement,
  type OpenHealthImproveSource,
} from "@/lib/openhealth-benchmarks/improve";

const CREATE_A = {
  action: "create",
  name: "Newborn Content in Maternal Charts",
  parent: "Obstetrics",
  parent_ref_id: "90dc1064-2243-4ce7-bf1a-1a9f0bb9d994",
  id: "newborn-content-in-maternal-charts",
  description: "Delivery encounters whose documentation describes the liveborn infant.",
  docs: "Delivery encounters…\n\n## Applies to\nA labor-and-delivery encounter.",
  addresses: ["1790623913185:missed:P011", "1790623913185:extra:O42919"],
  rationale: "Nothing in the tree told the producer.",
};
const AMEND = {
  action: "amend",
  name: "Trimester and Specificity",
  description: "Choosing the trimester character.",
  docs: "ICD-10-CM obstetric codes carry a trimester character.",
  addresses: ["1790623913185:code:O1403"],
  rationale: "The old wording made the producer pick O14.00.",
};
const CREATE_B = { ...CREATE_A, name: "Unifying Diagnosis From Findings", parent: "Problem List", addresses: [] };

const OUTPUT = {
  runs: [
    {
      runId: "1790623913185",
      gtId: 7021,
      score: 0.4,
      errors: [
        { id: "1790623913185:missed:P011" },
        { id: "1790623913185:extra:O42919" },
        { id: "1790623913185:code:O1403" },
      ],
    },
  ],
  summary: "Two new Concepts and one amend.",
  proposals: [CREATE_A, AMEND, CREATE_B],
  creates: [CREATE_A.name, CREATE_B.name],
  amends: [AMEND.name],
  rejected: [
    {
      action: "create",
      name: "Obstetrics",
      rejected_because: ["a Concept named 'Obstetrics' already exists — propose an amend instead"],
    },
  ],
  not_addressed: [{ error_id: "1790623913185:extra:F411", reason: "Chart-neutral; costs nothing." }],
  errors_uncovered: ["1790623913185:extra:F411"],
  applied: true,
  created: [
    { status: "Success", source_ref_id: "p1", target_ref_id: "c1", edge_ref_id: "e1", edge_type: "PARENT_OF" },
    { status: "Warning", source_ref_id: "p2", target_ref_id: "c2", edge_ref_id: "e2", edge_type: "PARENT_OF" },
  ],
  report: "/artifacts/1790625755699/proposals.md",
  analysis: "/artifacts/1790625755699/analysis.md",
  digest: "/artifacts/1790625755699/digest.md",
};

function row(overrides: Partial<OpenHealthImproveSource> = {}): OpenHealthImproveSource {
  return {
    id: "improve-1",
    strutRunId: "1790625755699",
    status: StrutRunStatus.SUCCESS,
    output: OUTPUT,
    error: null,
    durationMs: 231_023,
    createdAt: new Date("2026-09-28T20:02:35Z"),
    settledAt: new Date("2026-09-28T20:06:26Z"),
    ...overrides,
  };
}

describe("improveOutcomeOf", () => {
  it.each([
    [StrutRunStatus.PENDING, "running"],
    [StrutRunStatus.CANCELLED, "cancelled"],
    [StrutRunStatus.ERROR, "failed"],
    [StrutRunStatus.LOST, "failed"],
    [StrutRunStatus.SUCCESS, "succeeded"],
  ])("%s → %s", (status, outcome) => {
    expect(improveOutcomeOf(status)).toBe(outcome);
  });
});

describe("describeScoringError", () => {
  it.each([
    ["1790623913185:missed:P011", "missed P011"],
    ["1790623913185:extra:O42919", "extra O42919"],
    ["1790623913185:code:O1403", "wrong code O1403"],
    ["1790623913185:acuity:N179", "wrong acuity N179"],
  ])("%s → %s", (id, label) => {
    expect(describeScoringError(id)).toBe(label);
  });

  it.each(["P011", "1790623913185:other:P011", "1:missed:P011:more", ""])("leaves %j as it is", (id) => {
    expect(describeScoringError(id)).toBe(id);
  });
});

describe("toOpenHealthImprovement", () => {
  it("reads an applied run: each new Concept with what the graph answered", () => {
    const improvement = toOpenHealthImprovement(row());

    expect(improvement).toMatchObject({
      id: "improve-1",
      strutRunId: "1790625755699",
      outcome: "succeeded",
      applied: true,
      summary: "Two new Concepts and one amend.",
      errorCount: 3,
      durationMs: 231_023,
      error: null,
      createdAt: "2026-09-28T20:02:35.000Z",
      settledAt: "2026-09-28T20:06:26.000Z",
    });
    expect(improvement.proposals).toEqual([
      {
        action: "create",
        name: CREATE_A.name,
        parent: "Obstetrics",
        description: CREATE_A.description,
        docs: CREATE_A.docs,
        rationale: CREATE_A.rationale,
        addresses: ["missed P011", "extra O42919"],
        write: "created",
        writeError: null,
      },
      {
        action: "amend",
        name: AMEND.name,
        parent: null,
        description: AMEND.description,
        docs: AMEND.docs,
        rationale: AMEND.rationale,
        addresses: ["wrong code O1403"],
        write: null,
        writeError: null,
      },
      expect.objectContaining({ action: "create", name: CREATE_B.name, parent: "Problem List", write: "existed" }),
    ]);
    expect(improvement.rejected).toEqual([
      { name: "Obstetrics", reasons: ["a Concept named 'Obstetrics' already exists — propose an amend instead"] },
    ]);
    expect(improvement.notAddressed).toEqual([{ error: "extra F411", reason: "Chart-neutral; costs nothing." }]);
    expect(improvement.contestsAccepted).toEqual([]);
    expect(improvement.contestsRejected).toEqual([]);
  });

  it("reads the answer-key items the run contested and the graph recorded, and the contests refused", () => {
    const improvement = toOpenHealthImprovement(
      row({
        output: {
          ...OUTPUT,
          contests_proposed: [
            {
              error_id: "1790972203341/iter-3:missed_finding:primigravida",
              reason: "The chart documents a prior pregnancy.",
              evidence: [{ source: "chart", quote: "Cesarean section (low transverse, 2 years prior)" }],
            },
            { error_id: "1790972203341/iter-3:missed_finding:proteinuria", reason: "…", evidence: [] },
          ],
          contests_accepted: [
            {
              id: "oh-context-summarization-public-8274-contested-must-include-findings-primigravida",
              ref_id: "89aa4209-4e75-4715-959a-72ba20fbfe54",
              list: "must_include_findings",
              name: "Primigravida",
              reason: "The chart documents a prior pregnancy.",
              evidence: [{ source: "chart", quote: "Cesarean section (low transverse, 2 years prior)" }],
            },
          ],
          contests_rejected: [
            { error_id: "1790972203341/iter-3:missed_finding:proteinuria", why: "The quote is not in the chart." },
          ],
        },
      }),
    );
    expect(improvement.contestsAccepted).toEqual([
      {
        id: "oh-context-summarization-public-8274-contested-must-include-findings-primigravida",
        refId: "89aa4209-4e75-4715-959a-72ba20fbfe54",
        name: "Primigravida",
        list: "must_include_findings",
        icd10: null,
        reason: "The chart documents a prior pregnancy.",
        evidence: ['chart: "Cesarean section (low transverse, 2 years prior)"'],
      },
    ]);
    expect(improvement.contestsRejected).toEqual([
      { error: "1790972203341/iter-3:missed_finding:proteinuria", reason: "The quote is not in the chart." },
    ]);
  });

  it("names none of the run's files", () => {
    expect(JSON.stringify(toOpenHealthImprovement(row()))).not.toContain("/artifacts/");
  });

  it("reports a write the graph refused, which the run itself does not fail on", () => {
    const improvement = toOpenHealthImprovement(
      row({
        output: {
          ...OUTPUT,
          created: [
            "graph/create-triplet: nodes resolved but the edge write failed — no PARENT_OF schema",
            OUTPUT.created[0],
          ],
        },
      }),
    );

    expect(improvement.proposals.map((p) => [p.name, p.write, p.writeError])).toEqual([
      [CREATE_A.name, "failed", "graph/create-triplet: nodes resolved but the edge write failed — no PARENT_OF schema"],
      [AMEND.name, null, null],
      [CREATE_B.name, "created", null],
    ]);
  });

  it("claims no write for a run that did not apply, or that wrote fewer Concepts than it proposed", () => {
    const { created: _created, ...proposedOnly } = OUTPUT;
    const dry = toOpenHealthImprovement(row({ output: { ...proposedOnly, applied: false } }));
    expect(dry.applied).toBe(false);
    expect(dry.proposals.map((p) => p.write)).toEqual([null, null, null]);

    const short = toOpenHealthImprovement(row({ output: { ...OUTPUT, created: [OUTPUT.created[0]] } }));
    expect(short.proposals.map((p) => p.write)).toEqual(["created", null, null]);
  });

  it("keeps the writes in step when a proposal is not shown", () => {
    const improvement = toOpenHealthImprovement(
      row({ output: { ...OUTPUT, proposals: [{ ...CREATE_A, name: "" }, CREATE_B] } }),
    );
    expect(improvement.proposals).toEqual([expect.objectContaining({ name: CREATE_B.name, write: "existed" })]);
  });

  it.each([
    [StrutRunStatus.PENDING, null, "running", null],
    [StrutRunStatus.CANCELLED, null, "cancelled", null],
    [
      StrutRunStatus.ERROR,
      "run 1790623913185 is error with no score — pick a graded run",
      "failed",
      "run 1790623913185 is error with no score — pick a graded run",
    ],
    [StrutRunStatus.LOST, null, "failed", "The run did not finish."],
  ])("a %s row has no result", (status, error, outcome, shown) => {
    const improvement = toOpenHealthImprovement(
      row({ status, output: null, error, durationMs: null, settledAt: null }),
    );

    expect(improvement).toMatchObject({
      outcome,
      error: shown,
      applied: false,
      summary: null,
      errorCount: null,
      proposals: [],
      rejected: [],
      notAddressed: [],
      settledAt: null,
    });
  });

  it.each([
    [["a list"]],
    ["text"],
    [{ proposals: "none", rejected: [null, 3], not_addressed: [{ reason: "no id" }], runs: {} }],
  ])("degrades an output of another shape: %j", (output) => {
    expect(toOpenHealthImprovement(row({ output }))).toMatchObject({
      outcome: "succeeded",
      applied: false,
      summary: null,
      errorCount: null,
      proposals: [],
      rejected: [],
      notAddressed: [],
    });
  });
});
