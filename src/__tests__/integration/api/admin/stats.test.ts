import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/factories";
import {
  createAuthenticatedGetRequest,
  createGetRequest,
} from "@/__tests__/support/helpers/request-builders";

describe("/api/admin/stats", () => {
  let superAdminUser: { id: string; email: string };
  let regularUser: { id: string; email: string };
  let workspaceId: string;

  beforeEach(async () => {
    // Create test users (beforeEach because resetDatabase runs beforeEach)
    superAdminUser = await createTestUser({ role: "SUPER_ADMIN", email: "superadmin@test.com" });
    regularUser = await createTestUser({ role: "USER", email: "regular@test.com" });
    const workspace = await createTestWorkspace({
      ownerId: superAdminUser.id,
      name: "Test Workspace",
      slug: "test-workspace",
    });
    workspaceId = workspace.id;
  });

  describe("GET /api/admin/stats", () => {
    it("should return 403 for regular users", async () => {
      const request = createAuthenticatedGetRequest("/api/admin/stats", regularUser);
      const { GET } = await import("@/app/api/admin/stats/route");
      const response = await GET(request);

      expect(response.status).toBe(403);
    });

    it("should return 401 for unauthenticated requests", async () => {
      const request = createGetRequest("/api/admin/stats");
      const { GET } = await import("@/app/api/admin/stats/route");
      const response = await GET(request);

      expect(response.status).toBe(401);
    });

    it("should return all six stat fields as numbers for superadmin with window=all", async () => {
      // Create some test data
      await db.task.create({
        data: {
          title: "Completed Task",
          workspaceId,
          status: "DONE",
          createdById: superAdminUser.id,
          updatedById: superAdminUser.id,
        },
      });
      await db.task.create({
        data: {
          title: "In Progress Task",
          workspaceId,
          status: "IN_PROGRESS",
          createdById: superAdminUser.id,
          updatedById: superAdminUser.id,
        },
      });
      await db.user.create({
        data: {
          email: "newuser@test.com",
          name: "New User",
          deleted: false,
        },
      });

      const request = createAuthenticatedGetRequest("/api/admin/stats?window=all", superAdminUser);
      const { GET } = await import("@/app/api/admin/stats/route");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data).toHaveProperty("tasksCompleted");
      expect(data).toHaveProperty("tasksInProgress");
      expect(data).toHaveProperty("tasksCreated");
      expect(data).toHaveProperty("prsMerged");
      expect(data).toHaveProperty("activePods");
      expect(data).toHaveProperty("totalUsers");

      expect(typeof data.tasksCompleted).toBe("number");
      expect(typeof data.tasksInProgress).toBe("number");
      expect(typeof data.tasksCreated).toBe("number");
      expect(typeof data.prsMerged).toBe("number");
      expect(typeof data.activePods).toBe("number");
      expect(typeof data.totalUsers).toBe("number");

      expect(data.tasksCompleted).toBe(1);
      expect(data.tasksInProgress).toBe(1);
      expect(data.tasksCreated).toBe(2);
    });

    it("should filter tasks and PRs by time window for 7d", async () => {
      const now = new Date();
      const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
      const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

      // Create tasks with specific timestamps
      await db.task.create({
        data: {
          title: "Old Completed Task",
          workspaceId,
          status: "DONE",
          createdById: superAdminUser.id,
          updatedById: superAdminUser.id,
          createdAt: eightDaysAgo,
        },
      });
      await db.task.create({
        data: {
          title: "Recent Completed Task",
          workspaceId,
          status: "DONE",
          createdById: superAdminUser.id,
          updatedById: superAdminUser.id,
          createdAt: fiveDaysAgo,
        },
      });
      await db.task.create({
        data: {
          title: "Recent In Progress Task",
          workspaceId,
          status: "IN_PROGRESS",
          createdById: superAdminUser.id,
          updatedById: superAdminUser.id,
          createdAt: fiveDaysAgo,
        },
      });

      // Create a chat message to attach artifacts to
      const chatMessage = await db.chatMessage.create({
        data: {
          role: "ASSISTANT",
          message: "Test message",
          task: {
            create: {
              title: "Task for artifacts",
              workspaceId,
              createdById: superAdminUser.id,
              updatedById: superAdminUser.id,
            },
          },
        },
      });

      // Create artifacts with specific timestamps
      await db.artifact.create({
        data: {
          type: "PULL_REQUEST",
          content: { status: "DONE", url: "https://github.com/test/test/pull/1" },
          messageId: chatMessage.id,
          createdAt: eightDaysAgo,
        },
      });
      await db.artifact.create({
        data: {
          type: "PULL_REQUEST",
          content: { status: "DONE", url: "https://github.com/test/test/pull/2" },
          messageId: chatMessage.id,
          createdAt: fiveDaysAgo,
        },
      });

      const request = createAuthenticatedGetRequest("/api/admin/stats?window=7d", superAdminUser);
      const { GET } = await import("@/app/api/admin/stats/route");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();

      // Only recent tasks should be counted
      expect(data.tasksCompleted).toBe(1); // Only the recent completed task
      expect(data.tasksInProgress).toBe(1); // Only the recent in-progress task
      expect(data.tasksCreated).toBe(3); // Recent completed + recent in-progress + task for artifacts

      // Only recent PR should be counted
      expect(data.prsMerged).toBe(1);
    });

    it("should return activePods and totalUsers unaffected by window param", async () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);

      // Create a user with old timestamp
      await db.user.create({
        data: {
          email: "olduser@test.com",
          name: "Old User",
          deleted: false,
          createdAt: oldDate,
        },
      });

      // Create swarm and pod
      const swarm = await db.swarm.create({
        data: {
          name: `test-swarm-${Date.now()}`,
          workspaceId,
        },
      });
      await db.pod.create({
        data: {
          podId: `test-pod-${Date.now()}`,
          swarmId: swarm.id,
          status: "RUNNING",
          deletedAt: null,
        },
      });

      // Test with 24h window
      const request24h = createAuthenticatedGetRequest("/api/admin/stats?window=24h", superAdminUser);
      const { GET } = await import("@/app/api/admin/stats/route");
      const response24h = await GET(request24h);
      const data24h = await response24h.json();

      // Test with all window
      const requestAll = createAuthenticatedGetRequest("/api/admin/stats?window=all", superAdminUser);
      const responseAll = await GET(requestAll);
      const dataAll = await responseAll.json();

      // activePods and totalUsers should be the same regardless of window
      expect(data24h.activePods).toBe(dataAll.activePods);
      expect(data24h.totalUsers).toBe(dataAll.totalUsers);
      expect(data24h.activePods).toBe(1);
      expect(data24h.totalUsers).toBeGreaterThanOrEqual(3); // superadmin + regular + olduser
    });

    it("should default invalid window param to all", async () => {
      await db.task.create({
        data: {
          title: "Test Task",
          workspaceId,
          status: "DONE",
          createdById: superAdminUser.id,
          updatedById: superAdminUser.id,
        },
      });

      const request = createAuthenticatedGetRequest("/api/admin/stats?window=invalid", superAdminUser);
      const { GET } = await import("@/app/api/admin/stats/route");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      
      // Should return all stats without filtering
      expect(data.tasksCompleted).toBe(1);
      expect(typeof data.tasksCreated).toBe("number");
      expect(typeof data.activePods).toBe("number");
      expect(typeof data.totalUsers).toBe("number");
    });
  });
});
