import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";
import { StrutRunStatus } from "@prisma/client";
import fixture from "@/lib/run-report/fixtures/strut-harvey-lab-run.fixture.json";
import type { RunReportProjection } from "@/lib/run-report/types";

const { mockEvents, mockList, mockArtifact, mockGraph } = vi.hoisted(() => ({
  mockGraph: vi.fn(),
  mockEvents: vi.fn(),
  mockList: vi.fn(),
  mockArtifact: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/services/strut-runs", () => ({ dispatchStrutRun: vi.fn(), STRUT_RUN_LOG_TAG: "STRUT_RUN" }));
vi.mock("@/services/strut-runs/openhealth", () => ({ settleFromStrut: vi.fn() }));
vi.mock("@/services/strut-runs/lab", () => ({
  fetchStrutRunEvents: mockEvents,
  fetchStrutArtifactList: mockList,
  fetchStrutArtifact: mockArtifact,
}));
vi.mock("@/services/strut-runs/run-graph", () => ({ readStrutRunGraph: mockGraph }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { clearStrutReportCache, loadStrutRunReport, summarizeLatestRun } from "@/services/strut-runs/legal-report";

const MEMO = "output/compliance-certificate-issue-memo.docx";

const row = (over: Record<string, unknown> = {}) =>
  ({
    id: "row1",
    workspaceId: "ws",
    swarmId: "sw",
    userId: "u",
    kind: "benchmark:harvey-lab",
    workflow: "harvey-lab-run",
    strutRunId: fixture.row.strutRunId,
    status: StrutRunStatus.SUCCESS,
    input: fixture.row.input,
    output: fixture.row.output,
    error: null,
    durationMs: fixture.row.durationMs,
    conversationId: null,
    proposalId: null,
    jobId: null,
    createdAt: new Date("2026-10-21T03:21:39Z"),
    settledAt: new Date("2026-10-21T04:56:03Z"),
    ...over,
  }) as never;

const bytes = (text: string) => ({ body: new TextEncoder().encode(text).buffer, contentType: "text/plain" });

let memoDocx: ArrayBuffer;

beforeEach(async () => {
  vi.clearAllMocks();
  clearStrutReportCache();
  mockGraph.mockResolvedValue({ calls: [], nodes: [], edges: [] });
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${fixture.deliverable.text
      .split("\n")
      .map((l) => `<w:p><w:r><w:t xml:space="preserve">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</w:t></w:r></w:p>`)
      .join("")}</w:body></w:document>`,
  );
  memoDocx = await zip.generateAsync({ type: "arraybuffer" });

  const files = new Map<string, string>([
    ...fixture.sources.map((s) => [`sources/${s.name}.txt`, s.text] as [string, string]),
    ...fixture.workfiles.map((w) => [w.name, w.text] as [string, string]),
  ]);
  mockEvents.mockResolvedValue(fixture.events);
  mockList.mockResolvedValue(fixture.listing);
  mockArtifact.mockImplementation(async (_row: unknown, path: string) => {
    if (path === MEMO) return { body: memoDocx, contentType: "application/octet-stream" };
    // The fixture keeps 4 of the run's 8 working files; the rest are served as stubs.
    const text = files.get(path) ?? (path.endsWith(".md") ? `# ${path}` : undefined);
    return text === undefined ? null : bytes(text);
  });
});

describe("loadStrutRunReport", () => {
  it("builds the report from the run's log and files", async () => {
    const payload = await loadStrutRunReport(row());
    expect(payload).toMatchObject({ runId: "row1", hasReport: true });
    expect(payload.error).toBeUndefined();
    const projection = payload.projection as RunReportProjection;
    expect(projection.rubricRows).toHaveLength(4);
    expect(projection.sourceDocs.map((d) => d.id)).toEqual([
      "deliverable-compliance-certificate-issue-memo.docx",
      "agent-correspondence.eml",
      "credit-agreement-excerpts.docx",
      "q3-2024-compliance-certificate.docx",
      "q3-2024-financial-statements.xlsx",
    ]);
    expect(projection.rubricLinks["C-001"].map((l) => l.doc)).toContain("deliverable-compliance-certificate-issue-memo.docx");

    // Only the run's own report files are read: no drafts, no work/ notes, no scripts.
    const read = mockArtifact.mock.calls.map(([, path]) => path as string);
    expect(read).toContain(MEMO);
    expect(read).toContain("checklist.md");
    expect(read.some((p) => p.startsWith("work/") || p.startsWith("drafts/") || p.endsWith(".py"))).toBe(false);
  });

  it("keeps a settled run's report, and reads again after a partial read", async () => {
    await loadStrutRunReport(row());
    await loadStrutRunReport(row());
    expect(mockEvents).toHaveBeenCalledTimes(1);

    clearStrutReportCache();
    mockArtifact.mockImplementationOnce(async () => null);
    const partial = await loadStrutRunReport(row());
    expect(partial.hasReport).toBe(true);
    await loadStrutRunReport(row());
    expect(mockEvents).toHaveBeenCalledTimes(3);
  });

  it("has no report for a run that is still going, or that strut never started", async () => {
    expect(await loadStrutRunReport(row({ status: StrutRunStatus.PENDING }))).toEqual({
      runId: "row1",
      hasReport: false,
      projection: null,
    });
    expect((await loadStrutRunReport(row({ status: StrutRunStatus.ERROR, strutRunId: null }))).hasReport).toBe(false);
    expect(mockEvents).not.toHaveBeenCalled();
  });

  it("says the report is unavailable when the lab has no log for the run", async () => {
    mockEvents.mockResolvedValue(null);
    expect(await loadStrutRunReport(row())).toEqual({ runId: "row1", hasReport: true, error: "unavailable", projection: null });
  });

  it("still reports from the log when the file listing is unavailable", async () => {
    mockList.mockResolvedValue(null);
    const projection = (await loadStrutRunReport(row())).projection as RunReportProjection;
    expect(projection.pageData.timeline.length).toBeGreaterThan(0);
    expect(projection.sourceDocs.map((d) => d.id)).toEqual(["deliverable-compliance-certificate-issue-memo.docx"]);
  });
});

describe("summarizeLatestRun", () => {
  it("summarises a settled run from its process, with unrecorded counts left null", async () => {
    const summary = await summarizeLatestRun(row());
    expect(summary).toMatchObject({
      runId: "row1",
      status: "SUCCESS",
      score: { passed: 2, total: 4 },
      ingestion: { conceptsRead: 1, nodesCreated: null, edgesCreated: null },
      checklist: null,
    });
    expect(summary.topConcepts.map((c) => c.name)).toEqual(["Job"]);
    expect(summary.spreadsheets.length).toBeGreaterThan(0);
  });

  it("still summarises a failed run, and leaves everything unrecorded when its log is gone", async () => {
    expect((await summarizeLatestRun(row({ status: StrutRunStatus.ERROR }))).status).toBe("ERROR");
    clearStrutReportCache();
    mockEvents.mockResolvedValue(null);
    const gone = await summarizeLatestRun(row({ status: StrutRunStatus.ERROR }));
    expect(gone).toMatchObject({ ingestion: null, checklist: null, spreadsheets: [], topConcepts: [] });
  });
});
