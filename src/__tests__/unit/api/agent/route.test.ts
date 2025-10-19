import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST, PUT } from "@/app/api/agent/route";
import * as nextAuth from "next-auth/next";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import * as workspaceService from "@/services/workspace";
import * as middlewareUtils from "@/lib/middleware/utils";
import * as nextAuthLib from "@/lib/auth/nextauth";
import * as askToolsLib from "@/lib/ai/askTools";
import * as repositoryHelpers from "@/lib/helpers/repository";
import { streamText } from "ai";
import { gooseWeb } from "ai-sdk-provider-goose-web";
import * as aieo from "aieo";
import { ChatRole, ChatStatus } from "@/lib/chat";

// Mock external dependencies
vi.mock("next-auth/next");
vi.mock("@/lib/db", () => ({
  db: {
    chatMessage: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    task: {
      findFirst: vi.fn(),
    },
    swarm: {
      findFirst: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));
vi.mock("@/lib/encryption");
vi.mock("@/services/workspace");
vi.mock("@/lib/middleware/utils");
vi.mock("@/lib/auth/nextauth");
vi.mock("@/lib/ai/askTools");
vi.mock("@/lib/helpers/repository");
vi.mock("ai");
vi.mock("ai-sdk-provider-goose-web");
vi.mock("aieo");

describe("POST /api/agent - Goose Web Streaming", () => {
  const mockSession = {
    user: {
      id: "user-123",
      email: "test@example.com",
      name: "Test User",
    },
  };

  const mockTaskId = "task-456";
  const mockMessage = "Help me debug this code";
  const mockGooseUrl = "ws://localhost:8888/ws";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    it("should reject unauthenticated requests with 401", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ message: mockMessage }),
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
      expect(nextAuth.getServerSession).toHaveBeenCalled();
    });

    it("should reject requests with invalid session", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue({
        user: null,
      } as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ message: mockMessage }),
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    });

    it("should accept authenticated requests", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue(mockSession as any);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);
      
      const mockStream = new ReadableStream();
      const mockResult = {
        fullStream: {
          [Symbol.asyncIterator]: async function* () {
            yield { type: "start" };
            yield { type: "finish", finishReason: "stop" };
          },
        },
      };
      vi.mocked(streamText).mockReturnValue(mockResult as any);
      vi.mocked(gooseWeb).mockReturnValue({} as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ message: mockMessage }),
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(nextAuth.getServerSession).toHaveBeenCalled();
    });
  });

  describe("Session ID Generation", () => {
    it("should generate new session ID for first message", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue(mockSession as any);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);
      vi.mocked(db.chatMessage.create).mockResolvedValue({} as any);

      const mockResult = {
        fullStream: {
          [Symbol.asyncIterator]: async function* () {
            yield { type: "finish", finishReason: "stop" };
          },
        },
      };
      vi.mocked(streamText).mockReturnValue(mockResult as any);
      vi.mocked(gooseWeb).mockReturnValue({} as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ message: mockMessage, taskId: mockTaskId }),
      });

      await POST(request);

      // Verify gooseWeb was called with a sessionId matching timestamp format (yyyymmdd_hhmmss)
      expect(gooseWeb).toHaveBeenCalledWith("goose", expect.objectContaining({
        wsUrl: expect.any(String),
        sessionId: expect.stringMatching(/^\d{8}_\d{6}$/),
      }));
    });

    it("should reuse existing session ID from chat history", async () => {
      const existingSessionId = "20240101_120000";
      vi.mocked(nextAuth.getServerSession).mockResolvedValue(mockSession as any);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([
        {
          role: ChatRole.USER,
          message: "Previous message",
          sourceWebsocketID: existingSessionId,
        },
      ] as any);

      const mockResult = {
        fullStream: {
          [Symbol.asyncIterator]: async function* () {
            yield { type: "finish", finishReason: "stop" };
          },
        },
      };
      vi.mocked(streamText).mockReturnValue(mockResult as any);
      vi.mocked(gooseWeb).mockReturnValue({} as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ message: mockMessage, taskId: mockTaskId }),
      });

      await POST(request);

      expect(gooseWeb).toHaveBeenCalledWith("goose", expect.objectContaining({
        sessionId: existingSessionId,
      }));
      expect(db.chatMessage.findMany).toHaveBeenCalledWith({
        where: { taskId: mockTaskId },
        orderBy: { timestamp: "asc" },
        select: {
          role: true,
          message: true,
          sourceWebsocketID: true,
        },
      });
    });

    it("should generate new session ID when history has no sourceWebsocketID", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue(mockSession as any);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([
        {
          role: ChatRole.USER,
          message: "Previous message",
          sourceWebsocketID: null,
        },
      ] as any);

      const mockResult = {
        fullStream: {
          [Symbol.asyncIterator]: async function* () {
            yield { type: "finish", finishReason: "stop" };
          },
        },
      };
      vi.mocked(streamText).mockReturnValue(mockResult as any);
      vi.mocked(gooseWeb).mockReturnValue({} as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ message: mockMessage, taskId: mockTaskId }),
      });

      await POST(request);

      expect(gooseWeb).toHaveBeenCalledWith("goose", expect.objectContaining({
        sessionId: expect.stringMatching(/^\d{8}_\d{6}$/),
      }));
    });
  });

  describe("Message Persistence", () => {
    it("should save user message with artifacts when taskId provided", async () => {
      const artifacts = [
        { type: "code", content: { language: "typescript", code: "const x = 1;" } },
      ];

      vi.mocked(nextAuth.getServerSession).mockResolvedValue(mockSession as any);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);
      vi.mocked(db.chatMessage.create).mockResolvedValue({} as any);

      const mockResult = {
        fullStream: {
          [Symbol.asyncIterator]: async function* () {
            yield { type: "finish", finishReason: "stop" };
          },
        },
      };
      vi.mocked(streamText).mockReturnValue(mockResult as any);
      vi.mocked(gooseWeb).mockReturnValue({} as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({
          message: mockMessage,
          taskId: mockTaskId,
          artifacts,
        }),
      });

      await POST(request);

      expect(db.chatMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskId: mockTaskId,
          message: mockMessage,
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          sourceWebsocketID: expect.stringMatching(/^\d{8}_\d{6}$/),
          artifacts: {
            create: artifacts.map((artifact) => ({
              type: artifact.type,
              content: artifact.content,
            })),
          },
        }),
      });
    });

    it("should not persist message when taskId is missing", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue(mockSession as any);

      const mockResult = {
        fullStream: {
          [Symbol.asyncIterator]: async function* () {
            yield { type: "finish", finishReason: "stop" };
          },
        },
      };
      vi.mocked(streamText).mockReturnValue(mockResult as any);
      vi.mocked(gooseWeb).mockReturnValue({} as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ message: mockMessage }),
      });

      await POST(request);

      expect(db.chatMessage.create).not.toHaveBeenCalled();
    });

    it("should handle database save errors gracefully", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue(mockSession as any);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);
      vi.mocked(db.chatMessage.create).mockRejectedValue(new Error("Database error"));

      const mockResult = {
        fullStream: {
          [Symbol.asyncIterator]: async function* () {
            yield { type: "text-delta", id: "1", text: "Hello" };
            yield { type: "finish", finishReason: "stop" };
          },
        },
      };
      vi.mocked(streamText).mockReturnValue(mockResult as any);
      vi.mocked(gooseWeb).mockReturnValue({} as any);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ message: mockMessage, taskId: mockTaskId }),
      });

      const response = await POST(request);

      expect(response.status).toBe(200); // Should still return stream
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error saving message to database:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Goose Web Integration", () => {
    it("should use provided gooseUrl", async () => {
      const customGooseUrl = "https://custom-goose.com";
      
      vi.mocked(nextAuth.getServerSession).mockResolvedValue(mockSession as any);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      const mockResult = {
        fullStream: {
          [Symbol.asyncIterator]: async function* () {
            yield { type: "finish", finishReason: "stop" };
          },
        },
      };
      vi.mocked(streamText).mockReturnValue(mockResult as any);
      vi.mocked(gooseWeb).mockReturnValue({} as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ message: mockMessage, gooseUrl: customGooseUrl }),
      });

      await POST(request);

      expect(gooseWeb).toHaveBeenCalledWith("goose", expect.objectContaining({
        wsUrl: "wss://custom-goose.com/ws",
      }));
    });

    it("should fallback to localhost when gooseUrl not provided", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue(mockSession as any);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      const mockResult = {
        fullStream: {
          [Symbol.asyncIterator]: async function* () {
            yield { type: "finish", finishReason: "stop" };
          },
        },
      };
      vi.mocked(streamText).mockReturnValue(mockResult as any);
      vi.mocked(gooseWeb).mockReturnValue({} as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ message: mockMessage }),
      });

      await POST(request);

      expect(gooseWeb).toHaveBeenCalledWith("goose", expect.objectContaining({
        wsUrl: "ws://localhost:8888/ws",
      }));
    });
  });

  describe("Chat History Management", () => {
    it("should load chat history from database", async () => {
      const chatHistory = [
        { role: ChatRole.USER, message: "Message 1", sourceWebsocketID: "20240101_120000" },
        { role: ChatRole.ASSISTANT, message: "Response 1", sourceWebsocketID: "20240101_120000" },
      ];

      vi.mocked(nextAuth.getServerSession).mockResolvedValue(mockSession as any);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue(chatHistory as any);

      const mockResult = {
        fullStream: {
          [Symbol.asyncIterator]: async function* () {
            yield { type: "finish", finishReason: "stop" };
          },
        },
      };
      vi.mocked(streamText).mockReturnValue(mockResult as any);
      vi.mocked(gooseWeb).mockReturnValue({} as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ message: mockMessage, taskId: mockTaskId }),
      });

      await POST(request);

      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system" }),
            { role: "user", content: "Message 1" },
            { role: "assistant", content: "Response 1" },
            { role: "user", content: mockMessage },
          ]),
        })
      );
    });

    it("should handle chat history loading errors gracefully", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue(mockSession as any);
      vi.mocked(db.chatMessage.findMany).mockRejectedValue(new Error("DB error"));

      const mockResult = {
        fullStream: {
          [Symbol.asyncIterator]: async function* () {
            yield { type: "finish", finishReason: "stop" };
          },
        },
      };
      vi.mocked(streamText).mockReturnValue(mockResult as any);
      vi.mocked(gooseWeb).mockReturnValue({} as any);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ message: mockMessage, taskId: mockTaskId }),
      });

      const response = await POST(request);

      expect(response.status).toBe(200); // Should still return stream
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error loading chat history:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("SSE Event Stream Mapping", () => {
    it("should map text-delta events correctly", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue(mockSession as any);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      const mockResult = {
        fullStream: {
          [Symbol.asyncIterator]: async function* () {
            yield { type: "text-delta", id: "msg-1", text: "Hello" };
            yield { type: "text-delta", id: "msg-1", text: " World" };
            yield { type: "finish", finishReason: "stop" };
          },
        },
      };
      vi.mocked(streamText).mockReturnValue(mockResult as any);
      vi.mocked(gooseWeb).mockReturnValue({} as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ message: mockMessage }),
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(response.headers.get("Cache-Control")).toBe("no-cache");
      expect(response.headers.get("Connection")).toBe("keep-alive");
    });

    it("should map tool-call events to tool-input-* format", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue(mockSession as any);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      const mockResult = {
        fullStream: {
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: "tool-call",
              toolCallId: "call-123",
              toolName: "web_search",
              input: { query: "test" },
              invalid: false,
            };
            yield { type: "finish", finishReason: "stop" };
          },
        },
      };
      vi.mocked(streamText).mockReturnValue(mockResult as any);
      vi.mocked(gooseWeb).mockReturnValue({} as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ message: mockMessage }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it("should skip invalid tool calls", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue(mockSession as any);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      const mockResult = {
        fullStream: {
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: "tool-call",
              toolCallId: "call-invalid",
              toolName: "invalid_tool",
              input: {},
              invalid: true,
            };
            yield { type: "finish", finishReason: "stop" };
          },
        },
      };
      vi.mocked(streamText).mockReturnValue(mockResult as any);
      vi.mocked(gooseWeb).mockReturnValue({} as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ message: mockMessage }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it("should map tool-result to tool-output-available", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue(mockSession as any);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      const mockResult = {
        fullStream: {
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: "tool-result",
              toolCallId: "call-123",
              output: { result: "success" },
            };
            yield { type: "finish", finishReason: "stop" };
          },
        },
      };
      vi.mocked(streamText).mockReturnValue(mockResult as any);
      vi.mocked(gooseWeb).mockReturnValue({} as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ message: mockMessage }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });

    it("should handle tool-error as successful calls", async () => {
      vi.mocked(nextAuth.getServerSession).mockResolvedValue(mockSession as any);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      const mockResult = {
        fullStream: {
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: "tool-error",
              toolCallId: "call-error",
              toolName: "some_tool",
              input: { query: "test" },
              error: "Tool error",
            };
            yield { type: "finish", finishReason: "stop" };
          },
        },
      };
      vi.mocked(streamText).mockReturnValue(mockResult as any);
      vi.mocked(gooseWeb).mockReturnValue({} as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        body: JSON.stringify({ message: mockMessage }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
    });
  });
});

describe("PUT /api/agent - Workspace-Integrated AI", () => {
  const mockUser = {
    id: "user-123",
    email: "test@example.com",
    name: "Test User",
  };

  const mockContext = {
    user: mockUser,
    requestId: "req-123",
  };

  const mockWorkspaceSlug = "test-workspace";
  const mockTaskId = "task-456";
  const mockMessage = "Analyze this code";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication & Context", () => {
    it("should reject requests without middleware context", async () => {
      vi.mocked(middlewareUtils.getMiddlewareContext).mockReturnValue(mockContext as any);
      vi.mocked(middlewareUtils.requireAuth).mockReturnValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      );

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(401);
      expect(middlewareUtils.requireAuth).toHaveBeenCalled();
    });

    it("should accept requests with valid context", async () => {
      vi.mocked(middlewareUtils.getMiddlewareContext).mockReturnValue(mockContext as any);
      vi.mocked(middlewareUtils.requireAuth).mockReturnValue(mockUser);
      vi.mocked(workspaceService.validateWorkspaceAccess).mockResolvedValue({
        hasAccess: true,
        workspace: { id: "ws-123", slug: mockWorkspaceSlug } as any,
      });
      vi.mocked(db.task.findFirst).mockResolvedValue({ id: mockTaskId } as any);
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        swarmUrl: "http://localhost:3355",
        swarmApiKey: "encrypted-key",
      } as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue({ slug: mockWorkspaceSlug } as any);
      vi.mocked(repositoryHelpers.getPrimaryRepository).mockResolvedValue({
        repositoryUrl: "https://github.com/test/repo",
      } as any);
      vi.mocked(nextAuthLib.getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github-pat",
      } as any);

      const mockEncryptionService = {
        decryptField: vi.fn().mockReturnValue("decrypted-key"),
      };
      vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService as any);

      vi.mocked(aieo.getApiKeyForProvider).mockReturnValue("api-key");
      vi.mocked(aieo.getModel).mockResolvedValue({ modelId: "claude-3" } as any);
      vi.mocked(askToolsLib.askTools).mockReturnValue({
        get_learnings: {} as any,
        ask_question: {} as any,
        analyze_code: {} as any,
        web_search: {} as any,
      });

      const mockStreamResponse = {
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("stream", { status: 200 })
        ),
      };
      vi.mocked(streamText).mockReturnValue(mockStreamResponse as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(200);
      expect(middlewareUtils.requireAuth).toHaveBeenCalled();
    });
  });

  describe("Request Validation", () => {
    beforeEach(() => {
      vi.mocked(middlewareUtils.getMiddlewareContext).mockReturnValue(mockContext as any);
      vi.mocked(middlewareUtils.requireAuth).mockReturnValue(mockUser);
    });

    it("should reject requests without message", async () => {
      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("message");
    });

    it("should reject requests without workspaceSlug", async () => {
      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("workspaceSlug");
    });

    it("should reject requests without taskId", async () => {
      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("taskId");
    });
  });

  describe("Workspace Authorization", () => {
    beforeEach(() => {
      vi.mocked(middlewareUtils.getMiddlewareContext).mockReturnValue(mockContext as any);
      vi.mocked(middlewareUtils.requireAuth).mockReturnValue(mockUser);
    });

    it("should reject unauthorized workspace access", async () => {
      vi.mocked(workspaceService.validateWorkspaceAccess).mockResolvedValue({
        hasAccess: false,
        workspace: null,
      });

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain("access denied");
      expect(workspaceService.validateWorkspaceAccess).toHaveBeenCalledWith(
        mockWorkspaceSlug,
        mockUser.id
      );
    });

    it("should allow workspace owner access", async () => {
      vi.mocked(workspaceService.validateWorkspaceAccess).mockResolvedValue({
        hasAccess: true,
        workspace: { id: "ws-123", slug: mockWorkspaceSlug } as any,
      });
      vi.mocked(db.task.findFirst).mockResolvedValue({ id: mockTaskId } as any);
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        swarmUrl: "http://localhost:3355",
        swarmApiKey: "encrypted-key",
      } as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue({ slug: mockWorkspaceSlug } as any);
      vi.mocked(repositoryHelpers.getPrimaryRepository).mockResolvedValue({
        repositoryUrl: "https://github.com/test/repo",
      } as any);
      vi.mocked(nextAuthLib.getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github-pat",
      } as any);

      const mockEncryptionService = {
        decryptField: vi.fn().mockReturnValue("decrypted-key"),
      };
      vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService as any);

      vi.mocked(aieo.getApiKeyForProvider).mockReturnValue("api-key");
      vi.mocked(aieo.getModel).mockResolvedValue({ modelId: "claude-3" } as any);
      vi.mocked(askToolsLib.askTools).mockReturnValue({} as any);

      const mockStreamResponse = {
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("stream", { status: 200 })
        ),
      };
      vi.mocked(streamText).mockReturnValue(mockStreamResponse as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(200);
    });

    it("should allow workspace member access", async () => {
      vi.mocked(workspaceService.validateWorkspaceAccess).mockResolvedValue({
        hasAccess: true,
        workspace: { id: "ws-123", slug: mockWorkspaceSlug } as any,
      });
      vi.mocked(db.task.findFirst).mockResolvedValue({ id: mockTaskId } as any);
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        swarmUrl: "http://localhost:3355",
        swarmApiKey: "encrypted-key",
      } as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue({ slug: mockWorkspaceSlug } as any);
      vi.mocked(repositoryHelpers.getPrimaryRepository).mockResolvedValue({
        repositoryUrl: "https://github.com/test/repo",
      } as any);
      vi.mocked(nextAuthLib.getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github-pat",
      } as any);

      const mockEncryptionService = {
        decryptField: vi.fn().mockReturnValue("decrypted-key"),
      };
      vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService as any);

      vi.mocked(aieo.getApiKeyForProvider).mockReturnValue("api-key");
      vi.mocked(aieo.getModel).mockResolvedValue({ modelId: "claude-3" } as any);
      vi.mocked(askToolsLib.askTools).mockReturnValue({} as any);

      const mockStreamResponse = {
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("stream", { status: 200 })
        ),
      };
      vi.mocked(streamText).mockReturnValue(mockStreamResponse as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Task Ownership Validation", () => {
    beforeEach(() => {
      vi.mocked(middlewareUtils.getMiddlewareContext).mockReturnValue(mockContext as any);
      vi.mocked(middlewareUtils.requireAuth).mockReturnValue(mockUser);
      vi.mocked(workspaceService.validateWorkspaceAccess).mockResolvedValue({
        hasAccess: true,
        workspace: { id: "ws-123", slug: mockWorkspaceSlug } as any,
      });
    });

    it("should reject task from different workspace", async () => {
      vi.mocked(db.task.findFirst).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain("Task not found");
      expect(db.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockTaskId,
          workspaceId: "ws-123",
          deleted: false,
        },
      });
    });

    it("should reject deleted tasks", async () => {
      vi.mocked(db.task.findFirst).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(404);
      expect(db.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deleted: false,
          }),
        })
      );
    });

    it("should accept task belonging to workspace", async () => {
      vi.mocked(db.task.findFirst).mockResolvedValue({
        id: mockTaskId,
        workspaceId: "ws-123",
      } as any);
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        swarmUrl: "http://localhost:3355",
        swarmApiKey: "encrypted-key",
      } as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue({ slug: mockWorkspaceSlug } as any);
      vi.mocked(repositoryHelpers.getPrimaryRepository).mockResolvedValue({
        repositoryUrl: "https://github.com/test/repo",
      } as any);
      vi.mocked(nextAuthLib.getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github-pat",
      } as any);

      const mockEncryptionService = {
        decryptField: vi.fn().mockReturnValue("decrypted-key"),
      };
      vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService as any);

      vi.mocked(aieo.getApiKeyForProvider).mockReturnValue("api-key");
      vi.mocked(aieo.getModel).mockResolvedValue({ modelId: "claude-3" } as any);
      vi.mocked(askToolsLib.askTools).mockReturnValue({} as any);

      const mockStreamResponse = {
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("stream", { status: 200 })
        ),
      };
      vi.mocked(streamText).mockReturnValue(mockStreamResponse as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Swarm Configuration", () => {
    beforeEach(() => {
      vi.mocked(middlewareUtils.getMiddlewareContext).mockReturnValue(mockContext as any);
      vi.mocked(middlewareUtils.requireAuth).mockReturnValue(mockUser);
      vi.mocked(workspaceService.validateWorkspaceAccess).mockResolvedValue({
        hasAccess: true,
        workspace: { id: "ws-123", slug: mockWorkspaceSlug } as any,
      });
      vi.mocked(db.task.findFirst).mockResolvedValue({ id: mockTaskId } as any);
    });

    it("should reject workspace without swarm", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain("Swarm not found");
    });

    it("should reject swarm without URL", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        swarmUrl: null,
        swarmApiKey: "encrypted-key",
      } as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain("Swarm URL not configured");
    });

    it("should decrypt swarm API key", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        swarmUrl: "http://localhost:3355",
        swarmApiKey: "encrypted-key-data",
      } as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue({ slug: mockWorkspaceSlug } as any);
      vi.mocked(repositoryHelpers.getPrimaryRepository).mockResolvedValue({
        repositoryUrl: "https://github.com/test/repo",
      } as any);
      vi.mocked(nextAuthLib.getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github-pat",
      } as any);

      const mockEncryptionService = {
        decryptField: vi.fn().mockReturnValue("decrypted-swarm-key"),
      };
      vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService as any);

      vi.mocked(aieo.getApiKeyForProvider).mockReturnValue("api-key");
      vi.mocked(aieo.getModel).mockResolvedValue({ modelId: "claude-3" } as any);
      vi.mocked(askToolsLib.askTools).mockReturnValue({} as any);

      const mockStreamResponse = {
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("stream", { status: 200 })
        ),
      };
      vi.mocked(streamText).mockReturnValue(mockStreamResponse as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      await PUT(request);

      expect(mockEncryptionService.decryptField).toHaveBeenCalledWith(
        "swarmApiKey",
        "encrypted-key-data"
      );
      expect(askToolsLib.askTools).toHaveBeenCalledWith(
        expect.any(String),
        "decrypted-swarm-key",
        expect.any(String),
        expect.any(String),
        expect.any(String)
      );
    });

    it("should construct correct base URL for localhost", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        swarmUrl: "http://localhost:8080",
        swarmApiKey: "encrypted-key",
      } as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue({ slug: mockWorkspaceSlug } as any);
      vi.mocked(repositoryHelpers.getPrimaryRepository).mockResolvedValue({
        repositoryUrl: "https://github.com/test/repo",
      } as any);
      vi.mocked(nextAuthLib.getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github-pat",
      } as any);

      const mockEncryptionService = {
        decryptField: vi.fn().mockReturnValue("decrypted-key"),
      };
      vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService as any);

      vi.mocked(aieo.getApiKeyForProvider).mockReturnValue("api-key");
      vi.mocked(aieo.getModel).mockResolvedValue({ modelId: "claude-3" } as any);
      vi.mocked(askToolsLib.askTools).mockReturnValue({} as any);

      const mockStreamResponse = {
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("stream", { status: 200 })
        ),
      };
      vi.mocked(streamText).mockReturnValue(mockStreamResponse as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      await PUT(request);

      expect(askToolsLib.askTools).toHaveBeenCalledWith(
        "http://localhost:3355",
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String)
      );
    });

    it("should construct correct base URL for production", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        swarmUrl: "https://swarm.example.com",
        swarmApiKey: "encrypted-key",
      } as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue({ slug: mockWorkspaceSlug } as any);
      vi.mocked(repositoryHelpers.getPrimaryRepository).mockResolvedValue({
        repositoryUrl: "https://github.com/test/repo",
      } as any);
      vi.mocked(nextAuthLib.getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github-pat",
      } as any);

      const mockEncryptionService = {
        decryptField: vi.fn().mockReturnValue("decrypted-key"),
      };
      vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService as any);

      vi.mocked(aieo.getApiKeyForProvider).mockReturnValue("api-key");
      vi.mocked(aieo.getModel).mockResolvedValue({ modelId: "claude-3" } as any);
      vi.mocked(askToolsLib.askTools).mockReturnValue({} as any);

      const mockStreamResponse = {
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("stream", { status: 200 })
        ),
      };
      vi.mocked(streamText).mockReturnValue(mockStreamResponse as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      await PUT(request);

      expect(askToolsLib.askTools).toHaveBeenCalledWith(
        "https://swarm.example.com:3355",
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String)
      );
    });
  });

  describe("Repository and GitHub PAT", () => {
    beforeEach(() => {
      vi.mocked(middlewareUtils.getMiddlewareContext).mockReturnValue(mockContext as any);
      vi.mocked(middlewareUtils.requireAuth).mockReturnValue(mockUser);
      vi.mocked(workspaceService.validateWorkspaceAccess).mockResolvedValue({
        hasAccess: true,
        workspace: { id: "ws-123", slug: mockWorkspaceSlug } as any,
      });
      vi.mocked(db.task.findFirst).mockResolvedValue({ id: mockTaskId } as any);
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        workspaceId: "ws-123",
        swarmUrl: "http://localhost:3355",
        swarmApiKey: "encrypted-key",
      } as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue({ slug: mockWorkspaceSlug } as any);

      const mockEncryptionService = {
        decryptField: vi.fn().mockReturnValue("decrypted-key"),
      };
      vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService as any);
    });

    it("should reject workspace without repository", async () => {
      vi.mocked(repositoryHelpers.getPrimaryRepository).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain("Repository URL not configured");
    });

    it("should reject workspace with repository but no URL", async () => {
      vi.mocked(repositoryHelpers.getPrimaryRepository).mockResolvedValue({
        repositoryUrl: null,
      } as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain("Repository URL not configured");
    });

    it("should reject user without GitHub PAT", async () => {
      vi.mocked(repositoryHelpers.getPrimaryRepository).mockResolvedValue({
        repositoryUrl: "https://github.com/test/repo",
      } as any);
      vi.mocked(nextAuthLib.getGithubUsernameAndPAT).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain("GitHub PAT not found");
    });

    it("should pass repository URL and PAT to askTools", async () => {
      const repoUrl = "https://github.com/test/repo";
      const githubPat = "ghp_test123";

      vi.mocked(repositoryHelpers.getPrimaryRepository).mockResolvedValue({
        repositoryUrl: repoUrl,
      } as any);
      vi.mocked(nextAuthLib.getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: githubPat,
      } as any);

      vi.mocked(aieo.getApiKeyForProvider).mockReturnValue("api-key");
      vi.mocked(aieo.getModel).mockResolvedValue({ modelId: "claude-3" } as any);
      vi.mocked(askToolsLib.askTools).mockReturnValue({} as any);

      const mockStreamResponse = {
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("stream", { status: 200 })
        ),
      };
      vi.mocked(streamText).mockReturnValue(mockStreamResponse as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      await PUT(request);

      expect(askToolsLib.askTools).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        repoUrl,
        githubPat,
        expect.any(String)
      );
    });
  });

  describe("Tool Initialization", () => {
    beforeEach(() => {
      vi.mocked(middlewareUtils.getMiddlewareContext).mockReturnValue(mockContext as any);
      vi.mocked(middlewareUtils.requireAuth).mockReturnValue(mockUser);
      vi.mocked(workspaceService.validateWorkspaceAccess).mockResolvedValue({
        hasAccess: true,
        workspace: { id: "ws-123", slug: mockWorkspaceSlug } as any,
      });
      vi.mocked(db.task.findFirst).mockResolvedValue({ id: mockTaskId } as any);
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        swarmUrl: "http://localhost:3355",
        swarmApiKey: "encrypted-key",
      } as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue({ slug: mockWorkspaceSlug } as any);
      vi.mocked(repositoryHelpers.getPrimaryRepository).mockResolvedValue({
        repositoryUrl: "https://github.com/test/repo",
      } as any);
      vi.mocked(nextAuthLib.getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github-pat",
      } as any);

      const mockEncryptionService = {
        decryptField: vi.fn().mockReturnValue("decrypted-key"),
      };
      vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService as any);
    });

    it("should initialize all 4 AI tools", async () => {
      const mockTools = {
        get_learnings: { type: "function", name: "get_learnings" },
        ask_question: { type: "function", name: "ask_question" },
        analyze_code: { type: "function", name: "analyze_code" },
        web_search: { type: "function", name: "web_search" },
      };

      vi.mocked(aieo.getApiKeyForProvider).mockReturnValue("api-key");
      vi.mocked(aieo.getModel).mockResolvedValue({ modelId: "claude-3" } as any);
      vi.mocked(askToolsLib.askTools).mockReturnValue(mockTools as any);

      const mockStreamResponse = {
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("stream", { status: 200 })
        ),
      };
      vi.mocked(streamText).mockReturnValue(mockStreamResponse as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      await PUT(request);

      expect(askToolsLib.askTools).toHaveBeenCalled();
      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: mockTools,
        })
      );
    });

    it("should pass correct parameters to askTools", async () => {
      const baseSwarmUrl = "http://localhost:3355";
      const decryptedApiKey = "decrypted-swarm-key";
      const repoUrl = "https://github.com/test/repo";
      const pat = "github-pat";
      const anthropicKey = "anthropic-key";

      vi.mocked(aieo.getApiKeyForProvider).mockReturnValue(anthropicKey);
      vi.mocked(aieo.getModel).mockResolvedValue({ modelId: "claude-3" } as any);
      vi.mocked(askToolsLib.askTools).mockReturnValue({} as any);

      const mockEncryptionService = {
        decryptField: vi.fn().mockReturnValue(decryptedApiKey),
      };
      vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService as any);

      const mockStreamResponse = {
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("stream", { status: 200 })
        ),
      };
      vi.mocked(streamText).mockReturnValue(mockStreamResponse as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      await PUT(request);

      expect(askToolsLib.askTools).toHaveBeenCalledWith(
        baseSwarmUrl,
        decryptedApiKey,
        repoUrl,
        pat,
        anthropicKey
      );
    });
  });

  describe("Message Persistence", () => {
    beforeEach(() => {
      vi.mocked(middlewareUtils.getMiddlewareContext).mockReturnValue(mockContext as any);
      vi.mocked(middlewareUtils.requireAuth).mockReturnValue(mockUser);
      vi.mocked(workspaceService.validateWorkspaceAccess).mockResolvedValue({
        hasAccess: true,
        workspace: { id: "ws-123", slug: mockWorkspaceSlug } as any,
      });
      vi.mocked(db.task.findFirst).mockResolvedValue({ id: mockTaskId } as any);
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        swarmUrl: "http://localhost:3355",
        swarmApiKey: "encrypted-key",
      } as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue({ slug: mockWorkspaceSlug } as any);
      vi.mocked(repositoryHelpers.getPrimaryRepository).mockResolvedValue({
        repositoryUrl: "https://github.com/test/repo",
      } as any);
      vi.mocked(nextAuthLib.getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github-pat",
      } as any);

      const mockEncryptionService = {
        decryptField: vi.fn().mockReturnValue("decrypted-key"),
      };
      vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService as any);

      vi.mocked(aieo.getApiKeyForProvider).mockReturnValue("api-key");
      vi.mocked(aieo.getModel).mockResolvedValue({ modelId: "claude-3" } as any);
      vi.mocked(askToolsLib.askTools).mockReturnValue({} as any);
    });

    it("should save user message before streaming", async () => {
      vi.mocked(db.chatMessage.create).mockResolvedValue({} as any);

      const mockStreamResponse = {
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("stream", { status: 200 })
        ),
      };
      vi.mocked(streamText).mockReturnValue(mockStreamResponse as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      await PUT(request);

      expect(db.chatMessage.create).toHaveBeenCalledWith({
        data: {
          taskId: mockTaskId,
          message: mockMessage,
          role: ChatRole.USER,
          status: ChatStatus.SENT,
        },
      });
    });
  });

  describe("AI Streaming", () => {
    beforeEach(() => {
      vi.mocked(middlewareUtils.getMiddlewareContext).mockReturnValue(mockContext as any);
      vi.mocked(middlewareUtils.requireAuth).mockReturnValue(mockUser);
      vi.mocked(workspaceService.validateWorkspaceAccess).mockResolvedValue({
        hasAccess: true,
        workspace: { id: "ws-123", slug: mockWorkspaceSlug } as any,
      });
      vi.mocked(db.task.findFirst).mockResolvedValue({ id: mockTaskId } as any);
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        swarmUrl: "http://localhost:3355",
        swarmApiKey: "encrypted-key",
      } as any);
      vi.mocked(db.workspace.findUnique).mockResolvedValue({ slug: mockWorkspaceSlug } as any);
      vi.mocked(repositoryHelpers.getPrimaryRepository).mockResolvedValue({
        repositoryUrl: "https://github.com/test/repo",
      } as any);
      vi.mocked(nextAuthLib.getGithubUsernameAndPAT).mockResolvedValue({
        username: "testuser",
        token: "github-pat",
      } as any);
      vi.mocked(db.chatMessage.create).mockResolvedValue({} as any);

      const mockEncryptionService = {
        decryptField: vi.fn().mockReturnValue("decrypted-key"),
      };
      vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService as any);

      vi.mocked(aieo.getApiKeyForProvider).mockReturnValue("api-key");
      vi.mocked(askToolsLib.askTools).mockReturnValue({} as any);
    });

    it("should create stream with correct model and tools", async () => {
      const mockModel = { modelId: "claude-3-5-sonnet" };
      const mockTools = {
        get_learnings: {},
        ask_question: {},
        analyze_code: {},
        web_search: {},
      };

      vi.mocked(aieo.getModel).mockResolvedValue(mockModel as any);
      vi.mocked(askToolsLib.askTools).mockReturnValue(mockTools as any);

      const mockStreamResponse = {
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("stream", { status: 200 })
        ),
      };
      vi.mocked(streamText).mockReturnValue(mockStreamResponse as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      await PUT(request);

      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: mockModel,
          tools: mockTools,
        })
      );
    });

    it("should include chat history in messages", async () => {
      const history = [
        { role: "user", content: "Previous question" },
        { role: "assistant", content: "Previous answer" },
      ];

      vi.mocked(aieo.getModel).mockResolvedValue({ modelId: "claude-3" } as any);

      const mockStreamResponse = {
        toUIMessageStreamResponse: vi.fn().mockReturnValue(
          new Response("stream", { status: 200 })
        ),
      };
      vi.mocked(streamText).mockReturnValue(mockStreamResponse as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
          history,
        }),
      });

      await PUT(request);

      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system" }),
            { role: "user", content: "Previous question" },
            { role: "assistant", content: "Previous answer" },
            { role: "user", content: mockMessage },
          ]),
        })
      );
    });

    it("should handle streaming errors", async () => {
      vi.mocked(aieo.getModel).mockResolvedValue({ modelId: "claude-3" } as any);
      vi.mocked(streamText).mockImplementation(() => {
        throw new Error("Streaming failed");
      });

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to create stream");
    });

    it("should return UI message stream response", async () => {
      vi.mocked(aieo.getModel).mockResolvedValue({ modelId: "claude-3" } as any);

      const mockUIStreamResponse = new Response("stream-data", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });

      const mockStreamResponse = {
        toUIMessageStreamResponse: vi.fn().mockReturnValue(mockUIStreamResponse),
      };
      vi.mocked(streamText).mockReturnValue(mockStreamResponse as any);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response).toBe(mockUIStreamResponse);
      expect(mockStreamResponse.toUIMessageStreamResponse).toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    it("should handle validation errors", async () => {
      vi.mocked(middlewareUtils.getMiddlewareContext).mockReturnValue(mockContext as any);
      vi.mocked(middlewareUtils.requireAuth).mockReturnValue(mockUser);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          // Missing required fields
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.kind).toBe("validation");
    });

    it("should handle forbidden errors", async () => {
      vi.mocked(middlewareUtils.getMiddlewareContext).mockReturnValue(mockContext as any);
      vi.mocked(middlewareUtils.requireAuth).mockReturnValue(mockUser);
      vi.mocked(workspaceService.validateWorkspaceAccess).mockResolvedValue({
        hasAccess: false,
        workspace: null,
      });

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.kind).toBe("forbidden");
    });

    it("should handle not found errors", async () => {
      vi.mocked(middlewareUtils.getMiddlewareContext).mockReturnValue(mockContext as any);
      vi.mocked(middlewareUtils.requireAuth).mockReturnValue(mockUser);
      vi.mocked(workspaceService.validateWorkspaceAccess).mockResolvedValue({
        hasAccess: true,
        workspace: { id: "ws-123", slug: mockWorkspaceSlug } as any,
      });
      vi.mocked(db.task.findFirst).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.kind).toBe("not_found");
    });

    it("should handle generic errors", async () => {
      vi.mocked(middlewareUtils.getMiddlewareContext).mockReturnValue(mockContext as any);
      vi.mocked(middlewareUtils.requireAuth).mockImplementation(() => {
        throw new Error("Unexpected error");
      });

      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "PUT",
        body: JSON.stringify({
          message: mockMessage,
          workspaceSlug: mockWorkspaceSlug,
          taskId: mockTaskId,
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to process agent request");
    });
  });
});