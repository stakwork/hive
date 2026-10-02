/**
 * Unit tests for `services/strut-runs/openhealth.ts`.
 *
 * Coverage:
 *   - launch: dispatches `openhealth-run` with purpose `benchmark` and the
 *     task's id, benchmark and folder as input;
 *   - the in-flight guard is per task;
 *   - list / get: rows serialized, scoped to the workspace and the kind; a
 *     PENDING row past the probe age whose run is over on strut is settled
 *     through `completeStrutRun` and re-read; a fresh PENDING row is not
 *     probed; a probe failure leaves the row as is;
 *   - improve: dispatches `openhealth-improve` over one benchmark run with
 *     `apply` on; its runs are found by that run's strut id, and the
 *     in-flight guard is per benchmark run;
 *   - climbs: dispatches `openhealth-improve-loop` with the task, target
 *     and run count; the in-flight guard is per task; the list reads the
 *     event log for a climb in flight only, the detail for every climb.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrutRunStatus } from "@prisma/client";

const { mockStrutRun, mockDispatch, mockProbe, mockComplete, mockCatalogue, mockEvents } = vi.hoisted(() => ({
  mockStrutRun: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
  mockDispatch: vi.fn(),
  mockProbe: vi.fn(),
  mockComplete: vi.fn(),
  mockCatalogue: vi.fn(),
  mockEvents: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { strutRun: mockStrutRun } }));
vi.mock("@/services/strut-runs", () => ({
  dispatchStrutRun: mockDispatch,
  probeStrutRun: mockProbe,
  completeStrutRun: mockComplete,
  STRUT_RUN_LOG_TAG: "STRUT_RUN",
}));
vi.mock("@/services/strut-runs/lab", () => ({ fetchStrutRunEvents: mockEvents }));
vi.mock("@/services/openhealth-benchmarks/tasks", () => ({ cachedTaskLookup: mockCatalogue }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  getOpenHealthClimb,
  getOpenHealthRun,
  hasPendingOpenHealthClimb,
  hasPendingOpenHealthImprove,
  hasPendingOpenHealthRun,
  launchOpenHealthClimb,
  launchOpenHealthImprove,
  launchOpenHealthRun,
  listOpenHealthClimbs,
  listOpenHealthImprovements,
  listOpenHealthRuns,
} from "@/services/strut-runs/openhealth";

const NOW = new Date("2026-09-28T18:00:00Z");

/** A catalogue lookup answering one entry for every task. */
const entry = (difficulty: "easy" | "medium" | "hard") => () => ({
  difficulty,
  task: "patient_diagnosis" as const,
  variant: null,
  specialty: null,
});

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
  mockCatalogue.mockResolvedValue(entry("medium"));
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
      input: { gtId: 7532, task: "patient_diagnosis", workdir: "gt-7532" },
      publicBaseUrl: "https://hive.example",
    });
  });

  it("names the benchmark the task belongs to", async () => {
    mockDispatch.mockResolvedValue({ runId: "run-2", strutRunId: "2", swarmId: "swarm-1" });

    await launchOpenHealthRun({
      workspaceId: "ws-1",
      userId: "user-1",
      publicBaseUrl: "https://hive.example",
      gtId: 8274,
      task: "context_summarization",
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ input: { gtId: 8274, task: "context_summarization", workdir: "gt-8274" } }),
    );
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

    expect(mockCatalogue).toHaveBeenCalledWith("swarm-1", ["public", "heldout"]);
    expect(runs[0]).toMatchObject({ outcome: "failed", difficulty: "medium", error: "no problem list produced" });
  });

  it("asks nothing more of a workspace with no runs", async () => {
    mockStrutRun.findMany.mockResolvedValue([]);
    expect(await listOpenHealthRuns("ws-1", { now: NOW })).toEqual([]);
    expect(mockCatalogue).not.toHaveBeenCalled();
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

    expect(run).toMatchObject({
      id: "run-1",
      outcome: "succeeded",
      matched: [{ pred: "N179", gt: "N179" }],
      extra: ["E876"],
    });
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

// ─── Climbs ──────────────────────────────────────────────────────────────

function climbRow(overrides: Record<string, unknown> = {}) {
  return row({
    id: "climb-1",
    kind: "openhealth_climb",
    workflow: "openhealth-improve-loop",
    strutRunId: "1790830428092",
    input: { gtId: 7013, target: 1, maxRuns: 5 },
    ...overrides,
  });
}

const LOOP_EVENTS = [
  { type: "step.start", path: "openhealth-improve-loop/loop#0", ts: "2026-09-28T17:40:00.000Z" },
  { type: "step.start", path: "openhealth-improve-loop/loop#0/run" },
  { type: "step.start", path: "openhealth-improve-loop/loop#0/run/task" },
];

describe("launchOpenHealthClimb", () => {
  it("dispatches openhealth-improve-loop on the workspace's own swarm with the task and the rules", async () => {
    mockDispatch.mockResolvedValue({ runId: "climb-1", strutRunId: "1790830428092", swarmId: "swarm-1" });

    const result = await launchOpenHealthClimb({
      workspaceId: "ws-1",
      userId: "user-1",
      publicBaseUrl: "https://hive.example",
      gtId: 7013,
      targetF1: 0.9,
      maxRuns: 4,
    });

    expect(result).toEqual({ runId: "climb-1", strutRunId: "1790830428092", swarmId: "swarm-1" });
    expect(mockDispatch).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "user-1",
      kind: "openhealth_climb",
      workflow: "openhealth-improve-loop",
      purpose: "benchmark",
      input: { gtId: 7013, task: "patient_diagnosis", target: 0.9, maxRuns: 4 },
      publicBaseUrl: "https://hive.example",
    });
  });

  it("names the benchmark the task belongs to", async () => {
    mockDispatch.mockResolvedValue({ runId: "climb-2", strutRunId: "2", swarmId: "swarm-1" });

    await launchOpenHealthClimb({
      workspaceId: "ws-1",
      userId: "user-1",
      publicBaseUrl: "https://hive.example",
      gtId: 8274,
      task: "context_summarization",
      targetF1: 1,
      maxRuns: 2,
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ input: { gtId: 8274, task: "context_summarization", target: 1, maxRuns: 2 } }),
    );
  });
});

describe("hasPendingOpenHealthClimb", () => {
  it("looks for a PENDING climb of that task in the workspace", async () => {
    mockStrutRun.findFirst.mockResolvedValue({ id: "climb-1" });

    expect(await hasPendingOpenHealthClimb("ws-1", 7013)).toBe(true);
    expect(mockStrutRun.findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: "ws-1",
        kind: "openhealth_climb",
        status: StrutRunStatus.PENDING,
        input: { path: ["gtId"], equals: 7013 },
      },
      select: { id: true },
    });
  });

  it("is false when there is none", async () => {
    mockStrutRun.findFirst.mockResolvedValue(null);
    expect(await hasPendingOpenHealthClimb("ws-1", 7013)).toBe(false);
  });
});

describe("listOpenHealthClimbs", () => {
  it("lists the workspace's climbs newest first, reading the event log for one in flight only", async () => {
    const settled = climbRow({
      id: "climb-2",
      status: StrutRunStatus.SUCCESS,
      output: { stopReason: "target_reached", history: [{ iteration: 0, score: 1, improved: false }] },
      settledAt: NOW,
    });
    mockStrutRun.findMany.mockResolvedValue([climbRow(), settled]);
    mockCatalogue.mockResolvedValue((gtId: number) => (gtId === 7013 ? entry("medium")() : null));
    mockProbe.mockResolvedValue({ kind: "running" });
    mockEvents.mockResolvedValue(LOOP_EVENTS);

    const climbs = await listOpenHealthClimbs("ws-1", { now: NOW });

    expect(mockStrutRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "ws-1", kind: "openhealth_climb" },
        orderBy: { createdAt: "desc" },
      }),
    );
    expect(mockEvents).toHaveBeenCalledTimes(1);
    expect(mockEvents).toHaveBeenCalledWith(expect.objectContaining({ id: "climb-1" }));
    expect(climbs.map((c) => [c.id, c.status, c.difficulty, c.attempts])).toEqual([
      ["climb-1", "running", "medium", 1],
      ["climb-2", "reached", "medium", 1],
    ]);
    expect(climbs[0].steps[0]).toMatchObject({
      kind: "benchmark",
      outcome: "running",
      startedAt: "2026-09-28T17:40:00.000Z",
    });
    expect(climbs[0].steps[0].stages?.[0]).toMatchObject({ key: "task", status: "running" });
  });

  it("settles a PENDING row whose loop is over on strut, and reads no log for it", async () => {
    const pending = climbRow();
    const done = climbRow({
      status: StrutRunStatus.SUCCESS,
      output: { stopReason: "max_runs", history: [{ iteration: 0, score: 0.4, improved: false }] },
      settledAt: NOW,
    });
    mockStrutRun.findMany.mockResolvedValue([pending]);
    mockProbe.mockResolvedValue({ kind: "settled", completion: { status: "success", output: done.output } });
    mockStrutRun.findUnique.mockResolvedValueOnce({ id: "climb-1", tokenHash: "h" }).mockResolvedValueOnce(done);
    mockCatalogue.mockResolvedValue(() => null);

    const climbs = await listOpenHealthClimbs("ws-1", { now: NOW });

    expect(mockComplete).toHaveBeenCalledWith(
      { id: "climb-1", tokenHash: "h" },
      { status: "success", output: done.output },
    );
    expect(mockEvents).not.toHaveBeenCalled();
    expect(climbs[0]).toMatchObject({ status: "exhausted", attempts: 1, bestF1: 0.4 });
  });

  it("shows a climb in flight with no steps when the lab cannot be read", async () => {
    mockStrutRun.findMany.mockResolvedValue([climbRow()]);
    mockProbe.mockResolvedValue({ kind: "running" });
    mockCatalogue.mockResolvedValue(() => null);
    mockEvents.mockResolvedValue(null);

    const [climb] = await listOpenHealthClimbs("ws-1", { now: NOW });
    expect(climb).toMatchObject({ status: "running", attempts: 0, steps: [] });
  });

  it("asks nothing more of a workspace with no climbs", async () => {
    mockStrutRun.findMany.mockResolvedValue([]);
    expect(await listOpenHealthClimbs("ws-1")).toEqual([]);
    expect(mockCatalogue).not.toHaveBeenCalled();
    expect(mockEvents).not.toHaveBeenCalled();
  });
});

describe("getOpenHealthClimb", () => {
  it("is scoped to the workspace and the kind", async () => {
    mockStrutRun.findFirst.mockResolvedValue(null);

    expect(await getOpenHealthClimb("ws-1", "climb-1")).toBeNull();
    expect(mockStrutRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "climb-1", workspaceId: "ws-1", kind: "openhealth_climb" } }),
    );
  });

  it("reads the event log even for a settled climb: it alone knows each run's cost and start", async () => {
    mockStrutRun.findFirst.mockResolvedValue(
      climbRow({
        status: StrutRunStatus.SUCCESS,
        output: { stopReason: "target_reached", history: [{ iteration: 0, score: 1, improved: false }] },
        settledAt: NOW,
      }),
    );
    mockCatalogue.mockResolvedValue(entry("medium"));
    mockEvents.mockResolvedValue([
      ...LOOP_EVENTS,
      {
        type: "step.end",
        path: "openhealth-improve-loop/loop#0/run",
        output: { weighted_problem_list_f1_neutral: 1, produceCost: 0.75, ingested: [{ file: "a.md", cost: 0.25 }] },
      },
    ]);

    const climb = await getOpenHealthClimb("ws-1", "climb-1", { now: NOW });

    expect(mockEvents).toHaveBeenCalledTimes(1);
    expect(climb).toMatchObject({ status: "reached", difficulty: "medium", costUsd: 1 });
    expect(climb?.steps[0]).toMatchObject({ f1: 1, costUsd: 1, startedAt: "2026-09-28T17:40:00.000Z" });
  });
});
