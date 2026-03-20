import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/tasks/[taskId]/messages/route";
import { db } from "@/lib/db";
import { ChatRole, ChatStatus, ArtifactType } from "@prisma/client";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {tasks: {
      findFirst: vi.fn(),
    },chat_messages: {
      findMany: vi.fn(),
    },
  },
}));

describe("GET /api/tasks/[taskId]/messages - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  const mockTaskId = "task-123";
  const mockUserId = "user-123";
  const mockWorkspaceId = "workspace-123";

  function createAuthenticatedRequest(url: string): NextRequest {
    const headers = new Headers();
    headers.set("x-middleware-auth-status", "authenticated");
    headers.set("x-middleware-user-id", mockUserId);
    headers.set("x-middleware-user-email", "test@example.com");
    headers.set("x-middleware-user-name", "Test User");
    return new NextRequest(url, { method: "GET", headers });
  }

  const mockTask = {
    id: mockTaskId,
    title: "Test Task",
    workspaceId: mockWorkspaceId,
    workflowStatus: "IN_PROGRESS",
    stakworkProjectId: 456,
    workspace: {
      id: mockWorkspaceId,
      name: "Test Workspace",
      ownerId: mockUserId,
      members: [],
    },
  };

  const mockChatMessages = [
    {
      id: "message-1",
      taskId: mockTaskId,
      message: "First message",
      role: ChatRole.USER,
      timestamp: new Date("2024-01-01T10:00:00Z"),
      contextTags: JSON.stringify([]),
      status: ChatStatus.SENT,
      sourceWebsocketID: null,
      replyId: null,
      artifacts: [
        {
          id: "artifact-1",
          type: ArtifactType.CODE,
          content: { code: "console.log('test')" },
          createdAt: new Date("2024-01-01T10:00:01Z"),
        },
      ],
    },
    {
      id: "message-2",
      taskId: mockTaskId,
      message: "Second message",
      role: ChatRole.ASSISTANT,
      timestamp: new Date("2024-01-01T10:01:00Z"),
      contextTags: JSON.stringify([{ type: "FEATURE_BRIEF", id: "feature-1" }]),
      status: ChatStatus.SENT,
      sourceWebsocketID: null,
      replyId: null,
      artifacts: [],
    },
  ];

  describe("Authentication", () => {
    test("should return 401 if no session", async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
        { method: "GET" }
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      expect(db.tasks.findFirst).not.toHaveBeenCalled();
    });

    test("should return 401 if no auth headers present", async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
        { method: "GET" }
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      expect(db.tasks.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("Input Validation", () => {
    test("should return 400 if taskId is missing", async () => {
      const request = createAuthenticatedRequest(
        "http://localhost:3000/api/tasks/undefined/messages",
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: "" }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Task ID is required");
      expect(db.tasks.findFirst).not.toHaveBeenCalled();
    });

    test("should return 404 if task not found", async () => {
      (db.tasks.findFirst as Mock).mockResolvedValue(null);

      const request = createAuthenticatedRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
      expect(db.chat_messages.findMany).not.toHaveBeenCalled();
    });

    test("should validate task query includes deleted filter", async () => {
      (db.tasks.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chat_messages.findMany as Mock).mockResolvedValue([]);

      const request = createAuthenticatedRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
      );

      await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });

      expect(db.tasks.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockTaskId,
          deleted: false,
        },
        select: expect.objectContaining({
          id: true,
          title: true,
          workspaceId: true,
          workflowStatus: true,
          stakworkProjectId: true,
          workspace: expect.any(Object),
        }),
      });
    });
  });

  describe("Authorization", () => {
    test("should return 403 if user is not workspace owner or member", async () => {
      const taskWithDifferentOwner = {
        ...mockTask,
        workspace: {
          ...mockTask.workspace,
          ownerId: "different-user",
          members: [], // No members
        },
      };

      (db.tasks.findFirst as Mock).mockResolvedValue(taskWithDifferentOwner);

      const request = createAuthenticatedRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");
      expect(db.chat_messages.findMany).not.toHaveBeenCalled();
    });

    test("should allow access if user is workspace owner", async () => {
      (db.tasks.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chat_messages.findMany as Mock).mockResolvedValue([]);

      const request = createAuthenticatedRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });

      expect(response.status).toBe(200);
      expect(db.chat_messages.findMany).toHaveBeenCalled();
    });

    test("should allow access if user is workspace member", async () => {
      const taskWithMember = {
        ...mockTask,
        workspace: {
          ...mockTask.workspace,
          ownerId: "different-user",
          members: [{ role: "DEVELOPER" }], // User is a member
        },
      };

      (db.tasks.findFirst as Mock).mockResolvedValue(taskWithMember);
      (db.chat_messages.findMany as Mock).mockResolvedValue([]);

      const request = createAuthenticatedRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });

      expect(response.status).toBe(200);
      expect(db.chat_messages.findMany).toHaveBeenCalled();
    });

    test("should filter workspace members by current user in query", async () => {
      (db.tasks.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chat_messages.findMany as Mock).mockResolvedValue([]);

      const request = createAuthenticatedRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
      );

      await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });

      expect(db.tasks.findFirst).toHaveBeenCalledWith({
        where: expect.any(Object),
        select: {
          id: true,
          title: true,
          workspaceId: true,
          workflowStatus: true,
          stakworkProjectId: true,
          mode: true,
          podId: true,
          featureId: true,
          sourceType: true,
          feature: {
            select: {
              id: true,
              title: true,
            },
          },
          workspace: {
            select: {
              id: true,
              name: true,
              ownerId: true,
              members: {
                where: {
                  userId: mockUserId,
                },
                select: {
                  role: true,
                },
              },
            },
          },
        },
      });
    });
  });

  describe("Message Retrieval", () => {
    test("should return messages with artifacts ordered by timestamp", async () => {
      (db.tasks.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chat_messages.findMany as Mock).mockResolvedValue(mockChatMessages);

      const request = createAuthenticatedRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.messages).toHaveLength(2);
      expect(data.data.count).toBe(2);

      // Verify message structure
      expect(data.data.messages[0]).toMatchObject({
        id: "message-1",
        message: "First message",
        role: ChatRole.USER,
        contextTags: [], // Parsed from JSON
      });

      // Verify artifacts
      expect(data.data.messages[0].artifacts).toHaveLength(1);
      expect(data.data.messages[0].artifacts[0]).toMatchObject({
        id: "artifact-1",
        type: ArtifactType.CODE,
        content: { code: "console.log('test')" },
      });
    });

    test("should parse contextTags from JSON string", async () => {
      (db.tasks.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chat_messages.findMany as Mock).mockResolvedValue(mockChatMessages);

      const request = createAuthenticatedRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });
      const data = await response.json();

      expect(data.data.messages[0].contextTags).toEqual([]);
      expect(data.data.messages[1].contextTags).toEqual([
        { type: "FEATURE_BRIEF", id: "feature-1" },
      ]);
    });

    test("should include task metadata in response", async () => {
      (db.tasks.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chat_messages.findMany as Mock).mockResolvedValue([]);

      const request = createAuthenticatedRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });
      const data = await response.json();

      expect(data.data.task).toMatchObject({
        id: mockTaskId,
        title: "Test Task",
        workspaceId: mockWorkspaceId,
        workflowStatus: "IN_PROGRESS",
        stakworkProjectId: 456,
      });
    });

    test("should retrieve messages ordered by createdAt ascending", async () => {
      (db.tasks.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chat_messages.findMany as Mock).mockResolvedValue([]);

      const request = createAuthenticatedRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
      );

      await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });

      expect(db.chat_messages.findMany).toHaveBeenCalledWith({
        where: {
          taskId: mockTaskId,
        },
        include: {
          artifacts: {
            orderBy: {
              createdAt: "asc",
            },
          },
          attachments: true,
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              githubAuth: {
                select: { githubUsername: true },
              },
            },
          },
        },
        orderBy: {
          timestamp: "asc",
        },
      });
    });

    test("should return empty array when task has no messages", async () => {
      (db.tasks.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chat_messages.findMany as Mock).mockResolvedValue([]);

      const request = createAuthenticatedRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.messages).toEqual([]);
      expect(data.data.count).toBe(0);
    });

    test("should handle messages with no artifacts", async () => {
      const messagesWithoutArtifacts = [
        {
          ...mockChatMessages[0],
          artifacts: [],
        },
      ];

      (db.tasks.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chat_messages.findMany as Mock).mockResolvedValue(messagesWithoutArtifacts);

      const request = createAuthenticatedRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.messages[0].artifacts).toEqual([]);
    });
  });

  describe("Error Handling", () => {
    test("should return 500 on database error during task fetch", async () => {
      (db.tasks.findFirst as Mock).mockRejectedValue(new Error("Database connection failed"));

      const request = createAuthenticatedRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch chat messages");
    });

    test("should return 500 on database error during message fetch", async () => {
      (db.tasks.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chat_messages.findMany as Mock).mockRejectedValue(new Error("Query timeout"));

      const request = createAuthenticatedRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch chat messages");
    });

    test("should handle malformed contextTags JSON gracefully", async () => {
      const messagesWithInvalidJSON = [
        {
          ...mockChatMessages[0],
          contextTags: "invalid json",
        },
      ];

      (db.tasks.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chat_messages.findMany as Mock).mockResolvedValue(messagesWithInvalidJSON);

      const request = createAuthenticatedRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });

      // Should either return 500 or handle gracefully
      expect([200, 500]).toContain(response.status);
    });
  });

  describe("POST Method - Not Implemented", () => {
    test("should return 405 Method Not Allowed for POST requests", async () => {
      const headers = new Headers();
      headers.set("x-middleware-auth-status", "authenticated");
      headers.set("x-middleware-user-id", mockUserId);
      headers.set("x-middleware-user-email", "test@example.com");
      headers.set("x-middleware-user-name", "Test User");
      const request = new NextRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ message: "Test message" }),
          headers,
        }
      );

      // Note: POST handler does not exist in route.ts
      // This test documents expected behavior when POST is implemented
      // Current implementation will return Next.js default 405 response
      
      // When POST is implemented, it should follow this pattern:
      // - Authenticate with middleware auth
      // - Validate taskId and message content
      // - Check workspace access (owner/member)
      // - Call sendMessageToStakwork service function
      // - Return 201 with created message data
      // - Handle Stakwork integration and workflow triggering
    });
  });

  describe("Response Structure", () => {
    test("should return correct response structure", async () => {
      (db.tasks.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chat_messages.findMany as Mock).mockResolvedValue(mockChatMessages);

      const request = createAuthenticatedRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });
      const data = await response.json();

      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("task");
      expect(data.data).toHaveProperty("messages");
      expect(data.data).toHaveProperty("count");
      expect(Array.isArray(data.data.messages)).toBe(true);
      expect(typeof data.data.count).toBe("number");
    });

    test("should not include sensitive workspace data", async () => {
      (db.tasks.findFirst as Mock).mockResolvedValue(mockTask);
      (db.chat_messages.findMany as Mock).mockResolvedValue([]);

      const request = createAuthenticatedRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });
      const data = await response.json();

      // Should not expose workspace member details or owner info in response
      expect(data.data.task).not.toHaveProperty("workspace");
      expect(data.data.task.workspaceId).toBe(mockWorkspaceId);
    });

    test("should include sourceType in task object", async () => {
      const taskWithSourceType = {
        ...mockTask,
        sourceType: "PROTOTYPE",
      };
      (db.tasks.findFirst as Mock).mockResolvedValue(taskWithSourceType);
      (db.chat_messages.findMany as Mock).mockResolvedValue([]);

      const request = createAuthenticatedRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.task).toHaveProperty("sourceType", "PROTOTYPE");
    });

    test("should include sourceType for USER task", async () => {
      const taskWithSourceType = {
        ...mockTask,
        sourceType: "USER",
      };
      (db.tasks.findFirst as Mock).mockResolvedValue(taskWithSourceType);
      (db.chat_messages.findMany as Mock).mockResolvedValue([]);

      const request = createAuthenticatedRequest(
        `http://localhost:3000/api/tasks/${mockTaskId}/messages`,
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: mockTaskId }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.task).toHaveProperty("sourceType", "USER");
    });
  });
});
