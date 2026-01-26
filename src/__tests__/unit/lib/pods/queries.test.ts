import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PodStatus, PodUsageStatus } from "@prisma/client";
import type { Pod } from "@prisma/client";
import * as queries from "@/lib/pods/queries";
import { db } from "@/lib/db";

// Mock the db module
vi.mock("@/lib/db", () => ({
  db: {
    pod: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe("Pod Query Helper Functions", () => {
  const mockSwarmId = "test-swarm-123";
  const mockPodId = "test-pod-456";
  const now = new Date();
  const yesterday = new Date(Date.now() - 86400000);

  // Create mock pod data covering various scenarios
  const createMockPod = (overrides: Partial<Pod> = {}): Pod => ({
    id: "pod-1",
    podId: "workspace-1",
    swarmId: mockSwarmId,
    password: "encrypted-password",
    portMappings: {
      "15552": "https://control-1.example.com",
      "3000": "https://app-1.example.com",
    },
    status: PodStatus.RUNNING,
    usageStatus: PodUsageStatus.UNUSED,
    usageStatusMarkedAt: null,
    usageStatusMarkedBy: null,
    usageStatusReason: null,
    lastHealthCheck: null,
    flaggedForRecreation: false,
    flaggedAt: null,
    flaggedReason: null,
    deletedAt: null,
    createdAt: yesterday,
    updatedAt: now,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("findActivePods", () => {
    it("should return all non-deleted pods for a swarm", async () => {
      const mockPods: Pod[] = [
        createMockPod({ id: "pod-1", status: PodStatus.RUNNING }),
        createMockPod({ id: "pod-2", status: PodStatus.STARTING }),
        createMockPod({ id: "pod-3", status: PodStatus.FAILED }),
      ];

      vi.mocked(db.pod.findMany).mockResolvedValueOnce(mockPods);

      const result = await queries.findActivePods(mockSwarmId);

      expect(db.pod.findMany).toHaveBeenCalledWith({
        where: {
          swarmId: mockSwarmId,
          deletedAt: null,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
      expect(result).toEqual(mockPods);
      expect(result).toHaveLength(3);
    });

    it("should exclude soft-deleted pods", async () => {
      const mockPods: Pod[] = [
        createMockPod({ id: "pod-1", deletedAt: null }),
      ];

      vi.mocked(db.pod.findMany).mockResolvedValueOnce(mockPods);

      const result = await queries.findActivePods(mockSwarmId);

      expect(db.pod.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
          }),
        })
      );
      expect(result).toHaveLength(1);
      expect(result[0].deletedAt).toBeNull();
    });

    it("should return empty array when no active pods exist", async () => {
      vi.mocked(db.pod.findMany).mockResolvedValueOnce([]);

      const result = await queries.findActivePods(mockSwarmId);

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it("should order results by createdAt desc", async () => {
      const mockPods: Pod[] = [
        createMockPod({ id: "pod-1", createdAt: now }),
        createMockPod({ id: "pod-2", createdAt: yesterday }),
      ];

      vi.mocked(db.pod.findMany).mockResolvedValueOnce(mockPods);

      await queries.findActivePods(mockSwarmId);

      expect(db.pod.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: "desc" },
        })
      );
    });
  });

  describe("findUnusedPods", () => {
    it("should return only unused, non-deleted pods", async () => {
      const mockPods: Pod[] = [
        createMockPod({
          id: "pod-1",
          usageStatus: PodUsageStatus.UNUSED,
          deletedAt: null,
        }),
      ];

      vi.mocked(db.pod.findMany).mockResolvedValueOnce(mockPods);

      const result = await queries.findUnusedPods(mockSwarmId);

      expect(db.pod.findMany).toHaveBeenCalledWith({
        where: {
          swarmId: mockSwarmId,
          usageStatus: PodUsageStatus.UNUSED,
          deletedAt: null,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
      expect(result).toEqual(mockPods);
      expect(result[0].usageStatus).toBe(PodUsageStatus.UNUSED);
    });

    it("should return empty array when no unused pods exist", async () => {
      vi.mocked(db.pod.findMany).mockResolvedValueOnce([]);

      const result = await queries.findUnusedPods(mockSwarmId);

      expect(result).toEqual([]);
    });
  });

  describe("findUsedPods", () => {
    it("should return only used, non-deleted pods", async () => {
      const mockPods: Pod[] = [
        createMockPod({
          id: "pod-1",
          usageStatus: PodUsageStatus.USED,
          deletedAt: null,
        }),
      ];

      vi.mocked(db.pod.findMany).mockResolvedValueOnce(mockPods);

      const result = await queries.findUsedPods(mockSwarmId);

      expect(db.pod.findMany).toHaveBeenCalledWith({
        where: {
          swarmId: mockSwarmId,
          usageStatus: PodUsageStatus.USED,
          deletedAt: null,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
      expect(result).toEqual(mockPods);
      expect(result[0].usageStatus).toBe(PodUsageStatus.USED);
    });

    it("should return empty array when no used pods exist", async () => {
      vi.mocked(db.pod.findMany).mockResolvedValueOnce([]);

      const result = await queries.findUsedPods(mockSwarmId);

      expect(result).toEqual([]);
    });
  });

  describe("findClaimablePods", () => {
    it("should return only RUNNING + UNUSED + non-deleted pods", async () => {
      const mockPods: Pod[] = [
        createMockPod({
          id: "pod-1",
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          deletedAt: null,
        }),
      ];

      vi.mocked(db.pod.findMany).mockResolvedValueOnce(mockPods);

      const result = await queries.findClaimablePods(mockSwarmId);

      expect(db.pod.findMany).toHaveBeenCalledWith({
        where: {
          swarmId: mockSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          deletedAt: null,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
      expect(result).toEqual(mockPods);
      expect(result[0].status).toBe(PodStatus.RUNNING);
      expect(result[0].usageStatus).toBe(PodUsageStatus.UNUSED);
    });

    it("should exclude transitional states (STARTING, CREATING, PENDING)", async () => {
      // The function should only query for RUNNING status, implicitly excluding others
      vi.mocked(db.pod.findMany).mockResolvedValueOnce([]);

      await queries.findClaimablePods(mockSwarmId);

      expect(db.pod.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: PodStatus.RUNNING, // Only RUNNING, no other statuses
          }),
        })
      );
    });

    it("should exclude MOTHBALLED, CRASHING, UNSTABLE pods", async () => {
      // The function only queries for RUNNING status
      vi.mocked(db.pod.findMany).mockResolvedValueOnce([]);

      await queries.findClaimablePods(mockSwarmId);

      const call = vi.mocked(db.pod.findMany).mock.calls[0][0];
      expect(call?.where?.status).toBe(PodStatus.RUNNING);
    });

    it("should exclude FAILED, STOPPED, TERMINATING pods", async () => {
      // The function only queries for RUNNING status
      vi.mocked(db.pod.findMany).mockResolvedValueOnce([]);

      await queries.findClaimablePods(mockSwarmId);

      const call = vi.mocked(db.pod.findMany).mock.calls[0][0];
      expect(call?.where?.status).toBe(PodStatus.RUNNING);
    });

    it("should return empty array when no claimable pods exist", async () => {
      vi.mocked(db.pod.findMany).mockResolvedValueOnce([]);

      const result = await queries.findClaimablePods(mockSwarmId);

      expect(result).toEqual([]);
    });
  });

  describe("findPodsByStatus", () => {
    it("should filter pods by specific status and exclude deleted", async () => {
      const mockPods: Pod[] = [
        createMockPod({
          id: "pod-1",
          status: PodStatus.FAILED,
          deletedAt: null,
        }),
      ];

      vi.mocked(db.pod.findMany).mockResolvedValueOnce(mockPods);

      const result = await queries.findPodsByStatus(
        mockSwarmId,
        PodStatus.FAILED
      );

      expect(db.pod.findMany).toHaveBeenCalledWith({
        where: {
          swarmId: mockSwarmId,
          status: PodStatus.FAILED,
          deletedAt: null,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
      expect(result).toEqual(mockPods);
      expect(result[0].status).toBe(PodStatus.FAILED);
    });

    it("should work with STARTING status", async () => {
      const mockPods: Pod[] = [
        createMockPod({ status: PodStatus.STARTING }),
      ];

      vi.mocked(db.pod.findMany).mockResolvedValueOnce(mockPods);

      const result = await queries.findPodsByStatus(
        mockSwarmId,
        PodStatus.STARTING
      );

      expect(result[0].status).toBe(PodStatus.STARTING);
    });

    it("should work with all status types", async () => {
      const statuses = [
        PodStatus.PENDING,
        PodStatus.STARTING,
        PodStatus.CREATING,
        PodStatus.RUNNING,
        PodStatus.FAILED,
        PodStatus.STOPPED,
        PodStatus.TERMINATING,
        PodStatus.MOTHBALLED,
        PodStatus.CRASHING,
        PodStatus.UNSTABLE,
      ];

      for (const status of statuses) {
        vi.mocked(db.pod.findMany).mockResolvedValueOnce([
          createMockPod({ status }),
        ]);

        await queries.findPodsByStatus(mockSwarmId, status);

        expect(db.pod.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              status,
              deletedAt: null,
            }),
          })
        );
      }
    });

    it("should return empty array when no pods match status", async () => {
      vi.mocked(db.pod.findMany).mockResolvedValueOnce([]);

      const result = await queries.findPodsByStatus(
        mockSwarmId,
        PodStatus.CRASHING
      );

      expect(result).toEqual([]);
    });
  });

  describe("softDeletePod", () => {
    it("should set deletedAt timestamp for the specified pod", async () => {
      const mockUpdatedPod = createMockPod({
        id: mockPodId,
        deletedAt: now,
      });

      vi.mocked(db.pod.update).mockResolvedValueOnce(mockUpdatedPod);

      const result = await queries.softDeletePod(mockPodId);

      expect(db.pod.update).toHaveBeenCalledWith({
        where: {
          id: mockPodId,
        },
        data: {
          deletedAt: expect.any(Date),
        },
      });
      expect(result.deletedAt).not.toBeNull();
      expect(result.id).toBe(mockPodId);
    });

    it("should return the updated pod record", async () => {
      const mockUpdatedPod = createMockPod({
        id: mockPodId,
        deletedAt: now,
      });

      vi.mocked(db.pod.update).mockResolvedValueOnce(mockUpdatedPod);

      const result = await queries.softDeletePod(mockPodId);

      expect(result).toEqual(mockUpdatedPod);
      expect(result.deletedAt).toBeInstanceOf(Date);
    });

    it("should preserve all other pod fields", async () => {
      const mockUpdatedPod = createMockPod({
        id: mockPodId,
        status: PodStatus.RUNNING,
        usageStatus: PodUsageStatus.USED,
        portMappings: {
          "15552": "https://control.example.com",
          "3000": "https://app.example.com",
        },
        deletedAt: now,
      });

      vi.mocked(db.pod.update).mockResolvedValueOnce(mockUpdatedPod);

      const result = await queries.softDeletePod(mockPodId);

      expect(result.status).toBe(PodStatus.RUNNING);
      expect(result.usageStatus).toBe(PodUsageStatus.USED);
      expect(result.portMappings).toEqual({
        "15552": "https://control.example.com",
        "3000": "https://app.example.com",
      });
    });
  });

  describe("findDeletedPods", () => {
    it("should return only soft-deleted pods", async () => {
      const mockPods: Pod[] = [
        createMockPod({
          id: "pod-1",
          deletedAt: yesterday,
        }),
        createMockPod({
          id: "pod-2",
          deletedAt: now,
        }),
      ];

      vi.mocked(db.pod.findMany).mockResolvedValueOnce(mockPods);

      const result = await queries.findDeletedPods(mockSwarmId);

      expect(db.pod.findMany).toHaveBeenCalledWith({
        where: {
          swarmId: mockSwarmId,
          deletedAt: {
            not: null,
          },
        },
        orderBy: {
          deletedAt: "desc",
        },
      });
      expect(result).toEqual(mockPods);
      expect(result).toHaveLength(2);
      result.forEach((pod) => {
        expect(pod.deletedAt).not.toBeNull();
      });
    });

    it("should order results by deletedAt desc", async () => {
      vi.mocked(db.pod.findMany).mockResolvedValueOnce([]);

      await queries.findDeletedPods(mockSwarmId);

      expect(db.pod.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { deletedAt: "desc" },
        })
      );
    });

    it("should return empty array when no deleted pods exist", async () => {
      vi.mocked(db.pod.findMany).mockResolvedValueOnce([]);

      const result = await queries.findDeletedPods(mockSwarmId);

      expect(result).toEqual([]);
    });

    it("should only include pods with non-null deletedAt", async () => {
      const mockPods: Pod[] = [
        createMockPod({ id: "pod-1", deletedAt: now }),
      ];

      vi.mocked(db.pod.findMany).mockResolvedValueOnce(mockPods);

      const result = await queries.findDeletedPods(mockSwarmId);

      expect(db.pod.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: { not: null },
          }),
        })
      );
      expect(result[0].deletedAt).not.toBeNull();
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle database errors gracefully", async () => {
      const dbError = new Error("Database connection failed");
      vi.mocked(db.pod.findMany).mockRejectedValueOnce(dbError);

      await expect(queries.findActivePods(mockSwarmId)).rejects.toThrow(
        "Database connection failed"
      );
    });

    it("should handle invalid swarm ID", async () => {
      vi.mocked(db.pod.findMany).mockResolvedValueOnce([]);

      const result = await queries.findActivePods("non-existent-swarm");

      expect(result).toEqual([]);
    });

    it("should handle update errors in softDeletePod", async () => {
      const updateError = new Error("Pod not found");
      vi.mocked(db.pod.update).mockRejectedValueOnce(updateError);

      await expect(queries.softDeletePod("non-existent-pod")).rejects.toThrow(
        "Pod not found"
      );
    });
  });

  describe("port_mappings JSONB structure", () => {
    it("should preserve port_mappings as Record<string, string>", async () => {
      const mockPods: Pod[] = [
        createMockPod({
          portMappings: {
            "15552": "https://control-abc.example.com",
            "3000": "https://app-abc.example.com",
            "8080": "https://api-abc.example.com",
          },
        }),
      ];

      vi.mocked(db.pod.findMany).mockResolvedValueOnce(mockPods);

      const result = await queries.findActivePods(mockSwarmId);

      expect(result[0].portMappings).toEqual({
        "15552": "https://control-abc.example.com",
        "3000": "https://app-abc.example.com",
        "8080": "https://api-abc.example.com",
      });
      expect(typeof result[0].portMappings).toBe("object");
    });

    it("should allow accessing ports by string keys", async () => {
      const mockPods: Pod[] = [
        createMockPod({
          portMappings: {
            "15552": "https://control.example.com",
          },
        }),
      ];

      vi.mocked(db.pod.findMany).mockResolvedValueOnce(mockPods);

      const result = await queries.findActivePods(mockSwarmId);
      const portMappings = result[0].portMappings as Record<string, string>;

      expect(portMappings["15552"]).toBe("https://control.example.com");
    });
  });
});
