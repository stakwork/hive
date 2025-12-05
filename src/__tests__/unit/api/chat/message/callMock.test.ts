import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/chat/message/route";
import { getServerSession } from "next-auth/next";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { ChatRole, ChatStatus } from "@/lib/chat";
import { getS3Service } from "@/services/s3";
import { getBaseUrl } from "@/lib/utils";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import {
  DEFAULT_MOCK_IDS,
  createMockTask,
  createMockChatMessage,
  setupChatMessageDatabaseMocks,
} from "@/__tests__/support/helpers/chat-message-mocks";

// Mock all external dependencies
vi.mock("next-auth/next");
vi.mock("@/lib/auth/nextauth");
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));
vi.mock("@/config/env");
vi.mock("@/services/s3");
vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn(),
  cn: vi.fn(),
  getRelativeUrl: vi.fn(),
}));
vi.mock("@/lib/utils/swarm");

/**
 * Unit Tests for callMock Function (Chat Message Variant)
 *
 * Tests the callMock function which handles mock chat processing when Stakwork is not enabled.
 * This function makes HTTP calls to /api/mock/chat to simulate AI responses.
 *
 * Test Coverage:
 * 1. HTTP Call Construction - proper payload formation, headers, URL construction
 * 2. Response Handling - success/error responses, data extraction
 * 3. Error Handling - network failures, invalid responses
 * 4. Integration - proper invocation through POST route handler
 */
describe("callMock Function - Chat Message Processing", () => {
  const mockUserId = "user-123";
  const mockTaskId = "task-456";
  const mockWorkspaceId = "workspace-789";
  const mockWorkspaceSlug = "test-workspace";
  const mockMessageId = "message-abc";

  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup authenticated session
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: mockUserId, name: "Test User", email: "test@example.com" },
    } as any);

    // Mock config - NO Stakwork credentials (this triggers callMock)
    vi.mocked(config).STAKWORK_API_KEY = undefined;
    vi.mocked(config).STAKWORK_BASE_URL = undefined;
    vi.mocked(config).STAKWORK_WORKFLOW_ID = undefined;

    // Mock utility functions
    vi.mocked(getBaseUrl).mockReturnValue("http://localhost:3000");
    vi.mocked(transformSwarmUrlToRepo2Graph).mockReturnValue("http://test-swarm.com:3355");

    // Mock S3 service
    vi.mocked(getS3Service).mockReturnValue({
      generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.test.com/file"),
    } as any);

    // Mock GitHub credentials
    vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
      username: "testuser",
      token: "github_pat_test",
    });

    // Setup database mocks
    setupChatMessageDatabaseMocks(mockUserId, mockTaskId, mockWorkspaceId);

    // Mock workspace query
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      id: mockWorkspaceId,
      slug: mockWorkspaceSlug,
    } as any);

    // Mock fetch globally
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  describe("HTTP Call Construction", () => {
    it("should make POST request to /api/mock/chat endpoint", async () => {
      const mockChatMessage = createMockChatMessage({
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
      });

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      // Mock successful response from /api/mock/chat
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ message: "Mock response", success: true }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
        headers: {
          "content-type": "application/json",
          host: "localhost:3000",
        },
      });

      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/mock/chat",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );
    });

    it("should include taskId, message, userId, artifacts, and history in payload", async () => {
      const mockChatMessage = createMockChatMessage({
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
        artifacts: [
          {
            id: "artifact-1",
            type: "code",
            content: { language: "typescript", code: "console.log('test');" },
          },
        ],
      });

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([
        {
          id: "hist-1",
          message: "Previous message",
          role: ChatRole.USER,
          createdAt: new Date(),
          contextTags: "[]",
          artifacts: [],
          attachments: [],
        } as any,
      ]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ message: "Mock response", success: true }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
          artifacts: [{ type: "code", content: { language: "typescript", code: "console.log('test');" } }],
        }),
        headers: {
          "content-type": "application/json",
          host: "localhost:3000",
        },
      });

      await POST(request);

      expect(mockFetch).toHaveBeenCalled();
      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body as string);

      expect(requestBody).toMatchObject({
        taskId: mockTaskId,
        message: "Test message",
        userId: mockUserId,
        artifacts: expect.any(Array),
        history: expect.any(Array),
      });
    });

    it("should include chat history excluding current message", async () => {
      const mockChatMessage = createMockChatMessage({
        id: mockMessageId,
        taskId: mockTaskId,
        message: "New message",
      });

      const historyMessages = [
        {
          id: "hist-1",
          message: "Message 1",
          role: ChatRole.USER,
          createdAt: new Date(),
          contextTags: "[]",
          status: ChatStatus.SENT,
          artifacts: [],
          attachments: [],
        },
        {
          id: "hist-2",
          message: "Message 2",
          role: ChatRole.AI,
          createdAt: new Date(),
          contextTags: "[]",
          status: ChatStatus.SENT,
          artifacts: [],
          attachments: [],
        },
      ];

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue(historyMessages as any);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ message: "Mock response", success: true }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "New message",
        }),
        headers: {
          "content-type": "application/json",
          host: "localhost:3000",
        },
      });

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body as string);

      expect(requestBody.history).toHaveLength(2);
      expect(requestBody.history[0].id).toBe("hist-1");
      expect(requestBody.history[1].id).toBe("hist-2");
    });
  });

  describe("Response Handling", () => {
    it("should return success when mock server responds with 200 OK", async () => {
      const mockChatMessage = createMockChatMessage({
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
      });

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ message: "Mock AI response", success: true, data: { response: "Hello!" } }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
        headers: {
          "content-type": "application/json",
          host: "localhost:3000",
        },
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(201);
      expect(responseData.success).toBe(true);
      expect(responseData.workflow).toMatchObject({
        message: "Mock AI response",
        success: true,
        data: { response: "Hello!" },
      });
    });

    it("should extract and return response data from mock server", async () => {
      const mockChatMessage = createMockChatMessage({
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
      });

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      const mockServerResponse = {
        message: "Mock response text",
        artifacts: [{ type: "code", content: "test" }],
        timestamp: "2024-01-01T00:00:00Z",
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockServerResponse,
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
        headers: {
          "content-type": "application/json",
          host: "localhost:3000",
        },
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(responseData.workflow).toEqual(mockServerResponse);
    });
  });

  describe("Error Handling", () => {
    it("should handle network errors gracefully", async () => {
      const mockChatMessage = createMockChatMessage({
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
      });

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      mockFetch.mockRejectedValue(new Error("Network error"));

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
        headers: {
          "content-type": "application/json",
          host: "localhost:3000",
        },
      });

      const response = await POST(request);
      const responseData = await response.json();

      // Should still return a successful response (201) but workflow will be undefined
      // because callMock returns {success: false, error: "..."} with no data property
      expect(response.status).toBe(201);
      expect(responseData.success).toBe(true);
      expect(responseData.message).toBeDefined();
      // When callMock fails, stakworkData.data is undefined, so workflow is undefined
      expect(responseData.workflow).toBeUndefined();
    });

    it("should handle non-OK responses from mock server", async () => {
      const mockChatMessage = createMockChatMessage({
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
      });

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Internal Server Error",
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
        headers: {
          "content-type": "application/json",
          host: "localhost:3000",
        },
      });

      const response = await POST(request);
      const responseData = await response.json();

      // When fetch fails, callMock returns {success: false, error: "..."} with no data
      expect(response.status).toBe(201);
      expect(responseData.success).toBe(true);
      expect(responseData.message).toBeDefined();
      expect(responseData.workflow).toBeUndefined();
    });

    it("should handle malformed JSON responses", async () => {
      const mockChatMessage = createMockChatMessage({
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
      });

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
        headers: {
          "content-type": "application/json",
          host: "localhost:3000",
        },
      });

      const response = await POST(request);
      const responseData = await response.json();

      // When JSON parsing fails, callMock returns {success: false, error: "..."} with no data
      expect(response.status).toBe(201);
      expect(responseData.success).toBe(true);
      expect(responseData.message).toBeDefined();
      expect(responseData.workflow).toBeUndefined();
    });
  });

  describe("Integration with POST Route", () => {
    it("should be invoked when Stakwork credentials are not configured", async () => {
      const mockChatMessage = createMockChatMessage({
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
      });

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ message: "Mock response", success: true }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
        headers: {
          "content-type": "application/json",
          host: "localhost:3000",
        },
      });

      await POST(request);

      // Verify callMock was invoked (fetch to /api/mock/chat)
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/mock/chat",
        expect.any(Object),
      );
    });

    it("should save chat message before calling mock server", async () => {
      const mockChatMessage = createMockChatMessage({
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
      });

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ message: "Mock response", success: true }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
        headers: {
          "content-type": "application/json",
          host: "localhost:3000",
        },
      });

      await POST(request);

      // Verify message was created before calling mock
      expect(db.chatMessage.create).toHaveBeenCalled();
      const createCall = vi.mocked(db.chatMessage.create).mock.calls[0];
      expect(createCall[0].data.message).toBe("Test message");
      expect(createCall[0].data.taskId).toBe(mockTaskId);
    });

    it("should return complete response with message and workflow data", async () => {
      const mockChatMessage = createMockChatMessage({
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
      });

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ message: "Mock AI response", success: true }),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/chat/message", {
        method: "POST",
        body: JSON.stringify({
          taskId: mockTaskId,
          message: "Test message",
        }),
        headers: {
          "content-type": "application/json",
          host: "localhost:3000",
        },
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(responseData).toHaveProperty("success", true);
      expect(responseData).toHaveProperty("message");
      expect(responseData.message).toMatchObject({
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
        role: ChatRole.USER,
      });
      expect(responseData).toHaveProperty("workflow");
      expect(responseData.workflow).toMatchObject({
        message: "Mock AI response",
        success: true,
      });
    });
  });
});
