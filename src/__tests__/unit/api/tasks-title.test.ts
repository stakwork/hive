import { describe, test, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { PUT } from "@/app/api/tasks/[taskId]/title/route";
import { db } from "@/lib/db";
import { pusherServer } from "@/lib/pusher";

vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn(),
  },
  getTaskChannelName: (taskId: string) => `private-task-${taskId}`,
  getWorkspaceChannelName: (slug: string) => `private-workspace-${slug}`,
  PUSHER_EVENTS: {
    TASK_TITLE_UPDATE: "task-title-update",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
  },
}));

describe("PUT /api/tasks/[taskId]/title - Unit Tests", () => {
  const VALID_API_TOKEN = "test-api-token";
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
    process.env = { ...originalEnv, API_TOKEN: VALID_API_TOKEN };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const mockTask = {
    id: "task1",
    title: "Original Title",
    workspaceId: "workspace1",
    workspace: {
      slug: "test-workspace",
    },
  };

  const createRequest = (taskId: string, body: unknown, apiToken?: string) => {
    const headers = new Headers();
    if (apiToken !== undefined) {
      headers.set("x-api-token", apiToken);
    }
    return new NextRequest(`http://localhost:3000/api/tasks/${taskId}/title`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
  };

  describe("Authentication", () => {
    test("should return 401 when API token is missing", async () => {
      const request = createRequest("task1", { title: "New Title" });
      const params = Promise.resolve({ taskId: "task1" });

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      expect(db.task.findFirst).not.toHaveBeenCalled();
    });

    test("should return 401 when API token is invalid", async () => {
      const request = createRequest("task1", { title: "New Title" }, "wrong-token");
      const params = Promise.resolve({ taskId: "task1" });

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      expect(db.task.findFirst).not.toHaveBeenCalled();
    });

    test("should accept valid API token", async () => {
      const request = createRequest("task1", { title: "New Title" }, VALID_API_TOKEN);
      const params = Promise.resolve({ taskId: "task1" });

      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue({
        id: "task1",
        title: "New Title",
        workspaceId: "workspace1",
      });

      const response = await PUT(request, { params });

      expect(response.status).toBe(200);
      expect(db.task.findFirst).toHaveBeenCalled();
    });
  });

  describe("Input Validation", () => {
    test("should return 400 when taskId is missing", async () => {
      const request = createRequest("", { title: "New Title" }, VALID_API_TOKEN);
      const params = Promise.resolve({ taskId: "" });

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Task ID is required");
      expect(db.task.findFirst).not.toHaveBeenCalled();
    });

    test("should return 400 when title is missing", async () => {
      const request = createRequest("task1", {}, VALID_API_TOKEN);
      const params = Promise.resolve({ taskId: "task1" });

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Title is required and must be a string");
      expect(db.task.findFirst).not.toHaveBeenCalled();
    });

    test("should return 400 when title is not a string", async () => {
      const request = createRequest("task1", { title: 123 }, VALID_API_TOKEN);
      const params = Promise.resolve({ taskId: "task1" });

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Title is required and must be a string");
      expect(db.task.findFirst).not.toHaveBeenCalled();
    });

    test("should return 404 for non-existent task", async () => {
      const request = createRequest("non-existent", { title: "New Title" }, VALID_API_TOKEN);
      const params = Promise.resolve({ taskId: "non-existent" });

      (db.task.findFirst as Mock).mockResolvedValue(null);

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
      expect(db.task.update).not.toHaveBeenCalled();
    });
  });

  describe("Title Update Logic", () => {
    test("should successfully update task title", async () => {
      const request = createRequest("task1", { title: "New Title" }, VALID_API_TOKEN);
      const params = Promise.resolve({ taskId: "task1" });

      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue({
        id: "task1",
        title: "New Title",
        workspaceId: "workspace1",
      });

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.title).toBe("New Title");
      expect(db.task.update).toHaveBeenCalledWith({
        where: {
          id: "task1",
          deleted: false,
        },
        data: {
          title: "New Title",
        },
        select: {
          id: true,
          title: true,
          workspaceId: true,
        },
      });
    });

    test("should trim whitespace from title", async () => {
      const request = createRequest("task1", { title: "  New Title  " }, VALID_API_TOKEN);
      const params = Promise.resolve({ taskId: "task1" });

      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue({
        id: "task1",
        title: "New Title",
        workspaceId: "workspace1",
      });

   await PUT(request, { params });

      expect(db.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            title: "New Title",
          },
        })
      );
    });

    test("should skip update if title unchanged", async () => {
      const request = createRequest("task1", { title: "Original Title" }, VALID_API_TOKEN);
      const params = Promise.resolve({ taskId: "task1" });

      (db.task.findFirst as Mock).mockResolvedValue(mockTask);

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Title unchanged");
      expect(db.task.update).not.toHaveBeenCalled();
      expect(pusherServer.trigger).not.toHaveBeenCalled();
    });

    test("should skip update if trimmed title matches", async () => {
      const request = createRequest("task1", { title: "  Original Title  " }, VALID_API_TOKEN);
      const params = Promise.resolve({ taskId: "task1" });

      (db.task.findFirst as Mock).mockResolvedValue(mockTask);

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe("Title unchanged");
      expect(db.task.update).not.toHaveBeenCalled();
    });
  });

  describe("Pusher Integration", () => {
    test("should broadcast to task channel on title update", async () => {
      const request = createRequest("task1", { title: "New Title" }, VALID_API_TOKEN);
      const params = Promise.resolve({ taskId: "task1" });

      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue({
        id: "task1",
        title: "New Title",
        workspaceId: "workspace1",
      });

      await PUT(request, { params });

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        "private-task-task1",
        "task-title-update",
        expect.objectContaining({
          taskId: "task1",
          newTitle: "New Title",
          previousTitle: "Original Title",
        })
      );
    });

    test("should broadcast to workspace channel on title update", async () => {
      const request = createRequest("task1", { title: "New Title" }, VALID_API_TOKEN);
      const params = Promise.resolve({ taskId: "task1" });

      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue({
        id: "task1",
        title: "New Title",
        workspaceId: "workspace1",
      });

      await PUT(request, { params });

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        "private-workspace-test-workspace",
        "workspace-task-title-update",
        expect.objectContaining({
          taskId: "task1",
          newTitle: "New Title",
          previousTitle: "Original Title",
        })
      );
    });

    test("should include timestamp in broadcast payload", async () => {
      const request = createRequest("task1", { title: "New Title" }, VALID_API_TOKEN);
      const params = Promise.resolve({ taskId: "task1" });

      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue({
        id: "task1",
        title: "New Title",
        workspaceId: "workspace1",
      });

      await PUT(request, { params });

      const calls = (pusherServer.trigger as Mock).mock.calls;
      const payload = calls[0][2];
      expect(payload.timestamp).toBeInstanceOf(Date);
    });

    test("should not fail request if Pusher fails", async () => {
      const request = createRequest("task1", { title: "New Title" }, VALID_API_TOKEN);
      const params = Promise.resolve({ taskId: "task1" });

      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue({
        id: "task1",
        title: "New Title",
        workspaceId: "workspace1",
      });
      (pusherServer.trigger as Mock).mockRejectedValue(new Error("Pusher error"));

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test("should not broadcast when workspace slug is missing", async () => {
      const taskWithoutSlug = {
        ...mockTask,
        workspace: {
          slug: null,
        },
      };

      const request = createRequest("task1", { title: "New Title" }, VALID_API_TOKEN);
      const params = Promise.resolve({ taskId: "task1" });

      (db.task.findFirst as Mock).mockResolvedValue(taskWithoutSlug);
      (db.task.update as Mock).mockResolvedValue({
        id: "task1",
        title: "New Title",
        workspaceId: "workspace1",
      });

      await PUT(request, { params });

      expect(pusherServer.trigger).toHaveBeenCalledTimes(1);
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        "private-task-task1",
        "task-title-update",
        expect.any(Object)
      );
    });
  });

  describe("Response Structure", () => {
    test("should return success response with updated task data", async () => {
      const request = createRequest("task1", { title: "New Title" }, VALID_API_TOKEN);
      const params = Promise.resolve({ taskId: "task1" });

      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue({
        id: "task1",
        title: "New Title",
        workspaceId: "workspace1",
      });

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(data).toMatchObject({
        success: true,
        data: {
          id: "task1",
          title: "New Title",
          workspaceId: "workspace1",
        },
      });
    });

    test("should return task data when title unchanged", async () => {
      const request = createRequest("task1", { title: "Original Title" }, VALID_API_TOKEN);
      const params = Promise.resolve({ taskId: "task1" });

      (db.task.findFirst as Mock).mockResolvedValue(mockTask);

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(data).toMatchObject({
        success: true,
        data: mockTask,
        message: "Title unchanged",
      });
    });
  });

  describe("Error Handling", () => {
    test("should handle database errors gracefully", async () => {
      const request = createRequest("task1", { title: "New Title" }, VALID_API_TOKEN);
      const params = Promise.resolve({ taskId: "task1" });

      (db.task.findFirst as Mock).mockRejectedValue(new Error("Database error"));

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to update task title");
    });

    test("should handle P2025 error as 404 (task not found during update)", async () => {
      const request = createRequest("task1", { title: "New Title" }, VALID_API_TOKEN);
      const params = Promise.resolve({ taskId: "task1" });

      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockRejectedValue({ code: "P2025" });

      const response = await PUT(request, { params });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
    });

    test("should handle JSON parse errors", async () => {
      const headers = new Headers();
      headers.set("x-api-token", VALID_API_TOKEN);
      
      const request = new NextRequest("http://localhost:3000/api/tasks/task1/title", {
        method: "PUT",
        headers,
        body: "invalid json",
      });
      const params = Promise.resolve({ taskId: "task1" });

      const response = await PUT(request, { params });

      expect(response.status).toBe(500);
    });
  });
});
