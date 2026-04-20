import { describe, it, expect, vi, beforeEach } from "vitest";
import { PodStatus, PodUsageStatus } from "@prisma/client";

// Mock db before importing the module under test
vi.mock("@/lib/db", () => ({
  db: {
    pod: {
      findMany: vi.fn(),
    },
    task: {
      count: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import { getPoolStatusFromPods } from "@/lib/pods/status-queries";

const mockPodFindMany = vi.mocked(db.pod.findMany);
const mockTaskCount = vi.mocked(db.task.count);

const SWARM_ID = "swarm-test-123";
const WORKSPACE_ID = "workspace-test-456";

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
  describe("queuedCount", () => {
    it("returns queuedCount of 0 when no TASK_COORDINATOR TODO tasks exist", async () => {
      mockPodFindMany.mockResolvedValue([]);
      mockTaskCount.mockResolvedValue(0);

      const result = await getPoolStatusFromPods(SWARM_ID, WORKSPACE_ID);

      expect(result.queuedCount).toBe(0);
      expect(mockTaskCount).toHaveBeenCalledWith({
        where: {
          AND: [
            { workspaceId: WORKSPACE_ID },
            { deleted: false },
            { archived: false },
            { status: "TODO" },
            { systemAssigneeType: "TASK_COORDINATOR" },
            { sourceType: { not: "USER_JOURNEY" } },
            { OR: [{ featureId: null }, { feature: { status: { not: "CANCELLED" } } }] },
          ],
        },
      });
    });

    it("returns correct queuedCount when TASK_COORDINATOR TODO tasks exist", async () => {
      mockPodFindMany.mockResolvedValue([]);
      mockTaskCount.mockResolvedValue(5);

      const result = await getPoolStatusFromPods(SWARM_ID, WORKSPACE_ID);

      expect(result.queuedCount).toBe(5);
    });
  });

  describe("ws-pool-* filtering", () => {
    it("passes podId: { not: { startsWith: 'ws-pool-' } } filter in the where clause", async () => {
      mockPodFindMany.mockResolvedValue([]);
      mockTaskCount.mockResolvedValue(0);

      await getPoolStatusFromPods(SWARM_ID, WORKSPACE_ID);

      expect(mockPodFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            podId: { not: { startsWith: "ws-pool-" } },
          }),
        })
      );
    });

    it("excludes ws-pool-* pods from counts when the DB filter is present", async () => {
      // The actual DB filter excludes ws-pool-* pods before returning results.
      // Here we simulate the filtered result (only the regular pod is returned)
      // and verify counts reflect only that pod.
      mockPodFindMany.mockResolvedValue([
        makePod(PodStatus.RUNNING, PodUsageStatus.UNUSED),
      ] as any);
      mockTaskCount.mockResolvedValue(0);

      const result = await getPoolStatusFromPods(SWARM_ID, WORKSPACE_ID);

      expect(result.runningVms).toBe(1);
      expect(result.unusedVms).toBe(1);
      expect(result.usedVms).toBe(0);
    });
  });

  describe("pod aggregation", () => {
    it("counts PENDING+USED pod in pendingVms only, not usedVms; runningVms includes pendingVms", async () => {
      mockPodFindMany.mockResolvedValue([
        makePod(PodStatus.PENDING, PodUsageStatus.USED),
      ] as any);
      mockTaskCount.mockResolvedValue(0);

      const result = await getPoolStatusFromPods(SWARM_ID, WORKSPACE_ID);

      expect(result.pendingVms).toBe(1);
      expect(result.usedVms).toBe(0);
      expect(result.runningVms).toBe(1); // 0 RUNNING + 1 PENDING
      expect(result.unusedVms).toBe(0);
      expect(result.failedVms).toBe(0);
    });

    it("counts RUNNING+USED pod in both runningVms and usedVms", async () => {
      mockPodFindMany.mockResolvedValue([
        makePod(PodStatus.RUNNING, PodUsageStatus.USED),
      ] as any);
      mockTaskCount.mockResolvedValue(0);

      const result = await getPoolStatusFromPods(SWARM_ID, WORKSPACE_ID);

      expect(result.runningVms).toBe(1);
      expect(result.usedVms).toBe(1);
      expect(result.unusedVms).toBe(0);
      expect(result.pendingVms).toBe(0);
      expect(result.failedVms).toBe(0);
    });

    it("counts RUNNING+UNUSED pod in runningVms and unusedVms, not usedVms", async () => {
      mockPodFindMany.mockResolvedValue([
        makePod(PodStatus.RUNNING, PodUsageStatus.UNUSED),
      ] as any);
      mockTaskCount.mockResolvedValue(0);

      const result = await getPoolStatusFromPods(SWARM_ID, WORKSPACE_ID);

      expect(result.runningVms).toBe(1);
      expect(result.unusedVms).toBe(1);
      expect(result.usedVms).toBe(0);
      expect(result.pendingVms).toBe(0);
      expect(result.failedVms).toBe(0);
    });

    it("usedVms + unusedVms equals RUNNING-only count; runningVms includes pendingVms for a mixed pod set", async () => {
      mockPodFindMany.mockResolvedValue([
        makePod(PodStatus.RUNNING, PodUsageStatus.USED),
        makePod(PodStatus.RUNNING, PodUsageStatus.USED),
        makePod(PodStatus.RUNNING, PodUsageStatus.UNUSED),
        makePod(PodStatus.PENDING, PodUsageStatus.USED), // should NOT inflate usedVms
        makePod(PodStatus.FAILED, PodUsageStatus.UNUSED),
      ] as any);
      mockTaskCount.mockResolvedValue(0);

      const result = await getPoolStatusFromPods(SWARM_ID, WORKSPACE_ID);

      expect(result.runningVms).toBe(4); // 3 RUNNING + 1 PENDING
      expect(result.usedVms).toBe(2);
      expect(result.unusedVms).toBe(1);
      expect(result.pendingVms).toBe(1);
      expect(result.failedVms).toBe(1);
    });

    it("counts running, pending, and failed pods correctly; runningVms includes pending", async () => {
      const now = new Date();
      mockPodFindMany.mockResolvedValue([
        { status: PodStatus.RUNNING, usageStatus: PodUsageStatus.UNUSED, updatedAt: now },
        { status: PodStatus.RUNNING, usageStatus: PodUsageStatus.USED, updatedAt: now },
        { status: PodStatus.PENDING, usageStatus: PodUsageStatus.UNUSED, updatedAt: now },
        { status: PodStatus.FAILED, usageStatus: PodUsageStatus.UNUSED, updatedAt: now },
      ] as any);
      mockTaskCount.mockResolvedValue(3);

      const result = await getPoolStatusFromPods(SWARM_ID, WORKSPACE_ID);

      expect(result.runningVms).toBe(3); // 2 RUNNING + 1 PENDING
      expect(result.pendingVms).toBe(1);
      expect(result.failedVms).toBe(1);
      expect(result.usedVms).toBe(1);
      expect(result.unusedVms).toBe(1);
      expect(result.queuedCount).toBe(3);
    });

    it("includes STARTING pods in runningVms denominator alongside RUNNING pods", async () => {
      const now = new Date();
      mockPodFindMany.mockResolvedValue([
        { status: PodStatus.RUNNING, usageStatus: PodUsageStatus.USED, updatedAt: now },
        { status: PodStatus.STARTING, usageStatus: PodUsageStatus.UNUSED, updatedAt: now },
        { status: PodStatus.STARTING, usageStatus: PodUsageStatus.UNUSED, updatedAt: now },
      ] as any);
      mockTaskCount.mockResolvedValue(0);

      const result = await getPoolStatusFromPods(SWARM_ID, WORKSPACE_ID);

      expect(result.runningVms).toBe(3); // 1 RUNNING + 2 STARTING
      expect(result.usedVms).toBe(1);
      expect(result.pendingVms).toBe(2);
      expect(result.unusedVms).toBe(0);
    });

    it("counts only RUNNING pods as unusedVms (not PENDING + UNUSED)", async () => {
      const now = new Date();
      mockPodFindMany.mockResolvedValue([
        { status: PodStatus.PENDING, usageStatus: PodUsageStatus.UNUSED, updatedAt: now },
        { status: PodStatus.STARTING, usageStatus: PodUsageStatus.UNUSED, updatedAt: now },
      ] as any);
      mockTaskCount.mockResolvedValue(0);

      const result = await getPoolStatusFromPods(SWARM_ID, WORKSPACE_ID);

      expect(result.unusedVms).toBe(0);
      expect(result.pendingVms).toBe(2);
    });

    it("returns lastCheck as current time when no pods exist", async () => {
      mockPodFindMany.mockResolvedValue([]);
      mockTaskCount.mockResolvedValue(0);

      const before = Date.now();
      const result = await getPoolStatusFromPods(SWARM_ID, WORKSPACE_ID);
      const after = Date.now();

      const lastCheckTime = new Date(result.lastCheck).getTime();
      expect(lastCheckTime).toBeGreaterThanOrEqual(before);
      expect(lastCheckTime).toBeLessThanOrEqual(after);
    });
  });
});
