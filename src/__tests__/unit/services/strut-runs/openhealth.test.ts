/**
 * Unit tests for `services/strut-runs/openhealth.ts`.
 *
 * Coverage:
 *   - launch: dispatches `openhealth-run` with purpose `benchmark` and the
 *     task's id and folder as input;
 *   - the in-flight guard is per task;
 *   - list / get: rows serialized, scoped to the workspace and the kind; a
 *     PENDING row past the probe age whose run is over on strut is settled
 *     through `completeStrutRun` and re-read; a fresh PENDING row is not
 *     probed; a probe failure leaves the row as is;
 *   - improve: dispatches `openhealth-improve` over one benchmark run with
 *     `apply` on; its runs are found by that run's strut id, and the
 *     in-flight guard is per benchmark run.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrutRunStatus } from "@prisma/client";

const { mockStrutRun, mockDispatch, mockProbe, mockComplete, mockDifficulty } = vi.hoisted(() => ({
  mockStrutRun: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
  mockDispatch: vi.fn(),
  mockProbe: vi.fn(),
  mockComplete: vi.fn(),
  mockDifficulty: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { strutRun: mockStrutRun } }));
vi.mock("@/services/strut-runs", () => ({
  dispatchStrutRun: mockDispatch,
  probeStrutRun: mockProbe,
  completeStrutRun: mockComplete,
  STRUT_RUN_LOG_TAG: "STRUT_RUN",
}));
vi.mock("@/services/openhealth-benchmarks/tasks", () => ({ cachedDifficultyLookup: mockDifficulty }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  getOpenHealthRun,
  hasPendingOpenHealthImprove,
  hasPendingOpenHealthRun,
  launchOpenHealthImprove,
  launchOpenHealthRun,
  listOpenHealthImprovements,
  listOpenHealthRuns,
} from "@/services/strut-runs/openhealth";

const NOW = new Date("2026-09-28T18:00:00Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    workspaceId: "ws-1",
    swarmId: "swarm-1",
    userId: "user-1",
    kind: "openhealth_benchmark",
    workflow: "openhealth-run",
    strutRunId: "1790614605308",
    status: StrutRunStatus.PENDING,
    input: { gtId: 7532, workdir: "gt-7532" },
    output: null,
    error: null,
    durationMs: null,
    conversationId: null,
    proposalId: null,
    createdAt: new Date(NOW.getTime() - 20 * 60_000),
    settledAt: null,
    ...overrides,
  };
}

const SETTLED = {
  status: StrutRunStatus.SUCCESS,
  output: { gtId: 7532, difficulty: "hard", weighted_problem_list_f1_neutral: 0.82, tier: "A" },
  durationMs: 1_569_998,
  settledAt: NOW,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDifficulty.mockResolvedValue(() => "medium");
});

describe("launchOpenHealthRun", () => {
  it("dispatches openhealth-run on the workspace's own swarm for the task", async () => {
    mockDispatch.mockResolvedValue({ runId: "run-1", strutRunId: "1", swarmId: "swarm-1" });

    const out = await launchOpenHealthRun({
      workspaceId: "ws-1",
      userId: "user-1",
      publicBaseUrl: "https://hive.example",
      gtId: 7532,
    });

    expect(out.runId).toBe("run-1");
    expect(mockDispatch).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "user-1",
      kind: "openhealth_benchmark",
      workflow: "openhealth-run",
      purpose: "benchmark",
      input: { gtId: 7532, workdir: "gt-7532" },
      publicBaseUrl: "https://hive.example",
    });
  });
});

describe("hasPendingOpenHealthRun", () => {
  it("looks for a PENDING run of that task in the workspace", async () => {
    mockStrutRun.findFirst.mockResolvedValue({ id: "run-1" });

    expect(await hasPendingOpenHealthRun("ws-1", 7532)).toBe(true);
    expect(mockStrutRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: "ws-1",
          kind: "openhealth_benchmark",
          status: StrutRunStatus.PENDING,
          input: { path: ["gtId"], equals: 7532 },
        },
      }),
    );
  });

  it("is false when there is none", async () => {
    mockStrutRun.findFirst.mockResolvedValue(null);
    expect(await hasPendingOpenHealthRun("ws-1", 7532)).toBe(false);
  });
});

describe("listOpenHealthRuns", () => {
  it("lists the workspace's benchmark runs, newest first", async () => {
    mockStrutRun.findMany.mockResolvedValue([row({ ...SETTLED })]);

    const runs = await listOpenHealthRuns("ws-1", { now: NOW });

    expect(mockStrutRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "ws-1", kind: "openhealth_benchmark" },
        orderBy: { createdAt: "desc" },
      }),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: "run-1", outcome: "succeeded", gtId: 7532, difficulty: "hard" });
    expect(runs[0].scores?.f1).toBe(0.82);
    expect(mockProbe).not.toHaveBeenCalled();
  });

  it("settles a PENDING row whose run is over on strut", async () => {
    mockStrutRun.findMany.mockResolvedValue([row()]);
    mockProbe.mockResolvedValue({
      kind: "settled",
      completion: { status: "success", output: SETTLED.output, durationMs: SETTLED.durationMs },
    });
    mockStrutRun.findUnique
      .mockResolvedValueOnce({ id: "run-1", tokenHash: "hash" })
      .mockResolvedValueOnce(row({ ...SETTLED }));

    const runs = await listOpenHealthRuns("ws-1", { now: NOW });

    expect(mockComplete).toHaveBeenCalledWith(
      { id: "run-1", tokenHash: "hash" },
      expect.objectContaining({ status: "success" }),
    );
    expect(runs[0]).toMatchObject({ outcome: "succeeded", status: "SUCCESS" });
  });

  it("does not probe a run that was launched a moment ago", async () => {
    mockStrutRun.findMany.mockResolvedValue([row({ createdAt: new Date(NOW.getTime() - 5_000) })]);

    const runs = await listOpenHealthRuns("ws-1", { now: NOW });

    expect(mockProbe).not.toHaveBeenCalled();
    expect(runs[0]).toMatchObject({ outcome: "running" });
  });

  it("shows the row as running when strut still runs it, or cannot be asked", async () => {
    mockStrutRun.findMany.mockResolvedValue([row(), row({ id: "run-2" })]);
    mockProbe.mockResolvedValueOnce({ kind: "running", status: "running" }).mockRejectedValueOnce(new Error("down"));

    const runs = await listOpenHealthRuns("ws-1", { now: NOW });

    expect(mockComplete).not.toHaveBeenCalled();
    expect(runs.map((r) => r.outcome)).toEqual(["running", "running"]);
  });

  it("fills a failed run's difficulty from the cached catalogue", async () => {
    mockStrutRun.findMany.mockResolvedValue([
      row({ status: StrutRunStatus.ERROR, error: "no problem list produced", settledAt: NOW }),
    ]);

    const runs = await listOpenHealthRuns("ws-1", { now: NOW });

    expect(mockDifficulty).toHaveBeenCalledWith("swarm-1", ["public", "heldout"]);
    expect(runs[0]).toMatchObject({ outcome: "failed", difficulty: "medium", error: "no problem list produced" });
  });

  it("asks nothing more of a workspace with no runs", async () => {
    mockStrutRun.findMany.mockResolvedValue([]);
    expect(await listOpenHealthRuns("ws-1", { now: NOW })).toEqual([]);
    expect(mockDifficulty).not.toHaveBeenCalled();
  });
});

describe("getOpenHealthRun", () => {
  it("is scoped to the workspace and the kind", async () => {
    mockStrutRun.findFirst.mockResolvedValue(null);

    expect(await getOpenHealthRun("ws-1", "run-of-another-kind", { now: NOW })).toBeNull();
    expect(mockStrutRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-of-another-kind", workspaceId: "ws-1", kind: "openhealth_benchmark" },
      }),
    );
  });

  it("answers the run with its detail", async () => {
    mockStrutRun.findFirst.mockResolvedValue(
      row({ ...SETTLED, output: { ...SETTLED.output, matched: [{ pred: "N179", gt: "N179" }], extra: ["E876"] } }),
    );

    const run = await getOpenHealthRun("ws-1", "run-1", { now: NOW });

    expect(run).toMatchObject({ id: "run-1", outcome: "succeeded", matched: [{ pred: "N179", gt: "N179" }], extra: ["E876"] });
  });
});

describe("launchOpenHealthImprove", () => {
  it("dispatches openhealth-improve over the one run, with apply on", async () => {
    mockDispatch.mockResolvedValue({ runId: "improve-1", strutRunId: "2", swarmId: "swarm-1" });

    const out = await launchOpenHealthImprove({
      workspaceId: "ws-1",
      userId: "user-1",
      publicBaseUrl: "https://hive.example",
      strutRunId: "1790614605308",
    });

    expect(out.runId).toBe("improve-1");
    expect(mockDispatch).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "user-1",
      kind: "openhealth_improve",
      workflow: "openhealth-improve",
      purpose: "benchmark",
      input: { runIds: "1790614605308", apply: true },
      publicBaseUrl: "https://hive.example",
    });
  });
});

describe("hasPendingOpenHealthImprove", () => {
  it("looks for a PENDING improve run of that benchmark run in the workspace", async () => {
    mockStrutRun.findFirst.mockResolvedValue({ id: "improve-1" });

    expect(await hasPendingOpenHealthImprove("ws-1", "1790614605308")).toBe(true);
    expect(mockStrutRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: "ws-1",
          kind: "openhealth_improve",
          status: StrutRunStatus.PENDING,
          input: { path: ["runIds"], equals: "1790614605308" },
        },
      }),
    );
  });

  it("is false when there is none", async () => {
    mockStrutRun.findFirst.mockResolvedValue(null);
    expect(await hasPendingOpenHealthImprove("ws-1", "1790614605308")).toBe(false);
  });
});

describe("listOpenHealthImprovements", () => {
  const improve = (overrides: Record<string, unknown> = {}) =>
    row({
      id: "improve-1",
      kind: "openhealth_improve",
      workflow: "openhealth-improve",
      strutRunId: "1790625755699",
      input: { runIds: "1790614605308", apply: true },
      ...overrides,
    });
  const DONE = {
    status: StrutRunStatus.SUCCESS,
    output: {
      applied: true,
      summary: "One new Concept.",
      proposals: [{ action: "create", name: "Unifying Diagnosis From Findings", parent: "Problem List" }],
      created: [{ status: "Success" }],
    },
    durationMs: 231_023,
    settledAt: NOW,
  };

  it("lists the improve runs of that benchmark run, newest first", async () => {
    mockStrutRun.findMany.mockResolvedValue([improve({ ...DONE })]);

    const improvements = await listOpenHealthImprovements("ws-1", "1790614605308", { now: NOW });

    expect(mockStrutRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: "ws-1",
          kind: "openhealth_improve",
          input: { path: ["runIds"], equals: "1790614605308" },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
    expect(improvements).toHaveLength(1);
    expect(improvements[0]).toMatchObject({ id: "improve-1", outcome: "succeeded", applied: true });
    expect(improvements[0].proposals[0]).toMatchObject({ name: "Unifying Diagnosis From Findings", write: "created" });
    expect(mockProbe).not.toHaveBeenCalled();
  });

  it("settles a PENDING row whose run is over on strut", async () => {
    mockStrutRun.findMany.mockResolvedValue([improve()]);
    mockProbe.mockResolvedValue({
      kind: "settled",
      completion: { status: "success", output: DONE.output, durationMs: DONE.durationMs },
    });
    mockStrutRun.findUnique
      .mockResolvedValueOnce({ id: "improve-1", tokenHash: "hash" })
      .mockResolvedValueOnce(improve({ ...DONE }));

    const improvements = await listOpenHealthImprovements("ws-1", "1790614605308", { now: NOW });

    expect(mockComplete).toHaveBeenCalledWith(
      { id: "improve-1", tokenHash: "hash" },
      expect.objectContaining({ status: "success" }),
    );
    expect(improvements[0]).toMatchObject({ outcome: "succeeded" });
  });

  it("is empty for a run nobody improved", async () => {
    mockStrutRun.findMany.mockResolvedValue([]);
    expect(await listOpenHealthImprovements("ws-1", "1790614605308", { now: NOW })).toEqual([]);
  });
});
