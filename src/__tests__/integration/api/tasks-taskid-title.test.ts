import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { PUT } from "@/app/api/tasks/[taskId]/title/route";
import { db } from "@/lib/db";
import { TaskStatus, WorkflowStatus } from "@prisma/client";
import {
  generateUniqueId,
  expectSuccess,
  expectUnauthorized,
  expectError,
  expectNotFound,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";
import type { User, Workspace, Task } from "@prisma/client";

// Mock Pusher to verify event broadcasting
const mockPusherTrigger = vi.fn();
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: (...args: any[]) => mockPusherTrigger(...args),
  },
  getTaskChannelName: (taskId: string) => `task-${taskId}`,
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  PUSHER_EVENTS: {
    TASK_TITLE_UPDATE: "TASK_TITLE_UPDATE",
    WORKSPACE_TASK_TITLE_UPDATE: "WORKSPACE_TASK_TITLE_UPDATE",
  },
}));

// Test data factory for creating complete task setup
async function createTaskTestSetup() {
  const testData = await db.$transaction(async (tx) => {
    // Create owner user
    const owner = await tx.user.create({
      data: {
        email: `owner-${generateUniqueId()}@example.com`,
        name: "Task Owner",
      },
    });

    // Create workspace
    const workspace = await tx.workspace.create({
      data: {
        name: "Test Task Workspace",
        slug: `task-workspace-${generateUniqueId()}`,
        ownerId: owner.id,
      },
    });

    // Create task
    const task = await tx.task.create({
      data: {
        id: generateUniqueId("task"),
        title: "Original Task Title",
        description: "Test task description",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
        status: TaskStatus.IN_PROGRESS,
        workflowStatus: WorkflowStatus.PENDING,
        priority: "MEDIUM",
        deleted: false,
      },
    });

    return { owner, workspace, task };
  });

  return testData;
}

// Helper to create test task with options
async function createTestTask(
  workspaceId: string,
  ownerId: string,
  options?: {
    title?: string;
    deleted?: boolean;
  }
) {
  return await db.task.create({
    data: {
      id: generateUniqueId("task"),
      title: options?.title || "Test Task",
      description: "Test description",
      workspaceId,
      createdById: ownerId,
      updatedById: ownerId,
      status: TaskStatus.TODO,
      workflowStatus: WorkflowStatus.PENDING,
      deleted: options?.deleted || false,
    },
  });
}

// Helper to create PUT request with x-api-token header
function createPutRequest(url: string, body: { title: string }, token?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["x-api-token"] = token;
  }

  return new Request(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
}

describe("PUT /api/tasks/[taskId]/title - Integration Tests", () => {
  const VALID_API_TOKEN = process.env.API_TOKEN || "test-api-token";

  beforeEach(() => {
    vi.clearAllMocks();
    mockPusherTrigger.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    test("returns 401 for requests without x-api-token header", async () => {
      const { task } = await createTaskTestSetup();

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: "New Title" }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectUnauthorized(response);
    });

    test("returns 401 for requests with invalid x-api-token", async () => {
      const { task } = await createTaskTestSetup();

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: "New Title" },
        "invalid-token"
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectUnauthorized(response);
    });

    test("allows requests with valid x-api-token header", async () => {
      const { task } = await createTaskTestSetup();

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: "New Title" },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectSuccess(response, 200);
    });
  });

  describe("Authorization & Task Validation", () => {
    test("returns 404 for non-existent task", async () => {
      const request = createPutRequest(
        "http://localhost:3000/api/tasks/non-existent-task/title",
        { title: "New Title" },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: "non-existent-task" }),
      });

      await expectNotFound(response);
    });

    test("returns 404 for soft-deleted task", async () => {
      const { workspace, owner } = await createTaskTestSetup();

      // Create deleted task
      const deletedTask = await createTestTask(workspace.id, owner.id, {
        title: "Deleted Task",
        deleted: true,
      });

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${deletedTask.id}/title`,
        { title: "New Title" },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: deletedTask.id }),
      });

      await expectNotFound(response);
    });

    test("does not enforce workspace membership (token-based auth)", async () => {
      // This test verifies the security model difference:
      // Unlike session-based endpoints, token-based endpoint doesn't validate workspace membership
      const { task } = await createTaskTestSetup();

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: "Updated by Token" },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Should succeed without workspace membership checks
      await expectSuccess(response, 200);
    });
  });

  describe("Title Validation", () => {
    test("returns 400 for missing title field", async () => {
      const { task } = await createTaskTestSetup();

      const request = new Request(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-api-token": VALID_API_TOKEN,
          },
          body: JSON.stringify({}),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectError(response, "Title is required", 400);
    });

    test("returns 400 for empty string title", async () => {
      const { task } = await createTaskTestSetup();

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: "" },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Empty string fails the !title check
      await expectError(response, "Title is required and must be a string", 400);
    });

    test("accepts whitespace-only title (gets trimmed)", async () => {
      const { task } = await createTaskTestSetup();

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: "   " },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Route trims whitespace, resulting in empty title
      const data = await expectSuccess(response, 200);
      expect(data.data.title).toBe("");
    });

    test("accepts valid title with special characters", async () => {
      const { task } = await createTaskTestSetup();

      const newTitle = "Task: Fix #123 - Update [Component] (v2.0)";

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: newTitle },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.data.title).toBe(newTitle);
    });

    test("accepts title with unicode characters", async () => {
      const { task } = await createTaskTestSetup();

      const newTitle = "修复错误 🚀 - Исправление ошибки";

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: newTitle },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.data.title).toBe(newTitle);
    });
  });

  describe("Database Integration & Persistence", () => {
    test("updates task title in database", async () => {
      const { task } = await createTaskTestSetup();

      const newTitle = "Updated Task Title";

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: newTitle },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      await expectSuccess(response, 200);

      // Verify database persistence
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
        select: { title: true, updatedAt: true },
      });

      expect(updatedTask).toBeDefined();
      expect(updatedTask!.title).toBe(newTitle);
      expect(updatedTask!.updatedAt.getTime()).toBeGreaterThan(task.updatedAt.getTime());
    });

    test("returns updated task data in response", async () => {
      const { task } = await createTaskTestSetup();

      const newTitle = "Response Validation Title";

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: newTitle },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      const data = await expectSuccess(response, 200);

      // Validate response structure
      expect(data).toHaveProperty("success");
      expect(data.success).toBe(true);
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("id");
      expect(data.data).toHaveProperty("title");
      expect(data.data).toHaveProperty("workspaceId");

      // Validate updated values
      expect(data.data.id).toBe(task.id);
      expect(data.data.title).toBe(newTitle);
    });

    test("preserves other task fields during title update", async () => {
      const { task } = await createTaskTestSetup();

      const originalDescription = task.description;
      const originalStatus = task.status;
      const originalPriority = task.priority;

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: "New Title Only" },
        VALID_API_TOKEN
      );

      await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Verify other fields unchanged
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
        select: {
          title: true,
          description: true,
          status: true,
          priority: true,
          workflowStatus: true,
        },
      });

      expect(updatedTask!.title).toBe("New Title Only");
      expect(updatedTask!.description).toBe(originalDescription);
      expect(updatedTask!.status).toBe(originalStatus);
      expect(updatedTask!.priority).toBe(originalPriority);
    });

    test("updates updatedAt timestamp", async () => {
      const { task } = await createTaskTestSetup();

      const originalUpdatedAt = task.updatedAt;

      // Wait 1ms to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 1));

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: "Timestamp Test" },
        VALID_API_TOKEN
      );

      await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
        select: { updatedAt: true },
      });

      expect(updatedTask!.updatedAt.getTime()).toBeGreaterThan(
        originalUpdatedAt.getTime()
      );
    });
  });

  describe("Pusher Broadcasting", () => {
    test("broadcasts to task channel with TASK_TITLE_UPDATE event", async () => {
      const { task } = await createTaskTestSetup();

      const newTitle = "Pusher Test Title";

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: newTitle },
        VALID_API_TOKEN
      );

      await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Verify task channel broadcast
      expect(mockPusherTrigger).toHaveBeenCalledWith(
        `task-${task.id}`,
        "TASK_TITLE_UPDATE",
        expect.objectContaining({
          taskId: task.id,
          newTitle: newTitle,
        }),
      );
    });

    test("broadcasts to workspace channel with WORKSPACE_TASK_TITLE_UPDATE event", async () => {
      const { task, workspace } = await createTaskTestSetup();

      const newTitle = "Workspace Broadcast Test";

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: newTitle },
        VALID_API_TOKEN
      );

      await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Verify workspace channel broadcast
      expect(mockPusherTrigger).toHaveBeenCalledWith(
        `workspace-${workspace.slug}`,
        "WORKSPACE_TASK_TITLE_UPDATE",
        expect.objectContaining({
          taskId: task.id,
          newTitle: newTitle,
        }),
      );
    });

    test("broadcasts to both channels (dual-channel pattern)", async () => {
      const { task, workspace } = await createTaskTestSetup();

      const newTitle = "Dual Channel Test";

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: newTitle },
        VALID_API_TOKEN
      );

      await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Verify both channels received broadcasts
      expect(mockPusherTrigger).toHaveBeenCalledTimes(2);

      const calls = mockPusherTrigger.mock.calls;
      const taskChannelCall = calls.find((call) => call[0] === `task-${task.id}`);
      const workspaceChannelCall = calls.find(
        (call) => call[0] === `workspace-${workspace.slug}`
      );

      expect(taskChannelCall).toBeDefined();
      expect(workspaceChannelCall).toBeDefined();
    });

    test("includes previousTitle in workspace channel event", async () => {
      const { task, workspace } = await createTaskTestSetup();

      const originalTitle = task.title;
      const newTitle = "Previous Title Test";

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: newTitle },
        VALID_API_TOKEN
      );

      await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Verify workspace channel includes previous title
      expect(mockPusherTrigger).toHaveBeenCalledWith(
        `workspace-${workspace.slug}`,
        "WORKSPACE_TASK_TITLE_UPDATE",
        expect.objectContaining({
          taskId: task.id,
          newTitle: newTitle,
          previousTitle: originalTitle,
        }),
      );
    });

    test("continues on Pusher error (non-blocking)", async () => {
      const { task } = await createTaskTestSetup();

      // Simulate Pusher failure
      mockPusherTrigger.mockRejectedValue(new Error("Pusher connection error"));

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: "Pusher Error Test" },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Should still succeed even if Pusher fails
      await expectSuccess(response, 200);

      // Verify database update occurred despite Pusher error
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
        select: { title: true },
      });

      expect(updatedTask!.title).toBe("Pusher Error Test");
    });
  });

  describe("Error Handling", () => {
    test("returns 500 for database errors", async () => {
      const { task } = await createTaskTestSetup();

      // Force database error by mocking db.task.update
      const originalUpdate = db.task.update;
      db.task.update = vi
        .fn()
        .mockRejectedValue(new Error("Database connection error"));

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: "Database Error Test" },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Restore original function
      db.task.update = originalUpdate;

      await expectError(response, "Failed to update task title", 500);
    });

    test("validates response format consistency on success", async () => {
      const { task } = await createTaskTestSetup();

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: "Format Consistency Test" },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      const data = await expectSuccess(response, 200);

      // Validate top-level response format
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("data");
      expect(data.success).toBe(true);

      // Validate required fields in task (only what's in the select)
      expect(data.data).toHaveProperty("id");
      expect(data.data).toHaveProperty("title");
      expect(data.data).toHaveProperty("workspaceId");
    });

    test("validates all error responses have consistent format", async () => {
      const request = createPutRequest(
        "http://localhost:3000/api/tasks/invalid-id/title",
        { title: "Error Format Test" },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: "invalid-id" }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();

      // Validate error response format
      expect(data).toHaveProperty("error");
      expect(typeof data.error).toBe("string");
    });
  });

  describe("Real-World Scenarios", () => {
    test("handles concurrent title updates to same task", async () => {
      const { task } = await createTaskTestSetup();

      // Simulate concurrent requests
      const request1 = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: "Concurrent Update 1" },
        VALID_API_TOKEN
      );

      const request2 = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: "Concurrent Update 2" },
        VALID_API_TOKEN
      );

      const [response1, response2] = await Promise.all([
        PUT(request1, { params: Promise.resolve({ taskId: task.id }) }),
        PUT(request2, { params: Promise.resolve({ taskId: task.id }) }),
      ]);

      // Both requests should succeed
      await expectSuccess(response1, 200);
      await expectSuccess(response2, 200);

      // Final title should be one of the two updates
      const finalTask = await db.task.findUnique({
        where: { id: task.id },
        select: { title: true },
      });

      expect(["Concurrent Update 1", "Concurrent Update 2"]).toContain(
        finalTask!.title
      );
    });

    test("handles very long title (1000 characters)", async () => {
      const { task } = await createTaskTestSetup();

      const longTitle = "A".repeat(1000);

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: longTitle },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      const data = await expectSuccess(response, 200);

      // Verify long title is persisted
      expect(data.data.title).toBe(longTitle);
      expect(data.data.title.length).toBe(1000);

      // Verify database persistence
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
        select: { title: true },
      });

      expect(updatedTask!.title).toBe(longTitle);
    });

    test("handles title with newlines and tabs", async () => {
      const { task } = await createTaskTestSetup();

      const titleWithWhitespace = "Task:\tFix bug\nAdd test\n\tUpdate docs";

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: titleWithWhitespace },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.data.title).toBe(titleWithWhitespace);
    });

    test("verifies Pusher broadcast includes timestamp", async () => {
      const { task } = await createTaskTestSetup();

      const beforeUpdate = Date.now();

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: "Timestamp Broadcast Test" },
        VALID_API_TOKEN
      );

      await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      const afterUpdate = Date.now();

      // Verify workspace channel includes timestamp
      const workspaceCall = mockPusherTrigger.mock.calls.find(
        (call) => call[1] === "WORKSPACE_TASK_TITLE_UPDATE"
      );

      expect(workspaceCall).toBeDefined();
      const eventData = workspaceCall![2];
      expect(eventData).toHaveProperty("timestamp");

      // Timestamp should be within test execution window
      const eventTimestamp = new Date(eventData.timestamp).getTime();
      expect(eventTimestamp).toBeGreaterThanOrEqual(beforeUpdate);
      expect(eventTimestamp).toBeLessThanOrEqual(afterUpdate);
    });

    test("handles rapid sequential updates", async () => {
      const { task } = await createTaskTestSetup();

      const updates = ["Title 1", "Title 2", "Title 3", "Title 4", "Title 5"];

      for (const title of updates) {
        const request = createPutRequest(
          `http://localhost:3000/api/tasks/${task.id}/title`,
          { title },
          VALID_API_TOKEN
        );

        const response = await PUT(request, {
          params: Promise.resolve({ taskId: task.id }),
        });

        await expectSuccess(response, 200);
      }

      // Verify final title is last update
      const finalTask = await db.task.findUnique({
        where: { id: task.id },
        select: { title: true },
      });

      expect(finalTask!.title).toBe("Title 5");

      // Verify all broadcasts occurred
      expect(mockPusherTrigger).toHaveBeenCalledTimes(updates.length * 2); // 2 channels per update
    });
  });

  describe("Security Model Validation", () => {
    test("verifies token-based auth model (no session required)", async () => {
      const { task } = await createTaskTestSetup();

      // This test validates the architectural difference:
      // Token-based endpoint doesn't require NextAuth session
      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: "Token-Only Auth Test" },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Should succeed with only token, no session
      await expectSuccess(response, 200);
    });

    test("verifies no workspace ownership validation (by design)", async () => {
      // This test documents the security model: token-based endpoint
      // doesn't validate workspace membership/ownership like session-based endpoints
      const { task } = await createTaskTestSetup();

      const request = createPutRequest(
        `http://localhost:3000/api/tasks/${task.id}/title`,
        { title: "No Ownership Check" },
        VALID_API_TOKEN
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Should succeed without workspace membership validation
      await expectSuccess(response, 200);
    });

    test("verifies soft-delete protection works correctly", async () => {
      const { workspace, owner } = await createTaskTestSetup();

      // Create active and deleted tasks
      const activeTask = await createTestTask(workspace.id, owner.id, {
        title: "Active Task",
        deleted: false,
      });

      const deletedTask = await createTestTask(workspace.id, owner.id, {
        title: "Deleted Task",
        deleted: true,
      });

      // Active task should be updateable
      const request1 = createPutRequest(
        `http://localhost:3000/api/tasks/${activeTask.id}/title`,
        { title: "Updated Active Task" },
        VALID_API_TOKEN
      );

      const response1 = await PUT(request1, {
        params: Promise.resolve({ taskId: activeTask.id }),
      });

      await expectSuccess(response1, 200);

      // Deleted task should return 404
      const request2 = createPutRequest(
        `http://localhost:3000/api/tasks/${deletedTask.id}/title`,
        { title: "Try Update Deleted" },
        VALID_API_TOKEN
      );

      const response2 = await PUT(request2, {
        params: Promise.resolve({ taskId: deletedTask.id }),
      });

      await expectNotFound(response2);
    });
  });
});
