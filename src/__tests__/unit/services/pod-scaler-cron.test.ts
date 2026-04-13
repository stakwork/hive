import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    swarm: { findMany: vi.fn(), update: vi.fn() },
    task: { count: vi.fn() },
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

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { db } from "@/lib/db";
import { executePodScalerRuns } from "@/services/pod-scaler-cron";

// ── Helpers ────────────────────────────────────────────────────────────────

const mockedDb = vi.mocked(db);

let fetchMock: ReturnType<typeof vi.fn>;

let consoleSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
  global.fetch = fetchMock;
  mockedDb.swarm.update.mockResolvedValue({} as never);
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

// ── Tests ──────────────────────────────────────────────────────────────────

describe("executePodScalerRuns", () => {
  it("scales up when over-queued tasks exist", async () => {
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count.mockResolvedValue(3); // 3 over-queued → targetVms = max(2, 5) = 5

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
    expect(logCalls.some((m) => m.includes("Scaling UP") && m.includes("swarm-001"))).toBe(true);
  });

  it("scales down to minimumPods when no over-queued tasks and minimumVms differs", async () => {
    const swarm = makeSwarm({ minimumVms: 5, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count.mockResolvedValue(0); // no over-queued → targetVms = minimumPods = 2

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
    expect(logCalls.some((m) => m.includes("Scaling DOWN") && m.includes("swarm-001"))).toBe(true);
  });

  it("no-op: updates deployedPods in DB but skips Pool Manager when targetVms equals minimumVms", async () => {
    // minimumVms=2, minimumPods=2, 0 over-queued → targetVms=2 (no change)
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count.mockResolvedValue(0);

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
    // swarm1 → 3 over-queued (will trigger scale), swarm2 → 0 over-queued (no-op)
    mockedDb.task.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(0);

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
    mockedDb.task.count.mockResolvedValue(1); // 1 over-queued → targetVms = max(3, 3) = 3

    const result = await executePodScalerRuns();

    expect(result.swarmsProcessed).toBe(1);
    // targetVms (3) === minimumVms (3) → no scale, no Pool Manager call
    expect(result.swarmsScaled).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    expect(mockedDb.swarm.update).toHaveBeenCalledWith({
      where: { id: "swarm-001" },
      data: { minimumVms: 3, deployedPods: 3 },
    });
  });

  it("caps targetVms at 20 when overQueuedCount is very large", async () => {
    // 50 over-queued tasks would normally give targetVms = max(2, 52) = 52; must be capped at 20
    const swarm = makeSwarm({ minimumVms: 2, minimumPods: 2 });
    mockedDb.swarm.findMany.mockResolvedValue([swarm] as never);
    mockedDb.task.count.mockResolvedValue(50);

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
});
