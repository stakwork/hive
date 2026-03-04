import { describe, it, expect, vi, beforeEach } from "vitest";
import { PodStatus, PodUsageStatus } from "@prisma/client";
import { getPoolStatusFromPods } from "@/lib/pods/status-queries";

vi.mock("@/lib/db", () => ({
  db: {
    pod: {
      findMany: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";

const mockFindMany = db.pod.findMany as ReturnType<typeof vi.fn>;

function makePod(
  status: PodStatus,
  usageStatus: PodUsageStatus,
  updatedAt = new Date()
) {
  return { status, usageStatus, updatedAt };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPoolStatusFromPods", () => {
  it("counts PENDING+USED pod in pendingVms only, not usedVms", async () => {
    mockFindMany.mockResolvedValue([
      makePod(PodStatus.PENDING, PodUsageStatus.USED),
    ]);

    const result = await getPoolStatusFromPods("swarm-1");

    expect(result.pendingVms).toBe(1);
    expect(result.usedVms).toBe(0);
    expect(result.runningVms).toBe(0);
    expect(result.unusedVms).toBe(0);
    expect(result.failedVms).toBe(0);
  });

  it("counts RUNNING+USED pod in both runningVms and usedVms", async () => {
    mockFindMany.mockResolvedValue([
      makePod(PodStatus.RUNNING, PodUsageStatus.USED),
    ]);

    const result = await getPoolStatusFromPods("swarm-1");

    expect(result.runningVms).toBe(1);
    expect(result.usedVms).toBe(1);
    expect(result.unusedVms).toBe(0);
    expect(result.pendingVms).toBe(0);
    expect(result.failedVms).toBe(0);
  });

  it("counts RUNNING+UNUSED pod in runningVms and unusedVms, not usedVms", async () => {
    mockFindMany.mockResolvedValue([
      makePod(PodStatus.RUNNING, PodUsageStatus.UNUSED),
    ]);

    const result = await getPoolStatusFromPods("swarm-1");

    expect(result.runningVms).toBe(1);
    expect(result.unusedVms).toBe(1);
    expect(result.usedVms).toBe(0);
    expect(result.pendingVms).toBe(0);
    expect(result.failedVms).toBe(0);
  });

  it("usedVms + unusedVms equals runningVms for a mixed pod set", async () => {
    mockFindMany.mockResolvedValue([
      makePod(PodStatus.RUNNING, PodUsageStatus.USED),
      makePod(PodStatus.RUNNING, PodUsageStatus.USED),
      makePod(PodStatus.RUNNING, PodUsageStatus.UNUSED),
      makePod(PodStatus.PENDING, PodUsageStatus.USED), // should NOT inflate usedVms
      makePod(PodStatus.FAILED, PodUsageStatus.UNUSED),
    ]);

    const result = await getPoolStatusFromPods("swarm-1");

    expect(result.runningVms).toBe(3);
    expect(result.usedVms).toBe(2);
    expect(result.unusedVms).toBe(1);
    expect(result.usedVms + result.unusedVms).toBe(result.runningVms);
    expect(result.pendingVms).toBe(1);
    expect(result.failedVms).toBe(1);
  });
});
