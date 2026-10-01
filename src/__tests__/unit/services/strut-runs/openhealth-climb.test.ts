/**
 * Unit tests for `services/strut-runs/openhealth-climb.ts`.
 *
 * Coverage:
 *   - start: the climb row, the first step (a benchmark run, or an improve
 *     over the seed) launched with the climb's id, refusals, and a launch
 *     that fails marking the climb FAILED;
 *   - advance (the settle handler): only the current step advances the
 *     climb; the claim before a launch; improve after a scored run; the
 *     next attempt after an improve run; REACHED / STALLED endings; a lost
 *     claim; strut unreachable gives the claim back and rethrows; any
 *     other launch failure ends the climb;
 *   - stop: ends the climb and cancels the step in flight;
 *   - sweep: a claimed-and-never-launched climb fails, a pending step
 *     waits, a settled one is advanced.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenHealthClimbStatus, StrutRunStatus } from "@prisma/client";

const { mockClimb, mockStrutRun, mockLaunchRun, mockLaunchImprove, mockSettle, mockResolve, mockCancel } = vi.hoisted(
  () => ({
    mockClimb: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    mockStrutRun: { findMany: vi.fn(), findUnique: vi.fn() },
    mockLaunchRun: vi.fn(),
    mockLaunchImprove: vi.fn(),
    mockSettle: vi.fn(),
    mockResolve: vi.fn(),
    mockCancel: vi.fn(),
  }),
);

vi.mock("@/lib/db", () => ({ db: { openHealthClimb: mockClimb, strutRun: mockStrutRun } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@/services/strut-runs", () => {
  class StrutDispatchError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { cancelStrutRun: mockCancel, STRUT_RUN_LOG_TAG: "STRUT_RUN", StrutDispatchError };
});
vi.mock("@/services/strut-runs/openhealth", () => ({
  launchOpenHealthRun: mockLaunchRun,
  launchOpenHealthImprove: mockLaunchImprove,
  settleFromStrut: mockSettle,
  OPENHEALTH_ROW_SELECT: { id: true },
}));
vi.mock("@/services/strut-target", () => ({
  resolveStrutTarget: mockResolve,
  describeStrutTargetError: (e: unknown) => `target: ${String(e)}`,
}));

import { StrutDispatchError } from "@/services/strut-runs";
import {
  advanceOpenHealthClimb,
  handleOpenHealthRunSettled,
  listOpenHealthClimbs,
  OpenHealthClimbError,
  startOpenHealthClimb,
  stopOpenHealthClimb,
  sweepOpenHealthClimbs,
} from "@/services/strut-runs/openhealth-climb";

const NOW = new Date("2026-09-30T10:00:00Z");

function climbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "climb-1",
    workspaceId: "ws-1",
    swarmId: "swarm-1",
    userId: "user-1",
    gtId: 7532,
    targetF1: 1,
    maxAttempts: 5,
    status: OpenHealthClimbStatus.RUNNING,
    stopReason: null,
    seedRunId: null,
    currentRunId: "run-1",
    attempts: 1,
    startF1: null,
    bestF1: null,
    publicBaseUrl: "https://hive.example",
    createdAt: NOW,
    settledAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    workspaceId: "ws-1",
    swarmId: "swarm-1",
    userId: "user-1",
    kind: "openhealth_benchmark",
    workflow: "openhealth-run",
    strutRunId: "strut-run-1",
    status: StrutRunStatus.SUCCESS,
    input: { gtId: 7532, workdir: "gt-7532" },
    output: { weighted_problem_list_f1_neutral: 0.7 },
    error: null,
    durationMs: 60_000,
    conversationId: null,
    proposalId: null,
    jobId: null,
    climbId: "climb-1",
    createdAt: NOW,
    settledAt: NOW,
    ...overrides,
  };
}

const improveRow = (overrides: Record<string, unknown> = {}) =>
  runRow({
    id: "imp-1",
    kind: "openhealth_improve",
    workflow: "openhealth-improve",
    strutRunId: "strut-imp-1",
    input: { runIds: "strut-run-1", apply: true },
    output: { applied: true, proposals: [{ action: "create", name: "A" }], created: [{ status: "Success" }] },
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockResolve.mockResolvedValue({ ok: true, target: { swarmId: "swarm-1" } });
  mockClimb.updateMany.mockResolvedValue({ count: 1 });
  mockClimb.update.mockResolvedValue({});
  mockLaunchRun.mockResolvedValue({ runId: "run-2", strutRunId: "strut-run-2", swarmId: "swarm-1" });
  mockLaunchImprove.mockResolvedValue({ runId: "imp-1", strutRunId: "strut-imp-1", swarmId: "swarm-1" });
});

const startArgs = {
  workspaceId: "ws-1",
  userId: "user-1",
  publicBaseUrl: "https://hive.example",
  gtId: 7532,
  targetF1: 1,
  maxAttempts: 5,
};

describe("startOpenHealthClimb", () => {
  it("creates the climb and launches attempt 1 with the climb's id", async () => {
    mockClimb.create.mockResolvedValue(climbRow({ currentRunId: null, attempts: 0 }));

    const out = await startOpenHealthClimb(startArgs);

    expect(out).toEqual({ climbId: "climb-1", runId: "run-2" });
    expect(mockClimb.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "ws-1",
        swarmId: "swarm-1",
        gtId: 7532,
        targetF1: 1,
        maxAttempts: 5,
        seedRunId: null,
        attempts: 0,
        startF1: null,
        bestF1: null,
        publicBaseUrl: "https://hive.example",
      }),
    });
    expect(mockLaunchRun).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "user-1",
      publicBaseUrl: "https://hive.example",
      climbId: "climb-1",
      gtId: 7532,
    });
    expect(mockClimb.update).toHaveBeenCalledWith({
      where: { id: "climb-1" },
      data: { currentRunId: "run-2", attempts: { increment: 1 } },
    });
  });

  it("adopts a scored seed as attempt 1 and starts with an improve over it", async () => {
    mockClimb.create.mockResolvedValue(climbRow({ seedRunId: "run-1", currentRunId: null, attempts: 1 }));

    const out = await startOpenHealthClimb({ ...startArgs, seed: runRow({ climbId: null }) });

    expect(out.runId).toBe("imp-1");
    expect(mockClimb.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ seedRunId: "run-1", attempts: 1, startF1: 0.7, bestF1: 0.7 }),
    });
    expect(mockLaunchImprove).toHaveBeenCalledWith(
      expect.objectContaining({ strutRunId: "strut-run-1", climbId: "climb-1" }),
    );
    expect(mockLaunchRun).not.toHaveBeenCalled();
    expect(mockClimb.update).toHaveBeenCalledWith({ where: { id: "climb-1" }, data: { currentRunId: "imp-1" } });
  });

  it("refuses a seed at the target, an unscored seed, and a seed from another swarm", async () => {
    await expect(
      startOpenHealthClimb({ ...startArgs, seed: runRow({ output: { weighted_problem_list_f1_neutral: 1 } }) }),
    ).rejects.toMatchObject({ code: "target_reached" });
    await expect(
      startOpenHealthClimb({ ...startArgs, seed: runRow({ status: StrutRunStatus.ERROR, output: null }) }),
    ).rejects.toMatchObject({ code: "not_scored" });
    await expect(startOpenHealthClimb({ ...startArgs, seed: runRow({ swarmId: "swarm-2" }) })).rejects.toBeInstanceOf(
      OpenHealthClimbError,
    );
    expect(mockClimb.create).not.toHaveBeenCalled();
  });

  it("marks the climb FAILED and rethrows when the first step cannot be launched", async () => {
    mockClimb.create.mockResolvedValue(climbRow({ currentRunId: null, attempts: 0 }));
    mockLaunchRun.mockRejectedValue(new StrutDispatchError("workflow_missing", "no such workflow"));

    await expect(startOpenHealthClimb(startArgs)).rejects.toThrow("no such workflow");
    expect(mockClimb.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "climb-1", status: OpenHealthClimbStatus.RUNNING },
        data: expect.objectContaining({
          status: OpenHealthClimbStatus.FAILED,
          stopReason: "Could not launch the first step: no such workflow",
        }),
      }),
    );
  });
});

describe("advanceOpenHealthClimb", () => {
  it("does nothing for a row that is not the climb's current step", async () => {
    mockClimb.findUnique.mockResolvedValue(climbRow({ currentRunId: "run-9" }));
    await advanceOpenHealthClimb(runRow());
    expect(mockClimb.updateMany).not.toHaveBeenCalled();
    expect(mockLaunchImprove).not.toHaveBeenCalled();
  });

  it("does nothing for a climb that is no longer running", async () => {
    mockClimb.findUnique.mockResolvedValue(climbRow({ status: OpenHealthClimbStatus.STOPPED }));
    await advanceOpenHealthClimb(runRow());
    expect(mockLaunchImprove).not.toHaveBeenCalled();
  });

  it("claims the climb, records the score, and launches an improve over a scored run", async () => {
    mockClimb.findUnique.mockResolvedValue(climbRow());

    await advanceOpenHealthClimb(runRow());

    expect(mockClimb.updateMany).toHaveBeenCalledWith({
      where: { id: "climb-1", status: OpenHealthClimbStatus.RUNNING, currentRunId: "run-1" },
      data: { currentRunId: null, bestF1: 0.7, startF1: 0.7 },
    });
    expect(mockLaunchImprove).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      userId: "user-1",
      publicBaseUrl: "https://hive.example",
      climbId: "climb-1",
      strutRunId: "strut-run-1",
    });
    expect(mockClimb.update).toHaveBeenCalledWith({ where: { id: "climb-1" }, data: { currentRunId: "imp-1" } });
  });

  it("launches the next attempt after an improve run that wrote", async () => {
    mockClimb.findUnique.mockResolvedValue(climbRow({ currentRunId: "imp-1", bestF1: 0.7, startF1: 0.7 }));

    await advanceOpenHealthClimb(improveRow());

    expect(mockLaunchRun).toHaveBeenCalledWith(expect.objectContaining({ gtId: 7532, climbId: "climb-1" }));
    expect(mockClimb.update).toHaveBeenCalledWith({
      where: { id: "climb-1" },
      data: { currentRunId: "run-2", attempts: { increment: 1 } },
    });
  });

  it("ends the climb as REACHED at the target, with the best score", async () => {
    mockClimb.findUnique.mockResolvedValue(climbRow({ bestF1: 0.7, startF1: 0.7, attempts: 2 }));

    await advanceOpenHealthClimb(runRow({ output: { weighted_problem_list_f1_neutral: 1 } }));

    expect(mockClimb.updateMany).toHaveBeenCalledWith({
      where: { id: "climb-1", status: OpenHealthClimbStatus.RUNNING, currentRunId: "run-1" },
      data: expect.objectContaining({
        status: OpenHealthClimbStatus.REACHED,
        stopReason: "Attempt 2 scored 1.00.",
        currentRunId: null,
        bestF1: 1,
      }),
    });
    expect(mockLaunchImprove).not.toHaveBeenCalled();
  });

  it("ends the climb as STALLED after an improve run that wrote nothing", async () => {
    mockClimb.findUnique.mockResolvedValue(climbRow({ currentRunId: "imp-1" }));

    await advanceOpenHealthClimb(improveRow({ output: { applied: true, proposals: [], created: [] } }));

    expect(mockClimb.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: OpenHealthClimbStatus.STALLED }) }),
    );
    expect(mockLaunchRun).not.toHaveBeenCalled();
  });

  it("launches nothing when another delivery took the claim", async () => {
    mockClimb.findUnique.mockResolvedValue(climbRow());
    mockClimb.updateMany.mockResolvedValue({ count: 0 });

    await advanceOpenHealthClimb(runRow());

    expect(mockLaunchImprove).not.toHaveBeenCalled();
  });

  it("gives the claim back and rethrows when strut is unreachable, so the webhook retries", async () => {
    mockClimb.findUnique.mockResolvedValue(climbRow());
    mockLaunchImprove.mockRejectedValue(new StrutDispatchError("unreachable", "down"));

    await expect(advanceOpenHealthClimb(runRow())).rejects.toThrow("down");

    expect(mockClimb.updateMany).toHaveBeenLastCalledWith({
      where: { id: "climb-1", status: OpenHealthClimbStatus.RUNNING, currentRunId: null },
      data: { currentRunId: "run-1" },
    });
  });

  it("ends the climb as FAILED on any other launch failure", async () => {
    mockClimb.findUnique.mockResolvedValue(climbRow());
    mockLaunchImprove.mockRejectedValue(new StrutDispatchError("workflow_missing", "no such workflow"));

    await advanceOpenHealthClimb(runRow());

    expect(mockClimb.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OpenHealthClimbStatus.FAILED,
          stopReason: "Could not launch the next step: no such workflow",
        }),
      }),
    );
  });

  it("ends the climb as FAILED when the workspace moved to another swarm", async () => {
    mockClimb.findUnique.mockResolvedValue(climbRow());
    mockResolve.mockResolvedValue({ ok: true, target: { swarmId: "swarm-2" } });

    await advanceOpenHealthClimb(runRow());

    expect(mockLaunchImprove).not.toHaveBeenCalled();
    expect(mockClimb.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: OpenHealthClimbStatus.FAILED }) }),
    );
  });
});

describe("handleOpenHealthRunSettled", () => {
  it("leaves a run launched by hand alone", async () => {
    await handleOpenHealthRunSettled(runRow({ climbId: null }));
    expect(mockClimb.findUnique).not.toHaveBeenCalled();
  });

  it("advances the climb of a step", async () => {
    mockClimb.findUnique.mockResolvedValue(climbRow());
    await handleOpenHealthRunSettled(runRow());
    expect(mockLaunchImprove).toHaveBeenCalled();
  });
});

describe("stopOpenHealthClimb", () => {
  it("ends the climb and asks strut to cancel the step in flight", async () => {
    mockStrutRun.findUnique.mockResolvedValue({
      id: "run-1",
      swarmId: "swarm-1",
      workflow: "openhealth-run",
      strutRunId: "strut-run-1",
      status: StrutRunStatus.PENDING,
    });
    mockCancel.mockResolvedValue(true);

    expect(await stopOpenHealthClimb({ id: "climb-1", currentRunId: "run-1" }, "Stopped by a member.")).toBe(true);

    expect(mockClimb.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "climb-1", status: OpenHealthClimbStatus.RUNNING },
        data: expect.objectContaining({ status: OpenHealthClimbStatus.STOPPED, stopReason: "Stopped by a member." }),
      }),
    );
    expect(mockCancel).toHaveBeenCalledWith(expect.objectContaining({ id: "run-1", strutRunId: "strut-run-1" }));
  });

  it("is false for a climb that is not running, and cancels nothing", async () => {
    mockClimb.updateMany.mockResolvedValue({ count: 0 });
    expect(await stopOpenHealthClimb({ id: "climb-1", currentRunId: "run-1" }, "x")).toBe(false);
    expect(mockCancel).not.toHaveBeenCalled();
  });
});

describe("sweepOpenHealthClimbs", () => {
  it("fails a claimed climb that never launched, waits on a pending step, advances a settled one", async () => {
    mockClimb.findMany.mockResolvedValue([
      climbRow({ id: "c-null", currentRunId: null }),
      climbRow({ id: "c-pending", currentRunId: "run-p" }),
      climbRow({ id: "c-settled", currentRunId: "run-1" }),
    ]);
    mockStrutRun.findUnique
      .mockResolvedValueOnce(
        runRow({ id: "run-p", status: StrutRunStatus.PENDING, output: null, climbId: "c-pending" }),
      )
      .mockResolvedValueOnce(runRow({ climbId: "c-settled" }));
    mockClimb.findUnique.mockResolvedValue(climbRow({ id: "c-settled", currentRunId: "run-1" }));

    const stats = await sweepOpenHealthClimbs({ now: NOW });

    expect(stats).toEqual({ swept: 3, advanced: 1, failed: 1, waiting: 1 });
    expect(mockClimb.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c-null", status: OpenHealthClimbStatus.RUNNING },
        data: expect.objectContaining({ status: OpenHealthClimbStatus.FAILED }),
      }),
    );
    expect(mockLaunchImprove).toHaveBeenCalledTimes(1);
  });
});

describe("listOpenHealthClimbs", () => {
  it("answers the climbs with their steps, the seed included", async () => {
    mockClimb.findMany.mockResolvedValue([climbRow({ seedRunId: "seed", currentRunId: "imp-1", attempts: 1 })]);
    const seed = runRow({ id: "seed", climbId: null, createdAt: new Date(NOW.getTime() - 60_000) });
    const imp = improveRow({ status: StrutRunStatus.PENDING, output: null, settledAt: null });
    mockStrutRun.findMany.mockResolvedValue([seed, imp]);
    mockSettle.mockImplementation(async (row: unknown) => row);

    const climbs = await listOpenHealthClimbs("ws-1", { now: NOW });

    expect(mockStrutRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "ws-1", OR: [{ climbId: { in: ["climb-1"] } }, { id: { in: ["seed"] } }] },
      }),
    );
    expect(climbs).toHaveLength(1);
    expect(climbs[0].steps.map((s) => [s.kind, s.runId, s.outcome])).toEqual([
      ["benchmark", "seed", "succeeded"],
      ["improve", "imp-1", "running"],
    ]);
  });

  it("re-reads the climbs when a step was settled from strut", async () => {
    const pending = runRow({ status: StrutRunStatus.PENDING, output: null, settledAt: null });
    mockClimb.findMany
      .mockResolvedValueOnce([climbRow()])
      .mockResolvedValueOnce([climbRow({ currentRunId: "imp-1", bestF1: 0.7 })]);
    mockStrutRun.findMany
      .mockResolvedValueOnce([pending])
      .mockResolvedValueOnce([runRow(), improveRow({ status: StrutRunStatus.PENDING, output: null })]);
    mockSettle.mockResolvedValue(runRow());

    const climbs = await listOpenHealthClimbs("ws-1", { now: NOW });

    expect(mockClimb.findMany).toHaveBeenCalledTimes(2);
    expect(climbs[0].steps).toHaveLength(2);
    expect(climbs[0].currentRunId).toBe("imp-1");
  });
});
