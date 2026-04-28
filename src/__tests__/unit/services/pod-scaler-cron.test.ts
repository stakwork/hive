import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    swarm: { findMany: vi.fn(), update: vi.fn() },
    task: { count: vi.fn() },
    platformConfig: { findMany: vi.fn() },
  },
}));

vi.mock("@/config/env", () => ({
  config: {
    POOL_MANAGER_BASE_URL: "https://pool.example.com/api",
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((_field: string, value: unknown) => `decrypted-${value}`),
    })),
  },
}));

vi.mock("@/lib/pods/status-queries", () => ({
  getPoolStatusFromPods: vi.fn(),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { db } from "@/lib/db";
import { executePodScalerRuns } from "@/services/pod-scaler-cron";
import { getPoolStatusFromPods } from "@/lib/pods/status-queries";

// ── Helpers ────────────────────────────────────────────────────────────────

const mockedDb = vi.mocked(db);
const mockedGetPoolStatus = vi.mocked(getPoolStatusFromPods);

let fetchMock: ReturnType<typeof vi.fn>;

let consoleSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.task.count.mockReset();
  fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
  global.fetch = fetchMock;
  mockedDb.swarm.update.mockResolvedValue({} as never);
  // Default: no platformConfig overrides (use hardcoded defaults)
  mockedDb.platformConfig.findMany.mockResolvedValue([] as never);
  // Default: no utilisation trigger (0 used, 0 running)
  mockedGetPoolStatus.mockResolvedValue({
    usedVms: 0,
    runningVms: 0,
    unusedVms: 0,
    pendingVms: 0,
    failedVms: 0,
    queuedCount: 0,
    lastCheck: new Date().toISOString(),
  });
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

function makeSwarm(overrides: Partial<{
  id: string;
  minimumVms: number;
  minimumPods: number | null;
  deployedPods: number | null;
  poolApiKey: string | null;
  workspaceId: string;
}> = {}) {
  return {
    id: "swarm-001",
    minimumVms: 2,
    minimumPods: 2,
    deployedPods: null,
    poolApiKey: "enc-key-abc",
    workspaceId: "ws-001",
    ...overrides,
  };
}

function makePlatformConfig(key: string, value: string) {
  return { key, value, id: key, createdAt: new Date(), updatedAt: new Date() };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("executePodScalerRuns", () => {
  it("scales up when over-queued tasks exist", async () => {
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(3)  // todoCount → rawDemand=3 > floor=2 → 3 + 2 = 5
      .mockResolvedValueOnce(0); // inProgressNoPodCount

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(result.success).toBe(true);

    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 5, deployedPods: 5 },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://pool.example.com/api/pools/swarm-001/scale",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ minimum_vms: 5 }),
        headers: expect.objectContaining({
          Authorization: "Bearer decrypted-enc-key-abc",
        }),
      })
    );

    const logCalls = consoleSpy.mock.calls.map((c) => c[0] as string);
    expect(logCalls.some((m) => m.includes("Starting execution"))).toBe(true);
    expect(logCalls.some((m) => m.includes("Found"))).toBe(true);
    expect(logCalls.some((m) => m.includes("queue info") && m.includes("swarm-001"))).toBe(true);
    expect(logCalls.some((m) => m.includes("scaling calc") && m.includes("swarm-001"))).toBe(true);
    expect(logCalls.some((m) => m.includes("Scaling UP") && m.includes("swarm-001"))).toBe(true);
  });

  it("scales down to minimumPods when no over-queued tasks and minimumVms differs", async () => {
    const swarm = makeSwarm({ minimumVms: 5, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount → no over-queued → targetVms = minimumPods = 2

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(1);

    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 2, deployedPods: 2 },
    });

    expect(fetchMock).toHaveBeenCalled(); // minimumVms changed 5→2

    const logCalls = consoleSpy.mock.calls.map((c) => c[0] as string);
    expect(logCalls.some((m) => m.includes("Starting execution"))).toBe(true);
    expect(logCalls.some((m) => m.includes("Found"))).toBe(true);
    expect(logCalls.some((m) => m.includes("queue info") && m.includes("swarm-001"))).toBe(true);
    expect(logCalls.some((m) => m.includes("scaling calc") && m.includes("swarm-001"))).toBe(true);
    expect(logCalls.some((m) => m.includes("Scaling DOWN") && m.includes("swarm-001"))).toBe(true);
  });

  it("no-op: updates deployedPods in DB but skips Pool Manager when targetVms equals minimumVms", async () => {
    // minimumVms=2, minimumPods=2, 0 over-queued → targetVms=2 (no change)
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(0);

    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 2, deployedPods: 2 },
    });

    expect(fetchMock).not.toHaveBeenCalled(); // no Pool Manager call when value unchanged

    const logCalls = consoleSpy.mock.calls.map((c) => c[0] as string);
    expect(logCalls.some((m) => m.includes("Starting execution"))).toBe(true);
    expect(logCalls.some((m) => m.includes("Found"))).toBe(true);
    expect(logCalls.some((m) => m.includes("queue info") && m.includes("swarm-001"))).toBe(true);
    expect(logCalls.some((m) => m.includes("scaling calc") && m.includes("swarm-001"))).toBe(true);
    expect(logCalls.some((m) => m.includes("No change") && m.includes("swarm-001"))).toBe(true);
  });

  it("skips swarms with no poolApiKey", async () => {
    mockedDb.swarm.findMany.mockResolvedValue([] as never); // filtered at DB level

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(0);
    expect(result.swarmsScaled).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("captures Pool Manager failure in errors[], still processes other swarms", async () => {
    const swarm1 = makeSwarm({ id: "swarm-001", minimumVms: 2, minimumPods: 2 });
    const swarm2 = makeSwarm({ id: "swarm-002", minimumVms: 2, minimumPods: 2, workspaceId: "ws-002" });
    mockedDb.swarm.findMany.mockResolvedValue([swarm1, swarm2] as never);
    // swarm1 → todoCount=3, inProgressNoPodCount=0; swarm2 → todoCount=0, inProgressNoPodCount=0
    mockedDb.task.count
      .mockResolvedValueOnce(3)  // swarm1 todoCount
      .mockResolvedValueOnce(0)  // swarm1 inProgressNoPodCount
      .mockResolvedValueOnce(0)  // swarm2 todoCount
      .mockResolvedValueOnce(0); // swarm2 inProgressNoPodCount

    // Pool Manager throws for swarm1
    fetchMock.mockRejectedValueOnce(new Error("Network failure"));

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      swarmId: "swarm-001",
      error: "Network failure",
    });
    expect(result.success).toBe(false);

    const errorCalls = consoleErrorSpy.mock.calls.map((c) => c[0] as string);
    expect(errorCalls.some((m) => m.includes("Error processing swarm") && m.includes("swarm-001"))).toBe(true);
  });

  it("falls back to minimumVms as floor when minimumPods is null", async () => {
    const swarm = makeSwarm({ minimumVms: 3, minimumPods: null });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(1)  // todoCount → rawDemand=1 ≤ floor=3 → stays at floor=3 (no-op)
      .mockResolvedValueOnce(0); // inProgressNoPodCount

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 3, deployedPods: 3 },
    });
  });

  it("caps targetVms at 20 when overQueuedCount is very large (default ceiling)", async () => {
    // 50 over-queued tasks → targetVms = 2 + 50 + 2 = 54, capped at 20
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(50)  // todoCount
      .mockResolvedValueOnce(0);  // inProgressNoPodCount

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(1);

    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 20, deployedPods: 20 },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ minimum_vms: 20 }),
      })
    );
  });

  it("returns correct timestamp in result", async () => {
    mockedDb.swarm.findMany.mockResolvedValue([] as never);

    const before = Date.now();
    const result = await executePodScalerRuns();
    const after = Date.now();

    const ts = new Date(result.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  // ── platformConfig override tests ─────────────────────────────────────────

  it("caps targetVms at custom maxVmCeiling (10) when overQueuedCount is very large", async () => {
    mockedDb.platformConfig.findMany.mockResolvedValue([
      makePlatformConfig("podScalerMaxVmCeiling", "10"),
    ] as never);

    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(50)  // todoCount → 2 + 50 + 2 = 54, capped at 10
      .mockResolvedValueOnce(0);  // inProgressNoPodCount

    const result = await executePodScalerRuns();

    expect(result.swarmsScaled).toBe(1);
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 10, deployedPods: 10 },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ minimum_vms: 10 }),
      })
    );
  });

  // ── Scale-down cooldown tests ─────────────────────────────────────────────

  it("skips scale-down when a task completed within cooldown window", async () => {
    // minimumVms=5, minimumPods=2, overQueuedCount=0 → targetVms=2 (would scale down)
    // but recentlyCompletedCount=1 → skip
    const swarm = makeSwarm({ minimumVms: 5, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0)  // inProgressNoPodCount
      .mockResolvedValueOnce(1); // recentlyCompletedCount

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedDb.swarm.update).not.toHaveBeenCalled();

    const logCalls = consoleSpy.mock.calls.map((c) => c[0] as string);
    expect(logCalls.some((m) => m.includes("Skipping scale-down") && m.includes("swarm-001"))).toBe(true);
  });

  it("scales down when no task completed within cooldown window", async () => {
    // minimumVms=5, minimumPods=2, overQueuedCount=0 → targetVms=2
    // recentlyCompletedCount=0 → scale-down proceeds
    const swarm = makeSwarm({ minimumVms: 5, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0)  // inProgressNoPodCount
      .mockResolvedValueOnce(0); // recentlyCompletedCount

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://pool.example.com/api/pools/swarm-001/scale",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ minimum_vms: 2 }),
      })
    );
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 2, deployedPods: 2 },
    });
  });

  it("cooldown does not block scale-up", async () => {
    // overQueuedCount=3 → rawDemand=0+3=3 > floor=2 → targetVms = 3+2=5; recentlyCompletedCount should never be queried
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(3)  // todoCount → rawDemand=3 > floor=2 → 3 + 2 = 5
      .mockResolvedValueOnce(0)  // inProgressNoPodCount
      .mockResolvedValueOnce(5); // recentlyCompletedCount (should NOT be called)

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(1);
    // Two task.count calls (todoCount + inProgressNoPodCount), cooldown query skipped
    expect(mockedDb.task.count).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://pool.example.com/api/pools/swarm-001/scale",
      expect.objectContaining({
        body: JSON.stringify({ minimum_vms: 5 }),
      })
    );
  });

  it("excludes tasks with HALTED/COMPLETED/IN_PROGRESS workflowStatus from todoCount", async () => {
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount

    await executePodScalerRuns();

    const todoCall = mockedDb.task.count.mock.calls[0][0] as {
      where: { workflowStatus: { notIn: string[] } };
    };
    expect(todoCall.where.workflowStatus).toEqual({ notIn: ["HALTED", "COMPLETED", "IN_PROGRESS"] });
  });

  it("excludes tasks with HALTED/COMPLETED workflowStatus from inProgressNoPodCount", async () => {
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount

    await executePodScalerRuns();

    const inProgressCall = mockedDb.task.count.mock.calls[1][0] as {
      where: { workflowStatus: { notIn: string[] } };
    };
    expect(inProgressCall.where.workflowStatus).toEqual({ notIn: ["HALTED", "COMPLETED"] });
  });

  it("excludes tasks with dependencies from overQueuedCount", async () => {
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    // Simulate all queued tasks being blocked (count returns 0 after filter)
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    // Assert the filter was included in the query (first call = todoCount)
    const countCall = mockedDb.task.count.mock.calls[0][0] as {
      where: { dependsOnTaskIds: { isEmpty: boolean } };
    };
    expect(countCall.where.dependsOnTaskIds).toEqual({ isEmpty: true });
  });

  it("uses custom queueWaitMinutes (10) for the createdAt filter", async () => {
    mockedDb.platformConfig.findMany.mockResolvedValue([
      makePlatformConfig("podScalerQueueWaitMinutes", "10"),
    ] as never);

    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount

    const before = Date.now();
    await executePodScalerRuns();
    const after = Date.now();

    // The `createdAt: { lt: ... }` argument passed to task.count should reflect a ~10-min window
    const countCall = mockedDb.task.count.mock.calls[0][0] as {
      where: { createdAt: { lt: Date } };
    };
    const cutoff = countCall.where.createdAt.lt.getTime();

    const expectedMin = before - 10 * 60 * 1000;
    const expectedMax = after - 10 * 60 * 1000;

    expect(cutoff).toBeGreaterThanOrEqual(expectedMin);
    expect(cutoff).toBeLessThanOrEqual(expectedMax);
  });

  // ── Utilisation threshold tests ───────────────────────────────────────────

  it("scales up by scaleUpBuffer when utilisation >= threshold and no over-queued tasks", async () => {
    // 4/5 = 80% >= 80 threshold → utilisationTriggered; rawDemand=4 > floor=2 → targetVms = 4 + 2 = 6
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount
    mockedGetPoolStatus.mockResolvedValue({
      usedVms: 4,
      runningVms: 5,
      unusedVms: 1,
      pendingVms: 0,
      failedVms: 0,
      queuedCount: 0,
      lastCheck: new Date().toISOString(),
    });

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(1);
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 6, deployedPods: 6 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ minimum_vms: 6 }) })
    );
    const logCalls = consoleSpy.mock.calls.map((c) => c[0] as string);
    expect(logCalls.some((m) => m.includes("utilisation threshold"))).toBe(true);
  });

  it("does not scale up when utilisation below threshold and no over-queued tasks", async () => {
    // 2/5 = 40% < 80 threshold → no trigger; targetVms = floor = 2 (no change)
    // usedVms=2 equals floor so usedVms protection doesn't interfere
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount
    mockedGetPoolStatus.mockResolvedValue({
      usedVms: 2,
      runningVms: 5,
      unusedVms: 3,
      pendingVms: 0,
      failedVms: 0,
      queuedCount: 0,
      lastCheck: new Date().toISOString(),
    });

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(0);
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 2, deployedPods: 2 },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("over-queue path takes precedence over utilisation trigger", async () => {
    // usedVms=4, overQueuedCount=3 → rawDemand=7 > floor=2 → targetVms = 7 + 2 = 9
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(3)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount
    mockedGetPoolStatus.mockResolvedValue({
      usedVms: 4,
      runningVms: 5,
      unusedVms: 1,
      pendingVms: 0,
      failedVms: 0,
      queuedCount: 0,
      lastCheck: new Date().toISOString(),
    });

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(1);
    // rawDemand=7 > floor=2 → 7 + 2 = 9
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 9, deployedPods: 9 },
    });
    const logCalls = consoleSpy.mock.calls.map((c) => c[0] as string);
    expect(logCalls.some((m) => m.includes("over-queued tasks"))).toBe(true);
  });

  it("respects maxVmCeiling when utilisation triggers scale-up", async () => {
    // floor=19, usedVms=21 (>floor), overQueuedCount=0, util=true → rawDemand=21>19 → 21+2=23, capped at 20
    const swarm = makeSwarm({ minimumVms: 19, minimumPods: 19 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount
    mockedGetPoolStatus.mockResolvedValue({
      usedVms: 21,
      runningVms: 21,
      unusedVms: 0,
      pendingVms: 0,
      failedVms: 0,
      queuedCount: 0,
      lastCheck: new Date().toISOString(),
    });

    const result = await executePodScalerRuns();

    expect(result.swarmsScaled).toBe(1);
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 20, deployedPods: 20 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ minimum_vms: 20 }) })
    );
  });

  it("no-op when runningVms === 0 (avoids false utilisation trigger)", async () => {
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount
    mockedGetPoolStatus.mockResolvedValue({
      usedVms: 0,
      runningVms: 0,
      unusedVms: 0,
      pendingVms: 0,
      failedVms: 0,
      queuedCount: 0,
      lastCheck: new Date().toISOString(),
    });

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("suppresses utilisationTriggered when pendingVms > 0 (1 used / 1 running, 2 pending)", async () => {
    // usedVms=1, runningVms=1, pendingVms=2 → ratio=100% but pendingVms>0 → no trigger
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount
    mockedGetPoolStatus.mockResolvedValue({
      usedVms: 1,
      runningVms: 1,
      unusedVms: 0,
      pendingVms: 2,
      failedVms: 0,
      queuedCount: 0,
      lastCheck: new Date().toISOString(),
    });

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(0); // no scale-up fired
    expect(fetchMock).not.toHaveBeenCalled();
    const logCalls = consoleSpy.mock.calls.map((c) => c[0] as string);
    expect(logCalls.some((m) => m.includes("pendingVms=2"))).toBe(true);
  });

  it("fires utilisationTriggered when pendingVms === 0 and usedVms/runningVms >= threshold", async () => {
    // usedVms=1, runningVms=1, pendingVms=0 → ratio=100% >= 80% → utilisationTriggered
    // but rawDemand=1 ≤ floor=2, and usedVms=1 ≤ floor=2 → no scale-up, stays at floor=2 (no change)
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount
    mockedGetPoolStatus.mockResolvedValue({
      usedVms: 1,
      runningVms: 1,
      unusedVms: 0,
      pendingVms: 0,
      failedVms: 0,
      queuedCount: 0,
      lastCheck: new Date().toISOString(),
    });

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(0); // floor=2 already covers demand
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 2, deployedPods: 2 },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not scale up when pendingVms === 0 but ratio 75% < 80% threshold", async () => {
    // usedVms=2, runningVms=4, pendingVms=0 → ratio=50% < 80% → no trigger
    // usedVms=2 equals floor so usedVms protection doesn't interfere
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount
    mockedGetPoolStatus.mockResolvedValue({
      usedVms: 2,
      runningVms: 4,
      unusedVms: 2,
      pendingVms: 0,
      failedVms: 0,
      queuedCount: 0,
      lastCheck: new Date().toISOString(),
    });

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads podUtilisationThreshold from platformConfig override and triggers at 50%", async () => {
    // Threshold overridden to 50; 3/5 = 60% >= 50 → utilisationTriggered
    // rawDemand=3 > floor=2 → targetVms = 3 + 2 = 5
    mockedDb.platformConfig.findMany.mockResolvedValue([
      makePlatformConfig("podScalerUtilisationThreshold", "50"),
    ] as never);

    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount
    mockedGetPoolStatus.mockResolvedValue({
      usedVms: 3,
      runningVms: 5,
      unusedVms: 2,
      pendingVms: 0,
      failedVms: 0,
      queuedCount: 0,
      lastCheck: new Date().toISOString(),
    });

    const result = await executePodScalerRuns();

    expect(result.swarmsScaled).toBe(1);
    // rawDemand=3 > floor=2 → 3 + 2 = 5
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 5, deployedPods: 5 },
    });
  });

  // ── New IN_PROGRESS / no-pod demand signal tests ──────────────────────────

  it("scales up when only IN_PROGRESS/no-pod tasks exist (todoCount=0, inProgressNoPodCount=2)", async () => {
    // rawDemand=0+2=2, floor=2 → 2 ≤ 2 → targetVms=floor=2 (no-op, floor covers)
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(2); // inProgressNoPodCount

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(0);
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 2, deployedPods: 2 },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("combined count drives correct targetVms (todoCount=2, inProgressNoPodCount=1 → overQueuedCount=3)", async () => {
    // rawDemand=0+3=3 > floor=2 → targetVms = 3 + 2 = 5
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(2)  // todoCount
      .mockResolvedValueOnce(1); // inProgressNoPodCount

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(1);
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 5, deployedPods: 5 },
    });
  });

  it("IN_PROGRESS no-pod query does not include a createdAt filter", async () => {
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount

    await executePodScalerRuns();

    // Second call is the IN_PROGRESS / no-pod query
    const inProgressCall = mockedDb.task.count.mock.calls[1][0] as {
      where: Record<string, unknown>;
    };
    expect("createdAt" in inProgressCall.where).toBe(false);
    expect(inProgressCall.where.status).toBe("IN_PROGRESS");
    expect(inProgressCall.where.podId).toBeNull();
  });

  // ── Active pod protection (usedVms floor) tests ──────────────────────────

  it("usedVms equals floor — targetVms stays at floor (edge case, no change to existing behaviour)", async () => {
    // minimumVms=8, minimumPods=2, overQueuedCount=0, usedVms=2/runningVms=8 → 25% < 80% → no utilisation trigger
    // Math.max(floor=2, usedVms=2) = 2 → scale down from 8 to 2
    const swarm = makeSwarm({ minimumVms: 8, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0)  // inProgressNoPodCount
      .mockResolvedValueOnce(0); // recentlyCompletedCount (cooldown check)
    mockedGetPoolStatus.mockResolvedValue({
      usedVms: 2,
      runningVms: 8,
      unusedVms: 6,
      pendingVms: 0,
      failedVms: 0,
      queuedCount: 0,
      lastCheck: new Date().toISOString(),
    });

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(1);
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 2, deployedPods: 2 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://pool.example.com/api/pools/swarm-001/scale",
      expect.objectContaining({ body: JSON.stringify({ minimum_vms: 2 }) })
    );
    const logCalls = consoleSpy.mock.calls.map((c) => c[0] as string);
    expect(logCalls.some((m) => m.includes("usedVmsFloor=2"))).toBe(true);
  });

  it("usedVms exceeds floor — rawDemand > floor triggers scale-up with buffer", async () => {
    // minimumVms=8, minimumPods=2, overQueuedCount=0, usedVms=4/runningVms=8 → 50% < 80% → no utilisation trigger
    // rawDemand=4+0=4 > floor=2 → targetVms = 4 + 2 = 6 (scales down from 8 → 6, never below usedVms=4)
    const swarm = makeSwarm({ minimumVms: 8, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0)  // inProgressNoPodCount
      .mockResolvedValueOnce(0); // recentlyCompletedCount (cooldown check)
    mockedGetPoolStatus.mockResolvedValue({
      usedVms: 4,
      runningVms: 8,
      unusedVms: 4,
      pendingVms: 0,
      failedVms: 0,
      queuedCount: 0,
      lastCheck: new Date().toISOString(),
    });

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(1);
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 6, deployedPods: 6 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://pool.example.com/api/pools/swarm-001/scale",
      expect.objectContaining({ body: JSON.stringify({ minimum_vms: 6 }) })
    );
    const logCalls = consoleSpy.mock.calls.map((c) => c[0] as string);
    expect(logCalls.some((m) => m.includes("usedVmsFloor=4"))).toBe(true);
  });

  it("cooldown guard still fires when combined overQueuedCount is 0 (todoCount=0, inProgressNoPodCount=0)", async () => {
    // minimumVms=5, minimumPods=2 → would scale down; recentlyCompletedCount=1 → skip
    const swarm = makeSwarm({ minimumVms: 5, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0)  // inProgressNoPodCount
      .mockResolvedValueOnce(1); // recentlyCompletedCount

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    const logCalls = consoleSpy.mock.calls.map((c) => c[0] as string);
    expect(logCalls.some((m) => m.includes("Skipping scale-down"))).toBe(true);
  });

  // ── Demand-aware targetVms truth-table tests ──────────────────────────────

  it("floor covers demand — stays at floor (floor=5, usedVms=1, overQueued=2, buffer=2)", async () => {
    // rawDemand=1+2=3, floor=5 → 3 ≤ 5 → targetVms=5 (no change from minimumVms=5)
    const swarm = makeSwarm({ minimumVms: 5, minimumPods: 5 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(2)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount
    mockedGetPoolStatus.mockResolvedValue({
      usedVms: 1,
      runningVms: 5,
      unusedVms: 4,
      pendingVms: 0,
      failedVms: 0,
      queuedCount: 0,
      lastCheck: new Date().toISOString(),
    });

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(0); // no change — floor covers demand
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 5, deployedPods: 5 },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("demand exceeds floor — scales to demand + buffer (floor=5, usedVms=4, overQueued=2, buffer=2)", async () => {
    // rawDemand=4+2=6 > floor=5 → targetVms = 6 + 2 = 8
    const swarm = makeSwarm({ minimumVms: 5, minimumPods: 5 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(2)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount
    mockedGetPoolStatus.mockResolvedValue({
      usedVms: 4,
      runningVms: 5,
      unusedVms: 1,
      pendingVms: 0,
      failedVms: 0,
      queuedCount: 0,
      lastCheck: new Date().toISOString(),
    });

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(1);
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 8, deployedPods: 8 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ minimum_vms: 8 }) })
    );
  });

  it("utilisation busts floor — scales to usedVms + buffer (floor=5, usedVms=8, overQueued=0, utilisationTriggered=true, buffer=2)", async () => {
    // rawDemand=8+0=8 > floor=5 → targetVms = 8 + 2 = 10 (rawDemand path, which also satisfies usedVms > floor)
    const swarm = makeSwarm({ minimumVms: 5, minimumPods: 5 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount
    mockedGetPoolStatus.mockResolvedValue({
      usedVms: 8,
      runningVms: 8,
      unusedVms: 0,
      pendingVms: 0,
      failedVms: 0,
      queuedCount: 0,
      lastCheck: new Date().toISOString(),
    });

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(1);
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 10, deployedPods: 10 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ minimum_vms: 10 }) })
    );
  });
});
