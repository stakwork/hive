import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/tasks/[taskId]/messages/save/route";
import { db } from "@/lib/db";
import { ChatRole, ChatStatus } from "@prisma/client";
import { pusherServer } from "@/lib/pusher";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
  generateUniqueId,
  generateUniqueSlug,
  createPostRequest,
  getMockedSession,
  expectError,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";

// Mock Pusher to prevent actual WebSocket connections during tests
vi.mock("@/lib/pusher", async () => {
  const actual = await vi.importActual("@/lib/pusher");
  return {
    ...actual,
    pusherServer: {
      trigger: vi.fn().mockResolvedValue({}),
    },
  };
});

describe("POST /api/tasks/[taskId]/messages/save - Integration Tests", () => {
  let testUser: { id: string; email: string; name: string };
  let testWorkspace: { id: string; slug: string; ownerId: string };
  let testTask: { id: string; workspaceId: string };
  let otherUser: { id: string; email: string; name: string };
  let memberUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test data with proper relationships
    const testData = await db.$transaction(async (tx) => {
      // Create primary test user
      const user = await tx.user.create({
        data: {
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      // Create workspace owned by test user
      const workspace = await tx.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      // Create task in the workspace
      const task = await tx.task.create({
        data: {
          title: "Test Task for Messages",
          description: "Test task for message save endpoint",
          status: "IN_PROGRESS",
          priority: "MEDIUM",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
          workflowStatus: "IN_PROGRESS",
        },
      });

      // Create other user for unauthorized access testing
      const otherUser = await tx.user.create({
        data: {
          email: `other-user-${generateUniqueId()}@example.com`,
          name: "Other User",
        },
      });

      // Create member user with workspace access
      const memberUser = await tx.user.create({
        data: {
          email: `member-user-${generateUniqueId()}@example.com`,
          name: "Member User",
        },
      });

      // Add member to workspace
      await tx.workspaceMember.create({
        data: {
          userId: memberUser.id,
          workspaceId: workspace.id,
          role: "DEVELOPER",
        },
      });

      return {
        user,
        workspace,
        task,
        otherUser,
        memberUser,
      };
    });

    testUser = testData.user;
    testWorkspace = testData.workspace;
    testTask = testData.task;
    otherUser = testData.otherUser;
    memberUser = testData.memberUser;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    it("should return 401 when no session provided", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Test message",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      await expectUnauthorized(response);
    });

    it("should return 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({ user: null });

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Test message",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      await expectUnauthorized(response);
    });

    it("should return 401 when session user has no id", async () => {
      getMockedSession().mockResolvedValue({ user: { name: "Test User" } });

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Test message",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(401);
      const data = await response?.json();
      expect(data.error).toBe("Invalid user session");
    });
  });

  describe("Input Validation", () => {
    it("should return 404 when taskId is missing", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        "http://localhost:3000/api/tasks//messages/save",
        {
          message: "Test message",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: "" }),
      });

      await expectNotFound(response);
    });

    it("should return 400 when message is missing", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      await expectError(response, "Message is required", 400);
    });

    it("should return 400 when message is empty string", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      await expectError(response, "Message is required", 400);
    });

    it("should return 400 when role is missing or invalid", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Test message",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      await expectError(response, "Valid role is required (USER or ASSISTANT)", 400);
    });

    it("should return 400 when role is invalid", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Test message",
          role: "INVALID_ROLE",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      await expectError(response, "Valid role is required (USER or ASSISTANT)", 400);
    });

    it("should return 404 when task does not exist", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const nonExistentId = "non-existent-task-id";
      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${nonExistentId}/messages/save`,
        {
          message: "Test message",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: nonExistentId }),
      });

      await expectNotFound(response);
    });

    it("should return 404 for soft-deleted tasks", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Soft-delete the task
      await db.task.update({
        where: { id: testTask.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Test message",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      await expectNotFound(response);
    });
  });

  describe("Authorization & Access Control", () => {
    it("should return 403 when user is not workspace owner or member", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(otherUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Test message",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      await expectForbidden(response);
    });

    it("should allow access for workspace owner", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Owner message",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(201);
      const data = await expectSuccess(response, 201);
      expect(data.data).toBeDefined();
      expect(data.data.message).toBe("Owner message");
    });

    it("should allow access for workspace member", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(memberUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Member message",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(201);
      const data = await expectSuccess(response, 201);
      expect(data.data).toBeDefined();
      expect(data.data.message).toBe("Member message");
    });
  });

  describe("Message Persistence with Role Validation", () => {
    it("should create message with USER role successfully", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "User message content",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(201);
      const data = await expectSuccess(response, 201);

      // Verify response structure
      expect(data.data).toBeDefined();
      expect(data.data.message).toBe("User message content");
      expect(data.data.role).toBe(ChatRole.USER);
      expect(data.data.taskId).toBe(testTask.id);
      expect(data.data.status).toBe(ChatStatus.SENT);

      // Verify database persistence
      const savedMessage = await db.chatMessage.findUnique({
        where: { id: data.data.id },
      });

      expect(savedMessage).toBeDefined();
      expect(savedMessage?.message).toBe("User message content");
      expect(savedMessage?.role).toBe(ChatRole.USER);
      expect(savedMessage?.taskId).toBe(testTask.id);
    });

    it("should create message with ASSISTANT role successfully", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Assistant message content",
          role: "ASSISTANT",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(201);
      const data = await expectSuccess(response, 201);

      // Verify response structure
      expect(data.data).toBeDefined();
      expect(data.data.message).toBe("Assistant message content");
      expect(data.data.role).toBe(ChatRole.ASSISTANT);
      expect(data.data.taskId).toBe(testTask.id);

      // Verify database persistence
      const savedMessage = await db.chatMessage.findUnique({
        where: { id: data.data.id },
      });

      expect(savedMessage).toBeDefined();
      expect(savedMessage?.message).toBe("Assistant message content");
      expect(savedMessage?.role).toBe(ChatRole.ASSISTANT);
    });

    it("should set default status to SENT for new messages", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Status test message",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response, 201);
      expect(data.data.status).toBe(ChatStatus.SENT);

      const savedMessage = await db.chatMessage.findUnique({
        where: { id: data.data.id },
      });
      expect(savedMessage?.status).toBe(ChatStatus.SENT);
    });

    it("should preserve whitespace in message content", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "  Whitespace test message  ",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response, 201);
      // API does not trim whitespace
      expect(data.data.message).toBe("  Whitespace test message  ");
    });

    it("should set timestamp automatically", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const beforeCreate = new Date();

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Timestamp test message",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const afterCreate = new Date();
      const data = await expectSuccess(response, 201);

      const messageTimestamp = new Date(data.data.timestamp);
      expect(messageTimestamp.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
      expect(messageTimestamp.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
    });
  });

  // TODO: Pusher integration not yet implemented in /api/tasks/[taskId]/messages/save
  // These tests are commented out until the feature is added
  /*
  describe("Pusher Real-Time Notifications", () => {
    it("should broadcast NEW_MESSAGE event to task channel after creation", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Notification test message",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response, 201);

      // Verify Pusher trigger was called
      expect(pusherServer.trigger).toHaveBeenCalledTimes(1);
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `task-${testTask.id}`,
        "new-message",
        data.data.id
      );
    });

    it("should handle Pusher broadcast failure gracefully", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Mock Pusher trigger to throw error
      vi.mocked(pusherServer.trigger).mockRejectedValueOnce(
        new Error("Pusher connection failed")
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Pusher error test message",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      // Message should still be created successfully
      expect(response?.status).toBe(201);
      const data = await expectSuccess(response, 201);
      expect(data.data).toBeDefined();

      // Verify message was persisted despite Pusher failure
      const savedMessage = await db.chatMessage.findUnique({
        where: { id: data.data.id },
      });
      expect(savedMessage).toBeDefined();
    });

    it("should not broadcast to workspace channel (task-specific only)", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Channel test message",
          role: "USER",
        }
      );

      await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      // Verify only task channel was triggered, not workspace channel
      expect(pusherServer.trigger).toHaveBeenCalledTimes(1);
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `task-${testTask.id}`,
        expect.any(String),
        expect.any(String)
      );

      // Ensure workspace channel was NOT called
      const calls = vi.mocked(pusherServer.trigger).mock.calls;
      const workspaceChannelCalled = calls.some(
        (call) => call[0] === `workspace-${testWorkspace.slug}`
      );
      expect(workspaceChannelCalled).toBe(false);
    });
  });
  */

  describe("Response Structure", () => {
    it("should return correct response structure on success", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Response structure test",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response, 201);

      // Verify top-level structure
      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("data");

      // Verify message structure
      expect(data.data).toHaveProperty("id");
      expect(data.data).toHaveProperty("taskId", testTask.id);
      expect(data.data).toHaveProperty("message", "Response structure test");
      expect(data.data).toHaveProperty("role", ChatRole.USER);
      expect(data.data).toHaveProperty("status", ChatStatus.SENT);
      expect(data.data).toHaveProperty("timestamp");
      expect(typeof data.data.id).toBe("string");
      expect(typeof data.data.timestamp).toBe("string");
    });

    it("should set appropriate content-type header", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Content-type test",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(201);
      const contentType = response?.headers.get("content-type");
      expect(contentType).toContain("application/json");
    });
  });

  describe("Error Handling", () => {
    it("should return 500 on unexpected database error", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Mock database error by using invalid data
      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Database error test",
          role: "USER",
        }
      );

      // Temporarily mock db.chatMessage.create to throw error
      vi.spyOn(db.chatMessage, "create").mockRejectedValueOnce(
        new Error("Database connection failed")
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(500);
      const data = await response?.json();
      expect(data.error).toBe("Failed to save chat message");
    });

    it("should handle malformed JSON in request body", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Create request with malformed body (this will be caught by request.json())
      const request = new Request(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{malformed json",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      // Should return 400 or 500 depending on error handling
      expect([400, 500]).toContain(response?.status);
    });
  });

  describe("Edge Cases", () => {
    it("should handle very long message content", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const longMessage = "A".repeat(10000); // 10KB message

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: longMessage,
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(201);
      const data = await expectSuccess(response, 201);
      expect(data.data.message).toBe(longMessage);
    });

    it("should handle special characters in message content", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const specialMessage = "Test with <html> tags & special chars: @#$%^&*()";

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: specialMessage,
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(201);
      const data = await expectSuccess(response, 201);
      expect(data.data.message).toBe(specialMessage);
    });

    it("should handle unicode characters in message content", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const unicodeMessage = "Test with emoji 🚀 and unicode 你好世界";

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: unicodeMessage,
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(201);
      const data = await expectSuccess(response, 201);
      expect(data.data.message).toBe(unicodeMessage);
    });

    it("should handle rapid sequential message creation", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Create 5 messages in rapid succession
      const messagePromises = Array.from({ length: 5 }, (_, i) => {
        const request = createPostRequest(
          `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
          {
            message: `Rapid message ${i + 1}`,
            role: "USER",
          }
        );

        return POST(request, {
          params: Promise.resolve({ taskId: testTask.id }),
        });
      });

      const responses = await Promise.all(messagePromises);

      // All should succeed
      responses.forEach((response) => {
        expect(response?.status).toBe(201);
      });

      // Verify all messages were persisted
      const messages = await db.chatMessage.findMany({
        where: { taskId: testTask.id },
        orderBy: { timestamp: "asc" },
      });

      expect(messages.length).toBeGreaterThanOrEqual(5);
      const rapidMessages = messages.filter((m) =>
        m.message.startsWith("Rapid message")
      );
      expect(rapidMessages).toHaveLength(5);
    });
  });

  describe("Workflow Integration (Non-triggering)", () => {
    it("should NOT trigger Stakwork workflow (unlike /api/chat/message)", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Workflow test message",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(201);

      // Verify task workflow status was NOT updated
      const task = await db.task.findUnique({
        where: { id: testTask.id },
      });

      expect(task?.workflowStatus).toBe("IN_PROGRESS"); // Original status unchanged
      expect(task?.workflowStartedAt).toBeNull(); // No workflow start time set
    });

    it("should allow manual workflow status preservation", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Set task to specific workflow status
      await db.task.update({
        where: { id: testTask.id },
        data: {
          workflowStatus: "COMPLETED",
          workflowStartedAt: new Date("2024-01-01"),
        },
      });

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Manual workflow message",
          role: "ASSISTANT",
        }
      );

      await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      // Verify workflow status remained unchanged
      const task = await db.task.findUnique({
        where: { id: testTask.id },
      });

      expect(task?.workflowStatus).toBe("COMPLETED"); // Status preserved
      expect(task?.workflowStartedAt?.toISOString()).toBe(
        new Date("2024-01-01").toISOString()
      );
    });
  });
});