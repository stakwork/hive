import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/tasks/[taskId]/messages/save/route";
import { db } from "@/lib/db";
import { ChatRole, ChatStatus } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
  expectError,
  generateUniqueId,
  createPostRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace, createTestMembership } from "@/__tests__/support/fixtures/workspace";
import { createTestTask } from "@/__tests__/support/fixtures/task";

describe("POST /api/tasks/[taskId]/messages/save Integration Tests", () => {
  let testUser: { id: string; email: string; name: string };
  let testWorkspace: { id: string; slug: string; ownerId: string };
  let testTask: { id: string; workspaceId: string };
  let otherUser: { id: string; email: string; name: string };
  let memberUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create primary test user
    testUser = await createTestUser({ name: "Test User" });

    // Create workspace owned by test user
    testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

    // Create task in the workspace
    testTask = await createTestTask({
      title: "Test Task",
      description: "Test task for message saving",
      status: "IN_PROGRESS",
      workspaceId: testWorkspace.id,
      createdById: testUser.id,
    });

    // Create other user for unauthorized access testing
    otherUser = await createTestUser({ name: "Other User" });

    // Create member user with workspace access
    memberUser = await createTestUser({ name: "Member User" });

    // Add member to workspace
    await createTestMembership({
      userId: memberUser.id,
      workspaceId: testWorkspace.id,
      role: "DEVELOPER",
    });
  });

  describe("Authentication Tests", () => {
    test("should return 401 when no session provided", async () => {
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

    test("should return 401 when session has no user", async () => {
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

    test("should return 401 when session user has no id", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" },
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

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Invalid user session");
    });
  });

  describe("Input Validation Tests", () => {
    test("should return 400 when message is missing", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          role: "USER",
          // message missing
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      await expectError(response, "Message is required", 400);
    });

    test("should return 400 when message is empty string", async () => {
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

    test("should return 400 when role is missing", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Test message",
          // role missing
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      await expectError(
        response,
        "Valid role is required (USER or ASSISTANT)",
        400
      );
    });

    test("should return 400 when role is invalid", async () => {
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

      await expectError(
        response,
        "Valid role is required (USER or ASSISTANT)",
        400
      );
    });
  });

  describe("Task Existence Tests", () => {
    test("should return 404 when task does not exist", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const nonExistentId = generateUniqueId("non-existent");
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

      await expectNotFound(response, "Task not found");
    });

    test("should return 404 for soft-deleted tasks", async () => {
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

      await expectNotFound(response, "Task not found");
    });
  });

  describe("Authorization Tests", () => {
    test("should return 403 when user is not workspace owner or member", async () => {
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

      await expectForbidden(response, "Access denied");
    });

    test("should allow access for workspace owner", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Test message from owner",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });

    test("should allow access for workspace member", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(memberUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Test message from member",
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });
  });

  describe("Message Persistence Tests", () => {
    test("should successfully create message with USER role", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const messageContent = "Test user message content";
      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: messageContent,
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response, 201);

      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.message).toBe(messageContent);
      expect(data.data.role).toBe(ChatRole.USER);
      expect(data.data.status).toBe(ChatStatus.SENT);
      expect(data.data.taskId).toBe(testTask.id);
      expect(data.data.contextTags).toBeDefined();

      // Verify message was persisted to database
      const savedMessage = await db.chatMessage.findUnique({
        where: { id: data.data.id },
      });

      expect(savedMessage).toBeTruthy();
      expect(savedMessage?.message).toBe(messageContent);
      expect(savedMessage?.role).toBe(ChatRole.USER);
      expect(savedMessage?.status).toBe(ChatStatus.SENT);
      expect(savedMessage?.taskId).toBe(testTask.id);
    });

    test("should successfully create message with ASSISTANT role", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const messageContent = "Test assistant message content";
      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: messageContent,
          role: "ASSISTANT",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response, 201);

      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.message).toBe(messageContent);
      expect(data.data.role).toBe(ChatRole.ASSISTANT);
      expect(data.data.status).toBe(ChatStatus.SENT);
      expect(data.data.taskId).toBe(testTask.id);

      // Verify message was persisted to database
      const savedMessage = await db.chatMessage.findUnique({
        where: { id: data.data.id },
      });

      expect(savedMessage).toBeTruthy();
      expect(savedMessage?.message).toBe(messageContent);
      expect(savedMessage?.role).toBe(ChatRole.ASSISTANT);
    });

    test("should set contextTags to empty array by default", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
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

      const data = await expectSuccess(response, 201);

      // contextTags should be JSON string "[]"
      expect(data.data.contextTags).toBe("[]");

      const savedMessage = await db.chatMessage.findUnique({
        where: { id: data.data.id },
      });

      expect(savedMessage?.contextTags).toBe("[]");
    });

    test("should create multiple messages for same task", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Create first message
      const request1 = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "First message",
          role: "USER",
        }
      );

      const response1 = await POST(request1, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data1 = await expectSuccess(response1, 201);

      // Create second message
      const request2 = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Second message",
          role: "ASSISTANT",
        }
      );

      const response2 = await POST(request2, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data2 = await expectSuccess(response2, 201);

      // Verify both messages exist
      expect(data1.data.id).not.toBe(data2.data.id);

      const messages = await db.chatMessage.findMany({
        where: { taskId: testTask.id },
      });

      expect(messages).toHaveLength(2);
    });
  });

  describe("Edge Cases", () => {
    test("should handle very long message content", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const longMessage = "a".repeat(10000); // Very long message

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

      const data = await expectSuccess(response, 201);

      expect(data.data.message).toBe(longMessage);

      const savedMessage = await db.chatMessage.findUnique({
        where: { id: data.data.id },
      });

      expect(savedMessage?.message).toBe(longMessage);
    });

    test("should handle special characters in message content", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const specialMessage =
        "Test with 🚀 emojis and special chars: àáâäåæçèéêë & <html> tags";

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

      const data = await expectSuccess(response, 201);

      expect(data.data.message).toBe(specialMessage);
    });

    test("should handle message with only whitespace", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const whitespaceMessage = "   \n\t   ";

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: whitespaceMessage,
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response, 201);

      expect(data.data.message).toBe(whitespaceMessage);
    });

    test("should handle newlines and line breaks in message", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const multilineMessage = "Line 1\nLine 2\rLine 3\r\nLine 4";

      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: multilineMessage,
          role: "USER",
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response, 201);

      expect(data.data.message).toBe(multilineMessage);
    });
  });

  describe("Response Structure Tests", () => {
    test("should return correct response structure on success", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
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

      const data = await expectSuccess(response, 201);

      // Verify top-level structure
      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("data");

      // Verify data structure contains expected fields
      expect(data.data).toHaveProperty("id");
      expect(data.data).toHaveProperty("message");
      expect(data.data).toHaveProperty("role");
      expect(data.data).toHaveProperty("status");
      expect(data.data).toHaveProperty("taskId");
      expect(data.data).toHaveProperty("contextTags");
      expect(data.data).toHaveProperty("createdAt");
      expect(data.data).toHaveProperty("updatedAt");

      // Verify field types
      expect(typeof data.data.id).toBe("string");
      expect(typeof data.data.message).toBe("string");
      expect(typeof data.data.role).toBe("string");
      expect(typeof data.data.status).toBe("string");
      expect(typeof data.data.taskId).toBe("string");
    });

    test("should return appropriate content-type header", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
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

      expect(response.status).toBe(201);

      const contentType = response.headers.get("content-type");
      expect(contentType).toContain("application/json");
    });
  });

  describe("Error Handling Tests", () => {
    test("should return 500 for unexpected database errors", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Mock database error by using invalid taskId format
      const request = createPostRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          message: "Test message",
          role: "USER",
        }
      );

      // Force database error by temporarily breaking the connection
      const originalCreate = db.chatMessage.create;
      vi.spyOn(db.chatMessage, "create").mockRejectedValueOnce(
        new Error("Database connection failed")
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to save chat message");

      // Restore original method
      db.chatMessage.create = originalCreate;
    });

    test("should handle malformed JSON in request body", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = new Request(
        `http://localhost:3000/api/tasks/${testTask.id}/messages/save`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: "{invalid json}", // Malformed JSON
        }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      // Should handle gracefully with error response
      expect([400, 500]).toContain(response.status);
      const data = await response.json();
      expect(data).toHaveProperty("error");
    });
  });

  describe("Database Transaction Tests", () => {
    test("should rollback on database error during message creation", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const initialMessageCount = await db.chatMessage.count({
        where: { taskId: testTask.id },
      });

      // Force database error
      const originalCreate = db.chatMessage.create;
      vi.spyOn(db.chatMessage, "create").mockRejectedValueOnce(
        new Error("Database error")
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

      expect(response.status).toBe(500);

      // Verify no message was created
      const finalMessageCount = await db.chatMessage.count({
        where: { taskId: testTask.id },
      });

      expect(finalMessageCount).toBe(initialMessageCount);

      // Restore original method
      db.chatMessage.create = originalCreate;
    });
  });
});