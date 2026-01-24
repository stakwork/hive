import { describe, it, expect, beforeEach, vi } from "vitest";
import { PodStatus, PodUsageStatus } from "@prisma/client";
import {
  findActivePods,
  findUnusedPods,
  findUsedPods,
  findClaimablePods,
  softDeletePod,
  findDeletedPods,
} from "@/lib/pods/queries";
import { dbMock, resetDbMock } from "@/__tests__/support/mocks/prisma";

describe("Pod Query Helpers", () => {
  const testSwarmId = "test-swarm-123";
  const testPodId = "test-pod-123";

  beforeEach(() => {
    resetDbMock();
  });

  describe("findActivePods", () => {
    it("should query pods with swarmId filter", async () => {
      const mockPods = [
        {
          id: "pod-1",
          podId: "workspace-1",
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          deletedAt: null,
        },
        {
          id: "pod-2",
          podId: "workspace-2",
          swarmId: testSwarmId,
          status: PodStatus.PENDING,
          usageStatus: PodUsageStatus.UNUSED,
          deletedAt: null,
        },
      ];

      dbMock.pod.findMany.mockResolvedValue(mockPods);

      const result = await findActivePods(testSwarmId);

      expect(dbMock.pod.findMany).toHaveBeenCalledWith({
        where: { swarmId: testSwarmId },
        orderBy: { id: "asc" },
      });
      expect(result).toEqual(mockPods);
      expect(result).toHaveLength(2);
    });

    it("should return empty array when no pods exist", async () => {
      dbMock.pod.findMany.mockResolvedValue([]);

      const result = await findActivePods(testSwarmId);

      expect(result).toEqual([]);
    });

    it("should rely on middleware to filter deleted pods", async () => {
      // Middleware automatically adds deletedAt: null
      const mockPods = [
        {
          id: "pod-1",
          podId: "workspace-1",
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          deletedAt: null,
        },
      ];

      dbMock.pod.findMany.mockResolvedValue(mockPods);

      const result = await findActivePods(testSwarmId);

      // Query doesn't explicitly add deletedAt filter - middleware handles it
      expect(dbMock.pod.findMany).toHaveBeenCalledWith({
        where: { swarmId: testSwarmId },
        orderBy: { id: "asc" },
      });
      expect(result.every((pod) => pod.deletedAt === null)).toBe(true);
    });
  });

  describe("findUnusedPods", () => {
    it("should query pods with UNUSED usage status", async () => {
      const mockPods = [
        {
          id: "pod-1",
          podId: "workspace-1",
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          deletedAt: null,
        },
      ];

      dbMock.pod.findMany.mockResolvedValue(mockPods);

      const result = await findUnusedPods(testSwarmId);

      expect(dbMock.pod.findMany).toHaveBeenCalledWith({
        where: {
          swarmId: testSwarmId,
          usageStatus: PodUsageStatus.UNUSED,
        },
        orderBy: { id: "asc" },
      });
      expect(result).toEqual(mockPods);
      expect(result.every((pod) => pod.usageStatus === PodUsageStatus.UNUSED)).toBe(true);
    });

    it("should return empty array when no unused pods exist", async () => {
      dbMock.pod.findMany.mockResolvedValue([]);

      const result = await findUnusedPods(testSwarmId);

      expect(result).toEqual([]);
    });
  });

  describe("findUsedPods", () => {
    it("should query pods with USED usage status", async () => {
      const mockPods = [
        {
          id: "pod-1",
          podId: "workspace-1",
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.USED,
          deletedAt: null,
        },
      ];

      dbMock.pod.findMany.mockResolvedValue(mockPods);

      const result = await findUsedPods(testSwarmId);

      expect(dbMock.pod.findMany).toHaveBeenCalledWith({
        where: {
          swarmId: testSwarmId,
          usageStatus: PodUsageStatus.USED,
        },
        orderBy: { id: "asc" },
      });
      expect(result).toEqual(mockPods);
      expect(result.every((pod) => pod.usageStatus === PodUsageStatus.USED)).toBe(true);
    });
  });

  describe("findClaimablePods", () => {
    it("should query pods with RUNNING status only", async () => {
      const mockPods = [
        {
          id: "pod-1",
          podId: "workspace-1",
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          deletedAt: null,
        },
        {
          id: "pod-2",
          podId: "workspace-2",
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.USED,
          deletedAt: null,
        },
      ];

      dbMock.pod.findMany.mockResolvedValue(mockPods);

      const result = await findClaimablePods(testSwarmId);

      expect(dbMock.pod.findMany).toHaveBeenCalledWith({
        where: {
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
        },
        orderBy: { id: "asc" },
      });
      expect(result).toEqual(mockPods);
      expect(result.every((pod) => pod.status === PodStatus.RUNNING)).toBe(true);
    });

    it("should exclude transitional states", async () => {
      // Mock returns only RUNNING pods (transitional states filtered by query)
      const mockPods = [
        {
          id: "pod-1",
          podId: "workspace-1",
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          deletedAt: null,
        },
      ];

      dbMock.pod.findMany.mockResolvedValue(mockPods);

      const result = await findClaimablePods(testSwarmId);

      // Query explicitly filters for RUNNING status
      // This excludes: PENDING, STARTING, CREATING, MOTHBALLED, 
      // CRASHING, UNSTABLE, FAILED, STOPPED, TERMINATING
      expect(dbMock.pod.findMany).toHaveBeenCalledWith({
        where: {
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
        },
        orderBy: { id: "asc" },
      });
      expect(result.every((pod) => pod.status === PodStatus.RUNNING)).toBe(true);
    });

    it("should return empty array when no claimable pods exist", async () => {
      dbMock.pod.findMany.mockResolvedValue([]);

      const result = await findClaimablePods(testSwarmId);

      expect(result).toEqual([]);
    });
  });

  describe("softDeletePod", () => {
    it("should set deletedAt timestamp", async () => {
      const mockPod = {
        id: testPodId,
        podId: "workspace-1",
        swarmId: testSwarmId,
        status: PodStatus.RUNNING,
        usageStatus: PodUsageStatus.UNUSED,
        deletedAt: new Date("2024-01-24T11:00:00Z"),
      };

      dbMock.pod.update.mockResolvedValue(mockPod);

      const result = await softDeletePod(testPodId);

      expect(dbMock.pod.update).toHaveBeenCalledWith({
        where: { id: testPodId },
        data: {
          deletedAt: expect.any(Date),
        },
      });
      expect(result).toEqual(mockPod);
      expect(result.deletedAt).not.toBeNull();
    });

    it("should use current timestamp for deletedAt", async () => {
      const now = new Date();
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const mockPod = {
        id: testPodId,
        podId: "workspace-1",
        swarmId: testSwarmId,
        status: PodStatus.RUNNING,
        usageStatus: PodUsageStatus.UNUSED,
        deletedAt: now,
      };

      dbMock.pod.update.mockResolvedValue(mockPod);

      await softDeletePod(testPodId);

      const call = dbMock.pod.update.mock.calls[0][0];
      const deletedAtValue = call.data.deletedAt as Date;

      expect(deletedAtValue.getTime()).toBe(now.getTime());

      vi.useRealTimers();
    });
  });

  describe("findDeletedPods", () => {
    it("should query pods with deletedAt NOT NULL", async () => {
      const mockPods = [
        {
          id: "pod-1",
          podId: "workspace-1",
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          deletedAt: new Date("2024-01-24T10:00:00Z"),
        },
        {
          id: "pod-2",
          podId: "workspace-2",
          swarmId: testSwarmId,
          status: PodStatus.FAILED,
          usageStatus: PodUsageStatus.USED,
          deletedAt: new Date("2024-01-24T11:00:00Z"),
        },
      ];

      dbMock.pod.findMany.mockResolvedValue(mockPods);

      const result = await findDeletedPods(testSwarmId);

      expect(dbMock.pod.findMany).toHaveBeenCalledWith({
        where: {
          swarmId: testSwarmId,
          deletedAt: { not: null },
        },
        orderBy: { deletedAt: "desc" },
      });
      expect(result).toEqual(mockPods);
      expect(result.every((pod) => pod.deletedAt !== null)).toBe(true);
    });

    it("should order by deletedAt descending", async () => {
      dbMock.pod.findMany.mockResolvedValue([]);

      await findDeletedPods(testSwarmId);

      expect(dbMock.pod.findMany).toHaveBeenCalledWith({
        where: {
          swarmId: testSwarmId,
          deletedAt: { not: null },
        },
        orderBy: { deletedAt: "desc" },
      });
    });

    it("should explicitly bypass middleware filter", async () => {
      // By explicitly providing deletedAt: { not: null }, 
      // we bypass the middleware's automatic deletedAt: null filter
      const mockPods = [
        {
          id: "pod-1",
          podId: "workspace-1",
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          deletedAt: new Date(),
        },
      ];

      dbMock.pod.findMany.mockResolvedValue(mockPods);

      const result = await findDeletedPods(testSwarmId);

      // Verify we're querying for deleted pods explicitly
      const call = dbMock.pod.findMany.mock.calls[0][0];
      expect(call.where.deletedAt).toEqual({ not: null });
      expect(result.every((pod) => pod.deletedAt !== null)).toBe(true);
    });

    it("should return empty array when no deleted pods exist", async () => {
      dbMock.pod.findMany.mockResolvedValue([]);

      const result = await findDeletedPods(testSwarmId);

      expect(result).toEqual([]);
    });
  });

  describe("Integration with middleware", () => {
    it("should work together - active queries filter deleted, deleted queries find them", async () => {
      // Active pods query - middleware filters deleted
      const activePods = [
        {
          id: "pod-1",
          podId: "workspace-1",
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          deletedAt: null,
        },
      ];

      // Deleted pods query - explicitly queries deleted
      const deletedPods = [
        {
          id: "pod-2",
          podId: "workspace-2",
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          deletedAt: new Date(),
        },
      ];

      // Setup mocks
      dbMock.pod.findMany
        .mockResolvedValueOnce(activePods) // First call: findActivePods
        .mockResolvedValueOnce(deletedPods); // Second call: findDeletedPods

      // Query active pods (middleware filters deleted)
      const activeResult = await findActivePods(testSwarmId);
      expect(activeResult).toHaveLength(1);
      expect(activeResult[0].deletedAt).toBeNull();

      // Query deleted pods (explicitly requests deleted)
      const deletedResult = await findDeletedPods(testSwarmId);
      expect(deletedResult).toHaveLength(1);
      expect(deletedResult[0].deletedAt).not.toBeNull();

      // Verify different queries were made
      expect(dbMock.pod.findMany).toHaveBeenCalledTimes(2);
      expect(dbMock.pod.findMany).toHaveBeenNthCalledWith(1, {
        where: { swarmId: testSwarmId },
        orderBy: { id: "asc" },
      });
      expect(dbMock.pod.findMany).toHaveBeenNthCalledWith(2, {
        where: { swarmId: testSwarmId, deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
      });
    });
  });
});
