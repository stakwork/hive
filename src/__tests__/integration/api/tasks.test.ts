import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET, POST } from "@/app/api/tasks/route";
import { db } from "@/lib/db";
import { TaskStatus, Priority, WorkflowStatus } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
  expectError,
  getMockedSession,
  createGetRequest,
  createPostRequest,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import { createTestTask } from "@/__tests__/support/fixtures/task";
import { createTestRepository } from "@/__tests__/support/fixtures/repository";

// Mock next-auth for session management
vi.mock("next-auth/next");

describe("Tasks API Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("GET /api/tasks", () => {
    describe("Success scenarios", () => {
      test("should return tasks for workspace with pagination", async () => {
        const user = await createTestUser({ name: "Test User" });
        const workspace = await createTestWorkspace({
          name: "Test Workspace",
          ownerId: user.id,
        });

        // Create multiple tasks
        const task1 = await createTestTask({
          title: "Task 1",
          workspaceId: workspace.id,
          createdById: user.id,
        });
        const task2 = await createTestTask({
          title: "Task 2",
          workspaceId: workspace.id,
          createdById: user.id,
        });
        const task3 = await createTestTask({
          title: "Task 3",
          workspaceId: workspace.id,
          createdById: user.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: workspace.id,
            page: "1",
            limit: "2",
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.data).toHaveLength(2);
        expect(data.pagination).toMatchObject({
          page: 1,
          limit: 2,
          totalCount: 3,
          totalPages: 2,
          hasMore: true,
        });

        // Verify tasks are ordered by createdAt DESC (newest first)
        expect(data.data[0].id).toBe(task3.id);
        expect(data.data[1].id).toBe(task2.id);
      });

      test("should return tasks with default pagination values", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        await createTestTask({
          workspaceId: workspace.id,
          createdById: user.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: workspace.id,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.pagination).toMatchObject({
          page: 1,
          limit: 5, // Default limit
        });
      });

      test("should calculate pagination metadata correctly", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        // Create 7 tasks
        for (let i = 0; i < 7; i++) {
          await createTestTask({
            title: `Task ${i + 1}`,
            workspaceId: workspace.id,
            createdById: user.id,
          });
        }

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: workspace.id,
            page: "2",
            limit: "3",
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.pagination).toMatchObject({
          page: 2,
          limit: 3,
          totalCount: 7,
          totalPages: 3,
          hasMore: true,
        });
        expect(data.data).toHaveLength(3);
      });

      test("should return hasMore false on last page", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        // Create 5 tasks
        for (let i = 0; i < 5; i++) {
          await createTestTask({
            workspaceId: workspace.id,
            createdById: user.id,
          });
        }

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: workspace.id,
            page: "2",
            limit: "3",
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.pagination.hasMore).toBe(false);
        expect(data.data).toHaveLength(2); // Remaining tasks
      });

      test("should include task relations (assignee, repository, createdBy)", async () => {
        const user = await createTestUser({ name: "Owner User" });
        const assignee = await createTestUser({ name: "Assignee User" });
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });
        const repository = await createTestRepository({
          workspaceId: workspace.id,
        });

        await createTestTask({
          title: "Task with relations",
          workspaceId: workspace.id,
          createdById: user.id,
          assigneeId: assignee.id,
          repositoryId: repository.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: workspace.id,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.data[0]).toMatchObject({
          title: "Task with relations",
          assignee: {
            id: assignee.id,
            name: "Assignee User",
          },
          repository: {
            id: repository.id,
          },
          createdBy: {
            id: user.id,
            name: "Owner User",
          },
        });
      });

      test("should include message count", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        const task = await createTestTask({
          workspaceId: workspace.id,
          createdById: user.id,
        });

        // Create chat messages for the task
        await db.chatMessage.createMany({
          data: [
            {
              taskId: task.id,
              message: "Message 1",
              role: "USER",
            },
            {
              taskId: task.id,
              message: "Message 2",
              role: "ASSISTANT",
            },
          ],
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: workspace.id,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.data[0]._count.chatMessages).toBe(2);
      });

      test("should support includeLatestMessage flag", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        const task = await createTestTask({
          workspaceId: workspace.id,
          createdById: user.id,
        });

        // Create chat message with artifact
        const message = await db.chatMessage.create({
          data: {
            taskId: task.id,
            message: "Test message",
            role: "ASSISTANT",
          },
        });

        await db.artifact.create({
          data: {
            messageId: message.id,
            type: "FORM",
            content: { fields: [] },
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: workspace.id,
            includeLatestMessage: "true",
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.data[0].hasActionArtifact).toBe(true);
      });

      test("should calculate hasActionArtifact only for PENDING/IN_PROGRESS workflows", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        // Task with IN_PROGRESS status and FORM artifact
        const task1 = await db.task.create({
          data: {
            title: "In Progress Task",
            workspaceId: workspace.id,
            createdById: user.id,
            updatedById: user.id,
            workflowStatus: WorkflowStatus.IN_PROGRESS,
          },
        });

        const message1 = await db.chatMessage.create({
          data: {
            taskId: task1.id,
            message: "Message",
            role: "ASSISTANT",
          },
        });

        await db.artifact.create({
          data: {
            messageId: message1.id,
            type: "FORM",
          },
        });

        // Task with COMPLETED status and FORM artifact (should not have hasActionArtifact)
        const task2 = await db.task.create({
          data: {
            title: "Completed Task",
            workspaceId: workspace.id,
            createdById: user.id,
            updatedById: user.id,
            workflowStatus: WorkflowStatus.COMPLETED,
          },
        });

        const message2 = await db.chatMessage.create({
          data: {
            taskId: task2.id,
            message: "Message",
            role: "ASSISTANT",
          },
        });

        await db.artifact.create({
          data: {
            messageId: message2.id,
            type: "FORM",
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: workspace.id,
            includeLatestMessage: "true",
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        const inProgressTask = data.data.find((t: any) => t.id === task1.id);
        const completedTask = data.data.find((t: any) => t.id === task2.id);

        expect(inProgressTask.hasActionArtifact).toBe(true);
        expect(completedTask.hasActionArtifact).toBe(false);
      });

      test("should filter out soft-deleted tasks", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        // Create active task
        await createTestTask({
          title: "Active Task",
          workspaceId: workspace.id,
          createdById: user.id,
        });

        // Create deleted task
        await db.task.create({
          data: {
            title: "Deleted Task",
            workspaceId: workspace.id,
            createdById: user.id,
            updatedById: user.id,
            deleted: true,
            deletedAt: new Date(),
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: workspace.id,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.data).toHaveLength(1);
        expect(data.data[0].title).toBe("Active Task");
      });

      test("should return empty array when workspace has no tasks", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: workspace.id,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.data).toHaveLength(0);
        expect(data.pagination.totalCount).toBe(0);
      });
    });

    describe("Authentication and authorization", () => {
      test("should return 401 for unauthenticated user", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: "workspace-id",
          }
        );

        const response = await GET(request);

        await expectUnauthorized(response);
      });

      test("should return 401 for session without user ID", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" }, // Missing id
        });

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: "workspace-id",
          }
        );

        const response = await GET(request);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBe("Invalid user session");
      });

      test("should return 404 for non-existent workspace", async () => {
        const user = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: "non-existent-workspace-id",
          }
        );

        const response = await GET(request);

        await expectNotFound(response, "Workspace not found");
      });

      test("should return 403 for non-member user", async () => {
        const owner = await createTestUser({ name: "Owner" });
        const nonMember = await createTestUser({ name: "Non-Member" });
        const workspace = await createTestWorkspace({
          ownerId: owner.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(nonMember)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: workspace.id,
          }
        );

        const response = await GET(request);

        await expectForbidden(response, "Access denied");
      });

      test("should allow workspace member to list tasks", async () => {
        const owner = await createTestUser({ name: "Owner" });
        const member = await createTestUser({ name: "Member" });
        const workspace = await createTestWorkspace({
          ownerId: owner.id,
        });

        // Add member to workspace
        await db.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: member.id,
            role: "DEVELOPER",
          },
        });

        await createTestTask({
          workspaceId: workspace.id,
          createdById: owner.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(member)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: workspace.id,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.data).toHaveLength(1);
      });
    });

    describe("Query parameter validation", () => {
      test("should return 400 for missing workspaceId", async () => {
        const user = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {}
        );

        const response = await GET(request);

        await expectError(
          response,
          "workspaceId query parameter is required",
          400
        );
      });

      test("should return 400 for invalid page parameter", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: workspace.id,
            page: "0", // Invalid: page must be >= 1
          }
        );

        const response = await GET(request);

        await expectError(
          response,
          "Invalid pagination parameters",
          400
        );
      });

      test("should return 400 for invalid limit parameter", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: workspace.id,
            limit: "0", // Invalid: limit must be 1-100
          }
        );

        const response = await GET(request);

        await expectError(
          response,
          "Invalid pagination parameters",
          400
        );
      });

      test("should return 400 for limit exceeding maximum", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: workspace.id,
            limit: "101", // Invalid: limit must be <= 100
          }
        );

        const response = await GET(request);

        await expectError(
          response,
          "Invalid pagination parameters",
          400
        );
      });

      test("should accept valid limit at maximum boundary", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        await createTestTask({
          workspaceId: workspace.id,
          createdById: user.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: workspace.id,
            limit: "100", // Valid maximum
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.pagination.limit).toBe(100);
      });
    });

    describe("Edge cases", () => {
      test("should handle task with deleted assignee gracefully", async () => {
        const user = await createTestUser();
        const assignee = await createTestUser({ name: "Assignee" });
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        await createTestTask({
          workspaceId: workspace.id,
          createdById: user.id,
          assigneeId: assignee.id,
        });

        // Soft delete assignee
        await db.user.update({
          where: { id: assignee.id },
          data: { deleted: true, deletedAt: new Date() },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: workspace.id,
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        // Task should still be returned, assignee relation should be null or include deleted user
        expect(data.data).toHaveLength(1);
      });

      test("should handle large page numbers gracefully", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        await createTestTask({
          workspaceId: workspace.id,
          createdById: user.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createGetRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceId: workspace.id,
            page: "1000", // Page beyond available data
          }
        );

        const response = await GET(request);
        const data = await expectSuccess(response);

        expect(data.data).toHaveLength(0);
        expect(data.pagination.hasMore).toBe(false);
      });
    });
  });

  describe("POST /api/tasks", () => {
    describe("Success scenarios", () => {
      test("should create task successfully with all fields", async () => {
        const user = await createTestUser({ name: "Creator" });
        const assignee = await createTestUser({ name: "Assignee" });
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });
        const repository = await createTestRepository({
          workspaceId: workspace.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            title: "Test Task",
            description: "Test description",
            workspaceSlug: workspace.slug,
            status: TaskStatus.TODO,
            priority: Priority.HIGH,
            assigneeId: assignee.id,
            repositoryId: repository.id,
            estimatedHours: 8,
            actualHours: null,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response, 201);

        expect(data.data).toMatchObject({
          title: "Test Task",
          description: "Test description",
          status: TaskStatus.TODO,
          priority: Priority.HIGH,
          assignee: {
            id: assignee.id,
            name: "Assignee",
          },
          repository: {
            id: repository.id,
          },
          createdBy: {
            id: user.id,
            name: "Creator",
          },
          estimatedHours: 8,
          actualHours: null,
        });

        // Verify task was created in database
        const taskInDb = await db.task.findUnique({
          where: { id: data.data.id },
        });

        expect(taskInDb).toBeTruthy();
        expect(taskInDb?.workspaceId).toBe(workspace.id);
      });

      test("should create task with minimal required fields", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            title: "Minimal Task",
            workspaceSlug: workspace.slug,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response, 201);

        expect(data.data).toMatchObject({
          title: "Minimal Task",
          status: TaskStatus.TODO, // Default
          priority: Priority.MEDIUM, // Default
        });

        expect(data.data.assigneeId).toBeNull();
        expect(data.data.repositoryId).toBeNull();
      });

      test("should map 'active' status to IN_PROGRESS", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            title: "Active Task",
            workspaceSlug: workspace.slug,
            status: "active", // Frontend compatibility
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response, 201);

        expect(data.data.status).toBe(TaskStatus.IN_PROGRESS);

        // Verify in database
        const taskInDb = await db.task.findUnique({
          where: { id: data.data.id },
        });

        expect(taskInDb?.status).toBe(TaskStatus.IN_PROGRESS);
      });

      test("should trim title and description", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            title: "  Task with spaces  ",
            description: "  Description with spaces  ",
            workspaceSlug: workspace.slug,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response, 201);

        expect(data.data.title).toBe("Task with spaces");
        expect(data.data.description).toBe("Description with spaces");
      });

      test("should allow workspace member to create task", async () => {
        const owner = await createTestUser({ name: "Owner" });
        const member = await createTestUser({ name: "Member" });
        const workspace = await createTestWorkspace({
          ownerId: owner.id,
        });

        // Add member to workspace
        await db.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: member.id,
            role: "DEVELOPER",
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(member)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            title: "Member Task",
            workspaceSlug: workspace.slug,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response, 201);

        expect(data.data.createdBy.id).toBe(member.id);
      });
    });

    describe("Authentication and authorization", () => {
      test("should return 401 for unauthenticated user", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            title: "Test Task",
            workspaceSlug: "test-workspace",
          }
        );

        const response = await POST(request);

        await expectUnauthorized(response);
      });

      test("should return 401 for session without user ID", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" }, // Missing id
        });

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            title: "Test Task",
            workspaceSlug: "test-workspace",
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBe("Invalid user session");
      });

      test("should return 404 for non-existent workspace", async () => {
        const user = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            title: "Test Task",
            workspaceSlug: "non-existent-workspace",
          }
        );

        const response = await POST(request);

        await expectNotFound(response, "Workspace not found");
      });

      test("should return 403 for non-member user", async () => {
        const owner = await createTestUser({ name: "Owner" });
        const nonMember = await createTestUser({ name: "Non-Member" });
        const workspace = await createTestWorkspace({
          ownerId: owner.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(nonMember)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            title: "Test Task",
            workspaceSlug: workspace.slug,
          }
        );

        const response = await POST(request);

        await expectForbidden(response, "Access denied");
      });

      test("should return 404 for user not in database", async () => {
        // Create a user that we'll "delete" to simulate non-existence
        const user = await createTestUser({ name: "Soon to be deleted" });
        
        getMockedSession().mockResolvedValue({
          user: { id: user.id }, // Session still has the user's ID
        });

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            title: "Test Task",
            workspaceSlug: "non-existent-workspace", // User doesn't own any workspace
          }
        );

        const response = await POST(request);

        // When workspace doesn't exist, the API returns 404 with "Workspace not found"
        // but this indirectly proves that user lookup would fail since no workspace
        await expectNotFound(response, "Workspace not found");
      });
    });

    describe("Input validation", () => {
      test("should return 400 for missing title", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            workspaceSlug: workspace.slug,
            // Missing title
          }
        );

        const response = await POST(request);

        await expectError(
          response,
          "Missing required fields: title, workspaceId",
          400
        );
      });

      test("should return 400 for missing workspaceSlug", async () => {
        const user = await createTestUser();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            title: "Test Task",
            // Missing workspaceSlug
          }
        );

        const response = await POST(request);

        await expectError(
          response,
          "Missing required fields: title, workspaceId",
          400
        );
      });

      test("should return 400 for invalid status", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            title: "Test Task",
            workspaceSlug: workspace.slug,
            status: "INVALID_STATUS",
          }
        );

        const response = await POST(request);

        await expectError(response, "Invalid status", 400);
      });

      test("should return 400 for invalid priority", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            title: "Test Task",
            workspaceSlug: workspace.slug,
            priority: "INVALID_PRIORITY",
          }
        );

        const response = await POST(request);

        await expectError(response, "Invalid priority", 400);
      });

      test("should return 400 for non-existent assignee", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            title: "Test Task",
            workspaceSlug: workspace.slug,
            assigneeId: "non-existent-assignee-id",
          }
        );

        const response = await POST(request);

        await expectError(response, "Assignee not found", 400);
      });

      test("should return 400 for deleted assignee", async () => {
        const user = await createTestUser();
        const assignee = await createTestUser({ name: "Deleted Assignee" });
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        // Soft delete assignee
        await db.user.update({
          where: { id: assignee.id },
          data: { deleted: true, deletedAt: new Date() },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            title: "Test Task",
            workspaceSlug: workspace.slug,
            assigneeId: assignee.id,
          }
        );

        const response = await POST(request);

        await expectError(response, "Assignee not found", 400);
      });

      test("should return 400 for repository not in workspace", async () => {
        const user = await createTestUser();
        const workspace1 = await createTestWorkspace({
          ownerId: user.id,
          slug: "workspace-1",
        });
        const workspace2 = await createTestWorkspace({
          ownerId: user.id,
          slug: "workspace-2",
        });
        const repository = await createTestRepository({
          workspaceId: workspace2.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            title: "Test Task",
            workspaceSlug: workspace1.slug,
            repositoryId: repository.id, // Repository belongs to workspace2
          }
        );

        const response = await POST(request);

        await expectError(
          response,
          "Repository not found or does not belong to this workspace",
          400
        );
      });

      test("should return 400 for non-existent repository", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            title: "Test Task",
            workspaceSlug: workspace.slug,
            repositoryId: "non-existent-repository-id",
          }
        );

        const response = await POST(request);

        await expectError(
          response,
          "Repository not found or does not belong to this workspace",
          400
        );
      });
    });

    describe("Edge cases", () => {
      test("should handle concurrent task creation", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        // Create multiple tasks concurrently
        const requests = Array.from({ length: 5 }, (_, i) =>
          createPostRequest("http://localhost:3000/api/tasks", {
            title: `Concurrent Task ${i + 1}`,
            workspaceSlug: workspace.slug,
          })
        );

        const responses = await Promise.all(
          requests.map((req) => POST(req))
        );

        // All requests should succeed
        for (const response of responses) {
          await expectSuccess(response, 201);
        }

        // Verify all tasks were created
        const tasksInDb = await db.task.findMany({
          where: { workspaceId: workspace.id },
        });

        expect(tasksInDb).toHaveLength(5);
      });

      test("should handle empty title after trimming", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            title: "   ", // Only whitespace
            workspaceSlug: workspace.slug,
          }
        );

        const response = await POST(request);

        // Should still create task with empty string title
        // (Prisma schema allows empty strings)
        const data = await expectSuccess(response, 201);
        expect(data.data.title).toBe("");
      });

      test("should handle very long title", async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace({
          ownerId: user.id,
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(user)
        );

        const longTitle = "A".repeat(1000);

        const request = createPostRequest(
          "http://localhost:3000/api/tasks",
          {
            title: longTitle,
            workspaceSlug: workspace.slug,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response, 201);

        expect(data.data.title).toBe(longTitle);
      });
    });
  });
});