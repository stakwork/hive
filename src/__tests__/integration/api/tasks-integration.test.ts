import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET, POST } from "@/app/api/tasks/route";
import { db } from "@/lib/db";
import { TaskStatus, Priority, WorkflowStatus } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  generateUniqueId,
  createGetRequest,
  createPostRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures/workspace";

// Mock Pusher for real-time notification tests
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue({}),
  },
  getTaskChannelName: vi.fn((taskId: string) => `task-${taskId}`),
  PUSHER_EVENTS: {
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
    NEW_MESSAGE: "new-message",
  },
}));

// Mock Stakwork service for workflow integration tests
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-stakwork-key",
    STAKWORK_BASE_URL: "https://test-stakwork.com",
    STAKWORK_WORKFLOW_ID: "123,456,789",
  },
}));

describe("POST /api/tasks - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("End-to-End Database Persistence", () => {
    test("should persist task with all fields to database", async () => {
      const scenario = await createTestWorkspaceScenario({
        withRepository: true,
      });

      const assignee = await createTestUser({ name: "Assignee User" });
      await db.workspaceMember.create({
        data: {
          workspaceId: scenario.workspace.id,
          userId: assignee.id,
          role: "DEVELOPER",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const requestBody = {
        title: "Integration Test Task",
        description: "Full integration test",
        workspaceSlug: scenario.workspace.slug,
        status: "TODO",
        priority: "HIGH",
        assigneeId: assignee.id,
        repositoryId: scenario.repository!.id,
        estimatedHours: 8,
      };

      const request = createPostRequest("http://localhost:3000/api/tasks", requestBody);

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      // Verify response structure
      expect(data.success).toBe(true);
      expect(data.data).toMatchObject({
        title: "Integration Test Task",
        description: "Full integration test",
        status: TaskStatus.TODO,
        priority: Priority.HIGH,
        estimatedHours: 8,
      });

      // Verify database persistence
      const persistedTask = await db.task.findUnique({
        where: { id: data.data.id },
        include: {
          assignee: true,
          repository: true,
          createdBy: true,
        },
      });

      expect(persistedTask).toBeTruthy();
      expect(persistedTask?.title).toBe("Integration Test Task");
      expect(persistedTask?.workspaceId).toBe(scenario.workspace.id);
      expect(persistedTask?.assigneeId).toBe(assignee.id);
      expect(persistedTask?.repositoryId).toBe(scenario.repository!.id);
      expect(persistedTask?.createdById).toBe(scenario.owner.id);
      expect(persistedTask?.updatedById).toBe(scenario.owner.id);
      expect(persistedTask?.deleted).toBe(false);
    });

    test("should persist task with minimal required fields", async () => {
      const scenario = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const requestBody = {
        title: "Minimal Task",
        workspaceSlug: scenario.workspace.slug,
      };

      const request = createPostRequest("http://localhost:3000/api/tasks", requestBody);

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      // Verify database persistence with defaults
      const persistedTask = await db.task.findUnique({
        where: { id: data.data.id },
      });

      expect(persistedTask).toBeTruthy();
      expect(persistedTask?.title).toBe("Minimal Task");
      expect(persistedTask?.description).toBeNull();
      expect(persistedTask?.status).toBe(TaskStatus.TODO);
      expect(persistedTask?.priority).toBe(Priority.MEDIUM);
      expect(persistedTask?.assigneeId).toBeNull();
      expect(persistedTask?.repositoryId).toBeNull();
      expect(persistedTask?.deleted).toBe(false);
    });

    test("should maintain audit trail with timestamps", async () => {
      const scenario = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const beforeCreate = new Date();

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Audit Trail Task",
        workspaceSlug: scenario.workspace.slug,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      const afterCreate = new Date();

      const persistedTask = await db.task.findUnique({
        where: { id: data.data.id },
      });

      expect(persistedTask?.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
      expect(persistedTask?.createdAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
      expect(persistedTask?.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
      expect(persistedTask?.updatedAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
      expect(persistedTask?.createdById).toBe(scenario.owner.id);
      expect(persistedTask?.updatedById).toBe(scenario.owner.id);
    });
  });

  describe("Foreign Key Constraints", () => {
    test("should enforce workspace foreign key constraint", async () => {
      const scenario = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      // Try to create task with non-existent workspace
      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Invalid Workspace Task",
        workspaceSlug: "non-existent-workspace",
      });

      const response = await POST(request);
      await expectError(response, "Workspace not found", 404);
    });

    test("should validate assignee exists and is not deleted", async () => {
      const scenario = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Invalid Assignee Task",
        workspaceSlug: scenario.workspace.slug,
        assigneeId: "non-existent-user-id",
      });

      const response = await POST(request);
      await expectError(response, "Assignee not found", 400);
    });

    test("should validate repository belongs to workspace", async () => {
      const scenario = await createTestWorkspaceScenario({
        withRepository: true,
      });

      // Create a different workspace with repository
      const otherScenario = await createTestWorkspaceScenario({
        withRepository: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      // Try to link task to repository from different workspace
      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Wrong Repository Task",
        workspaceSlug: scenario.workspace.slug,
        repositoryId: otherScenario.repository!.id,
      });

      const response = await POST(request);
      await expectError(response, "Repository not found or does not belong to this workspace", 400);
    });
  });

  describe("Soft Delete Behavior", () => {
    test("should filter out soft-deleted tasks from GET endpoint", async () => {
      const scenario = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      // Create two tasks
      const task1 = await db.task.create({
        data: {
          title: "Active Task",
          workspaceId: scenario.workspace.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
          deleted: false,
        },
      });

      const task2 = await db.task.create({
        data: {
          title: "Deleted Task",
          workspaceId: scenario.workspace.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
          deleted: true,
          deletedAt: new Date(),
        },
      });

      const request = createGetRequest("http://localhost:3000/api/tasks", {
        workspaceId: scenario.workspace.id,
      });

      const response = await GET(request);
      const data = await expectSuccess(response);

      // Should only return non-deleted task
      expect(data.data).toHaveLength(1);
      expect(data.data[0].id).toBe(task1.id);
      expect(data.data.find((t: any) => t.id === task2.id)).toBeUndefined();
    });
  });

  describe("Concurrent Operations", () => {
    test("should handle concurrent task creations correctly", async () => {
      const scenario = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      // Create multiple tasks concurrently
      const requests = Array.from({ length: 5 }, (_, i) =>
        POST(
          createPostRequest("http://localhost:3000/api/tasks", {
            title: `Concurrent Task ${i + 1}`,
            workspaceSlug: scenario.workspace.slug,
          })
        )
      );

      const responses = await Promise.all(requests);

      // All requests should succeed
      for (const response of responses) {
        expect(response.status).toBe(201);
      }

      // Verify all tasks were created in database
      const tasks = await db.task.findMany({
        where: {
          workspaceId: scenario.workspace.id,
          deleted: false,
        },
      });

      expect(tasks).toHaveLength(5);
      const titles = tasks.map(t => t.title).sort();
      expect(titles).toEqual([
        "Concurrent Task 1",
        "Concurrent Task 2",
        "Concurrent Task 3",
        "Concurrent Task 4",
        "Concurrent Task 5",
      ]);
    });

    test("should handle concurrent GET requests without data corruption", async () => {
      const scenario = await createTestWorkspaceScenario();

      // Create test tasks
      await db.task.createMany({
        data: Array.from({ length: 10 }, (_, i) => ({
          title: `Task ${i + 1}`,
          workspaceId: scenario.workspace.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
        })),
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      // Execute multiple concurrent GET requests
      const requests = Array.from({ length: 10 }, () =>
        GET(
          createGetRequest("http://localhost:3000/api/tasks", {
            workspaceId: scenario.workspace.id,
          })
        )
      );

      const responses = await Promise.all(requests);

      // All requests should succeed with consistent data
      for (const response of responses) {
        const data = await expectSuccess(response);
        expect(data.data).toHaveLength(10);
        expect(data.pagination.totalCount).toBe(10);
      }
    });
  });

  describe("Edge Cases", () => {
    test("should handle very long task titles and descriptions", async () => {
      const scenario = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const longTitle = "a".repeat(500);
      const longDescription = "b".repeat(5000);

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: longTitle,
        description: longDescription,
        workspaceSlug: scenario.workspace.slug,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      const persistedTask = await db.task.findUnique({
        where: { id: data.data.id },
      });

      expect(persistedTask?.title).toBe(longTitle);
      expect(persistedTask?.description).toBe(longDescription);
    });

    test("should handle special characters in task content", async () => {
      const scenario = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const specialTitle = 'Task with 🚀 emojis and special chars: àáâäåæçèéêë & <html> tags';
      const specialDescription = 'Description with quotes "double" and \'single\' plus newlines\n\nand spaces';

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: specialTitle,
        description: specialDescription,
        workspaceSlug: scenario.workspace.slug,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      const persistedTask = await db.task.findUnique({
        where: { id: data.data.id },
      });

      expect(persistedTask?.title).toBe(specialTitle);
      expect(persistedTask?.description).toBe(specialDescription);
    });

    test("should handle pagination with large page numbers", async () => {
      const scenario = await createTestWorkspaceScenario();

      // Create 5 tasks
      await db.task.createMany({
        data: Array.from({ length: 5 }, (_, i) => ({
          title: `Task ${i + 1}`,
          workspaceId: scenario.workspace.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
        })),
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      // Request page beyond available data
      const request = createGetRequest("http://localhost:3000/api/tasks", {
        workspaceId: scenario.workspace.id,
        page: "10",
        limit: "5",
      });

      const response = await GET(request);
      const data = await expectSuccess(response);

      expect(data.data).toHaveLength(0);
      expect(data.pagination).toMatchObject({
        page: 10,
        limit: 5,
        totalCount: 5,
        totalPages: 1,
        hasMore: false,
      });
    });

    test("should handle empty workspace with no tasks", async () => {
      const scenario = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createGetRequest("http://localhost:3000/api/tasks", {
        workspaceId: scenario.workspace.id,
      });

      const response = await GET(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data).toEqual([]);
      expect(data.pagination).toMatchObject({
        page: 1,
        limit: 20,
        totalCount: 0,
        totalPages: 0,
        hasMore: false,
      });
    });
  });

  describe("Status and Priority Enum Handling", () => {
    test("should map 'active' status to IN_PROGRESS", async () => {
      const scenario = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Active Status Task",
        workspaceSlug: scenario.workspace.slug,
        status: "active",
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      const persistedTask = await db.task.findUnique({
        where: { id: data.data.id },
      });

      expect(persistedTask?.status).toBe(TaskStatus.IN_PROGRESS);
    });

    test("should default priority to MEDIUM when not specified", async () => {
      const scenario = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Default Priority Task",
        workspaceSlug: scenario.workspace.slug,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      const persistedTask = await db.task.findUnique({
        where: { id: data.data.id },
      });

      expect(persistedTask?.priority).toBe(Priority.MEDIUM);
    });

    test("should persist all valid TaskStatus enum values", async () => {
      const scenario = await createTestWorkspaceScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const statuses: TaskStatus[] = [
        TaskStatus.TODO,
        TaskStatus.IN_PROGRESS,
        TaskStatus.DONE,
        TaskStatus.CANCELLED,
      ];

      for (const status of statuses) {
        const request = createPostRequest("http://localhost:3000/api/tasks", {
          title: `Task with ${status} status`,
          workspaceSlug: scenario.workspace.slug,
          status,
        });

        const response = await POST(request);
        const data = await expectSuccess(response, 201);

        const persistedTask = await db.task.findUnique({
          where: { id: data.data.id },
        });

        expect(persistedTask?.status).toBe(status);
      }
    });

    test("should persist all valid Priority enum values", async () => {
      const scenario = await createTestWorkspaceScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const priorities: Priority[] = [
        Priority.LOW,
        Priority.MEDIUM,
        Priority.HIGH,
        Priority.CRITICAL,
      ];

      for (const priority of priorities) {
        const request = createPostRequest("http://localhost:3000/api/tasks", {
          title: `Task with ${priority} priority`,
          workspaceSlug: scenario.workspace.slug,
          priority,
        });

        const response = await POST(request);
        const data = await expectSuccess(response, 201);

        const persistedTask = await db.task.findUnique({
          where: { id: data.data.id },
        });

        expect(persistedTask?.priority).toBe(priority);
      }
    });
  });

  describe("Workspace Access Control", () => {
    test("should allow workspace owner to create tasks", async () => {
      const scenario = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Owner Task",
        workspaceSlug: scenario.workspace.slug,
      });

      const response = await POST(request);
      await expectSuccess(response, 201);
    });

    test("should allow workspace members to create tasks", async () => {
      const scenario = await createTestWorkspaceScenario({
        members: [{ role: "DEVELOPER" }],
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.members[0]));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Member Task",
        workspaceSlug: scenario.workspace.slug,
      });

      const response = await POST(request);
      await expectSuccess(response, 201);
    });

    test("should deny access for non-members", async () => {
      const scenario = await createTestWorkspaceScenario();
      const outsider = await createTestUser({ name: "Outsider User" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(outsider));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Unauthorized Task",
        workspaceSlug: scenario.workspace.slug,
      });

      const response = await POST(request);
      await expectError(response, "Access denied", 403);
    });

    test("should allow workspace owner to list all tasks", async () => {
      const scenario = await createTestWorkspaceScenario();

      // Create tasks by different members
      await db.task.createMany({
        data: [
          {
            title: "Owner Task",
            workspaceId: scenario.workspace.id,
            status: TaskStatus.TODO,
            priority: Priority.MEDIUM,
            createdById: scenario.owner.id,
            updatedById: scenario.owner.id,
          },
        ],
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createGetRequest("http://localhost:3000/api/tasks", {
        workspaceId: scenario.workspace.id,
      });

      const response = await GET(request);
      const data = await expectSuccess(response);

      expect(data.data).toHaveLength(1);
    });

    test("should allow workspace members to list all tasks", async () => {
      const scenario = await createTestWorkspaceScenario({
        members: [{ role: "DEVELOPER" }],
      });

      await db.task.create({
        data: {
          title: "Owner Task",
          workspaceId: scenario.workspace.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.members[0]));

      const request = createGetRequest("http://localhost:3000/api/tasks", {
        workspaceId: scenario.workspace.id,
      });

      const response = await GET(request);
      const data = await expectSuccess(response);

      expect(data.data).toHaveLength(1);
    });

    test("should deny task listing for non-members", async () => {
      const scenario = await createTestWorkspaceScenario();
      const outsider = await createTestUser({ name: "Outsider User" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(outsider));

      const request = createGetRequest("http://localhost:3000/api/tasks", {
        workspaceId: scenario.workspace.id,
      });

      const response = await GET(request);
      await expectError(response, "Access denied", 403);
    });
  });
});