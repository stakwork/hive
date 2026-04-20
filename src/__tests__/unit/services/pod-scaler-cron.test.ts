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
      .mockResolvedValueOnce(3)  // todoCount → 3 over-queued → targetVms = 2 + 3 + 2 = 7
      .mockResolvedValueOnce(0); // inProgressNoPodCount

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(result.success).toBe(true);

    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 7, deployedPods: 7 },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://pool.example.com/api/pools/swarm-001/scale",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ minimum_vms: 7 }),
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
      .mockResolvedValueOnce(1)  // todoCount → 1 over-queued → targetVms = 3 + 1 + 2 = 6
      .mockResolvedValueOnce(0); // inProgressNoPodCount

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(1);
    expect(fetchMock).toHaveBeenCalled();

    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 6, deployedPods: 6 },
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
    // overQueuedCount=3 → scale-up; recentlyCompletedCount should never be queried
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(3)  // todoCount → targetVms = 2+3+2=7
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
        body: JSON.stringify({ minimum_vms: 7 }),
      })
    );
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
    // 4/5 = 80% >= 80 threshold → utilisationTriggered; targetVms = floor(2) + scaleUpBuffer(2) = 4
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
      data: { minimumVms: 4, deployedPods: 4 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ minimum_vms: 4 }) })
    );
    const logCalls = consoleSpy.mock.calls.map((c) => c[0] as string);
    expect(logCalls.some((m) => m.includes("utilisation threshold"))).toBe(true);
  });

  it("does not scale up when utilisation below threshold and no over-queued tasks", async () => {
    // 3/5 = 60% < 80 threshold → no trigger; targetVms = floor = 2 (no change)
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

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(0);
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 2, deployedPods: 2 },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("over-queue path takes precedence over utilisation trigger", async () => {
    // overQueuedCount=3 → targetVms = 2+3+2 = 7; utilisation also triggered but over-queue wins
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
    // over-queue: 2 + 3 + 2 = 7 vs utilisation: 2 + 2 = 4 → 7 wins
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 7, deployedPods: 7 },
    });
    const logCalls = consoleSpy.mock.calls.map((c) => c[0] as string);
    expect(logCalls.some((m) => m.includes("over-queued tasks"))).toBe(true);
  });

  it("respects maxVmCeiling when utilisation triggers scale-up", async () => {
    // floor=19, scaleUpBuffer=2 → 19+2=21, capped at 20
    const swarm = makeSwarm({ minimumVms: 19, minimumPods: 19 });
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
    // usedVms=1, runningVms=1, pendingVms=0 → ratio=100% >= 80% → scale-up
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
    expect(result.swarmsScaled).toBe(1);
    // floor(2) + scaleUpBuffer(2) = 4
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 4, deployedPods: 4 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ minimum_vms: 4 }) })
    );
  });

  it("does not scale up when pendingVms === 0 but ratio 75% < 80% threshold", async () => {
    // usedVms=3, runningVms=4, pendingVms=0 → ratio=75% < 80% → no trigger
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(0); // inProgressNoPodCount
    mockedGetPoolStatus.mockResolvedValue({
      usedVms: 3,
      runningVms: 4,
      unusedVms: 1,
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
    // Threshold overridden to 50; 3/5 = 60% >= 50 → trigger
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
    // floor(2) + scaleUpBuffer(2) = 4
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 4, deployedPods: 4 },
    });
  });

  // ── New IN_PROGRESS / no-pod demand signal tests ──────────────────────────

  it("scales up when only IN_PROGRESS/no-pod tasks exist (todoCount=0, inProgressNoPodCount=2)", async () => {
    // targetVms = floor(2) + 2 + scaleUpBuffer(2) = 6
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count
      .mockResolvedValueOnce(0)  // todoCount
      .mockResolvedValueOnce(2); // inProgressNoPodCount

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    expect(result.swarmsScaled).toBe(1);
    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 6, deployedPods: 6 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://pool.example.com/api/pools/swarm-001/scale",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ minimum_vms: 6 }),
      })
    );
  });

  it("combined count drives correct targetVms (todoCount=2, inProgressNoPodCount=1 → overQueuedCount=3)", async () => {
    // targetVms = floor(2) + 3 + scaleUpBuffer(2) = 7
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
      data: { minimumVms: 7, deployedPods: 7 },
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
});
