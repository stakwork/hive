/**
 * The Process derivation (`buildProcess`) and its place in the strut bundle:
 * the trimmed real run (concepts read, no writes in its slice of the log), a
 * synthetic run with writes, and a failed run that recorded almost nothing.
 */
import { describe, it, expect, vi } from "vitest";
import fixture from "@/lib/run-report/fixtures/strut-harvey-lab-run.fixture.json";
import {
  buildProcess,
  checklistProgress,
  parseChecklist,
  rankConcepts,
  safeHttpsUrl,
  sanitizeProcess,
  stepOfPath,
} from "@/lib/run-report/process";
import { buildStrutReportBundle, type StrutReportInput } from "@/lib/run-report/strut-bundle";
import { projectBundle } from "@/lib/run-report/project";
import type { RunReportProjection } from "@/lib/run-report/types";
import type { StrutRunEvent } from "@/lib/legal-cascade/strut";

const WF = "harvey-lab-run";
const end = (path: string, stepType: string, nodes?: unknown[], extra: Record<string, unknown> = {}) => ({
  ts: "2026-10-21T03:22:00.000Z",
  runId: "1",
  path: `${WF}/${path}`,
  type: "step.end",
  stepType: `tool:${stepType}`,
  output: "x",
  ...(nodes ? { nodes } : {}),
  ...extra,
});
const concept = (ref_id: string, name: string) => ({ ref_id, node_type: "Concept", name });

describe("buildProcess on the real (trimmed) run", () => {
  const process = buildProcess({
    workflow: WF,
    events: fixture.events,
    output: fixture.row.output,
    workfiles: fixture.workfiles,
  });

  it("counts the concept the run read and leaves unrecorded writes null", () => {
    expect(process.ingestion).toEqual({ conceptsRead: 1, nodesCreated: null, edgesCreated: null });
  });

  it("places the read under its workflow step", () => {
    expect(process.steps).toHaveLength(1);
    expect(process.steps?.[0]).toMatchObject({
      step: "checklist",
      concepts: [{ ref_id: "54ddd023-7000-4a50-8540-0614768838a2", name: "Job", access: "read", calls: 1 }],
      created: { nodes: [], edges: [] },
    });
  });

  it("reads the spreadsheet from the score body and spreadsheet.md, https only", () => {
    expect(process.spreadsheets.length).toBeGreaterThanOrEqual(1);
    expect(process.spreadsheets.every((s) => s.url.startsWith("https://"))).toBe(true);
    const urls = process.spreadsheets.map((s) => s.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("keeps a checklist with no checkboxes as raw text, progress not derivable", () => {
    expect(process.checklist?.items).toEqual([]);
    expect(process.checklist?.raw).toContain("SENIOR PARTNER REVIEW CHECKLIST");
    expect(checklistProgress(process)).toBeNull();
  });
});

describe("buildProcess with writes", () => {
  const events = [
    end("ingest#0/001-graph_create_node", "graph_create_node", [{ ref_id: "d1", node_type: "Document", name: "Memo" }]),
    end("ingest#1/001-graph_create_batch_triplet", "graph_create_batch_triplet", [
      { ref_id: "a1", node_type: "Agreement", name: "Credit Agreement" },
      { ref_id: "d1", node_type: "Document", name: "Memo" },
    ], { edges: [{ source_ref_id: "d1", target_ref_id: "a1", edge_type: "CONTAINS" }] }),
    end("checklist/001-graph_graph_get", "graph_graph_get", [concept("c1", "Playbook")]),
    end("drafter/001-graph_graph_get", "graph_graph_get", [concept("c1", "Playbook"), concept("c2", "Tone")]),
    end("drafter/002-graph_graph_search", "graph_graph_search", [concept("c9", "Only a hit")]),
    end("checklist/002-graph_graph_get", "graph_graph_get", [concept("c1", "Playbook")]),
  ];
  const process = buildProcess({
    workflow: WF,
    events,
    output: { callback: { spreadsheet_url: "https://docs.google.com/spreadsheets/d/x/edit" } },
    workfiles: [{ name: "checklist.md", text: "- [x] Check leverage\n- [ ] Check EBITDA\n* [X] Cite section 6.1" }],
    trace: {
      nodes: [],
      edges: [
        { source: "c1", target: "c2", edge_type: "RELATED" },
        { source: "c1", target: "zzz", edge_type: "RELATED" },
      ],
    },
  });

  it("counts nodes created from write calls and edges only when the writes list them", () => {
    expect(process.ingestion).toEqual({ conceptsRead: 2, nodesCreated: 2, edgesCreated: 1 });
  });

  it("does not count search hits as concepts read", () => {
    expect(process.steps?.flatMap((s) => s.concepts.map((c) => c.ref_id))).not.toContain("c9");
  });

  it("folds a loop's iterations into one step and records what each step created", () => {
    const ingest = process.steps?.find((s) => s.step === "ingest");
    expect(ingest?.created.nodes.map((n) => n.ref_id).sort()).toEqual(["a1", "d1"]);
    expect(ingest?.created.edges).toEqual([{ source: "d1", target: "a1", edge_type: "CONTAINS" }]);
  });

  it("keeps only graph links between nodes the step touched", () => {
    const drafter = process.steps?.find((s) => s.step === "drafter");
    expect(drafter?.links).toEqual([{ source: "c1", target: "c2", edge_type: "RELATED" }]);
    expect(process.steps?.find((s) => s.step === "checklist")?.links).toEqual([]);
  });

  it("ranks concepts by use, with the steps that used each", () => {
    expect(rankConcepts(process.steps)).toEqual([
      { ref_id: "c1", name: "Playbook", steps: ["checklist", "drafter"], calls: 3 },
      { ref_id: "c2", name: "Tone", steps: ["drafter"], calls: 1 },
    ]);
  });

  it("parses checkbox items and progress", () => {
    expect(process.checklist?.items).toEqual([
      { text: "Check leverage", done: true },
      { text: "Check EBITDA", done: false },
      { text: "Cite section 6.1", done: true },
    ]);
    expect(checklistProgress(process)).toEqual({ done: 2, total: 3 });
  });
});

describe("buildProcess on a failed run with partial data", () => {
  it("records nothing it did not see", () => {
    const process = buildProcess({
      workflow: WF,
      events: [{ type: "run.start", path: undefined }, end("ingest#0/001-bash", "bash")],
      output: null,
      workfiles: [],
    });
    expect(process).toEqual({
      ingestion: { conceptsRead: 0, nodesCreated: null, edgesCreated: null },
      checklist: null,
      spreadsheets: [],
      steps: null,
    });
  });

  it("leaves steps null when graph calls sit outside the workflow's paths", () => {
    const process = buildProcess({
      workflow: WF,
      events: [{ ...end("x", "graph_graph_get", [concept("c1", "A")]), path: "other/y" }],
      output: {},
      workfiles: [],
    });
    expect(process.steps).toBeNull();
    expect(process.ingestion.conceptsRead).toBe(1);
  });

  it("tolerates garbage events and outputs", () => {
    expect(() => buildProcess({ workflow: WF, events: [null, 3, "x", {}], output: "nope", workfiles: [] })).not.toThrow();
  });
});

describe("helpers", () => {
  it("accepts only credential-free https urls", () => {
    expect(safeHttpsUrl("https://docs.google.com/a")).toBe("https://docs.google.com/a");
    expect(safeHttpsUrl("http://docs.google.com/a")).toBeNull();
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("https://user:pw@evil.test/")).toBeNull();
    expect(safeHttpsUrl(42)).toBeNull();
  });

  it("maps a path to its step", () => {
    expect(stepOfPath(`${WF}/ingest#3/001-graph_get`, WF)).toBe("ingest");
    expect(stepOfPath(`${WF}/drafter`, WF)).toBe("drafter");
    expect(stepOfPath("other/ingest", WF)).toBeNull();
  });

  it("parses an empty checklist", () => {
    expect(parseChecklist("")).toEqual({ items: [], raw: "" });
  });

  it("narrows untrusted wire values", () => {
    expect(sanitizeProcess("x")).toBeNull();
    const clean = sanitizeProcess({
      ingestion: { conceptsRead: "7", nodesCreated: -1, edgesCreated: 4 },
      checklist: { items: [{ text: "a", done: true }, { nope: 1 }] },
      spreadsheets: [{ url: "http://x.test", label: "bad" }, { url: "https://ok.test/s", label: "ok" }],
      steps: [{ step: "s", concepts: [{ ref_id: "r", access: "weird" }, {}], created: {}, links: "no" }, { nope: 1 }],
      extra: "dropped",
    });
    expect(clean).toEqual({
      ingestion: { conceptsRead: 0, nodesCreated: null, edgesCreated: 4 },
      checklist: { items: [{ text: "a", done: true }] },
      spreadsheets: [{ url: "https://ok.test/s", label: "ok" }],
      steps: [{ step: "s", concepts: [{ ref_id: "r", name: "r", access: "read", calls: 1 }], created: { nodes: [], edges: [] }, links: [] }],
    });
  });
});

describe("process in the bundle projection", () => {
  const run: StrutReportInput = {
    workflow: fixture.row.workflow,
    strutRunId: fixture.row.strutRunId,
    input: fixture.row.input,
    output: fixture.row.output,
    durationMs: fixture.row.durationMs,
    events: fixture.events as StrutRunEvent[],
    sources: fixture.sources,
    deliverables: [fixture.deliverable],
    workfiles: fixture.workfiles,
  };
  const project = (bundle: Record<string, unknown>) => {
    const out = projectBundle(JSON.stringify(bundle));
    if (out.status !== "ok") throw new Error("did not project");
    return out.projection as RunReportProjection;
  };

  it("projects process without drift notes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const projection = project(buildStrutReportBundle(run));
    expect(projection.contractNotes.unexpected).toEqual([]);
    expect(projection.process?.ingestion.conceptsRead).toBe(1);
    warn.mockRestore();
  });

  it("leaves process absent on a Stakwork-shaped bundle", () => {
    const { process: _drop, ...stakwork } = buildStrutReportBundle(run);
    expect(project(stakwork).process).toBeUndefined();
  });
});
