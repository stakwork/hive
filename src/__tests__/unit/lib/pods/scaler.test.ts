import { describe, it, expect, vi, beforeEach } from "vitest";

const { findMany, taskCount } = vi.hoisted(() => ({ findMany: vi.fn(), taskCount: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { pod: { findMany }, task: { count: taskCount } } }));

import { getPodUsage } from "@/lib/pods/scaler";

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
