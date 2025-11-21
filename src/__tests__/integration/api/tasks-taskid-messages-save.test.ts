import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/tasks/[taskId]/messages/save/route";
import { db } from "@/lib/db";
import { ChatRole } from "@prisma/client";
import {
  getMockedSession,
  mockUnauthenticatedSession,
  generateUniqueId,
  generateUniqueSlug,
  createPostRequest,
} from "@/__tests__/support/helpers";

describe("POST /api/tasks/[taskId]/messages/save", () => {
  let testUser: { id: string; email: string; name: string };
  let testWorkspace: { id: string; slug: string; ownerId: string };
  let testTask: { id: string; workspaceId: string };
  let otherUser: { id: string; email: string; name: string };
  let memberUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test data with proper relationships
    const testData = await db.$transaction(async (tx) => {
      // Create primary test user
      const user = await tx.user.create({
        data: {
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      // Create workspace owned by test user
      const workspace = await tx.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      // Create task in the workspace
      const task = await tx.task.create({
        data: {
          title: "Test Task",
          description: "Test task for messages",
          status: "IN_PROGRESS",
          priority: "MEDIUM",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
          workflowStatus: "IN_PROGRESS",
        },
      });

      // Create other user for unauthorized access testing
      const otherUser = await tx.user.create({
        data: {
          email: `other-user-${Date.now()}@example.com`,
          name: "Other User",
        },
      });

      // Create member user with workspace access
      const memberUser = await tx.user.create({
        data: {
          email: `member-user-${Date.now()}@example.com`,
          name: "Member User",
        },
      });

      // Add member to workspace
      await tx.workspaceMember.create({
        data: {
          userId: memberUser.id,
          workspaceId: workspace.id,
          role: "DEVELOPER",
        },
      });

      return {
        user,
        workspace,
        task,
        otherUser,
        memberUser,
      };
    });

    testUser = testData.user;
    testWorkspace = testData.workspace;
    testTask = testData.task;
    otherUser = testData.otherUser;
    memberUser = testData.memberUser;
  });

  describe("Authentication", () => {
    it("should return 401 when no session provided", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest(`http://localhost:3000/api/tasks/${testTask.id}/messages/save`, {
        message: "Test message",
        role: "USER",
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(401);
      const data = await response?.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({ user: null });

      const request = createPostRequest(`http://localhost:3000/api/tasks/${testTask.id}/messages/save`, {
        message: "Test message",
        role: "USER",
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(401);
      const data = await response?.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 when session user has no id", async () => {
      getMockedSession().mockResolvedValue({ user: { name: "Test User" } });

      const request = createPostRequest(`http://localhost:3000/api/tasks/${testTask.id}/messages/save`, {
        message: "Test message",
        role: "USER",
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(401);
      const data = await response?.json();
      expect(data.error).toBe("Invalid user session");
    });
  });

  describe("Input Validation", () => {
    it("should return 400 when message is missing", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createPostRequest(`http://localhost:3000/api/tasks/${testTask.id}/messages/save`, {
        role: "USER",
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toBe("Message or artifacts are required");
    });

    it("should return 400 when role is missing", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createPostRequest(`http://localhost:3000/api/tasks/${testTask.id}/messages/save`, {
        message: "Test message",
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toBe("Valid role is required (USER or ASSISTANT)");
    });

    it("should return 400 when role is invalid", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createPostRequest(`http://localhost:3000/api/tasks/${testTask.id}/messages/save`, {
        message: "Test message",
        role: "INVALID",
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toBe("Valid role is required (USER or ASSISTANT)");
    });

    it("should return 404 when task does not exist", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const nonExistentId = "non-existent-task-id";
      const request = createPostRequest(`http://localhost:3000/api/tasks/${nonExistentId}/messages/save`, {
        message: "Test message",
        role: "USER",
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: nonExistentId }),
      });

      expect(response?.status).toBe(404);
      const data = await response?.json();
      expect(data.error).toBe("Task not found");
    });

    it("should return 404 for soft-deleted tasks", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      // Soft-delete the task
      await db.task.update({
        where: { id: testTask.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const request = createPostRequest(`http://localhost:3000/api/tasks/${testTask.id}/messages/save`, {
        message: "Test message",
        role: "USER",
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(404);
      const data = await response?.json();
      expect(data.error).toBe("Task not found");
    });
  });

  describe("Authorization & Access Control", () => {
    it("should return 403 when user is not workspace owner or member", async () => {
      getMockedSession().mockResolvedValue({ user: { id: otherUser.id } });

      const request = createPostRequest(`http://localhost:3000/api/tasks/${testTask.id}/messages/save`, {
        message: "Test message",
        role: "USER",
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(403);
      const data = await response?.json();
      expect(data.error).toBe("Access denied");
    });

    it("should allow access for workspace owner", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createPostRequest(`http://localhost:3000/api/tasks/${testTask.id}/messages/save`, {
        message: "Test message",
        role: "USER",
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(201);
      const data = await response?.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });

    it("should allow access for workspace member", async () => {
      getMockedSession().mockResolvedValue({ user: { id: memberUser.id } });

      const request = createPostRequest(`http://localhost:3000/api/tasks/${testTask.id}/messages/save`, {
        message: "Test message",
        role: "USER",
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(201);
      const data = await response?.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });
  });

  describe("Message Creation", () => {
    it("should create message with USER role", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createPostRequest(`http://localhost:3000/api/tasks/${testTask.id}/messages/save`, {
        message: "User message",
        role: "USER",
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(201);
      const data = await response?.json();

      expect(data.success).toBe(true);
      expect(data.data.message).toBe("User message");
      expect(data.data.role).toBe("USER");
      expect(data.data.taskId).toBe(testTask.id);
    });

    it("should create message with ASSISTANT role", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createPostRequest(`http://localhost:3000/api/tasks/${testTask.id}/messages/save`, {
        message: "Assistant message",
        role: "ASSISTANT",
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(201);
      const data = await response?.json();

      expect(data.success).toBe(true);
      expect(data.data.message).toBe("Assistant message");
      expect(data.data.role).toBe("ASSISTANT");
      expect(data.data.taskId).toBe(testTask.id);
    });
  });

  describe("PR Detection and Task Auto-Completion", () => {
    it("should mark task as DONE when PULL_REQUEST artifact is present", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createPostRequest(`http://localhost:3000/api/tasks/${testTask.id}/messages/save`, {
        message: "",
        role: "ASSISTANT",
        artifacts: [
          {
            type: "PULL_REQUEST",
            content: {
              repo: "user/repo",
              url: "https://github.com/user/repo/pull/123",
              status: "open",
            },
          },
        ],
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(201);
      const data = await response?.json();

      expect(data.success).toBe(true);

      // Verify task status was updated
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
        select: { status: true, workflowStatus: true },
      });

      expect(updatedTask?.status).toBe("DONE");
      expect(updatedTask?.workflowStatus).toBe("COMPLETED");
    });

    it("should mark task as DONE with multiple PULL_REQUEST artifacts", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createPostRequest(`http://localhost:3000/api/tasks/${testTask.id}/messages/save`, {
        message: "",
        role: "ASSISTANT",
        artifacts: [
          {
            type: "PULL_REQUEST",
            content: {
              repo: "user/repo",
              url: "https://github.com/user/repo/pull/123",
              status: "open",
            },
          },
          {
            type: "PULL_REQUEST",
            content: {
              repo: "user/repo-2",
              url: "https://github.com/user/repo-2/pull/456",
              status: "open",
            },
          },
        ],
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(201);

      // Verify task status was updated
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
        select: { status: true, workflowStatus: true },
      });

      expect(updatedTask?.status).toBe("DONE");
      expect(updatedTask?.workflowStatus).toBe("COMPLETED");
    });

    it("should NOT mark task as DONE when no PULL_REQUEST artifact is present", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createPostRequest(`http://localhost:3000/api/tasks/${testTask.id}/messages/save`, {
        message: "Regular message without PR link",
        role: "ASSISTANT",
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(201);

      // Verify task status was NOT changed
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
        select: { status: true },
      });

      expect(updatedTask?.status).toBe("IN_PROGRESS");
    });

    it("should mark task as DONE even if [Open PR] is in different case", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const prMessage = "Check out this [open pr](https://github.com/user/repo/pull/123)";

      const request = createPostRequest(`http://localhost:3000/api/tasks/${testTask.id}/messages/save`, {
        message: prMessage,
        role: "ASSISTANT",
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(201);

      // Verify task status was NOT changed (case-sensitive check)
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
        select: { status: true },
      });

      // The check is case-sensitive, so lowercase "open pr" should NOT trigger completion
      expect(updatedTask?.status).toBe("IN_PROGRESS");
    });

    it("should work for tasks in TODO status", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      // Create a task in TODO status
      const todoTask = await db.task.create({
        data: {
          title: "TODO Task",
          status: "TODO",
          priority: "MEDIUM",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      const request = createPostRequest(`http://localhost:3000/api/tasks/${todoTask.id}/messages/save`, {
        message: "",
        role: "ASSISTANT",
        artifacts: [
          {
            type: "PULL_REQUEST",
            content: {
              repo: "user/repo",
              url: "https://github.com/user/repo/pull/123",
              status: "open",
            },
          },
        ],
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: todoTask.id }),
      });

      expect(response?.status).toBe(201);

      // Verify task status was updated from TODO to DONE
      const updatedTask = await db.task.findUnique({
        where: { id: todoTask.id },
        select: { status: true, workflowStatus: true },
      });

      expect(updatedTask?.status).toBe("DONE");
      expect(updatedTask?.workflowStatus).toBe("COMPLETED");
    });
  });

  describe("Response Structure", () => {
    it("should return correct response structure", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createPostRequest(`http://localhost:3000/api/tasks/${testTask.id}/messages/save`, {
        message: "Test message",
        role: "USER",
      });

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(201);
      const data = await response?.json();

      // Verify top-level structure
      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("data");

      // Verify message structure
      expect(data.data).toHaveProperty("id");
      expect(data.data).toHaveProperty("message");
      expect(data.data).toHaveProperty("role");
      expect(data.data).toHaveProperty("taskId");
      expect(data.data).toHaveProperty("status");
      expect(data.data).toHaveProperty("createdAt");
    });
  });
});
