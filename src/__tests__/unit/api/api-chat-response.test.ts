import { NextRequest } from "next/server";
import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/chat/response/route";
import { ChatRole, ChatStatus, ArtifactType } from "@/lib/chat";

// Mock all external dependencies at module level
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findFirst: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn(),
  },
  getTaskChannelName: vi.fn((taskId: string) => `task-${taskId}`),
  PUSHER_EVENTS: {
    NEW_MESSAGE: "new-message",
  },
}));

// Import mocked modules
const { db: mockDb } = await import("@/lib/db");
const { pusherServer: mockPusherServer, getTaskChannelName } = await import("@/lib/pusher");

describe("POST /api/chat/response", () => {
  const mockTaskId = "test-task-id";
  const mockMessage = "AI generated response";
  const mockWorkflowUrl = "https://workflow.example.com/123";

  const mockTask = {
    id: mockTaskId,
    title: "Test Task",
    workspaceId: "workspace-id",
    deleted: false,
  };

  const mockChatMessage = {
    id: "message-id",
    taskId: mockTaskId,
    message: mockMessage,
    workflowUrl: mockWorkflowUrl,
    role: ChatRole.ASSISTANT,
    contextTags: "[]",
    status: ChatStatus.SENT,
    sourceWebsocketID: null,
    artifacts: [],
    task: {
      id: mockTaskId,
      title: "Test Task",
    },
    timestamp: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    mockDb.task.findFirst.mockResolvedValue(mockTask as any);
    mockDb.chatMessage.create.mockResolvedValue(mockChatMessage as any);
    mockPusherServer.trigger.mockResolvedValue(undefined as any);
  });

  describe("Input Validation", () => {
    test("should accept request with only message (no taskId)", async () => {
      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          message: mockMessage,
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(mockDb.task.findFirst).not.toHaveBeenCalled();
    });

    test("should accept empty message with artifacts", async () => {
      const artifacts = [
        {
          type: ArtifactType.CODE,
          content: { code: "console.log('test')" },
        },
      ];

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "",
          artifacts,
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
    });

    test("should handle malformed JSON body", async () => {
      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: "invalid json",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
    });
  });

  describe("Task Validation", () => {
    test("should return 404 when task not found", async () => {
      mockDb.task.findFirst.mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: "non-existent-task",
          message: mockMessage,
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
      expect(mockDb.chatMessage.create).not.toHaveBeenCalled();
    });

    test("should return 404 when task is deleted", async () => {
      mockDb.task.findFirst.mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
      expect(mockDb.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockTaskId,
          deleted: false,
        },
      });
    });

    test("should validate task with correct query", async () => {
      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
        }),
      });

      await POST(request);

      expect(mockDb.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockTaskId,
          deleted: false,
        },
      });
    });
  });

  describe("Message Creation", () => {
    test("should create message with role ASSISTANT", async () => {
      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
        }),
      });

      await POST(request);

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: ChatRole.ASSISTANT,
          }),
        })
      );
    });

    test("should create message with status SENT", async () => {
      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
        }),
      });

      await POST(request);

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ChatStatus.SENT,
          }),
        })
      );
    });

    test("should create message with all provided fields", async () => {
      const contextTags = [{ type: "file", value: "test.js" }];
      const sourceWebsocketID = "websocket-123";

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          workflowUrl: mockWorkflowUrl,
          contextTags,
          sourceWebsocketID,
        }),
      });

      await POST(request);

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith({
        data: {
          taskId: mockTaskId,
          message: mockMessage,
          workflowUrl: mockWorkflowUrl,
          role: ChatRole.ASSISTANT,
          contextTags: JSON.stringify(contextTags),
          status: ChatStatus.SENT,
          sourceWebsocketID,
          artifacts: {
            create: [],
          },
        },
        include: {
          artifacts: true,
          task: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      });
    });

    test("should handle empty message with empty string", async () => {
      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: null,
        }),
      });

      await POST(request);

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            message: "",
          }),
        })
      );
    });

    test("should default contextTags to empty array", async () => {
      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
        }),
      });

      await POST(request);

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contextTags: JSON.stringify([]),
          }),
        })
      );
    });
  });

  describe("Artifact Handling", () => {
    test("should create message with CODE artifact", async () => {
      const artifacts = [
        {
          type: ArtifactType.CODE,
          content: { language: "javascript", code: "console.log('test')" },
          icon: "code",
        },
      ];

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          artifacts,
        }),
      });

      await POST(request);

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            artifacts: {
              create: [
                {
                  type: ArtifactType.CODE,
                  content: { language: "javascript", code: "console.log('test')" },
                  icon: "code",
                },
              ],
            },
          }),
        })
      );
    });

    test("should create message with FORM artifact", async () => {
      const artifacts = [
        {
          type: ArtifactType.FORM,
          content: { fields: [{ name: "email", type: "text" }] },
        },
      ];

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          artifacts,
        }),
      });

      await POST(request);

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            artifacts: {
              create: [
                {
                  type: ArtifactType.FORM,
                  content: { fields: [{ name: "email", type: "text" }] },
                  icon: undefined,
                },
              ],
            },
          }),
        })
      );
    });

    test("should create message with BROWSER artifact", async () => {
      const artifacts = [
        {
          type: ArtifactType.BROWSER,
          content: { url: "https://example.com", html: "<div>Test</div>" },
        },
      ];

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          artifacts,
        }),
      });

      await POST(request);

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            artifacts: {
              create: [
                {
                  type: ArtifactType.BROWSER,
                  content: { url: "https://example.com", html: "<div>Test</div>" },
                  icon: undefined,
                },
              ],
            },
          }),
        })
      );
    });

    test("should create message with LONGFORM artifact", async () => {
      const artifacts = [
        {
          type: ArtifactType.LONGFORM,
          content: { title: "Test Document", body: "Long form content..." },
        },
      ];

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          artifacts,
        }),
      });

      await POST(request);

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            artifacts: {
              create: [
                {
                  type: ArtifactType.LONGFORM,
                  content: { title: "Test Document", body: "Long form content..." },
                  icon: undefined,
                },
              ],
            },
          }),
        })
      );
    });

    test("should create message with BUG_REPORT artifact", async () => {
      const artifacts = [
        {
          type: ArtifactType.BUG_REPORT,
          content: {
            title: "Bug in login",
            description: "Users cannot log in",
            steps: ["Go to login page", "Enter credentials"],
          },
        },
      ];

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          artifacts,
        }),
      });

      await POST(request);

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            artifacts: {
              create: [
                {
                  type: ArtifactType.BUG_REPORT,
                  content: {
                    title: "Bug in login",
                    description: "Users cannot log in",
                    steps: ["Go to login page", "Enter credentials"],
                  },
                  icon: undefined,
                },
              ],
            },
          }),
        })
      );
    });

    test("should create message with multiple artifacts", async () => {
      const artifacts = [
        {
          type: ArtifactType.CODE,
          content: { code: "console.log('test')" },
        },
        {
          type: ArtifactType.FORM,
          content: { fields: [] },
        },
        {
          type: ArtifactType.BROWSER,
          content: { url: "https://example.com" },
        },
      ];

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          artifacts,
        }),
      });

      await POST(request);

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            artifacts: {
              create: artifacts.map((a) => ({
                type: a.type,
                content: a.content,
                icon: undefined,
              })),
            },
          }),
        })
      );
    });

    test("should default artifacts to empty array", async () => {
      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
        }),
      });

      await POST(request);

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            artifacts: {
              create: [],
            },
          }),
        })
      );
    });
  });

  describe("Pusher Broadcasting", () => {
    test("should broadcast message to Pusher when taskId provided", async () => {
      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
        }),
      });

      await POST(request);

      expect(getTaskChannelName).toHaveBeenCalledWith(mockTaskId);
      expect(mockPusherServer.trigger).toHaveBeenCalledWith(
        `task-${mockTaskId}`,
        "new-message",
        mockChatMessage.id
      );
    });

    test("should not broadcast to Pusher when no taskId", async () => {
      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          message: mockMessage,
        }),
      });

      await POST(request);

      expect(mockPusherServer.trigger).not.toHaveBeenCalled();
    });

    test("should broadcast only message ID, not full message", async () => {
      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
        }),
      });

      await POST(request);

      expect(mockPusherServer.trigger).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        mockChatMessage.id
      );
    });

    test("should handle Pusher failure gracefully (eventual consistency)", async () => {
      mockPusherServer.trigger.mockRejectedValue(new Error("Pusher connection failed"));

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      // Message should still be created successfully
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(mockDb.chatMessage.create).toHaveBeenCalled();
    });

    test("should log Pusher errors but not fail request", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockPusherServer.trigger.mockRejectedValue(new Error("Network error"));

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "❌ Error broadcasting to Pusher:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Response Format", () => {
    test("should return 201 status on success", async () => {
      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    test("should return success flag in response", async () => {
      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
    });

    test("should return formatted client message with parsed contextTags", async () => {
      const contextTags = [{ type: "file", value: "test.js" }];
      const messageWithContextTags = {
        ...mockChatMessage,
        contextTags: JSON.stringify(contextTags),
      };

      mockDb.chatMessage.create.mockResolvedValue(messageWithContextTags as any);

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          contextTags,
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.data.contextTags).toEqual(contextTags);
    });

    test("should return formatted artifacts in response", async () => {
      const artifacts = [
        {
          id: "artifact-1",
          type: ArtifactType.CODE,
          content: { code: "console.log('test')" },
          icon: "code",
          messageId: "message-id",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const messageWithArtifacts = {
        ...mockChatMessage,
        artifacts,
      };

      mockDb.chatMessage.create.mockResolvedValue(messageWithArtifacts as any);

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          artifacts: [
            {
              type: ArtifactType.CODE,
              content: { code: "console.log('test')" },
              icon: "code",
            },
          ],
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.data.artifacts).toHaveLength(1);
      expect(data.data.artifacts[0]).toMatchObject({
        type: ArtifactType.CODE,
        content: { code: "console.log('test')" },
        icon: "code",
      });
    });
  });

  describe("Context Tags", () => {
    test("should handle file context tags", async () => {
      const contextTags = [
        { type: "file", value: "src/index.ts" },
        { type: "file", value: "src/utils.ts" },
      ];

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          contextTags,
        }),
      });

      await POST(request);

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contextTags: JSON.stringify(contextTags),
          }),
        })
      );
    });

    test("should handle repository context tags", async () => {
      const contextTags = [
        { type: "repository", value: "https://github.com/user/repo" },
      ];

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          contextTags,
        }),
      });

      await POST(request);

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contextTags: JSON.stringify(contextTags),
          }),
        })
      );
    });

    test("should handle complex nested context tags", async () => {
      const contextTags = [
        {
          type: "file",
          value: "src/index.ts",
          metadata: { lines: [10, 20], modified: true },
        },
        {
          type: "repository",
          value: "https://github.com/user/repo",
          metadata: { branch: "main", commit: "abc123" },
        },
      ];

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          contextTags,
        }),
      });

      await POST(request);

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contextTags: JSON.stringify(contextTags),
          }),
        })
      );
    });
  });

  describe("Error Handling", () => {
    test("should return 500 on database error", async () => {
      mockDb.chatMessage.create.mockRejectedValue(new Error("Database connection failed"));

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create chat response");
    });

    test("should log database errors", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const dbError = new Error("Database connection failed");
      mockDb.chatMessage.create.mockRejectedValue(dbError);

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
        }),
      });

      await POST(request);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error creating chat response:",
        dbError
      );

      consoleErrorSpy.mockRestore();
    });

    test("should handle task validation errors", async () => {
      mockDb.task.findFirst.mockRejectedValue(new Error("Task query failed"));

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
    });
  });

  describe("Edge Cases", () => {
    test("should handle very long message content", async () => {
      const longMessage = "a".repeat(10000);

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: longMessage,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            message: longMessage,
          }),
        })
      );
    });

    test("should handle special characters in message", async () => {
      const specialMessage = "Test with 🚀 emojis and special chars: àáâäåæçèéêë & <html> tags";

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: specialMessage,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            message: specialMessage,
          }),
        })
      );
    });

    test("should handle empty artifact content", async () => {
      const artifacts = [
        {
          type: ArtifactType.CODE,
          content: {},
        },
      ];

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          artifacts,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    test("should handle artifact without content field", async () => {
      const artifacts = [
        {
          type: ArtifactType.CODE,
        },
      ];

      const request = new NextRequest("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: mockMessage,
          artifacts,
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            artifacts: {
              create: [
                {
                  type: ArtifactType.CODE,
                  content: undefined,
                  icon: undefined,
                },
              ],
            },
          }),
        })
      );
    });
  });
});