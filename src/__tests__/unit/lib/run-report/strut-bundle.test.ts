/**
 * `buildStrutReportBundle` against a `harvey-lab-run` run trimmed from a real
 * one on the openlaw-1 swarm (run 1792552899038): 4 of its 36 criteria (two
 * passed, two failed and contested), a slice of its event log, and excerpts
 * of its converted sources, working files and deliverable. The bundle goes
 * through the same `projectBundle` → `buildChainModel` pipeline a Stakwork
 * S3 bundle does.
 */
import { describe, it, expect } from "vitest";
import fixture from "@/lib/run-report/fixtures/strut-harvey-lab-run.fixture.json";
import {
  buildStrutReportBundle,
  nodesFromOutput,
  reportFilesOf,
  type StrutReportInput,
} from "@/lib/run-report/strut-bundle";
import { projectBundle } from "@/lib/run-report/project";
import { buildChainModel } from "@/lib/run-report/chain";
import { buildTimeline, phaseOf } from "@/lib/run-report/derive";
import type { RunReportProjection } from "@/lib/run-report/types";
import type { StrutRunEvent } from "@/lib/legal-cascade/strut";

const MEMO = "compliance-certificate-issue-memo.docx";

function runOf(over: Partial<StrutReportInput> = {}): StrutReportInput {
  return {
    workflow: fixture.row.workflow,
    strutRunId: fixture.row.strutRunId,
    input: fixture.row.input,
    output: fixture.row.output,
    durationMs: fixture.row.durationMs,
    events: fixture.events as StrutRunEvent[],
    sources: fixture.sources,
    deliverables: [fixture.deliverable],
    workfiles: fixture.workfiles,
    ...over,
  };
}

function project(run: StrutReportInput): RunReportProjection {
  const outcome = projectBundle(JSON.stringify(buildStrutReportBundle(run)));
  if (outcome.status !== "ok") throw new Error("strut bundle did not project");
  return outcome.projection as RunReportProjection;
}

describe("buildStrutReportBundle (real harvey-lab-run run)", () => {
  const projection = project(runOf());
  const chain = buildChainModel(projection);

  it("uses only keys the projector knows", () => {
    expect(projection.contractNotes.unexpected).toEqual([]);
  });

  it("reads the header from the run's input and score body", () => {
    expect(projection.pageData.config).toMatchObject({
      task_slug: "harvey-banking-identify-issues-compliance-cert",
      run_id: "1792552899038",
      workflow: "harvey-lab-run",
      models: { reasoning_model: "claude-opus-5", judge_model: "claude-sonnet-4-6" },
    });
    expect(projection.pageData.config.task_goal).toContain("compliance certificate");
    expect(projection.pageData.score).toMatchObject({ n_passed: 2, n_criteria: 4, all_pass: false, judge_model: "claude-sonnet-4-6" });
    expect(projection.pageData.wallClockMin).toBeCloseTo(94.41, 1);
    expect(projection.generatedAtMs).toBe(Date.parse("2026-10-21T04:56:03.702Z"));
  });

  it("carries each criterion's verdict, dispute and the task's match criteria", () => {
    expect(projection.rubricRows.map((r) => [r.id, r.passed])).toEqual([
      ["C-001", true],
      ["C-002", false],
      ["C-004", true],
      ["C-020", false],
    ]);
    const disputed = projection.rubricRows.find((r) => r.id === "C-002")!;
    expect(disputed).toMatchObject({ judgeFlagged: true, criterionContested: true, judgeFlagBasis: "criterion_validity" });
    expect(disputed.judgeFlagReason).toContain("Criterion Validity");
    expect(disputed.documentExcerpt).not.toBe("");
    expect(disputed.matchCriteria).toMatch(/^PASS if the memo/);
  });

  it("lays the run's direct steps on the timeline and its agents beside them", () => {
    const steps = projection.pageData.timeline.map((t) => t.step);
    expect(steps).toEqual(expect.arrayContaining(["docs", "ingest", "checklist", "drafter", "dispute", "score"]));
    expect(steps.some((s) => s.includes("#") || s.includes("/"))).toBe(false);

    const agents = projection.pageData.agents as Array<Record<string, unknown>>;
    const ingest0 = agents.find((a) => a.name === "ingest#0")!;
    expect(ingest0).toMatchObject({ step: "ingest", n_messages: 18, model: "claude-sonnet-5", status: "success" });
    expect(ingest0.cost_usd).toBeCloseTo(0.94, 2);
    expect(ingest0.tools).toEqual(expect.arrayContaining(["get_ontology", "bash"]));
    expect(agents.find((a) => a.name === "dispute")!.final_answer).toContain("disputes");

    // A step with one agent shows once; the ingest foreach shows its iterations.
    const names = buildTimeline(projection.pageData.timeline, projection.pageData.agents).map((e) => e.name);
    expect(names.filter((n) => n === "drafter")).toHaveLength(1);
    expect(names).toEqual(expect.arrayContaining(["ingest", "ingest#0", "ingest#1"]));
  });

  it("colours strut's steps by phase and leaves Stakwork's as they were", () => {
    expect(["docs", "ingest", "drafter", "verify_correctness", "dispute"].map(phaseOf)).toEqual([
      "setup",
      "setup",
      "draft",
      "verify",
      "score",
    ]);
    expect(["run_draft", "score_rubric", "call_checklist_llm", "run_case_law_research"].map(phaseOf)).toEqual([
      "draft",
      "score",
      "setup",
      "context",
    ]);
  });

  it("notes which way each gate went and what was skipped", () => {
    expect(projection.pageData.branches).toEqual(["xc_gate: then", "SKIPPED: post"]);
    expect(projection.pageData.healthNotes).toEqual([]);
  });

  it("adds up the agents' usage and cost", () => {
    expect(projection.pageData.logStats).toMatchObject({ agents: 5, tool_calls: 21 });
    expect(projection.pageData.logStats.model_calls).toBeGreaterThan(0);
    expect(projection.pageData.logStats.cost_usd).toBeGreaterThan(5);
  });

  it("lists the task's documents with the sizes the docs step reported", () => {
    expect(projection.pageData.documents).toEqual([
      { name: "agent-correspondence.eml", type: "eml", sizeBytes: 11160 },
      { name: "credit-agreement-excerpts.docx", type: "docx", sizeBytes: 61972 },
      { name: "q3-2024-compliance-certificate.docx", type: "docx", sizeBytes: 47931 },
      { name: "q3-2024-financial-statements.xlsx", type: "xlsx", sizeBytes: 21422 },
    ]);
  });

  it("walks every criterion from the deliverable back to the sources", () => {
    expect(chain.deliverables).toEqual([{ id: `deliverable-${MEMO}`, title: `FINAL DELIVERABLE: ${MEMO}` }]);
    expect(chain.checklist?.name).toBe("checklist.md");
    expect(chain.inputDocs.map((d) => d.id)).toHaveLength(4);

    const c001 = chain.criteria.find((c) => c.id === "C-001")!;
    const hop = (n: number) => c001.hops.find((h) => h.n === n)!;
    expect(hop(1)).toMatchObject({ tone: "pass", method: "artifact" });
    expect(hop(2)).toMatchObject({ tone: "pass", method: "term-match" });
    expect(hop(2).answer).toContain("$6,100,000");
    expect(hop(3)).toMatchObject({ tone: "pass", links: [{ workfile: "checklist.md" }] });
    expect(hop(5)).toMatchObject({ tone: "pass", method: "term-match" });
    expect(hop(5).links.map((l) => l.docId)).toContain("credit-agreement-excerpts.docx");

    // The memo never states the $1,100,000 excess C-002 asked for.
    const c002Links = projection.rubricLinks["C-002"].find((l) => l.doc === `deliverable-${MEMO}`)!;
    expect(c002Links.tokens).not.toContain("$1,100,000");
    expect(c002Links.tokens).toContain("$5,000,000");

    // Failed criteria lead the review order.
    expect(chain.criteria.slice(0, 2).map((c) => c.id)).toEqual(["C-002", "C-020"]);
  });

  it("shows the agents' graph reads, not their writes, and the Concepts they read", () => {
    const ta = projection.toolActivity;
    expect(ta.present).toBe(true);
    expect(ta.unknownToolNames).toEqual([]);
    expect(ta.unattributedRecordCount).toBe(0);
    const tools = new Set(ta.groups.flatMap((g) => g.calls.map((c) => c.toolName)));
    expect([...tools].sort()).toEqual(["get_ontology", "get_ontology_type", "graph_get", "graph_search"]);
    expect(chain.topConcepts.map((c) => c.name)).toEqual(["Job"]);
    expect(chain.topConcepts[0].refId).toBe("54ddd023-7000-4a50-8540-0614768838a2");

    const write: StrutRunEvent[] = [
      {
        type: "step.start",
        path: "harvey-lab-run/ingest#0/099-graph_create_batch_triplet",
        stepType: "tool:graph_create_batch_triplet",
        ts: "2026-10-21T03:25:00.000Z",
        input: { triplets: [] },
      },
      {
        type: "step.end",
        path: "harvey-lab-run/ingest#0/099-graph_create_batch_triplet",
        stepType: "tool:graph_create_batch_triplet",
        ts: "2026-10-21T03:25:01.000Z",
        nodes: [{ ref_id: "r1", node_type: "Concept", name: "Written" }],
      },
    ];
    const withWrite = project(runOf({ events: [...(fixture.events as StrutRunEvent[]), ...write] }));
    const calls = withWrite.toolActivity.groups.flatMap((g) => g.calls);
    expect(calls).toHaveLength(ta.groups.flatMap((g) => g.calls).length);
    const ingest0 = (withWrite.pageData.agents as Array<Record<string, unknown>>).find((a) => a.name === "ingest#0")!;
    expect(ingest0.tools).toContain("create_batch_triplet");
  });

  it("renders the sources as text and the deliverable as converted HTML", () => {
    const memo = projection.sourceDocs.find((d) => d.id === `deliverable-${MEMO}`)!;
    expect(memo.body[0]).toMatchObject({ t: "p" });
    const eml = projection.sourceDocs.find((d) => d.id === "agent-correspondence.eml")!;
    expect(eml.body).toHaveLength(1);
    expect(eml.body[0]).toMatchObject({ t: "pre" });
    expect(projection.workfiles.map((w) => w.name)).toEqual(fixture.workfiles.map((w) => w.name));
    expect(projection.analysis).toEqual({ summaries: [], traces: [] });
  });

  it("reports failed steps, unfinished agents and grading errors as health notes", () => {
    const events = [
      ...(fixture.events as StrutRunEvent[]),
      { type: "step.start", path: "harvey-lab-run/aggregator", stepType: "agent", ts: "2026-10-21T04:50:00.000Z", input: {} },
      { type: "step.error", path: "harvey-lab-run/sheet", stepType: "sheets/create-spreadsheet", ts: "2026-10-21T04:50:01.000Z", error: { message: "quota" } },
    ];
    const output = { ...fixture.row.output, callback: { ...fixture.row.output.callback, n_grading_errors: 2 } };
    const p = project(runOf({ events, output }));
    expect(p.pageData.healthNotes).toEqual(
      expect.arrayContaining(["sheet failed: quota", "aggregator never finished", "2 criteria could not be graded"]),
    );
  });

  it("still projects a run that failed before scoring", () => {
    const p = project(runOf({ output: null, deliverables: [], workfiles: [] }));
    expect(p.rubricRows).toEqual([]);
    expect(p.pageData.timeline.length).toBeGreaterThan(0);
    expect(buildChainModel(p).criteria).toEqual([]);
  });
});

describe("reportFilesOf", () => {
  it("picks the converted sources and the working files, never work/ or drafts/", () => {
    expect(reportFilesOf(fixture.listing)).toEqual({
      sources: [
        "sources/agent-correspondence.eml.txt",
        "sources/credit-agreement-excerpts.docx.txt",
        "sources/q3-2024-compliance-certificate.docx.txt",
        "sources/q3-2024-financial-statements.xlsx.txt",
      ],
      workfiles: [
        "case-law-research.md",
        "checklist.md",
        "critiques/critique_arithmetic.md",
        "critiques/critique_completeness.md",
        "critiques/critique_correctness.md",
        "critiques/critique_doctrine.md",
        "facts.md",
        "spreadsheet.md",
      ],
    });
    expect(fixture.listing).toEqual(expect.arrayContaining(["work/drafter-internal-note-PRIVILEGED.md"]));
  });
});

describe("nodesFromOutput", () => {
  it("reads the complete nodes before the log cut a search result off", () => {
    const cut =
      '[{"ref_id":"a","name":"Job {x}","node_type":"Concept","description":"say \\"hi\\" }"},' +
      '{"ref_id":"b","name":"Plan Mode","node_type":"Concept","edges":{"PROCESS":1}},{"ref_id":"c","name":"Pod Con';
    expect(nodesFromOutput(cut)).toEqual([
      { ref_id: "a", node_type: "Concept", name: "Job {x}" },
      { ref_id: "b", node_type: "Concept", name: "Plan Mode" },
    ]);
  });

  it("is empty for an empty result or anything that is not a node list", () => {
    expect(nodesFromOutput("[]")).toEqual([]);
    expect(nodesFromOutput('{"ref_id":"a"}')).toEqual([]);
    expect(nodesFromOutput('[{"name":"no id"}]')).toEqual([]);
    expect(nodesFromOutput(undefined)).toEqual([]);
  });

  it("marks a search that found nothing empty, and one that surfaced nodes ok", () => {
    const search = (n: number, output: string): StrutRunEvent[] => [
      { type: "step.start", path: `harvey-lab-run/drafter/09${n}-graph_graph_search`, stepType: "tool:graph_graph_search", input: { q: "x" } },
      { type: "step.end", path: `harvey-lab-run/drafter/09${n}-graph_graph_search`, stepType: "tool:graph_graph_search", output },
    ];
    const events = [...(fixture.events as StrutRunEvent[]), ...search(1, "[]"), ...search(2, '[{"ref_id":"r9","name":"Lien","node_type":"Concept"}]')];
    const outcome = projectBundle(JSON.stringify(buildStrutReportBundle(runOf({ events }))));
    const p = (outcome as { projection: RunReportProjection }).projection;
    const drafter = p.toolActivity.groups.find((g) => g.agentName === "drafter")!;
    const searches = drafter.calls.filter((c) => c.toolName === "graph_search");
    expect(searches.map((c) => c.status)).toEqual(["empty", "ok"]);
    expect(buildChainModel(p).conceptsSurfacedOnly).toBeGreaterThan(0);
  });
});
