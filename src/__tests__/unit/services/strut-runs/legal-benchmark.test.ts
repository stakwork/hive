import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrutRunStatus, WorkflowStatus } from "@prisma/client";

const { mockStrutRun, mockDispatch, mockSettle } = vi.hoisted(() => ({
  mockStrutRun: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  mockDispatch: vi.fn(),
  mockSettle: vi.fn(async (row: unknown) => row),
}));

vi.mock("@/lib/db", () => ({ db: { strutRun: mockStrutRun } }));
vi.mock("@/services/strut-runs", () => ({ dispatchStrutRun: mockDispatch, STRUT_RUN_LOG_TAG: "STRUT_RUN" }));
vi.mock("@/services/strut-runs/openhealth", () => ({ settleFromStrut: mockSettle }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  LegalRunInProgressError,
  deliverablesOf,
  launchLegalStrutRun,
  listLegalStrutRuns,
  paramsFor,
  toLegalRunWireRow,
} from "@/services/strut-runs/legal-benchmark";
import { parseBenchmarkRunResult } from "@/types/legal";
import type { HarveyTaskInput } from "@/lib/harvey-lab/task-input";

const SLUG = "banking-finance/identify-issues-in-compliance-certificate";

const input: HarveyTaskInput = {
  task_slug: SLUG,
  task_title: "Identify Issues in Borrower's Q3 2024 Compliance Certificate",
  task_goal: "Review the attached compliance certificate…",
  task_output_desc: "compliance-certificate-issue-memo.docx",
  documents_json: ["https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/x/documents/a.docx"],
  rubrics_json: [{ id: "C-001", title: "Identifies the cap", match_criteria: "PASS if …" }],
};

/** `harvey-lab-run`'s output, trimmed from a real run on the openlaw-1 swarm. */
const output = {
  callback: {
    task_slug: SLUG,
    run_id: "1792552899038",
    final_output: {
      "compliance-certificate-issue-memo.docx": "/artifacts/1792552899038/output/compliance-certificate-issue-memo.docx",
      "escape.docx": "/artifacts/1792552899038/../other/secret.docx",
      "elsewhere.docx": "/artifacts/9999/output/elsewhere.docx",
    },
    score: 0,
    max_score: 1,
    all_pass: false,
    n_passed: 32,
    n_total: 36,
    n_grading_errors: 0,
    pass_rate: "32/36",
    judge_model: "claude-sonnet-4-6",
    model: "claude-opus-5",
    criteria_results: [
      { id: "C-001", title: "Identifies the cap", verdict: "pass", reasoning: "Issue 2 identifies it." },
      {
        id: "C-002",
        title: "Quantifies the excess",
        verdict: "fail",
        reasoning: "States $100,000.",
        flagged: true,
        contested: true,
        flag_basis: "criterion_validity",
        llm_flag_reason: "**Criterion Validity** …",
        document_excerpt: "(f) restructuring charges …",
      },
      { title: "no id" },
    ],
    spreadsheet_url: "https://docs.google.com/spreadsheets/d/abc",
  },
  files: { dir: "/artifacts/1792552899038" },
};

const row = (over: Record<string, unknown> = {}) => ({
  id: "row1",
  workspaceId: "ws",
  swarmId: "sw",
  userId: "u",
  kind: "benchmark:harvey-lab",
  workflow: "harvey-lab-run",
  strutRunId: "1792552899038",
  status: StrutRunStatus.SUCCESS,
  input,
  output,
  error: null,
  durationMs: 5_664_576,
  conversationId: null,
  proposalId: null,
  jobId: null,
  createdAt: new Date("2026-10-21T03:21:39Z"),
  settledAt: new Date("2026-10-21T04:56:03Z"),
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("legal benchmark runs on strut", () => {
  it("reads a finished run in the legal page's row shape", () => {
    const wire = toLegalRunWireRow(row() as never);
    expect(wire).toMatchObject({
      id: "row1",
      type: "LEGAL_BENCHMARK_RUNNER",
      status: WorkflowStatus.COMPLETED,
      projectId: null,
      hasReport: false,
      createdAt: "2026-10-21T03:21:39.000Z",
      updatedAt: "2026-10-21T04:56:03.000Z",
    });
    const result = parseBenchmarkRunResult(wire.result)!;
    expect(result).toMatchObject({
      taskSlug: SLUG,
      taskTitle: input.task_title,
      runner: "strut",
      strutRunId: "1792552899038",
      n_passed: 32,
      n_total: 36,
      pass_rate: 32 / 36,
      all_pass: false,
      score: 0,
      max_score: 1,
      model: "claude-opus-5",
      judge_model: "claude-sonnet-4-6",
      deliverables: ["compliance-certificate-issue-memo.docx"],
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/abc",
    });
    expect(result.criteria_results).toEqual([
      { id: "C-001", title: "Identifies the cap", verdict: "pass", reasoning: "Issue 2 identifies it." },
      {
        id: "C-002",
        title: "Quantifies the excess",
        verdict: "fail",
        reasoning: "States $100,000.",
        flagged: true,
        contested: true,
        flag_basis: "criterion_validity",
        llm_flag_reason: "**Criterion Validity** …",
      },
    ]);
    expect(result.errorMessage).toBeUndefined();
  });

  it("maps a running and a failed run onto the page's statuses", () => {
    const running = toLegalRunWireRow(row({ status: StrutRunStatus.PENDING, output: null, settledAt: null }) as never);
    expect(running.status).toBe(WorkflowStatus.IN_PROGRESS);
    expect(running.updatedAt).toBe("2026-10-21T03:21:39.000Z");
    expect(parseBenchmarkRunResult(running.result)).toEqual({
      taskSlug: SLUG,
      taskTitle: input.task_title,
      runner: "strut",
      strutRunId: "1792552899038",
    });

    const failed = toLegalRunWireRow(row({ status: StrutRunStatus.ERROR, output: null, error: "boom" }) as never);
    expect(failed.status).toBe(WorkflowStatus.FAILED);
    expect(parseBenchmarkRunResult(failed.result)?.errorMessage).toBe("boom");
    const lost = toLegalRunWireRow(row({ status: StrutRunStatus.LOST, output: null }) as never);
    expect(parseBenchmarkRunResult(lost.result)?.errorMessage).toBe("Strut never reported this run back");
  });

  it("keeps only deliverables inside the run's own folder", () => {
    expect([...deliverablesOf(row() as never)]).toEqual([
      ["compliance-certificate-issue-memo.docx", "output/compliance-certificate-issue-memo.docx"],
    ]);
    expect(deliverablesOf(row({ strutRunId: null }) as never).size).toBe(0);
    expect(deliverablesOf(row({ output: { callback: { final_output: "x" } } }) as never).size).toBe(0);
  });

  it("sends only the picked models, the judge without its provider", () => {
    expect(paramsFor({})).toEqual({});
    expect(
      paramsFor({
        reasoningModel: "anthropic/claude-opus-5",
        standardModel: "anthropic/claude-sonnet-5",
        judgeModel: "anthropic/claude-sonnet-4-6",
      }),
    ).toEqual({
      reasoning_model: "anthropic/claude-opus-5",
      standard_model: "anthropic/claude-sonnet-5",
      judge_model: "claude-sonnet-4-6",
    });
  });

  it("launches harvey-lab-run under the harvey-lab benchmark kind", async () => {
    mockStrutRun.findFirst.mockResolvedValue(null);
    mockDispatch.mockResolvedValue({ runId: "row1", strutRunId: "s", swarmId: "sw" });
    await launchLegalStrutRun({
      workspaceId: "ws",
      userId: "u",
      publicBaseUrl: "https://hive",
      input,
      models: { judgeModel: "anthropic/claude-sonnet-4-6" },
    });
    expect(mockStrutRun.findFirst.mock.calls[0][0].where).toMatchObject({
      workspaceId: "ws",
      kind: "benchmark:harvey-lab",
      status: StrutRunStatus.PENDING,
      input: { path: ["task_slug"], equals: SLUG },
    });
    expect(mockDispatch).toHaveBeenCalledWith({
      workspaceId: "ws",
      userId: "u",
      kind: "benchmark:harvey-lab",
      workflow: "harvey-lab-run",
      purpose: "benchmark",
      input,
      params: { judge_model: "claude-sonnet-4-6" },
      publicBaseUrl: "https://hive",
    });
  });

  it("refuses a second run of a task while one is in flight", async () => {
    mockStrutRun.findFirst.mockResolvedValue({ id: "busy" });
    await expect(
      launchLegalStrutRun({ workspaceId: "ws", userId: "u", publicBaseUrl: "h", input }),
    ).rejects.toBeInstanceOf(LegalRunInProgressError);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("lists the workspace's runs, settling each from strut", async () => {
    mockStrutRun.findMany.mockResolvedValue([row(), row({ id: "row2", status: StrutRunStatus.PENDING, output: null })]);
    mockStrutRun.count.mockResolvedValue(2);
    const { runs, total } = await listLegalStrutRuns("ws");
    expect(mockStrutRun.findMany.mock.calls[0][0].where).toEqual({ workspaceId: "ws", kind: "benchmark:harvey-lab" });
    expect(mockSettle).toHaveBeenCalledTimes(2);
    expect(runs.map((r) => [r.id, r.status])).toEqual([
      ["row1", WorkflowStatus.COMPLETED],
      ["row2", WorkflowStatus.IN_PROGRESS],
    ]);
    expect(total).toBe(2);
  });
});
