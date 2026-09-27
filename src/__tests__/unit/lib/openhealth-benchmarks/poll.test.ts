/**
 * Unit tests for pollOpenHealthBenchmarkRuns — the poll-on-read settle path.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { WorkflowStatus } from "@prisma/client";

const mockGetSwarmAccessByWorkspaceId = vi.hoisted(() => vi.fn());
const mockDbUpdateMany = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/helpers/swarm-access", () => ({
  getSwarmAccessByWorkspaceId: mockGetSwarmAccessByWorkspaceId,
}));

vi.mock("@/lib/db", () => ({
  db: { stakworkRun: { updateMany: mockDbUpdateMany } },
}));

vi.mock("@/services/bifrost/strut-delegation", () => ({
  strutLabBaseUrl: (url: string) => `${url}/lab`,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.stubGlobal("fetch", mockFetch);

const WORKSPACE_ID = "ws-openhealth";

function setup() {
  mockGetSwarmAccessByWorkspaceId.mockResolvedValue({
    success: true,
    data: { swarmUrl: "https://swarm.example.com/api", swarmApiKey: "swarm-key" },
  });
  mockDbUpdateMany.mockResolvedValue({ count: 1 });
  process.env.OPENHEALTH_STRUT_WORKFLOW_NAME = "openhealth-run";
}

describe("pollOpenHealthBenchmarkRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
  });

  test("skips rows with no pending/in-progress status", async () => {
    const { pollOpenHealthBenchmarkRuns } = await import("@/lib/openhealth-benchmarks/poll");
    await pollOpenHealthBenchmarkRuns(WORKSPACE_ID, [
      { id: "run-1", status: WorkflowStatus.COMPLETED, result: "{}" },
    ]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("leaves a row unsettled when the probe is not terminal (running)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "running", partial: false }),
    });
    const { pollOpenHealthBenchmarkRuns } = await import("@/lib/openhealth-benchmarks/poll");
    await pollOpenHealthBenchmarkRuns(WORKSPACE_ID, [
      {
        id: "run-1",
        status: WorkflowStatus.IN_PROGRESS,
        result: JSON.stringify({ strutRunId: "lab-1" }),
      },
    ]);
    expect(mockDbUpdateMany).not.toHaveBeenCalled();
  });

  test("leaves a row unsettled when partial:true even if status is terminal-shaped", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "success", partial: true, output: { weighted_problem_list_f1_neutral: 0.9 } }),
    });
    const { pollOpenHealthBenchmarkRuns } = await import("@/lib/openhealth-benchmarks/poll");
    await pollOpenHealthBenchmarkRuns(WORKSPACE_ID, [
      {
        id: "run-1",
        status: WorkflowStatus.IN_PROGRESS,
        result: JSON.stringify({ strutRunId: "lab-1" }),
      },
    ]);
    expect(mockDbUpdateMany).not.toHaveBeenCalled();
  });

  test("settles COMPLETED with allowlisted fields + counts when F1 is present", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "success",
        partial: false,
        output: {
          task: "patient_diagnosis",
          split: "public",
          gtId: "gt-1",
          weighted_problem_list_f1_neutral: 0.82,
          n_matched: 3,
          n_gt: 4,
          missed: ["a"],
          extra: ["b", "c"],
          tier: "gold",
          problemList: ["leak"],
          ground_truth: "leak",
        },
      }),
    });
    const { pollOpenHealthBenchmarkRuns } = await import("@/lib/openhealth-benchmarks/poll");
    await pollOpenHealthBenchmarkRuns(WORKSPACE_ID, [
      {
        id: "run-1",
        status: WorkflowStatus.IN_PROGRESS,
        result: JSON.stringify({ strutRunId: "lab-1", runner: "strut" }),
      },
    ]);

    expect(mockDbUpdateMany).toHaveBeenCalledTimes(1);
    const call = mockDbUpdateMany.mock.calls[0][0];
    expect(call.data.status).toBe(WorkflowStatus.COMPLETED);
    const written = JSON.parse(call.data.result);
    expect(written.weighted_problem_list_f1_neutral).toBe(0.82);
    expect(written.missed).toEqual(["a"]);
    expect(written.extra).toEqual(["b", "c"]);
    expect(written).not.toHaveProperty("problemList");
    expect(written).not.toHaveProperty("ground_truth");
    expect(written).not.toHaveProperty("scoreError");
  });

  test("a terminal probe with no numeric F1 becomes FAILED with scoreError, not COMPLETED", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "success",
        partial: false,
        output: { task: "patient_diagnosis", gtId: "gt-1" },
      }),
    });
    const { pollOpenHealthBenchmarkRuns } = await import("@/lib/openhealth-benchmarks/poll");
    await pollOpenHealthBenchmarkRuns(WORKSPACE_ID, [
      {
        id: "run-1",
        status: WorkflowStatus.IN_PROGRESS,
        result: JSON.stringify({ strutRunId: "lab-1" }),
      },
    ]);

    const call = mockDbUpdateMany.mock.calls[0][0];
    expect(call.data.status).toBe(WorkflowStatus.FAILED);
    const written = JSON.parse(call.data.result);
    expect(written.scoreError).toBe("missing_score");
  });

  test("a strut error status is FAILED", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "error",
        partial: false,
        output: { task: "patient_diagnosis", gtId: "gt-1" },
      }),
    });
    const { pollOpenHealthBenchmarkRuns } = await import("@/lib/openhealth-benchmarks/poll");
    await pollOpenHealthBenchmarkRuns(WORKSPACE_ID, [
      {
        id: "run-1",
        status: WorkflowStatus.IN_PROGRESS,
        result: JSON.stringify({ strutRunId: "lab-1" }),
      },
    ]);

    const call = mockDbUpdateMany.mock.calls[0][0];
    expect(call.data.status).toBe(WorkflowStatus.FAILED);
  });

  test("never accepts a caller-supplied lab run id — uses only result.strutRunId", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "running", partial: false }),
    });
    const { pollOpenHealthBenchmarkRuns } = await import("@/lib/openhealth-benchmarks/poll");
    await pollOpenHealthBenchmarkRuns(WORKSPACE_ID, [
      {
        id: "run-1",
        status: WorkflowStatus.IN_PROGRESS,
        result: JSON.stringify({ strutRunId: "server-stored-id" }),
      },
    ]);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("server-stored-id");
    expect(url).toContain("openhealth-run");
  });

  test("does nothing when there is no strutRunId on the row", async () => {
    const { pollOpenHealthBenchmarkRuns } = await import("@/lib/openhealth-benchmarks/poll");
    await pollOpenHealthBenchmarkRuns(WORKSPACE_ID, [
      { id: "run-1", status: WorkflowStatus.PENDING, result: "{}" },
    ]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
