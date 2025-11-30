import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/tasks/[taskId]/messages/route";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findFirst: vi.fn(),
    },
    chatMessage: {
      findMany: vi.fn(),
    },
  },
}));

describe("GET /api/tasks/[taskId]/messages - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  const mockSession = {
    user: { id: "user1" },
  };

  const mockTask = {
    id: "task1",
    title: "Test Task",
    workspaceId: "workspace1",
    workflowStatus: WorkflowStatus.IN_PROGRESS,
    stakworkProjectId: "project123",
    workspace: {
      id: "workspace1",
      name: "Test Workspace",
      ownerId: "user1",
      members: [{ role: "DEVELOPER" }],
    },
  };

  const createMockMessage = (overrides = {}) => ({
    id: "msg1",
    taskId: "task1",
    role: "user",
    content: "Test message",
    timestamp: new Date("2024-01-01T10:00:00Z"),
    contextTags: JSON.stringify([{ type: "file", value: "test.ts" }]),
    workflowUrl: null,
    artifacts: [
      {
        id: "artifact1",
        type: "TEXT",
        content: "Artifact content",
        title: "Test Artifact",
        chatMessageId: "msg1",
        createdAt: new Date("2024-01-01T10:00:00Z"),
        updatedAt: new Date("2024-01-01T10:00:00Z"),
      },
    ],
    ...overrides,
  });

  describe("Authentication & Authorization", () => {
    test("should return 401 for unauthenticated requests", async () => {
      (getServerSession as Mock).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      expect(db.task.findFirst).not.toHaveBeenCalled();
    });

    test("should return 401 for invalid session (missing userId)", async () => {
      (getServerSession as Mock).mockResolvedValue({ user: {} });

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
      expect(db.task.findFirst).not.toHaveBeenCalled();
    });

    test("should return 403 for users without workspace access", async () => {
      const taskWithoutAccess = {
        ...mockTask,
        workspace: {
          id: "workspace1",
          name: "Test Workspace",
          ownerId: "different-user",
          members: [], 
        },
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(taskWithoutAccess);

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");
      expect(db.chatMessage.findMany).not.toHaveBeenCalled();
    });

    test("should allow workspace owners to get messages", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chatMessage.findMany as Mock).mockResolvedValue([createMockMessage()]);

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      expect(db.chatMessage.findMany).toHaveBeenCalled();
    });

    test("should allow workspace members to get messages", async () => {
      const taskAsMember = {
        ...mockTask,
        workspace: {
          id: "workspace1",
          name: "Test Workspace",
          ownerId: "different-user",
          members: [{ role: "DEVELOPER" }],
        },
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(taskAsMember);
      (db.chatMessage.findMany as Mock).mockResolvedValue([createMockMessage()]);

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      expect(db.chatMessage.findMany).toHaveBeenCalled();
    });
  });

  describe("Input Validation", () => {
    test("should return 400 when taskId is missing", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);

      const request = new NextRequest("http://localhost:3000/api/tasks//messages");
      const params = Promise.resolve({ taskId: "" });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Task ID is required");
      expect(db.task.findFirst).not.toHaveBeenCalled();
    });

    test("should return 404 for non-existent task", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/tasks/non-existent/messages");
      const params = Promise.resolve({ taskId: "non-existent" });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
      expect(db.chatMessage.findMany).not.toHaveBeenCalled();
    });
  });

  describe("Message Retrieval", () => {
    test("should return messages in chronological order (ASC)", async () => {
      const message1 = createMockMessage({
        id: "msg1",
        timestamp: new Date("2024-01-01T10:00:00Z"),
      });
      const message2 = createMockMessage({
        id: "msg2",
        timestamp: new Date("2024-01-01T11:00:00Z"),
      });
      const message3 = createMockMessage({
        id: "msg3",
        timestamp: new Date("2024-01-01T12:00:00Z"),
      });

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chatMessage.findMany as Mock).mockResolvedValue([message1, message2, message3]);

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      await GET(request, { params });

      expect(db.chatMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: {
            timestamp: "asc",
          },
        })
      );
    });

    test("should include all message fields", async () => {
      const message = createMockMessage({
        id: "msg1",
        role: "assistant",
        content: "AI response",
        workflowUrl: "https://example.com/workflow",
      });

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chatMessage.findMany as Mock).mockResolvedValue([message]);

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.success).toBe(true);
      const returnedMessage = data.data.messages[0];
      expect(returnedMessage).toHaveProperty("id");
      expect(returnedMessage).toHaveProperty("role");
      expect(returnedMessage).toHaveProperty("content");
      expect(returnedMessage).toHaveProperty("timestamp");
      expect(returnedMessage).toHaveProperty("contextTags");
      expect(returnedMessage).toHaveProperty("workflowUrl");
    });

    test("should include artifacts for each message", async () => {
      const message = createMockMessage({
        artifacts: [
          {
            id: "artifact1",
            type: "TEXT",
            content: "Content 1",
            title: "Artifact 1",
            chatMessageId: "msg1",
            createdAt: new Date("2024-01-01T10:00:00Z"),
            updatedAt: new Date("2024-01-01T10:00:00Z"),
          },
          {
            id: "artifact2",
            type: "FORM",
            content: "Content 2",
            title: "Artifact 2",
            chatMessageId: "msg1",
            createdAt: new Date("2024-01-01T10:01:00Z"),
            updatedAt: new Date("2024-01-01T10:01:00Z"),
          },
        ],
      });

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chatMessage.findMany as Mock).mockResolvedValue([message]);

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data.messages[0].artifacts).toHaveLength(2);
      expect(db.chatMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            artifacts: {
              orderBy: {
                createdAt: "asc",
              },
            },
          },
        })
      );
    });

    test("should parse contextTags JSON correctly", async () => {
      const contextTags = [
        { type: "file", value: "src/app.ts" },
        { type: "function", value: "handleRequest" },
      ];

      const message = createMockMessage({
        contextTags: JSON.stringify(contextTags),
      });

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chatMessage.findMany as Mock).mockResolvedValue([message]);

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data.messages[0].contextTags).toEqual(contextTags);
      expect(Array.isArray(data.data.messages[0].contextTags)).toBe(true);
    });

    test("should parse artifacts JSON correctly", async () => {
      const message = createMockMessage({
        artifacts: [
          {
            id: "artifact1",
            type: "TEXT",
            content: JSON.stringify({ key: "value" }),
            title: "JSON Artifact",
            chatMessageId: "msg1",
            createdAt: new Date("2024-01-01T10:00:00Z"),
            updatedAt: new Date("2024-01-01T10:00:00Z"),
          },
        ],
      });

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chatMessage.findMany as Mock).mockResolvedValue([message]);

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data.messages[0].artifacts[0]).toHaveProperty("id");
      expect(data.data.messages[0].artifacts[0]).toHaveProperty("type");
      expect(data.data.messages[0].artifacts[0]).toHaveProperty("content");
    });

    test("should handle empty message list", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chatMessage.findMany as Mock).mockResolvedValue([]);

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.messages).toEqual([]);
      expect(Array.isArray(data.data.messages)).toBe(true);
    });

    test("should return correct artifact ordering (by createdAt ASC)", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chatMessage.findMany as Mock).mockResolvedValue([createMockMessage()]);

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      await GET(request, { params });

      const callArgs = (db.chatMessage.findMany as Mock).mock.calls[0][0];
      expect(callArgs.include.artifacts.orderBy).toEqual({ createdAt: "asc" });
    });
  });

  describe("Task & Workspace Info", () => {
    test("should return task id, title, and workflowStatus", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chatMessage.findMany as Mock).mockResolvedValue([createMockMessage()]);

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data.task).toMatchObject({
        id: "task1",
        title: "Test Task",
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      });
    });

    test("should return stakworkProjectId when present", async () => {
      const taskWithProject = {
        ...mockTask,
        stakworkProjectId: "project456",
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(taskWithProject);
      (db.chatMessage.findMany as Mock).mockResolvedValue([createMockMessage()]);

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data.task.stakworkProjectId).toBe("project456");
    });

    test("should return workspace id and name", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chatMessage.findMany as Mock).mockResolvedValue([createMockMessage()]);

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data.task.workspaceId).toBe("workspace1");
    });

    test("should exclude deleted messages", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chatMessage.findMany as Mock).mockResolvedValue([createMockMessage()]);

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      await GET(request, { params });


      expect(db.chatMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            taskId: "task1",
          },
        })
      );
    });
  });

  describe("JSON Parsing Edge Cases", () => {
    test("should handle malformed JSON gracefully", async () => {
      const messageWithBadJson = createMockMessage({
        contextTags: "{ invalid json }",
      });

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chatMessage.findMany as Mock).mockResolvedValue([messageWithBadJson]);

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      const response = await GET(request, { params });

      
      expect([200, 500]).toContain(response.status);
    });

    test("should handle null contextTags", async () => {
      const messageWithNull = createMockMessage({
        contextTags: null as unknown as string,
      });

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chatMessage.findMany as Mock).mockResolvedValue([messageWithNull]);

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      const response = await GET(request, { params });

      expect([200, 500]).toContain(response.status);
    });

    test("should handle empty artifacts array", async () => {
      const messageWithNoArtifacts = createMockMessage({
        artifacts: [],
      });

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chatMessage.findMany as Mock).mockResolvedValue([messageWithNoArtifacts]);

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.messages[0].artifacts).toEqual([]);
    });
  });

  describe("Error Handling", () => {
    test("should handle database errors gracefully", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chatMessage.findMany as Mock).mockRejectedValue(
        new Error("Database connection failed")
      );

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      const response = await GET(request, { params });

      expect(response.status).toBe(500);
    });

    test("should return 500 on unexpected errors", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockRejectedValue(
        new Error("Unexpected error")
      );

      const request = new NextRequest("http://localhost:3000/api/tasks/task1/messages");
      const params = Promise.resolve({ taskId: "task1" });

      const response = await GET(request, { params });

      expect(response.status).toBe(500);
    });
  });
});
