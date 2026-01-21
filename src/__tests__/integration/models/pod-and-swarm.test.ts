/**
 * Integration tests for Pod model and Swarm field updates
 * Tests Pod CRUD operations, Swarm relations, and enum accessibility
 */

import { describe, it, expect } from "vitest";
import { PodStatus, PodUsageStatus, PodFlagReason } from "@prisma/client";
import { db } from "@/lib/db";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { generateUniqueId } from "@/__tests__/support/helpers";

// Helper to create workspace with owner for tests
async function createTestWorkspace() {
  const user = await createTestUser({
    email: `test-${generateUniqueId()}@example.com`,
  });

  const workspace = await db.workspace.create({
    data: {
      name: `Test Workspace ${generateUniqueId()}`,
      slug: `test-${generateUniqueId()}`,
      ownerId: user.id,
    },
  });

  return { user, workspace };
}

describe("Pod and Swarm Schema Integration", () => {
  describe("Swarm new fields", () => {
    it("should create Swarm with minimumVms and webhookUrl", async () => {
      const { workspace } = await createTestWorkspace();

      const swarm = await db.swarm.create({
        data: {
          name: `test-swarm-${generateUniqueId()}`,
          workspaceId: workspace.id,
          minimumVms: 5,
          webhookUrl: "https://example.com/webhook",
        },
      });

      expect(swarm.minimumVms).toBe(5);
      expect(swarm.webhookUrl).toBe("https://example.com/webhook");
    });

    it("should use default minimumVms value of 2", async () => {
      const { workspace } = await createTestWorkspace();

      const swarm = await db.swarm.create({
        data: {
          name: `test-swarm-${generateUniqueId()}`,
          workspaceId: workspace.id,
        },
      });

      expect(swarm.minimumVms).toBe(2);
    });

    it("should allow null webhookUrl", async () => {
      const { workspace } = await createTestWorkspace();

      const swarm = await db.swarm.create({
        data: {
          name: `test-swarm-${generateUniqueId()}`,
          workspaceId: workspace.id,
          webhookUrl: null,
        },
      });

      expect(swarm.webhookUrl).toBeNull();
    });

    it("should update existing Swarm with new fields", async () => {
      const { workspace } = await createTestWorkspace();

      const swarm = await db.swarm.create({
        data: {
          name: `test-swarm-${generateUniqueId()}`,
          workspaceId: workspace.id,
        },
      });

      const updated = await db.swarm.update({
        where: { id: swarm.id },
        data: {
          minimumVms: 10,
          webhookUrl: "https://updated.com/webhook",
        },
      });

      expect(updated.minimumVms).toBe(10);
      expect(updated.webhookUrl).toBe("https://updated.com/webhook");
    });
  });

  describe("Pod model CRUD operations", () => {
    it("should create Pod linked to Swarm", async () => {
      const { workspace } = await createTestWorkspace();

      const swarm = await db.swarm.create({
        data: {
          name: `test-swarm-${generateUniqueId()}`,
          workspaceId: workspace.id,
        },
      });

      const pod = await db.pod.create({
        data: {
          podId: `pod-${generateUniqueId()}`,
          swarmId: swarm.id,
          password: "encrypted-password-here",
          portMappings: { "3000": "http://localhost:3000", "8080": "http://localhost:8080" },
        },
      });

      expect(pod.podId).toContain("pod-");
      expect(pod.swarmId).toBe(swarm.id);
      expect(pod.password).toBe("encrypted-password-here");
      expect(pod.portMappings).toEqual({ "3000": "http://localhost:3000", "8080": "http://localhost:8080" });
      expect(pod.status).toBe(PodStatus.RUNNING);
      expect(pod.usageStatus).toBe(PodUsageStatus.AVAILABLE);
      expect(pod.flaggedForRecreation).toBe(false);
      expect(pod.recreationAttempts).toBe(0);
    });

    it("should create Pod with all fields", async () => {
      const { workspace } = await createTestWorkspace();

      const swarm = await db.swarm.create({
        data: {
          name: `test-swarm-${generateUniqueId()}`,
          workspaceId: workspace.id,
        },
      });

      const pod = await db.pod.create({
        data: {
          podId: `pod-full-${generateUniqueId()}`,
          swarmId: swarm.id,
          password: "encrypted-password",
          portMappings: { "3000": "http://localhost:3000" },
          status: PodStatus.PENDING,
          usageStatus: PodUsageStatus.IN_USE,
          lastHealthCheck: new Date(),
          healthStatus: "healthy",
          healthMessage: "All systems operational",
          flaggedForRecreation: true,
          flagReason: PodFlagReason.OOM_KILLED,
          flaggedAt: new Date(),
          recreationAttempts: 2,
          currentTaskId: "task-123",
          claimedAt: new Date(),
          metadata: { repositories: ["repo1", "repo2"], branches: ["main", "develop"] },
        },
      });

      expect(pod.status).toBe(PodStatus.PENDING);
      expect(pod.usageStatus).toBe(PodUsageStatus.IN_USE);
      expect(pod.healthStatus).toBe("healthy");
      expect(pod.flaggedForRecreation).toBe(true);
      expect(pod.flagReason).toBe(PodFlagReason.OOM_KILLED);
      expect(pod.recreationAttempts).toBe(2);
      expect(pod.currentTaskId).toBe("task-123");
      expect(pod.metadata).toEqual({ repositories: ["repo1", "repo2"], branches: ["main", "develop"] });
    });

    it("should enforce unique podId constraint", async () => {
      const { workspace } = await createTestWorkspace();

      const swarm = await db.swarm.create({
        data: {
          name: `test-swarm-${generateUniqueId()}`,
          workspaceId: workspace.id,
        },
      });

      const podId = `pod-unique-${generateUniqueId()}`;

      await db.pod.create({
        data: {
          podId,
          swarmId: swarm.id,
          password: "encrypted-password",
        },
      });

      // Attempt to create another pod with the same podId
      await expect(
        db.pod.create({
          data: {
            podId,
            swarmId: swarm.id,
            password: "another-password",
          },
        })
      ).rejects.toThrow();
    });

    it("should cascade delete Pods when Swarm is deleted", async () => {
      const { workspace } = await createTestWorkspace();

      const swarm = await db.swarm.create({
        data: {
          name: `test-swarm-${generateUniqueId()}`,
          workspaceId: workspace.id,
        },
      });

      const pod1 = await db.pod.create({
        data: {
          podId: `pod-cascade-1-${generateUniqueId()}`,
          swarmId: swarm.id,
          password: "encrypted-password-1",
        },
      });

      const pod2 = await db.pod.create({
        data: {
          podId: `pod-cascade-2-${generateUniqueId()}`,
          swarmId: swarm.id,
          password: "encrypted-password-2",
        },
      });

      // Delete the swarm
      await db.swarm.delete({
        where: { id: swarm.id },
      });

      // Pods should be deleted
      const foundPod1 = await db.pod.findUnique({ where: { id: pod1.id } });
      const foundPod2 = await db.pod.findUnique({ where: { id: pod2.id } });

      expect(foundPod1).toBeNull();
      expect(foundPod2).toBeNull();
    });
  });

  describe("Swarm-Pod relationship", () => {
    it("should query Pods from Swarm", async () => {
      const { workspace } = await createTestWorkspace();

      const swarm = await db.swarm.create({
        data: {
          name: `test-swarm-${generateUniqueId()}`,
          workspaceId: workspace.id,
        },
      });

      await db.pod.createMany({
        data: [
          {
            podId: `pod-rel-1-${generateUniqueId()}`,
            swarmId: swarm.id,
            password: "password-1",
          },
          {
            podId: `pod-rel-2-${generateUniqueId()}`,
            swarmId: swarm.id,
            password: "password-2",
          },
        ],
      });

      const swarmWithPods = await db.swarm.findUnique({
        where: { id: swarm.id },
        include: { pods: true },
      });

      expect(swarmWithPods?.pods).toHaveLength(2);
    });

    it("should query Swarm from Pod", async () => {
      const { workspace } = await createTestWorkspace();

      const swarm = await db.swarm.create({
        data: {
          name: `test-swarm-${generateUniqueId()}`,
          workspaceId: workspace.id,
        },
      });

      const pod = await db.pod.create({
        data: {
          podId: `pod-parent-${generateUniqueId()}`,
          swarmId: swarm.id,
          password: "password",
        },
      });

      const podWithSwarm = await db.pod.findUnique({
        where: { id: pod.id },
        include: { swarm: true },
      });

      expect(podWithSwarm?.swarm.id).toBe(swarm.id);
      expect(podWithSwarm?.swarm.name).toBe(swarm.name);
    });
  });

  describe("Enum accessibility in TypeScript", () => {
    it("should have PodStatus enum accessible", () => {
      expect(PodStatus.PENDING).toBe("PENDING");
      expect(PodStatus.RUNNING).toBe("RUNNING");
      expect(PodStatus.STOPPED).toBe("STOPPED");
      expect(PodStatus.FAILED).toBe("FAILED");
      expect(PodStatus.TERMINATED).toBe("TERMINATED");
    });

    it("should have PodUsageStatus enum accessible", () => {
      expect(PodUsageStatus.AVAILABLE).toBe("AVAILABLE");
      expect(PodUsageStatus.IN_USE).toBe("IN_USE");
      expect(PodUsageStatus.CLAIMED).toBe("CLAIMED");
      expect(PodUsageStatus.RESERVED).toBe("RESERVED");
    });

    it("should have PodFlagReason enum accessible", () => {
      expect(PodFlagReason.OOM_KILLED).toBe("OOM_KILLED");
      expect(PodFlagReason.CRASH_LOOP).toBe("CRASH_LOOP");
      expect(PodFlagReason.IMAGE_PULL_ERROR).toBe("IMAGE_PULL_ERROR");
      expect(PodFlagReason.HEALTH_CHECK_FAILED).toBe("HEALTH_CHECK_FAILED");
      expect(PodFlagReason.MANUAL_FLAG).toBe("MANUAL_FLAG");
      expect(PodFlagReason.STALE).toBe("STALE");
    });

    it("should use enums in type-safe queries", async () => {
      const { workspace } = await createTestWorkspace();

      const swarm = await db.swarm.create({
        data: {
          name: `test-swarm-${generateUniqueId()}`,
          workspaceId: workspace.id,
        },
      });

      await db.pod.create({
        data: {
          podId: `pod-enum-${generateUniqueId()}`,
          swarmId: swarm.id,
          password: "password",
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.AVAILABLE,
        },
      });

      // Query using enum values
      const runningPods = await db.pod.findMany({
        where: {
          status: PodStatus.RUNNING,
          usageStatus: PodUsageStatus.AVAILABLE,
        },
      });

      expect(runningPods.length).toBeGreaterThan(0);
    });
  });
});
