import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";

// Mock NextAuth (not used for API token auth, but prevents import errors)
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock Pusher with proper tracking
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue({}),
  },
  getTaskChannelName: vi.fn((id: string) => `task-${id}`),
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    TASK_TITLE_UPDATE: "task-title-update",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
  },
}));

// Import the route handler and mocked pusher after mocks
import { PUT } from "@/app/api/tasks/[taskId]/title/route";
import { pusherServer, getTaskChannelName, getWorkspaceChannelName } from "@/lib/pusher";

describe("PUT /api/tasks/[taskId]/title", () => {
  const API_TOKEN = process.env.API_TOKEN || "test-api-token";
  let testData: {
    user: { id: string; email: string };
    workspace: { id: string; slug: string };
    task: { id: string; title: string; workspaceId: string };
  };

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create test data in a transaction
    testData = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: `test-${Date.now()}@example.com`,
          name: "Test User",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: "Test Workspace",
          slug: `test-workspace-${Date.now()}`,
          ownerId: user.id,
          members: {
            create: {
              userId: user.id,
              role: "OWNER",
            },
          },
        },
      });

      const task = await tx.task.create({
        data: {
          title: "Original Task Title",
          workspace: {
            connect: {
              id: workspace.id,
            },
          },
          createdBy: {
            connect: {
              id: user.id,
            },
          },
          updatedBy: {
            connect: {
              id: user.id,
            },
          },
          status: "TODO",
          workflowStatus: "PENDING",
        },
      });

      return { user, workspace, task };
    });
  });

  afterEach(async () => {
    // Cleanup test data
    if (testData?.task?.id) {
      await db.task.deleteMany({
        where: { id: testData.task.id },
      });
    }
    if (testData?.workspace?.id) {
      await db.workspaceMember.deleteMany({
        where: { workspaceId: testData.workspace.id },
      });
      await db.workspace.deleteMany({
        where: { id: testData.workspace.id },
      });
    }
    if (testData?.user?.id) {
      await db.user.deleteMany({
        where: { id: testData.user.id },
      });
    }
  });

  describe("Authentication", () => {
    test("should return 401 when x-api-token header is missing", async () => {
      const request = new NextRequest(
        new URL(`http://localhost/api/tasks/${testData.task.id}/title`),
        {
          method: "PUT",
          body: JSON.stringify({ title: "New Title" }),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: testData.task.id }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 401 when x-api-token header is invalid", async () => {
      const request = new NextRequest(
        new URL(`http://localhost/api/tasks/${testData.task.id}/title`),
        {
          method: "PUT",
          headers: {
            "x-api-token": "invalid-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: "New Title" }),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: testData.task.id }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    test("should return 400 when title is missing", async () => {
      const request = new NextRequest(
        new URL(`http://localhost/api/tasks/${testData.task.id}/title`),
        {
          method: "PUT",
          headers: {
            "x-api-token": API_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: testData.task.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Title is required and must be a string");
    });

    test("should return 400 when title is empty string", async () => {
      const request = new NextRequest(
        new URL(`http://localhost/api/tasks/${testData.task.id}/title`),
        {
          method: "PUT",
          headers: {
            "x-api-token": API_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: "" }),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: testData.task.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Title is required and must be a string");
    });

    test("should return 400 when title is not a string", async () => {
      const request = new NextRequest(
        new URL(`http://localhost/api/tasks/${testData.task.id}/title`),
        {
          method: "PUT",
          headers: {
            "x-api-token": API_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: 123 }),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: testData.task.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Title is required and must be a string");
    });

    test("should return 400 when taskId is missing", async () => {
      const request = new NextRequest(
        new URL("http://localhost/api/tasks//title"),
        {
          method: "PUT",
          headers: {
            "x-api-token": API_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: "New Title" }),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: "" }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Task ID is required");
    });
  });

  describe("Task Not Found", () => {
    test("should return 404 when task does not exist", async () => {
      const nonExistentTaskId = "non-existent-task-id";
      const request = new NextRequest(
        new URL(`http://localhost/api/tasks/${nonExistentTaskId}/title`),
        {
          method: "PUT",
          headers: {
            "x-api-token": API_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: "New Title" }),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: nonExistentTaskId }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Task not found");
    });

    test("should return 404 when task is soft-deleted", async () => {
      // Mark task as deleted
      await db.task.update({
        where: { id: testData.task.id },
        data: { deleted: true },
      });

      const request = new NextRequest(
        new URL(`http://localhost/api/tasks/${testData.task.id}/title`),
        {
          method: "PUT",
          headers: {
            "x-api-token": API_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: "New Title" }),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: testData.task.id }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Task not found");
    });
  });

  describe("Successful Update", () => {
    test("should update task title and return 200", async () => {
      const newTitle = "Updated Task Title";
      const request = new NextRequest(
        new URL(`http://localhost/api/tasks/${testData.task.id}/title`),
        {
          method: "PUT",
          headers: {
            "x-api-token": API_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: newTitle }),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: testData.task.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(testData.task.id);
      expect(data.data.title).toBe(newTitle);

      // Verify database persistence
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.title).toBe(newTitle);
    });

    test("should trim whitespace from title", async () => {
      const titleWithWhitespace = "  Trimmed Title  ";
      const expectedTitle = "Trimmed Title";
      const request = new NextRequest(
        new URL(`http://localhost/api/tasks/${testData.task.id}/title`),
        {
          method: "PUT",
          headers: {
            "x-api-token": API_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: titleWithWhitespace }),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: testData.task.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.title).toBe(expectedTitle);

      // Verify database persistence
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.title).toBe(expectedTitle);
    });

    test("should return 200 with unchanged message when title is the same", async () => {
      const request = new NextRequest(
        new URL(`http://localhost/api/tasks/${testData.task.id}/title`),
        {
          method: "PUT",
          headers: {
            "x-api-token": API_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: testData.task.title }),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: testData.task.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe("Title unchanged");
      expect(data.data.title).toBe(testData.task.title);

      // Verify no Pusher broadcasts were triggered
      expect(pusherServer.trigger).not.toHaveBeenCalled();
    });
  });

  describe("Pusher Broadcasting", () => {
    test("should broadcast to task-specific channel on successful update", async () => {
      const newTitle = "Broadcasted Title";
      const request = new NextRequest(
        new URL(`http://localhost/api/tasks/${testData.task.id}/title`),
        {
          method: "PUT",
          headers: {
            "x-api-token": API_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: newTitle }),
        }
      );

      await PUT(request, {
        params: Promise.resolve({ taskId: testData.task.id }),
      });

      // Verify task channel broadcast
      expect(getTaskChannelName).toHaveBeenCalledWith(testData.task.id);
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `task-${testData.task.id}`,
        "task-title-update",
        expect.objectContaining({
          taskId: testData.task.id,
          newTitle,
          previousTitle: testData.task.title,
        })
      );
    });

    test("should broadcast to workspace channel on successful update", async () => {
      const newTitle = "Workspace Broadcasted Title";
      const request = new NextRequest(
        new URL(`http://localhost/api/tasks/${testData.task.id}/title`),
        {
          method: "PUT",
          headers: {
            "x-api-token": API_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: newTitle }),
        }
      );

      await PUT(request, {
        params: Promise.resolve({ taskId: testData.task.id }),
      });

      // Verify workspace channel broadcast
      expect(getWorkspaceChannelName).toHaveBeenCalledWith(
        testData.workspace.slug
      );
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `workspace-${testData.workspace.slug}`,
        "workspace-task-title-update",
        expect.objectContaining({
          taskId: testData.task.id,
          newTitle,
          previousTitle: testData.task.title,
        })
      );
    });

    test("should trigger both channels on successful update", async () => {
      const newTitle = "Dual Channel Title";
      const request = new NextRequest(
        new URL(`http://localhost/api/tasks/${testData.task.id}/title`),
        {
          method: "PUT",
          headers: {
            "x-api-token": API_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: newTitle }),
        }
      );

      await PUT(request, {
        params: Promise.resolve({ taskId: testData.task.id }),
      });

      // Verify both channels were triggered
      expect(pusherServer.trigger).toHaveBeenCalledTimes(2);
    });

    test("should include timestamp in broadcast payload", async () => {
      const newTitle = "Timestamped Title";
      const beforeRequest = new Date();

      const request = new NextRequest(
        new URL(`http://localhost/api/tasks/${testData.task.id}/title`),
        {
          method: "PUT",
          headers: {
            "x-api-token": API_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: newTitle }),
        }
      );

      await PUT(request, {
        params: Promise.resolve({ taskId: testData.task.id }),
      });

      const afterRequest = new Date();

      // Verify payload structure with timestamp
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          taskId: testData.task.id,
          newTitle,
          previousTitle: testData.task.title,
          timestamp: expect.any(Date),
        })
      );

      // Verify timestamp is within reasonable range
      const mockTrigger = pusherServer.trigger as unknown as vi.Mock;
      const payload = mockTrigger.mock.calls[0][2];
      expect(payload.timestamp.getTime()).toBeGreaterThanOrEqual(
        beforeRequest.getTime()
      );
      expect(payload.timestamp.getTime()).toBeLessThanOrEqual(
        afterRequest.getTime()
      );
    });

    test("should succeed even if Pusher broadcasting fails", async () => {
      // Mock Pusher trigger to fail
      const mockTrigger = pusherServer.trigger as unknown as vi.Mock;
      mockTrigger.mockRejectedValueOnce(new Error("Pusher error"));

      const newTitle = "Title Despite Pusher Failure";
      const request = new NextRequest(
        new URL(`http://localhost/api/tasks/${testData.task.id}/title`),
        {
          method: "PUT",
          headers: {
            "x-api-token": API_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: newTitle }),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: testData.task.id }),
      });

      // Request should still succeed
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.title).toBe(newTitle);

      // Verify database was updated despite Pusher failure
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.title).toBe(newTitle);
    });
  });

  describe("Edge Cases", () => {
    test("should handle very long titles", async () => {
      const longTitle = "A".repeat(500);
      const request = new NextRequest(
        new URL(`http://localhost/api/tasks/${testData.task.id}/title`),
        {
          method: "PUT",
          headers: {
            "x-api-token": API_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: longTitle }),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: testData.task.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.title).toBe(longTitle);
    });

    test("should handle special characters in title", async () => {
      const specialTitle = "Task 🚀 with émojis & spëcial çhars!";
      const request = new NextRequest(
        new URL(`http://localhost/api/tasks/${testData.task.id}/title`),
        {
          method: "PUT",
          headers: {
            "x-api-token": API_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: specialTitle }),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: testData.task.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.title).toBe(specialTitle);

      // Verify database persistence
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.title).toBe(specialTitle);
    });

    test("should handle newlines and tabs in title", async () => {
      const titleWithWhitespace = "Title\nwith\nnewlines\tand\ttabs";
      const request = new NextRequest(
        new URL(`http://localhost/api/tasks/${testData.task.id}/title`),
        {
          method: "PUT",
          headers: {
            "x-api-token": API_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: titleWithWhitespace }),
        }
      );

      const response = await PUT(request, {
        params: Promise.resolve({ taskId: testData.task.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      // trim() only removes leading/trailing whitespace, not internal newlines/tabs
      expect(data.data.title).toBe(titleWithWhitespace);
    });
  });
});