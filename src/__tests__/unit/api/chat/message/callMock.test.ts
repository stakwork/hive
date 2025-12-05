import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/chat/message/route";
import { getServerSession } from "next-auth/next";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { ChatRole, ChatStatus } from "@/lib/chat";
import { getS3Service } from "@/services/s3";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { processMockChat } from "@/services/chat-mock";
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
vi.mock("@/lib/utils/swarm");
vi.mock("@/services/chat-mock");

/**
 * Unit Tests for callMock Function (Chat Message Variant)
 *
 * Tests the callMock function which handles mock chat processing when Stakwork is not enabled.
 * After refactoring, this function now calls processMockChat() service directly instead of
 * making HTTP calls to /api/mock/chat.
 *
 * Test Coverage:
 * 1. Service Call Construction - proper payload formation and parameters
 * 2. Response Handling - success/error responses, data extraction
 * 3. Error Handling - service failures, invalid responses
 * 4. Integration - proper invocation through POST route handler
 */
describe("callMock Function - Chat Message Processing", () => {
  const mockUserId = "user-123";
  const mockTaskId = "task-456";
  const mockWorkspaceId = "workspace-789";
  const mockWorkspaceSlug = "test-workspace";
  const mockMessageId = "message-abc";

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

    // Mock processMockChat service
    vi.mocked(processMockChat).mockResolvedValue({
      success: true,
      data: {
        id: "mock-response-123",
        role: "assistant",
        content: "Mock AI response",
        createdAt: new Date().toISOString(),
      },
    });
  });

  describe("Service Call Construction", () => {
    it("should call processMockChat service with correct parameters", async () => {
      const mockChatMessage = createMockChatMessage({
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
      });

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

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

      expect(processMockChat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: mockTaskId,
          message: "Test message",
          userId: mockUserId,
          artifacts: expect.any(Array),
          history: expect.any(Array),
        }),
      );
    });

    it("should include taskId, message, userId, artifacts, and history in service call", async () => {
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

      expect(processMockChat).toHaveBeenCalled();
      const callArgs = vi.mocked(processMockChat).mock.calls[0][0];

      expect(callArgs).toMatchObject({
        taskId: mockTaskId,
        message: "Test message",
        userId: mockUserId,
        artifacts: expect.any(Array),
        history: expect.any(Array),
      });
      expect(callArgs.artifacts).toHaveLength(1);
      expect(callArgs.artifacts[0].type).toBe("code");
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

      const callArgs = vi.mocked(processMockChat).mock.calls[0][0];

      expect(callArgs.history).toHaveLength(2);
      expect(callArgs.history[0]).toHaveProperty("id", "hist-1");
      expect(callArgs.history[1]).toHaveProperty("id", "hist-2");
    });
  });

  describe("Response Handling", () => {
    it("should return success when mock service responds successfully", async () => {
      const mockChatMessage = createMockChatMessage({
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
      });

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      vi.mocked(processMockChat).mockResolvedValue({
        success: true,
        data: {
          id: "mock-123",
          role: "assistant",
          content: "Mock AI response",
          createdAt: new Date().toISOString(),
        },
      });

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
        id: "mock-123",
        role: "assistant",
        content: "Mock AI response",
      });
    });

    it("should extract and return response data from mock service", async () => {
      const mockChatMessage = createMockChatMessage({
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
      });

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      const mockServiceResponse = {
        id: "mock-456",
        role: "assistant" as const,
        content: "Mock response text",
        createdAt: "2024-01-01T00:00:00Z",
        artifacts: [{ id: "art-1", type: "code", title: "test.ts", content: "test" }],
      };

      vi.mocked(processMockChat).mockResolvedValue({
        success: true,
        data: mockServiceResponse,
      });

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

      expect(responseData.workflow).toEqual(mockServiceResponse);
    });
  });

  describe("Error Handling", () => {
    it("should handle service errors gracefully", async () => {
      const mockChatMessage = createMockChatMessage({
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
      });

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      vi.mocked(processMockChat).mockResolvedValue({
        success: false,
        error: "Service error occurred",
      });

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

      // Should still return 201 but workflow will be undefined due to error
      expect(response.status).toBe(201);
      expect(responseData.success).toBe(true);
      expect(responseData.message).toBeDefined();
      expect(responseData.workflow).toBeUndefined();
    });

    it("should handle service exceptions", async () => {
      const mockChatMessage = createMockChatMessage({
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
      });

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      vi.mocked(processMockChat).mockRejectedValue(new Error("Unexpected error"));

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
      expect(responseData.message).toBeDefined();
      expect(responseData.workflow).toBeUndefined();
    });

    it("should handle service returning invalid response structure", async () => {
      const mockChatMessage = createMockChatMessage({
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
      });

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      vi.mocked(processMockChat).mockResolvedValue({
        success: true,
        // Missing data property
      } as any);

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

      // Verify processMockChat was called
      expect(processMockChat).toHaveBeenCalled();
    });

    it("should save chat message before calling mock service", async () => {
      const mockChatMessage = createMockChatMessage({
        id: mockMessageId,
        taskId: mockTaskId,
        message: "Test message",
      });

      vi.mocked(db.chatMessage.create).mockResolvedValue(mockChatMessage);
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

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

      vi.mocked(processMockChat).mockResolvedValue({
        success: true,
        data: {
          id: "mock-789",
          role: "assistant",
          content: "Mock AI response",
          createdAt: new Date().toISOString(),
        },
      });

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
        id: "mock-789",
        role: "assistant",
        content: "Mock AI response",
      });
    });
  });
});
