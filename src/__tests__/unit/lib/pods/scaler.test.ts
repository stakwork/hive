import { describe, it, expect, vi, beforeEach } from "vitest";

const { findMany, taskCount, findUnique } = vi.hoisted(() => ({
  findMany: vi.fn(),
  taskCount: vi.fn(),
  findUnique: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: { pod: { findMany }, task: { count: taskCount }, platformConfig: { findUnique } },
}));

import { getPodUsage, getPodScalerCeiling, getSwarmFloor } from "@/lib/pods/scaler";
import { POD_SCALER_MAX_VM_CEILING } from "@/lib/constants/pod-scaler";

describe("getPodScalerCeiling", () => {
  it.each([
    [null, POD_SCALER_MAX_VM_CEILING],
    [{ value: "8" }, 8],
    [{ value: "0" }, POD_SCALER_MAX_VM_CEILING],
    [{ value: "-3" }, POD_SCALER_MAX_VM_CEILING],
    [{ value: "abc" }, POD_SCALER_MAX_VM_CEILING],
    [{ value: "2.5" }, POD_SCALER_MAX_VM_CEILING],
  ])("%j -> %s", async (record, expected) => {
    findUnique.mockResolvedValue(record);
    expect(await getPodScalerCeiling()).toBe(expected);
  });
});

describe("getSwarmFloor", () => {
  it("prefers minimumPods, else minimumVms", () => {
    expect(getSwarmFloor({ minimumPods: 4, minimumVms: 2 })).toBe(4);
    expect(getSwarmFloor({ minimumPods: null, minimumVms: 3 })).toBe(3);
  });
});

describe("getPodUsage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aggregates pods and never queries tasks", async () => {
    const t1 = new Date("2026-01-01T00:00:00Z");
    const t2 = new Date("2026-02-01T00:00:00Z");
    findMany.mockResolvedValue([
      { status: "RUNNING", usageStatus: "USED", usageStatusMarkedAt: t1 },
      { status: "RUNNING", usageStatus: "UNUSED", usageStatusMarkedAt: t1 },
      { status: "RUNNING", usageStatus: "UNUSED", usageStatusMarkedAt: t2 },
      { status: "CREATING", usageStatus: "UNUSED", usageStatusMarkedAt: null },
      { status: "FAILED", usageStatus: "UNUSED", usageStatusMarkedAt: null },
    ]);
    const u = await getPodUsage("s1");
    expect(u).toEqual({
      usedVms: 1,
      runningVms: 4,
      pendingVms: 1,
      failedVms: 1,
      lastReleasedAt: t2.toISOString(),
    });
    expect(taskCount).not.toHaveBeenCalled();
    expect(findMany.mock.calls[0][0].where.deletedAt).toBeNull();
  });
});
