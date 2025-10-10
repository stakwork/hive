import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET, POST } from "@/app/api/tasks/route";
import { TaskStatus, Priority, WorkflowStatus, ArtifactType } from "@prisma/client";
import { db } from "@/lib/db";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
  expectError,
  createGetRequest,
  createPostRequest,
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";
import {
  createTestUser,
  createTestWorkspace,
  createTestTask,
  createTestWorkspaceScenario,
  resetDatabase,
} from "@/__tests__/support/fixtures";

describe("GET /api/tasks", () => {
  let testUser: { id: string; email: string; name: string };
  let testWorkspace: { id: string; slug: string; ownerId: string };
  let otherUser: { id: string; email: string; name: string };
  let memberUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();

    // Create test users and workspace
    testUser = await createTestUser({ email: `owner-${generateUniqueId()}@example.com` });
    testWorkspace = await createTestWorkspace({
      name: "Test Workspace",
      slug: generateUniqueSlug("test-workspace"),
      ownerId: testUser.id,
    });

    // Create other users for authorization tests
    otherUser = await createTestUser({ email: `other-${generateUniqueId()}@example.com` });
    memberUser = await createTestUser({ email: `member-${generateUniqueId()}@example.com` });

    // Add member to workspace
    await db.workspaceMember.create({
      data: {
        userId: memberUser.id,
        workspaceId: testWorkspace.id,
        role: "DEVELOPER",
      },
    });
  });

  describe("Authentication", () => {
    test("should return 401 when no session provided", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const response = await GET(request);

      await expectUnauthorized(response);
    });

    test("should return 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({ user: null });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const response = await GET(request);

      await expectUnauthorized(response);
    });

    test("should return 401 when session user has no id", async () => {
      getMockedSession().mockResolvedValue({ user: { name: "Test User" } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const response = await GET(request);

      expect(response?.status).toBe(401);
      const data = await response?.json();
      expect(data.error).toBe("Invalid user session");
    });
  });

  describe("Input Validation", () => {
    test("should return 400 when workspaceId is missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/tasks");

      const response = await GET(request);

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toBe("workspaceId query parameter is required");
    });

    test("should return 400 when page is less than 1", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}&page=0`
      );

      const response = await GET(request);

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toContain("Invalid pagination parameters");
    });

    test("should return 400 when limit is less than 1", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}&limit=0`
      );

      const response = await GET(request);

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toContain("Invalid pagination parameters");
    });

    test("should return 400 when limit exceeds 100", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}&limit=101`
      );

      const response = await GET(request);

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toContain("Invalid pagination parameters");
    });

    test("should accept valid pagination parameters", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}&page=1&limit=10`
      );

      const response = await GET(request);

      expect(response?.status).toBe(200);
      const data = await response?.json();
      expect(data.success).toBe(true);
    });
  });

  describe("Authorization & Access Control", () => {
    test("should return 404 when workspace does not exist", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const nonExistentWorkspaceId = "non-existent-workspace-id";
      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${nonExistentWorkspaceId}`
      );

      const response = await GET(request);

      await expectNotFound(response);
    });

    test("should return 404 for soft-deleted workspace", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Soft-delete the workspace
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const response = await GET(request);

      await expectNotFound(response);
    });

    test("should return 403 when user is not workspace owner or member", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(otherUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const response = await GET(request);

      await expectForbidden(response);
    });

    test("should allow access for workspace owner", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const response = await GET(request);

      expect(response?.status).toBe(200);
      const data = await response?.json();
      expect(data.success).toBe(true);
    });

    test("should allow access for workspace member", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const response = await GET(request);

      expect(response?.status).toBe(200);
      const data = await response?.json();
      expect(data.success).toBe(true);
    });
  });

  describe("Task Retrieval", () => {
    test("should return empty array when no tasks exist", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data).toEqual([]);
      expect(data.pagination.totalCount).toBe(0);
      expect(data.pagination.hasMore).toBe(false);
    });

    test("should return tasks with assignee, repository, and createdBy relations", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Create repository
      const repository = await db.repository.create({
        data: {
          name: "Test Repo",
          repositoryUrl: "https://github.com/test/repo",
          workspaceId: testWorkspace.id,
        },
      });

      // Create task with relations
      await createTestTask({
        title: "Test Task",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        assigneeId: memberUser.id,
        repositoryId: repository.id,
      });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data).toHaveLength(1);
      
      const task = data.data[0];
      expect(task.assignee).toMatchObject({
        id: memberUser.id,
        name: memberUser.name,
        email: memberUser.email,
      });
      expect(task.repository).toMatchObject({
        id: repository.id,
        name: repository.name,
        repositoryUrl: repository.repositoryUrl,
      });
      expect(task.createdBy).toMatchObject({
        id: testUser.id,
        name: testUser.name,
        email: testUser.email,
      });
    });

    test("should filter out soft-deleted tasks", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Create active task
      await createTestTask({
        title: "Active Task",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      });

      // Create deleted task
      const deletedTask = await createTestTask({
        title: "Deleted Task",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      });
      await db.task.update({
        where: { id: deletedTask.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].title).toBe("Active Task");
    });

    test("should order tasks by createdAt descending", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Create tasks in specific order
      const task1 = await createTestTask({
        title: "First Task",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const task2 = await createTestTask({
        title: "Second Task",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data).toHaveLength(2);
      // Most recent first
      expect(data.data[0].title).toBe("Second Task");
      expect(data.data[1].title).toBe("First Task");
    });
  });

  describe("Pagination", () => {
    beforeEach(async () => {
      // Create 15 tasks for pagination testing
      for (let i = 1; i <= 15; i++) {
        await createTestTask({
          title: `Task ${i}`,
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
        });
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    });

    test("should paginate results with default limit of 5", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data).toHaveLength(5);
      expect(data.pagination).toMatchObject({
        page: 1,
        limit: 5,
        totalCount: 15,
        totalPages: 3,
        hasMore: true,
      });
    });

    test("should return second page with correct pagination", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}&page=2&limit=5`
      );

      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data).toHaveLength(5);
      expect(data.pagination).toMatchObject({
        page: 2,
        limit: 5,
        totalCount: 15,
        totalPages: 3,
        hasMore: true,
      });
    });

    test("should return last page with correct hasMore flag", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}&page=3&limit=5`
      );

      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data).toHaveLength(5);
      expect(data.pagination).toMatchObject({
        page: 3,
        limit: 5,
        totalCount: 15,
        totalPages: 3,
        hasMore: false,
      });
    });

    test("should handle custom limit", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}&limit=10`
      );

      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data).toHaveLength(10);
      expect(data.pagination).toMatchObject({
        page: 1,
        limit: 10,
        totalCount: 15,
        totalPages: 2,
        hasMore: true,
      });
    });
  });

  describe("includeLatestMessage Flag", () => {
    test("should not include chatMessages by default", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const task = await createTestTask({
        title: "Task with Messages",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      });

      // Create chat message
      await db.chatMessage.create({
        data: {
          message: "Test message",
          role: "USER",
          status: "SENT",
          taskId: task.id,
          timestamp: new Date(),
        },
      });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data[0].chatMessages).toBeUndefined();
      expect(data.data[0].hasActionArtifact).toBeUndefined();
    });

    test("should include latest message when includeLatestMessage is true", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const task = await createTestTask({
        title: "Task with Messages",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      });

      const message = await db.chatMessage.create({
        data: {
          message: "Test message",
          role: "USER",
          status: "SENT",
          taskId: task.id,
          timestamp: new Date(),
        },
      });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}&includeLatestMessage=true`
      );

      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data[0]._count.chatMessages).toBe(1);
      expect(data.data[0].hasActionArtifact).toBe(false);
    });

    test("should set hasActionArtifact to true when FORM artifact exists and workflow is PENDING", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const task = await createTestTask({
        title: "Task with Action Artifact",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        workflowStatus: WorkflowStatus.PENDING,
      });

      const message = await db.chatMessage.create({
        data: {
          message: "Test message",
          role: "ASSISTANT",
          status: "SENT",
          taskId: task.id,
          timestamp: new Date(),
        },
      });

      await db.artifact.create({
        data: {
          type: ArtifactType.FORM,
          content: { actionText: "Approve", options: [] },
          messageId: message.id,
        },
      });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}&includeLatestMessage=true`
      );

      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data[0].hasActionArtifact).toBe(true);
    });

    test("should set hasActionArtifact to true when FORM artifact exists and workflow is IN_PROGRESS", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const task = await createTestTask({
        title: "Task with Action Artifact",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      });

      const message = await db.chatMessage.create({
        data: {
          message: "Test message",
          role: "ASSISTANT",
          status: "SENT",
          taskId: task.id,
          timestamp: new Date(),
        },
      });

      await db.artifact.create({
        data: {
          type: ArtifactType.FORM,
          content: { actionText: "Approve", options: [] },
          messageId: message.id,
        },
      });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}&includeLatestMessage=true`
      );

      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data[0].hasActionArtifact).toBe(true);
    });

    test("should set hasActionArtifact to false when workflow is COMPLETED", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const task = await createTestTask({
        title: "Completed Task",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        workflowStatus: WorkflowStatus.COMPLETED,
      });

      const message = await db.chatMessage.create({
        data: {
          message: "Test message",
          role: "ASSISTANT",
          status: "SENT",
          taskId: task.id,
          timestamp: new Date(),
        },
      });

      await db.artifact.create({
        data: {
          type: ArtifactType.FORM,
          content: { actionText: "Approve", options: [] },
          messageId: message.id,
        },
      });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}&includeLatestMessage=true`
      );

      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data[0].hasActionArtifact).toBe(false);
    });

    test("should set hasActionArtifact to false when artifact type is CODE", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const task = await createTestTask({
        title: "Task with Code Artifact",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      });

      const message = await db.chatMessage.create({
        data: {
          message: "Test message",
          role: "ASSISTANT",
          status: "SENT",
          taskId: task.id,
          timestamp: new Date(),
        },
      });

      await db.artifact.create({
        data: {
          type: ArtifactType.CODE,
          content: { language: "javascript", code: "console.log('test');" },
          messageId: message.id,
        },
      });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}&includeLatestMessage=true`
      );

      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data.data[0].hasActionArtifact).toBe(false);
    });
  });

  describe("Response Structure", () => {
    test("should return correct response structure", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      await createTestTask({
        title: "Test Task",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const response = await GET(request);

      const data = await expectSuccess(response);
      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("data");
      expect(data).toHaveProperty("pagination");
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.pagination).toMatchObject({
        page: expect.any(Number),
        limit: expect.any(Number),
        totalCount: expect.any(Number),
        totalPages: expect.any(Number),
        hasMore: expect.any(Boolean),
      });
    });

    test("should include all expected task fields", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      await createTestTask({
        title: "Complete Task",
        description: "Task description",
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.HIGH,
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const response = await GET(request);

      const data = await expectSuccess(response);
      const task = data.data[0];

      expect(task).toHaveProperty("id");
      expect(task).toHaveProperty("title");
      expect(task).toHaveProperty("description");
      expect(task).toHaveProperty("status");
      expect(task).toHaveProperty("priority");
      expect(task).toHaveProperty("workflowStatus");
      expect(task).toHaveProperty("createdAt");
      expect(task).toHaveProperty("updatedAt");
      expect(task).toHaveProperty("createdBy");
      expect(task).toHaveProperty("_count");
    });
  });

  describe("Error Handling", () => {
    test("should handle database errors gracefully", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock database error by passing invalid workspace ID format
      const request = createGetRequest(
        "http://localhost:3000/api/tasks?workspaceId=invalid-id-format"
      );

      const response = await GET(request);

      // Should handle error without crashing
      expect(response?.status).toBeOneOf([404, 500]);
      const data = await response?.json();
      expect(data).toHaveProperty("error");
    });
  });
});

describe("POST /api/tasks", () => {
  let testUser: { id: string; email: string; name: string };
  let testWorkspace: { id: string; slug: string; ownerId: string };
  let otherUser: { id: string; email: string; name: string };
  let memberUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();

    // Create test users and workspace
    testUser = await createTestUser({ email: `owner-${generateUniqueId()}@example.com` });
    testWorkspace = await createTestWorkspace({
      name: "Test Workspace",
      slug: generateUniqueSlug("test-workspace"),
      ownerId: testUser.id,
    });

    otherUser = await createTestUser({ email: `other-${generateUniqueId()}@example.com` });
    memberUser = await createTestUser({ email: `member-${generateUniqueId()}@example.com` });

    // Add member to workspace
    await db.workspaceMember.create({
      data: {
        userId: memberUser.id,
        workspaceId: testWorkspace.id,
        role: "DEVELOPER",
      },
    });
  });

  describe("Authentication", () => {
    test("should return 401 when no session provided", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        workspaceSlug: testWorkspace.slug,
      });

      const response = await POST(request);

      await expectUnauthorized(response);
    });

    test("should return 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({ user: null });

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        workspaceSlug: testWorkspace.slug,
      });

      const response = await POST(request);

      await expectUnauthorized(response);
    });

    test("should return 401 when session user has no id", async () => {
      getMockedSession().mockResolvedValue({ user: { name: "Test User" } });

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        workspaceSlug: testWorkspace.slug,
      });

      const response = await POST(request);

      expect(response?.status).toBe(401);
      const data = await response?.json();
      expect(data.error).toBe("Invalid user session");
    });
  });

  describe("Input Validation", () => {
    test("should return 400 when title is missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        workspaceSlug: testWorkspace.slug,
      });

      const response = await POST(request);

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toContain("Missing required fields");
    });

    test("should return 400 when workspaceSlug is missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
      });

      const response = await POST(request);

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toContain("Missing required fields");
    });

    test("should return 400 when both title and workspaceSlug are missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {});

      const response = await POST(request);

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toContain("Missing required fields");
    });

    test("should return 400 for invalid status enum", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        workspaceSlug: testWorkspace.slug,
        status: "INVALID_STATUS",
      });

      const response = await POST(request);

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toContain("Invalid status");
    });

    test("should return 400 for invalid priority enum", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        workspaceSlug: testWorkspace.slug,
        priority: "INVALID_PRIORITY",
      });

      const response = await POST(request);

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toContain("Invalid priority");
    });

    test("should return 400 when assignee does not exist", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        workspaceSlug: testWorkspace.slug,
        assigneeId: "non-existent-user-id",
      });

      const response = await POST(request);

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toBe("Assignee not found");
    });

    test("should return 400 when assignee is soft-deleted", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Soft-delete the member user
      await db.user.update({
        where: { id: memberUser.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        workspaceSlug: testWorkspace.slug,
        assigneeId: memberUser.id,
      });

      const response = await POST(request);

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toBe("Assignee not found");
    });

    test("should return 400 when repository does not exist", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        workspaceSlug: testWorkspace.slug,
        repositoryId: "non-existent-repo-id",
      });

      const response = await POST(request);

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toContain("Repository not found");
    });

    test("should return 400 when repository belongs to different workspace", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Create different workspace and repository
      const otherWorkspace = await createTestWorkspace({
        name: "Other Workspace",
        slug: generateUniqueSlug("other-workspace"),
        ownerId: otherUser.id,
      });

      const repository = await db.repository.create({
        data: {
          name: "Other Repo",
          repositoryUrl: "https://github.com/other/repo",
          workspaceId: otherWorkspace.id,
        },
      });

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        workspaceSlug: testWorkspace.slug,
        repositoryId: repository.id,
      });

      const response = await POST(request);

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toContain("Repository not found or does not belong to this workspace");
    });
  });

  describe("Authorization & Access Control", () => {
    test("should return 404 when workspace does not exist", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        workspaceSlug: "non-existent-workspace",
      });

      const response = await POST(request);

      await expectNotFound(response);
    });

    test("should return 404 for soft-deleted workspace", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Soft-delete the workspace
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        workspaceSlug: testWorkspace.slug,
      });

      const response = await POST(request);

      await expectNotFound(response);
    });

    test("should return 404 when user does not exist in database", async () => {
      const nonExistentUser = {
        id: "non-existent-user-id",
        email: "nonexistent@example.com",
        name: "Non Existent",
      };
      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonExistentUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        workspaceSlug: testWorkspace.slug,
      });

      const response = await POST(request);

      expect(response?.status).toBe(404);
      const data = await response?.json();
      expect(data.error).toBe("User not found");
    });

    test("should return 403 when user is not workspace owner or member", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(otherUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        workspaceSlug: testWorkspace.slug,
      });

      const response = await POST(request);

      await expectForbidden(response);
    });

    test("should allow task creation for workspace owner", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        workspaceSlug: testWorkspace.slug,
      });

      const response = await POST(request);

      expect(response?.status).toBe(201);
      const data = await response?.json();
      expect(data.success).toBe(true);
    });

    test("should allow task creation for workspace member", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        workspaceSlug: testWorkspace.slug,
      });

      const response = await POST(request);

      expect(response?.status).toBe(201);
      const data = await response?.json();
      expect(data.success).toBe(true);
    });
  });

  describe("Task Creation", () => {
    test("should create task with only required fields", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Minimal Task",
        workspaceSlug: testWorkspace.slug,
      });

      const response = await POST(request);

      expect(response?.status).toBe(201);
      const data = await response?.json();

      expect(data.success).toBe(true);
      expect(data.data).toMatchObject({
        title: "Minimal Task",
        workspaceId: testWorkspace.id,
        status: TaskStatus.TODO, // default
        priority: Priority.MEDIUM, // default
        createdById: testUser.id,
        updatedById: testUser.id,
      });

      // Verify in database
      const dbTask = await db.task.findUnique({
        where: { id: data.data.id },
      });
      expect(dbTask).toBeTruthy();
      expect(dbTask?.title).toBe("Minimal Task");
    });

    test("should create task with all optional fields", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const repository = await db.repository.create({
        data: {
          name: "Test Repo",
          repositoryUrl: "https://github.com/test/repo",
          workspaceId: testWorkspace.id,
        },
      });

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Complete Task",
        description: "Detailed description",
        workspaceSlug: testWorkspace.slug,
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.HIGH,
        assigneeId: memberUser.id,
        repositoryId: repository.id,
        estimatedHours: 8,
        actualHours: 5,
      });

      const response = await POST(request);

      expect(response?.status).toBe(201);
      const data = await response?.json();

      expect(data.success).toBe(true);
      expect(data.data).toMatchObject({
        title: "Complete Task",
        description: "Detailed description",
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.HIGH,
        assigneeId: memberUser.id,
        repositoryId: repository.id,
        estimatedHours: 8,
        actualHours: 5,
      });
    });

    test("should trim whitespace from title", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "  Task with whitespace  ",
        workspaceSlug: testWorkspace.slug,
      });

      const response = await POST(request);

      expect(response?.status).toBe(201);
      const data = await response?.json();
      expect(data.data.title).toBe("Task with whitespace");
    });

    test("should trim whitespace from description", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        description: "  Description with whitespace  ",
        workspaceSlug: testWorkspace.slug,
      });

      const response = await POST(request);

      expect(response?.status).toBe(201);
      const data = await response?.json();
      expect(data.data.description).toBe("Description with whitespace");
    });

    test("should handle null description", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Task without description",
        workspaceSlug: testWorkspace.slug,
        description: null,
      });

      const response = await POST(request);

      expect(response?.status).toBe(201);
      const data = await response?.json();
      expect(data.data.description).toBeNull();
    });

    test("should map 'active' status to IN_PROGRESS", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Active Task",
        workspaceSlug: testWorkspace.slug,
        status: "active", // Frontend sends this
      });

      const response = await POST(request);

      expect(response?.status).toBe(201);
      const data = await response?.json();
      expect(data.data.status).toBe(TaskStatus.IN_PROGRESS);
    });

    test("should accept valid TaskStatus enum values", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const statuses = [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.DONE];

      for (const status of statuses) {
        const request = createPostRequest("http://localhost:3000/api/tasks", {
          title: `Task with ${status}`,
          workspaceSlug: testWorkspace.slug,
          status,
        });

        const response = await POST(request);

        expect(response?.status).toBe(201);
        const data = await response?.json();
        expect(data.data.status).toBe(status);
      }
    });

    test("should accept valid Priority enum values when explicitly provided", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const priorities = [Priority.LOW, Priority.HIGH, Priority.URGENT];

      for (const priority of priorities) {
        const request = createPostRequest("http://localhost:3000/api/tasks", {
          title: `Task with ${priority} priority`,
          workspaceSlug: testWorkspace.slug,
          priority,
        });

        const response = await POST(request);

        expect(response?.status).toBe(201);
        const data = await response?.json();
        expect(data.data.priority).toBe(priority);
      }
    });
    
    test("should use default priority when none provided", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Task with default priority",
        workspaceSlug: testWorkspace.slug,
        // No priority provided
      });

      const response = await POST(request);

      expect(response?.status).toBe(201);
      const data = await response?.json();
      expect(data.data.priority).toBe(Priority.MEDIUM);
    });

    test("should set createdById and updatedById to current user", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        workspaceSlug: testWorkspace.slug,
      });

      const response = await POST(request);

      expect(response?.status).toBe(201);
      const data = await response?.json();
      expect(data.data.createdById).toBe(testUser.id);
      expect(data.data.updatedById).toBe(testUser.id);
    });
  });

  describe("Response Structure", () => {
    test("should return correct response structure with relations", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const repository = await db.repository.create({
        data: {
          name: "Test Repo",
          repositoryUrl: "https://github.com/test/repo",
          workspaceId: testWorkspace.id,
        },
      });

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        workspaceSlug: testWorkspace.slug,
        assigneeId: memberUser.id,
        repositoryId: repository.id,
      });

      const response = await POST(request);

      expect(response?.status).toBe(201);
      const data = await response?.json();

      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("data");

      // Verify assignee relation
      expect(data.data.assignee).toMatchObject({
        id: memberUser.id,
        name: memberUser.name,
        email: memberUser.email,
      });

      // Verify repository relation
      expect(data.data.repository).toMatchObject({
        id: repository.id,
        name: repository.name,
        repositoryUrl: repository.repositoryUrl,
      });

      // Verify createdBy relation
      expect(data.data.createdBy).toMatchObject({
        id: testUser.id,
        name: testUser.name,
        email: testUser.email,
      });

      // Verify workspace relation
      expect(data.data.workspace).toMatchObject({
        id: testWorkspace.id,
        name: testWorkspace.name,
        slug: testWorkspace.slug,
      });
    });

    test("should include githubAuth in createdBy relation", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Add GitHub auth to test user
      await db.gitHubAuth.create({
        data: {
          userId: testUser.id,
          githubUserId: "12345",
          githubUsername: "testuser",
        },
      });

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        workspaceSlug: testWorkspace.slug,
      });

      const response = await POST(request);

      expect(response?.status).toBe(201);
      const data = await response?.json();

      expect(data.data.createdBy.githubAuth).toBeDefined();
      expect(data.data.createdBy.githubAuth.githubUsername).toBe("testuser");
    });
  });

  describe("Error Handling", () => {
    test("should handle database errors gracefully", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Create a task to simulate potential constraint violations
      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Test Task",
        workspaceSlug: testWorkspace.slug,
        assigneeId: "malformed-uuid-format",
      });

      const response = await POST(request);

      expect(response?.status).toBeOneOf([400, 500]);
      const data = await response?.json();
      expect(data).toHaveProperty("error");
    });

    test("should return 201 when title is extremely long", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock a database failure by using an extremely long title that might exceed limits
      const veryLongTitle = "a".repeat(10000);

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: veryLongTitle,
        workspaceSlug: testWorkspace.slug,
      });

      const response = await POST(request);

      // Should handle request successfully (title is just truncated or stored as is)
      expect(response?.status).toBe(201);
      const data = await response?.json();
      expect(data.success).toBe(true);
    });
  });

  describe("Database Integration", () => {
    test("should properly store task in database with all fields", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const repository = await db.repository.create({
        data: {
          name: "Test Repo",
          repositoryUrl: "https://github.com/test/repo",
          workspaceId: testWorkspace.id,
        },
      });

      const taskData = {
        title: "Database Test Task",
        description: "Test description",
        workspaceSlug: testWorkspace.slug,
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.HIGH,
        assigneeId: memberUser.id,
        repositoryId: repository.id,
        estimatedHours: 10,
        actualHours: 5,
      };

      const request = createPostRequest("http://localhost:3000/api/tasks", taskData);

      const response = await POST(request);

      expect(response?.status).toBe(201);
      const data = await response?.json();

      // Verify task in database
      const dbTask = await db.task.findUnique({
        where: { id: data.data.id },
        include: {
          assignee: true,
          repository: true,
          createdBy: true,
          workspace: true,
        },
      });

      expect(dbTask).toBeTruthy();
      expect(dbTask?.title).toBe("Database Test Task");
      expect(dbTask?.description).toBe("Test description");
      expect(dbTask?.status).toBe(TaskStatus.IN_PROGRESS);
      expect(dbTask?.priority).toBe(Priority.HIGH);
      expect(dbTask?.assigneeId).toBe(memberUser.id);
      expect(dbTask?.repositoryId).toBe(repository.id);
      expect(dbTask?.estimatedHours).toBe(10);
      expect(dbTask?.actualHours).toBe(5);
      expect(dbTask?.createdById).toBe(testUser.id);
      expect(dbTask?.updatedById).toBe(testUser.id);
      expect(dbTask?.deleted).toBe(false);
    });

    test("should create task with timestamps", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Timestamp Test Task",
        workspaceSlug: testWorkspace.slug,
      });

      const beforeCreate = new Date();
      const response = await POST(request);
      const afterCreate = new Date();

      expect(response?.status).toBe(201);
      const data = await response?.json();

      const createdAt = new Date(data.data.createdAt);
      const updatedAt = new Date(data.data.updatedAt);

      expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
      expect(createdAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
      expect(updatedAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
      expect(updatedAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
    });
  });
});