import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/tasks/[taskId]/route";
import { db } from "@/lib/db";
import { startTaskWorkflow } from "@/services/task-workflow";
import { pusherServer } from "@/lib/pusher";
import { getWorkspaceChannelName } from "@/lib/utils";
import { sanitizeTask } from "@/lib/helpers/tasks";
import { TaskStatus, WorkflowStatus } from "@prisma/client";

// Mock external dependencies
vi.mock("@/services/task-workflow", () => ({
  startTaskWorkflow: vi.fn(),
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn(),
  },
  PUSHER_EVENTS: {
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
  },
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
}));

vi.mock("@/lib/helpers/tasks", () => ({
  sanitizeTask: vi.fn((task: any) => {
    const { agentPassword, ...sanitized } = task;
    return sanitized;
  }),
}));

vi.mock("@/lib/middleware/utils", async () => {
  const { NextResponse } = await import("next/server");
  return {
    getMiddlewareContext: vi.fn((request: any) => ({
      user: request._mockUser || null,
    })),
    requireAuth: vi.fn((context: any) => {
      if (!context.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return context.user;
    }),
  };
});

const mockStartTaskWorkflow = vi.mocked(startTaskWorkflow);
const mockPusherTrigger = vi.mocked(pusherServer.trigger);
const mockSanitizeTask = vi.mocked(sanitizeTask);

describe("PATCH /api/tasks/[taskId] - Task Update Endpoint", () => {
  let testUser: any;
  let testWorkspace: any;
  let testTask: any;
  let testRepository: any;
  let otherUser: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test user
    testUser = await db.user.create({
      data: {
        name: "Test Owner",
        email: "owner@test.com",
      },
    });

    // Create other user (not a member)
    otherUser = await db.user.create({
      data: {
        name: "Other User",
        email: "other@test.com",
      },
    });

    // Create test workspace
    testWorkspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: testUser.id,
      },
    });

    // Create test repository
    testRepository = await db.repository.create({
      data: {
        name: "test-repo",
        repositoryUrl: "https://github.com/test/repo",
        branch: "main",
        workspaceId: testWorkspace.id,
      },
    });

    // Create test task
    testTask = await db.task.create({
      data: {
        title: "Test Task",
        description: "Test task description",
        status: "TODO",
        priority: "MEDIUM",
        workflowStatus: "PENDING",
        sourceType: "USER",
        mode: "live",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
        assigneeId: testUser.id,
        repositoryId: testRepository.id,
      },
    });

    // Mock Pusher to resolve successfully
    mockPusherTrigger.mockResolvedValue(undefined as any);
  });

  afterEach(async () => {
    // Clean up in reverse order of dependencies
    await db.artifact.deleteMany({});
    await db.chatMessage.deleteMany({});
    await db.task.deleteMany({});
    await db.repository.deleteMany({});
    await db.workspaceMember.deleteMany({});
    await db.workspace.deleteMany({});
    await db.user.deleteMany({});
  });

  describe("Authentication", () => {
    test("should return 401 when user is not authenticated", async () => {
      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Authorization", () => {
    test("should return 404 for non-existent task", async () => {
      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      (request as any)._mockUser = { id: testUser.id };

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: "non-existent-id" }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Task not found");
    });

    test("should return 404 for deleted task", async () => {
      await db.task.update({
        where: { id: testTask.id },
        data: { deleted: true },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      (request as any)._mockUser = { id: testUser.id };

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Task not found");
    });

    test("should return 403 when user is not workspace owner or member", async () => {
      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      (request as any)._mockUser = { id: otherUser.id };

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Access denied");
    });

    test("should allow workspace owner to update task", async () => {
      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      (request as any)._mockUser = { id: testUser.id };

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
    });

    test("should allow workspace member to update task", async () => {
      // Add other user as workspace member
      await db.workspaceMember.create({
        data: {
          workspaceId: testWorkspace.id,
          userId: otherUser.id,
          role: "DEVELOPER",
        },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      (request as any)._mockUser = { id: otherUser.id };

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
    });
  });

  describe("Field Updates", () => {
    test("should update task status successfully", async () => {
      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      (request as any)._mockUser = { id: testUser.id };

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.task.status).toBe("IN_PROGRESS");

      // Verify database was updated
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(updatedTask?.status).toBe("IN_PROGRESS");
    });

    test("should update task workflowStatus successfully", async () => {
      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({ workflowStatus: "COMPLETED" }),
      });
      (request as any)._mockUser = { id: testUser.id };

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.task.workflowStatus).toBe("COMPLETED");

      // Verify database was updated
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(updatedTask?.workflowStatus).toBe("COMPLETED");
    });

    test("should archive task and set archivedAt", async () => {
      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      });
      (request as any)._mockUser = { id: testUser.id };

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.task.archived).toBe(true);
      expect(result.task.archivedAt).toBeDefined();

      // Verify database was updated
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(updatedTask?.archived).toBe(true);
      expect(updatedTask?.archivedAt).toBeInstanceOf(Date);
    });

    test("should unarchive task and clear archivedAt", async () => {
      // First archive the task
      await db.task.update({
        where: { id: testTask.id },
        data: { archived: true, archivedAt: new Date() },
      });

      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({ archived: false }),
      });
      (request as any)._mockUser = { id: testUser.id };

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.task.archived).toBe(false);
      expect(result.task.archivedAt).toBeNull();

      // Verify database was updated
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(updatedTask?.archived).toBe(false);
      expect(updatedTask?.archivedAt).toBeNull();
    });

    test("should update multiple fields simultaneously", async () => {
      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({
          status: "DONE",
          workflowStatus: "COMPLETED",
          archived: true,
        }),
      });
      (request as any)._mockUser = { id: testUser.id };

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.task.status).toBe("DONE");
      expect(result.task.workflowStatus).toBe("COMPLETED");
      expect(result.task.archived).toBe(true);
    });

    test("should update updatedById field", async () => {
      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      (request as any)._mockUser = { id: testUser.id };

      await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      // Verify updatedById was set
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(updatedTask?.updatedById).toBe(testUser.id);
    });
  });

  describe("Validation", () => {
    test("should return 400 for invalid status enum", async () => {
      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({ status: "INVALID_STATUS" }),
      });
      (request as any)._mockUser = { id: testUser.id };

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Invalid status");
      expect(data.error).toContain("TODO");
      expect(data.error).toContain("IN_PROGRESS");
      expect(data.error).toContain("DONE");
    });

    test("should return 400 for invalid workflowStatus enum", async () => {
      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({ workflowStatus: "INVALID_WORKFLOW_STATUS" }),
      });
      (request as any)._mockUser = { id: testUser.id };

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Invalid workflowStatus");
      expect(data.error).toContain("PENDING");
      expect(data.error).toContain("COMPLETED");
    });

    test("should return 400 for invalid archived type", async () => {
      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({ archived: "not-a-boolean" }),
      });
      (request as any)._mockUser = { id: testUser.id };

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Invalid archived value");
      expect(data.error).toContain("boolean");
    });
  });

  describe("Workflow Triggering", () => {
    test("should trigger workflow when startWorkflow is true", async () => {
      mockStartTaskWorkflow.mockResolvedValue({
        success: true,
        stakworkData: {
          project_id: "stakwork-123",
        },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({
          startWorkflow: true,
          mode: "live",
        }),
      });
      (request as any)._mockUser = { id: testUser.id };

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.workflow).toBeDefined();
      expect(result.workflow.project_id).toBe("stakwork-123");

      // Verify startTaskWorkflow was called correctly
      expect(mockStartTaskWorkflow).toHaveBeenCalledWith({
        taskId: testTask.id,
        userId: testUser.id,
        mode: "live",
      });
    });

    test("should use default mode 'live' when not specified", async () => {
      mockStartTaskWorkflow.mockResolvedValue({
        success: true,
        stakworkData: {},
      } as any);

      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({
          startWorkflow: true,
        }),
      });
      (request as any)._mockUser = { id: testUser.id };

      await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(mockStartTaskWorkflow).toHaveBeenCalledWith({
        taskId: testTask.id,
        userId: testUser.id,
        mode: "live",
      });
    });

    test("should not trigger workflow when startWorkflow is false", async () => {
      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({
          status: "IN_PROGRESS",
          startWorkflow: false,
        }),
      });
      (request as any)._mockUser = { id: testUser.id };

      await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(mockStartTaskWorkflow).not.toHaveBeenCalled();
    });
  });

  describe("Pusher Broadcasting", () => {
    test("should broadcast status update to Pusher", async () => {
      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      (request as any)._mockUser = { id: testUser.id };

      await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      // Verify Pusher was called
      expect(mockPusherTrigger).toHaveBeenCalledWith(
        "workspace-test-workspace",
        "workspace-task-title-update",
        expect.objectContaining({
          taskId: testTask.id,
          status: "IN_PROGRESS",
        })
      );
    });

    test("should include all updated fields in Pusher payload", async () => {
      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({
          status: "DONE",
          workflowStatus: "COMPLETED",
          archived: true,
        }),
      });
      (request as any)._mockUser = { id: testUser.id };

      await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(mockPusherTrigger).toHaveBeenCalledWith(
        "workspace-test-workspace",
        "workspace-task-title-update",
        expect.objectContaining({
          taskId: testTask.id,
          status: "DONE",
          workflowStatus: "COMPLETED",
          archived: true,
          archivedAt: expect.any(Date),
          timestamp: expect.any(Date),
        })
      );
    });

    test("should not fail request if Pusher broadcasting fails", async () => {
      mockPusherTrigger.mockRejectedValueOnce(new Error("Pusher error"));

      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      (request as any)._mockUser = { id: testUser.id };

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      // Request should still succeed
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
    });
  });

  describe("Response Sanitization", () => {
    test("should sanitize task in response when no updates provided", async () => {
      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({}),
      });
      (request as any)._mockUser = { id: testUser.id };

      await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(mockSanitizeTask).toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    test("should return 500 on database error", async () => {
      const request = new NextRequest("http://localhost:3000/api/tasks/123", {
        method: "PATCH",
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      (request as any)._mockUser = { id: testUser.id };

      // Mock database error
      vi.spyOn(db.task, "findFirst").mockRejectedValueOnce(
        new Error("Database error")
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to update task");
    });
  });
});