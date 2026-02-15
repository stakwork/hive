/**
 * Unit tests for pod query functions
 * Tests atomic operations, race conditions, and soft-delete filtering
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { PodStatus, PodUsageStatus } from "@prisma/client";
import {
  claimAvailablePod,
  getPodDetails,
  releasePodById,
  getPodUsageStatus,
} from "@/lib/pods/queries";
import type { Pod } from "@prisma/client";

describe("Pod Queries", () => {
  // Test data setup
  let testSwarmId: string;
  let testUserId: string;
  let testWorkspaceId: string;
  let testPods: Pod[] = [];

  beforeEach(async () => {
    // Generate unique IDs for this test run
    const timestamp = Date.now();

    // Create a test user
    const user = await db.user.create({
      data: {
        email: `test-user-${timestamp}@example.com`,
        name: `Test User ${timestamp}`,
      },
    });
    testUserId = user.id;

    // Create a test workspace first
    const workspace = await db.workspace.create({
      data: {
        name: `Test Workspace ${timestamp}`,
        slug: `test-workspace-${timestamp}`,
        ownerId: testUserId,
      },
    });
    testWorkspaceId = workspace.id;

    // Create a test swarm (required for pods foreign key) linked to workspace
    const swarm = await db.swarm.create({
      data: {
        name: `test-swarm-${timestamp}`,
        status: "ACTIVE",
        workspaceId: testWorkspaceId,
      },
    });
    testSwarmId = swarm.id;

    // Clean up any existing test data
    await db.task.deleteMany({
      where: {
        podId: {
          contains: "test-pod",
        },
      },
    });

    await db.pod.deleteMany({
      where: {
        podId: {
          contains: "test-pod",
        },
      },
    });
  });

  afterEach(async () => {
    // Clean up test data
    await db.task.deleteMany({
      where: {
        podId: {
          contains: "test-pod",
        },
      },
    });

    await db.pod.deleteMany({
      where: {
        podId: {
          contains: "test-pod",
        },
      },
    });

    // Clean up test swarm
    if (testSwarmId) {
      await db.swarm.delete({
        where: { id: testSwarmId },
      }).catch(() => {
        // Ignore errors if already deleted
      });
    }

    // Clean up test workspace and user
    if (testWorkspaceId) {
      await db.workspace.delete({
        where: { id: testWorkspaceId },
      }).catch(() => {
        // Ignore errors if already deleted
      });
    }

    if (testUserId) {
      await db.user.delete({
        where: { id: testUserId },
      }).catch(() => {
        // Ignore errors if already deleted
      });
    }

    testPods = [];
  });

  describe("claimAvailablePod", () => {
    it("should claim first RUNNING + UNUSED pod and mark it USED", async () => {
      // Create 3 RUNNING + UNUSED pods
      const pod1 = await db.pod.create({
        data: {
          podId: `test-pod-1-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          password: "encrypted-password-1",
          portMappings: [3000],
        },
      });

      await db.pod.create({
        data: {
          podId: `test-pod-2-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          password: "encrypted-password-2",
          portMappings: [3000],
        },
      });

      // Claim a pod
      const claimedPod = await claimAvailablePod(testSwarmId, testUserId);

      expect(claimedPod).not.toBeNull();
      expect(claimedPod?.id).toBe(pod1.id);
      expect(claimedPod?.usageStatus).toBe(PodUsageStatus.USED);
      expect(claimedPod?.usageStatusMarkedBy).toBe(testUserId);
      expect(claimedPod?.usageStatusMarkedAt).toBeInstanceOf(Date);

      // Verify database state
      const verifyPod = await db.pod.findUnique({
        where: { id: pod1.id },
      });

      expect(verifyPod?.usageStatus).toBe(PodUsageStatus.USED);
      expect(verifyPod?.usageStatusMarkedBy).toBe(testUserId);
    });

    it("should return null when no pods available", async () => {
      // Create only USED or non-RUNNING pods
      await db.pod.create({
        data: {
          podId: `test-pod-used-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.USED,
          usageStatusMarkedBy: "another-user",
          usageStatusMarkedAt: new Date(),
        },
      });

      await db.pod.create({
        data: {
          podId: `test-pod-pending-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.PENDING,
          usageStatus: PodUsageStatus.UNUSED,
        },
      });

      const claimedPod = await claimAvailablePod(testSwarmId, testUserId);

      expect(claimedPod).toBeNull();
    });

    it("should exclude soft-deleted pods", async () => {
      // Create a soft-deleted pod
      await db.pod.create({
        data: {
          podId: `test-pod-deleted-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          deletedAt: new Date(),
        },
      });

      // Create a valid pod
      const validPod = await db.pod.create({
        data: {
          podId: `test-pod-valid-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
        },
      });

      const claimedPod = await claimAvailablePod(testSwarmId, testUserId);

      expect(claimedPod).not.toBeNull();
      expect(claimedPod?.id).toBe(validPod.id);
    });

    it("should handle race conditions without double-claiming", async () => {
      // Create only 1 RUNNING + UNUSED pod
      const pod = await db.pod.create({
        data: {
          podId: `test-pod-race-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          password: "encrypted-password",
          portMappings: [3000],
        },
      });

      // Simulate 5 concurrent claim requests
      const user1 = `user-1-${Date.now()}`;
      const user2 = `user-2-${Date.now()}`;
      const user3 = `user-3-${Date.now()}`;
      const user4 = `user-4-${Date.now()}`;
      const user5 = `user-5-${Date.now()}`;

      const results = await Promise.all([
        claimAvailablePod(testSwarmId, user1),
        claimAvailablePod(testSwarmId, user2),
        claimAvailablePod(testSwarmId, user3),
        claimAvailablePod(testSwarmId, user4),
        claimAvailablePod(testSwarmId, user5),
      ]);

      // Only one should succeed, others should get null
      const successfulClaims = results.filter((r) => r !== null);
      const failedClaims = results.filter((r) => r === null);

      expect(successfulClaims).toHaveLength(1);
      expect(failedClaims).toHaveLength(4);

      // Verify the pod is claimed by exactly one user
      const verifyPod = await db.pod.findUnique({
        where: { id: pod.id },
      });

      expect(verifyPod?.usageStatus).toBe(PodUsageStatus.USED);
      expect(verifyPod?.usageStatusMarkedBy).toMatch(/^user-[1-5]-/);
      expect([user1, user2, user3, user4, user5]).toContain(
        verifyPod?.usageStatusMarkedBy
      );
    });

    it("should claim oldest pod first (ORDER BY created_at ASC)", async () => {
      // Create pods with slight time delays
      const oldestPod = await db.pod.create({
        data: {
          podId: `test-pod-oldest-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          createdAt: new Date("2024-01-01"),
        },
      });

      await db.pod.create({
        data: {
          podId: `test-pod-newer-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          createdAt: new Date("2024-01-02"),
        },
      });

      const claimedPod = await claimAvailablePod(testSwarmId, testUserId);

      expect(claimedPod?.id).toBe(oldestPod.id);
    });

    it("should only claim pods from specified swarm", async () => {
      // Create another workspace and swarm
      const otherWorkspace = await db.workspace.create({
        data: {
          name: `Other Test Workspace ${Date.now()}`,
          slug: `other-test-workspace-${Date.now()}`,
          ownerId: testUserId,
        },
      });

      const otherSwarm = await db.swarm.create({
        data: {
          name: `Other Test Swarm ${Date.now()}`,
          swarmId: `other-swarm-${Date.now()}`,
          workspaceId: otherWorkspace.id,
        },
      });

      // Create pod in different swarm
      await db.pod.create({
        data: {
          podId: `test-pod-other-swarm-${Date.now()}`,
          swarmId: otherSwarm.id,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
        },
      });

      // Try to claim from testSwarmId - should return null since no pods available
      const claimedPod = await claimAvailablePod(testSwarmId, testUserId);

      expect(claimedPod).toBeNull();

      // Cleanup
      await db.pod.deleteMany({ where: { swarmId: otherSwarm.id } });
      await db.swarm.delete({ where: { id: otherSwarm.id } });
      await db.workspace.delete({ where: { id: otherWorkspace.id } });
    });

    it("should exclude PENDING status pods", async () => {
      await db.pod.create({
        data: {
          podId: `test-pod-pending-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.PENDING,
          usageStatus: PodUsageStatus.UNUSED,
        },
      });

      const claimedPod = await claimAvailablePod(testSwarmId, testUserId);

      expect(claimedPod).toBeNull();
    });

    it("should exclude FAILED status pods", async () => {
      await db.pod.create({
        data: {
          podId: `test-pod-failed-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.FAILED,
          usageStatus: PodUsageStatus.UNUSED,
        },
      });

      const claimedPod = await claimAvailablePod(testSwarmId, testUserId);

      expect(claimedPod).toBeNull();
    });
  });

  describe("getPodDetails", () => {
    it("should return password and portMappings", async () => {
      const pod = await db.pod.create({
        data: {
          podId: `test-pod-details-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          password: "encrypted-password-123",
          portMappings: [3000, 15551, 15552],
        },
      });

      const details = await getPodDetails(pod.podId);

      expect(details).not.toBeNull();
      expect(details?.password).toBe("encrypted-password-123");
      expect(details?.portMappings).toEqual([3000, 15551, 15552]);
    });

    it("should return null for soft-deleted pods", async () => {
      const pod = await db.pod.create({
        data: {
          podId: `test-pod-deleted-details-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          password: "encrypted-password",
          portMappings: [3000],
          deletedAt: new Date(),
        },
      });

      const details = await getPodDetails(pod.podId);

      expect(details).toBeNull();
    });

    it("should return null for non-existent pods", async () => {
      const details = await getPodDetails("non-existent-pod-id");

      expect(details).toBeNull();
    });

    it("should handle null password and portMappings", async () => {
      const pod = await db.pod.create({
        data: {
          podId: `test-pod-nulls-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          password: null,
          portMappings: null,
        },
      });

      const details = await getPodDetails(pod.podId);

      expect(details).not.toBeNull();
      expect(details?.password).toBeNull();
      expect(details?.portMappings).toBeNull();
    });
  });

  describe("releasePodById", () => {
    it("should clear usage status and task associations", async () => {
      const pod = await db.pod.create({
        data: {
          podId: `test-pod-release-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.USED,
          usageStatusMarkedAt: new Date(),
          usageStatusMarkedBy: testUserId,
          usageStatusReason: "Task execution",
        },
      });

      // Create a task associated with this pod
      const task = await db.task.create({
        data: {
          title: "Test Task",
          workspace: {
            connect: { id: testWorkspaceId },
          },
          createdBy: {
            connect: { id: testUserId },
          },
          updatedBy: {
            connect: { id: testUserId },
          },
          podId: pod.podId,
        },
      });

      const releasedPod = await releasePodById(pod.podId);

      expect(releasedPod).not.toBeNull();
      expect(releasedPod?.usageStatus).toBe(PodUsageStatus.UNUSED);
      expect(releasedPod?.usageStatusMarkedAt).toBeNull();
      expect(releasedPod?.usageStatusMarkedBy).toBeNull();
      expect(releasedPod?.usageStatusReason).toBeNull();

      // Verify task's podId is cleared
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask?.podId).toBeNull();
    });

    it("should use transaction (both pod and task updates)", async () => {
      const pod = await db.pod.create({
        data: {
          podId: `test-pod-transaction-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.USED,
          usageStatusMarkedAt: new Date(),
          usageStatusMarkedBy: testUserId,
        },
      });

      // Create multiple tasks
      await Promise.all([
        db.task.create({
          data: {
            title: "Task 1",
            workspace: { connect: { id: testWorkspaceId } },
            createdBy: { connect: { id: testUserId } },
            updatedBy: { connect: { id: testUserId } },
            podId: pod.podId,
          },
        }),
        db.task.create({
          data: {
            title: "Task 2",
            workspace: { connect: { id: testWorkspaceId } },
            createdBy: { connect: { id: testUserId } },
            updatedBy: { connect: { id: testUserId } },
            podId: pod.podId,
          },
        }),
      ]);

      const releasedPod = await releasePodById(pod.podId);

      expect(releasedPod).not.toBeNull();

      // Verify all tasks have podId cleared
      const tasksWithPod = await db.task.count({
        where: {
          podId: pod.podId,
        },
      });

      expect(tasksWithPod).toBe(0);
    });

    it("should return null for non-existent pods", async () => {
      const result = await releasePodById("non-existent-pod-id");

      expect(result).toBeNull();
    });

    it("should return null for soft-deleted pods", async () => {
      const pod = await db.pod.create({
        data: {
          podId: `test-pod-deleted-release-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.USED,
          usageStatusMarkedAt: new Date(),
          usageStatusMarkedBy: testUserId,
          deletedAt: new Date(),
        },
      });

      const result = await releasePodById(pod.podId);

      expect(result).toBeNull();
    });

    it("should handle pods with no associated tasks", async () => {
      const pod = await db.pod.create({
        data: {
          podId: `test-pod-no-tasks-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.USED,
          usageStatusMarkedAt: new Date(),
          usageStatusMarkedBy: testUserId,
        },
      });

      const releasedPod = await releasePodById(pod.podId);

      expect(releasedPod).not.toBeNull();
      expect(releasedPod?.usageStatus).toBe(PodUsageStatus.UNUSED);
    });

    it("should clear all usage status fields atomically", async () => {
      const pod = await db.pod.create({
        data: {
          podId: `test-pod-atomic-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.USED,
          usageStatusMarkedAt: new Date("2024-01-01"),
          usageStatusMarkedBy: "user-123",
          usageStatusReason: "Long running task",
        },
      });

      const releasedPod = await releasePodById(pod.podId);

      expect(releasedPod?.usageStatus).toBe(PodUsageStatus.UNUSED);
      expect(releasedPod?.usageStatusMarkedAt).toBeNull();
      expect(releasedPod?.usageStatusMarkedBy).toBeNull();
      expect(releasedPod?.usageStatusReason).toBeNull();
    });
  });

  describe("getPodUsageStatus", () => {
    it("should return correct status fields", async () => {
      const markedAt = new Date("2024-01-01T12:00:00Z");

      const pod = await db.pod.create({
        data: {
          podId: `test-pod-status-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.USED,
          usageStatusMarkedAt: markedAt,
          usageStatusMarkedBy: testUserId,
        },
      });

      const status = await getPodUsageStatus(pod.podId);

      expect(status).not.toBeNull();
      expect(status?.usageStatus).toBe(PodUsageStatus.USED);
      expect(status?.usageStatusMarkedAt).toEqual(markedAt);
      expect(status?.usageStatusMarkedBy).toBe(testUserId);
    });

    it("should return null for soft-deleted pods", async () => {
      const pod = await db.pod.create({
        data: {
          podId: `test-pod-deleted-status-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.USED,
          usageStatusMarkedAt: new Date(),
          usageStatusMarkedBy: testUserId,
          deletedAt: new Date(),
        },
      });

      const status = await getPodUsageStatus(pod.podId);

      expect(status).toBeNull();
    });

    it("should return null for non-existent pods", async () => {
      const status = await getPodUsageStatus("non-existent-pod-id");

      expect(status).toBeNull();
    });

    it("should handle UNUSED pods with null marked fields", async () => {
      const pod = await db.pod.create({
        data: {
          podId: `test-pod-unused-status-${Date.now()}`,
          swarmId: testSwarmId,
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.UNUSED,
          usageStatusMarkedAt: null,
          usageStatusMarkedBy: null,
        },
      });

      const status = await getPodUsageStatus(pod.podId);

      expect(status).not.toBeNull();
      expect(status?.usageStatus).toBe(PodUsageStatus.UNUSED);
      expect(status?.usageStatusMarkedAt).toBeNull();
      expect(status?.usageStatusMarkedBy).toBeNull();
    });
  });
});
