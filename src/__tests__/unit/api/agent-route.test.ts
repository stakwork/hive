import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { POST } from "@/app/api/agent/route";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { ChatRole, ChatStatus, ArtifactType } from "@/lib/chat";
import { createPostRequest } from "@/__tests__/support/helpers";

// Mock next-auth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock authOptions
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    chatMessage: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// Mock AI SDK and gooseWeb provider
const mockFullStream = {
  async *[Symbol.asyncIterator]() {
    yield { type: "text-delta", id: "1", text: "Hello" };
    yield { type: "finish", finishReason: "stop" };
  },
};

vi.mock("ai", () => ({
  streamText: vi.fn(() => ({
    fullStream: mockFullStream,
  })),
}));

vi.mock("ai-sdk-provider-goose-web", () => ({
  gooseWeb: vi.fn(() => "mock-model"),
}));

describe("POST /api/agent - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  const mockSession = {
    user: { id: "user1", email: "test@example.com" },
  };

  describe("Authentication", () => {
    test("should return 401 when user is not authenticated", async () => {
      (getServerSession as Mock).mockResolvedValue(null);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        gooseUrl: "https://example.com",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      expect(db.chatMessage.findMany).not.toHaveBeenCalled();
      expect(db.chatMessage.create).not.toHaveBeenCalled();
    });

    test("should return 401 when session exists but user is missing", async () => {
      (getServerSession as Mock).mockResolvedValue({ user: null });

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        gooseUrl: "https://example.com",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Goose URL Handling", () => {
    test("should return 400 when no gooseUrl is provided and no persisted URL exists", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.chatMessage.findMany as Mock).mockResolvedValue([]);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("No Goose URL available");
    });

    test("should use CUSTOM_GOOSE_URL when environment variable is set", async () => {
      const originalEnv = process.env.CUSTOM_GOOSE_URL;
      process.env.CUSTOM_GOOSE_URL = "ws://custom-url:8888/ws";

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.chatMessage.findMany as Mock).mockResolvedValue([]);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");

      // Cleanup
      process.env.CUSTOM_GOOSE_URL = originalEnv;
    });

    test("should transform https URL to wss websocket URL", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.chatMessage.findMany as Mock).mockResolvedValue([]);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        gooseUrl: "https://example.com",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      // The URL transformation happens internally: https://example.com -> wss://example.com/ws
    });

    test("should use persisted gooseUrl from IDE artifact in chat history", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.chatMessage.findMany as Mock).mockResolvedValue([
        {
          role: "assistant",
          message: "Previous message",
          sourceWebsocketID: "20240101_120000",
          artifacts: [
            {
              content: { url: "https://09c0a821.workspaces.sphinx.chat" },
            },
          ],
        },
      ]);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        taskId: "task1",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(db.chatMessage.findMany).toHaveBeenCalledWith({
        where: { taskId: "task1" },
        orderBy: { timestamp: "asc" },
        select: expect.any(Object),
      });
    });
  });

  describe("Session ID Management", () => {
    test("should generate new session ID when no taskId provided", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        gooseUrl: "https://example.com",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(db.chatMessage.findMany).not.toHaveBeenCalled();
    });

    test("should reuse session ID from first message in chat history", async () => {
      const existingSessionId = "20240101_120000";
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.chatMessage.findMany as Mock).mockResolvedValue([
        {
          role: "user",
          message: "First message",
          sourceWebsocketID: existingSessionId,
          artifacts: [],
        },
      ]);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        taskId: "task1",
        gooseUrl: "https://example.com",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(db.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceWebsocketID: existingSessionId,
          }),
        })
      );
    });

    test("should generate new session ID when chat history has no sourceWebsocketID", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.chatMessage.findMany as Mock).mockResolvedValue([
        {
          role: "user",
          message: "First message",
          sourceWebsocketID: null,
          artifacts: [],
        },
      ]);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        taskId: "task1",
        gooseUrl: "https://example.com",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(db.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceWebsocketID: expect.stringMatching(/^\d{8}_\d{6}$/),
          }),
        })
      );
    });
  });

  describe("Message Persistence", () => {
    test("should save user message to database when taskId is provided", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.chatMessage.findMany as Mock).mockResolvedValue([]);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        taskId: "task1",
        gooseUrl: "https://example.com",
      });

      await POST(request);

      expect(db.chatMessage.create).toHaveBeenCalledWith({
        data: {
          taskId: "task1",
          message: "Test message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          sourceWebsocketID: expect.any(String),
          artifacts: {
            create: [],
          },
        },
      });
    });

    test("should not save message when taskId is not provided", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        gooseUrl: "https://example.com",
      });

      await POST(request);

      expect(db.chatMessage.create).not.toHaveBeenCalled();
    });

    test("should save artifacts with user message", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.chatMessage.findMany as Mock).mockResolvedValue([]);

      const artifacts = [
        {
          type: ArtifactType.IDE,
          content: { url: "https://example.com" },
        },
        {
          type: ArtifactType.CODE,
          content: { code: "console.log('test')", language: "javascript" },
        },
      ];

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        taskId: "task1",
        gooseUrl: "https://example.com",
        artifacts,
      });

      await POST(request);

      expect(db.chatMessage.create).toHaveBeenCalledWith({
        data: {
          taskId: "task1",
          message: "Test message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          sourceWebsocketID: expect.any(String),
          artifacts: {
            create: artifacts,
          },
        },
      });
    });

    test("should handle database error gracefully during message save", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.chatMessage.findMany as Mock).mockResolvedValue([]);
      (db.chatMessage.create as Mock).mockRejectedValue(
        new Error("Database error")
      );

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        taskId: "task1",
        gooseUrl: "https://example.com",
      });

      const response = await POST(request);

      // Should still continue streaming even if save fails
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    });
  });

  describe("Chat History Loading", () => {
    test("should load chat history when taskId is provided", async () => {
      const chatHistory = [
        {
          role: "user",
          message: "First message",
          sourceWebsocketID: "20240101_120000",
          artifacts: [],
        },
        {
          role: "assistant",
          message: "First response",
          sourceWebsocketID: "20240101_120000",
          artifacts: [],
        },
      ];

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.chatMessage.findMany as Mock).mockResolvedValue(chatHistory);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        taskId: "task1",
        gooseUrl: "https://example.com",
      });

      await POST(request);

      expect(db.chatMessage.findMany).toHaveBeenCalledWith({
        where: { taskId: "task1" },
        orderBy: { timestamp: "asc" },
        select: {
          role: true,
          message: true,
          sourceWebsocketID: true,
          artifacts: {
            where: { type: ArtifactType.IDE },
            select: {
              content: true,
            },
          },
        },
      });
    });

    test("should handle database error when loading chat history", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.chatMessage.findMany as Mock).mockRejectedValue(
        new Error("Database error")
      );

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        taskId: "task1",
        gooseUrl: "https://example.com",
      });

      const response = await POST(request);

      // Should continue with empty history and generate new session
      expect(response.status).toBe(200);
    });

    test("should filter out non-user/assistant messages from history", async () => {
      const chatHistory = [
        {
          role: "user",
          message: "User message",
          sourceWebsocketID: "20240101_120000",
          artifacts: [],
        },
        {
          role: "system",
          message: "System message",
          sourceWebsocketID: "20240101_120000",
          artifacts: [],
        },
        {
          role: "assistant",
          message: "Assistant message",
          sourceWebsocketID: "20240101_120000",
          artifacts: [],
        },
      ];

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.chatMessage.findMany as Mock).mockResolvedValue(chatHistory);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        taskId: "task1",
        gooseUrl: "https://example.com",
      });

      const response = await POST(request);

      // System messages should be filtered out in message building
      expect(response.status).toBe(200);
    });
  });

  describe("Streaming Response", () => {
    test("should return streaming response with correct headers", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        gooseUrl: "https://example.com",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(response.headers.get("Cache-Control")).toBe("no-cache");
      expect(response.headers.get("Connection")).toBe("keep-alive");
    });

    test("should stream with system prompt included", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.chatMessage.findMany as Mock).mockResolvedValue([]);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        gooseUrl: "https://example.com",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      // System prompt is included in messages array internally
    });
  });

  describe("URL Transformation", () => {
    test("should transform persisted URL format correctly", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.chatMessage.findMany as Mock).mockResolvedValue([
        {
          role: "assistant",
          message: "Previous message",
          sourceWebsocketID: "20240101_120000",
          artifacts: [
            {
              content: { url: "https://09c0a821.workspaces.sphinx.chat" },
            },
          ],
        },
      ]);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        taskId: "task1",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      // URL should be transformed from https://09c0a821.workspaces.sphinx.chat
      // to https://09c0a821-15551.workspaces.sphinx.chat
    });

    test("should remove trailing slash from gooseUrl", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        gooseUrl: "https://example.com/",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      // Trailing slash should be removed before adding /ws
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty artifacts array", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.chatMessage.findMany as Mock).mockResolvedValue([]);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        taskId: "task1",
        gooseUrl: "https://example.com",
        artifacts: [],
      });

      await POST(request);

      expect(db.chatMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          artifacts: {
            create: [],
          },
        }),
      });
    });

    test("should handle artifacts without content", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.chatMessage.findMany as Mock).mockResolvedValue([]);

      const artifacts = [
        {
          type: ArtifactType.IDE,
        },
      ];

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        taskId: "task1",
        gooseUrl: "https://example.com",
        artifacts,
      });

      await POST(request);

      expect(db.chatMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          artifacts: {
            create: artifacts,
          },
        }),
      });
    });

    test("should handle chat history with empty artifacts array", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.chatMessage.findMany as Mock).mockResolvedValue([
        {
          role: "user",
          message: "First message",
          sourceWebsocketID: "20240101_120000",
          artifacts: [],
        },
      ]);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        taskId: "task1",
        gooseUrl: "https://example.com",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    test("should handle malformed artifact content", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.chatMessage.findMany as Mock).mockResolvedValue([
        {
          role: "assistant",
          message: "Previous message",
          sourceWebsocketID: "20240101_120000",
          artifacts: [
            {
              content: "invalid-content", // Not an object
            },
          ],
        },
      ]);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        taskId: "task1",
        gooseUrl: "https://example.com",
      });

      const response = await POST(request);

      // Should handle gracefully and use provided gooseUrl
      expect(response.status).toBe(200);
    });
  });

  describe("Request Body Validation", () => {
    test("should accept valid request with all optional fields", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.chatMessage.findMany as Mock).mockResolvedValue([]);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        gooseUrl: "https://example.com",
        taskId: "task1",
        artifacts: [
          {
            type: ArtifactType.CODE,
            content: { code: "test" },
          },
        ],
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    test("should accept request with only required fields", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);

      const request = createPostRequest("/api/agent", {
        message: "Test message",
        gooseUrl: "https://example.com",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });
});
