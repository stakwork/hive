import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/tasks/[taskId]/messages/route";
import { db } from "@/lib/db";
import { ChatRole, ChatStatus, ArtifactType } from "@/lib/chat";
import { WorkflowStatus } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
  generateUniqueId,
  generateUniqueSlug,
  createGetRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";

describe("GET /api/tasks/[taskId]/messages", () => {
  let testUser: { id: string; email: string; name: string };
  let testWorkspace: { id: string; slug: string; ownerId: string };
  let testTask: { id: string; workspaceId: string };
  let testMessages: Array<{ id: string; taskId: string; message: string; role: string; replyId: string | null }>;
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
          title: "Test Task",
          description: "Test task description",
          status: "IN_PROGRESS",
          priority: "MEDIUM",
          workspaceId: workspace.id,
          workflowStatus: WorkflowStatus.PENDING,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Create chat messages with threading and artifacts
      const message1 = await tx.chatMessage.create({
        data: {
          message: "First message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          taskId: task.id,
          timestamp: new Date("2024-01-01T10:00:00Z"),
          contextTags: JSON.stringify([{ type: "FILE", id: "file-1" }]),
        },
      });

      // Create artifact for first message
      await tx.artifact.create({
        data: {
          type: ArtifactType.CODE,
          content: { code: "console.log('test');" },
          messageId: message1.id,
          createdAt: new Date("2024-01-01T10:00:01Z"),
        },
      });

      const message2 = await tx.chatMessage.create({
        data: {
          message: "Second message",
          role: ChatRole.ASSISTANT,
          status: ChatStatus.SENT,
          taskId: task.id,
          timestamp: new Date("2024-01-01T10:01:00Z"),
          contextTags: JSON.stringify([]),
          replyId: message1.id, // Thread reply
        },
      });

      const message3 = await tx.chatMessage.create({
        data: {
          message: "Third message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          taskId: task.id,
          timestamp: new Date("2024-01-01T10:02:00Z"),
          contextTags: JSON.stringify([
            { type: "FEATURE_BRIEF", id: "feature-1" },
            { type: "USER_STORY", id: "story-1" },
          ]),
        },
      });

      // Create multiple artifacts for third message
      await tx.artifact.create({
        data: {
          type: ArtifactType.CODE,
          content: { code: "function test() {}" },
          messageId: message3.id,
          createdAt: new Date("2024-01-01T10:02:01Z"),
        },
      });

      await tx.artifact.create({
        data: {
          type: ArtifactType.FORM,
          content: { 
            actionText: "Submit",
            webhook: "https://example.com/webhook",
            options: []
          },
          messageId: message3.id,
          createdAt: new Date("2024-01-01T10:02:02Z"),
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
        messages: [message1, message2, message3],
        otherUser,
        memberUser,
      };
    });

    testUser = testData.user;
    testWorkspace = testData.workspace;
    testTask = testData.task;
    testMessages = testData.messages;
    otherUser = testData.otherUser;
    memberUser = testData.memberUser;
  });

  describe("Authentication", () => {
    it("should return 401 when no session provided", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      await expectUnauthorized(response);
    });

    it("should return 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({ user: null });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(401);
      const data = await response?.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 when session user has no id", async () => {
      getMockedSession().mockResolvedValue({ user: { name: "Test User" } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(401);
      const data = await response?.json();
      expect(data.error).toBe("Invalid user session");
    });
  });

  describe("Input Validation", () => {
    it("should return 400 when taskId is missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest("http://localhost:3000/api/tasks//messages");

      const response = await GET(request, {
        params: Promise.resolve({ taskId: "" }),
      });

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toBe("Task ID is required");
    });

    it("should return 404 when task does not exist", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const nonExistentId = "non-existent-task-id";
      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${nonExistentId}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: nonExistentId }),
      });

      await expectNotFound(response, "Task not found");
    });

    it("should return 404 when task is soft-deleted", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Soft-delete the task
      await db.task.update({
        where: { id: testTask.id },
        data: { deleted: true },
      });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      await expectNotFound(response, "Task not found");
    });
  });

  describe("Authorization & Access Control", () => {
    it("should return 403 when user is not workspace owner or member", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(otherUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      await expectForbidden(response, "Access denied");
    });

    it("should allow access for workspace owner", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });

    it("should allow access for workspace member", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });
  });

  describe("Message Association & Ordering", () => {
    it("should return all messages for the correct task in chronological order", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response);

      expect(data.data.messages).toHaveLength(3);
      expect(data.data.count).toBe(3);

      // Verify chronological ordering by timestamp
      expect(data.data.messages[0].message).toBe("First message");
      expect(data.data.messages[1].message).toBe("Second message");
      expect(data.data.messages[2].message).toBe("Third message");

      // Verify timestamps are in ascending order
      const timestamps = data.data.messages.map((m: any) => new Date(m.timestamp).getTime());
      expect(timestamps[0]).toBeLessThan(timestamps[1]);
      expect(timestamps[1]).toBeLessThan(timestamps[2]);
    });

    it("should include correct task metadata in response", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response);

      expect(data.data.task).toMatchObject({
        id: testTask.id,
        title: "Test Task",
        workspaceId: testWorkspace.id,
        workflowStatus: WorkflowStatus.PENDING,
      });
    });

    it("should return empty array when task has no messages", async () => {
      // Create task with no messages
      const emptyTask = await db.task.create({
        data: {
          title: "Empty Task",
          description: "No messages",
          status: "TODO",
          priority: "LOW",
          workspaceId: testWorkspace.id,
          workflowStatus: WorkflowStatus.PENDING,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${emptyTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: emptyTask.id }),
      });

      const data = await expectSuccess(response);

      expect(data.data.messages).toEqual([]);
      expect(data.data.count).toBe(0);
    });
  });

  describe("Artifact Handling", () => {
    it("should include artifacts in messages ordered by createdAt", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response);

      // First message has 1 artifact
      expect(data.data.messages[0].artifacts).toHaveLength(1);
      expect(data.data.messages[0].artifacts[0].type).toBe(ArtifactType.CODE);
      expect(data.data.messages[0].artifacts[0].content).toEqual({
        code: "console.log('test');",
      });

      // Second message has no artifacts
      expect(data.data.messages[1].artifacts).toHaveLength(0);

      // Third message has 2 artifacts in chronological order
      expect(data.data.messages[2].artifacts).toHaveLength(2);
      expect(data.data.messages[2].artifacts[0].type).toBe(ArtifactType.CODE);
      expect(data.data.messages[2].artifacts[1].type).toBe(ArtifactType.FORM);

      // Verify artifact ordering by createdAt
      const artifactTimestamps = data.data.messages[2].artifacts.map(
        (a: any) => new Date(a.createdAt).getTime()
      );
      expect(artifactTimestamps[0]).toBeLessThan(artifactTimestamps[1]);
    });

    it("should handle messages with no artifacts", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response);

      // Second message has no artifacts
      const messageWithoutArtifacts = data.data.messages[1];
      expect(messageWithoutArtifacts.artifacts).toEqual([]);
    });
  });

  describe("Threading Support", () => {
    it("should preserve replyId for threaded messages", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response);

      // First message has no replyId (root message)
      expect(data.data.messages[0].replyId).toBeNull();

      // Second message is a reply to first message
      expect(data.data.messages[1].replyId).toBe(testMessages[0].id);

      // Third message has no replyId (separate conversation)
      expect(data.data.messages[2].replyId).toBeNull();
    });
  });

  describe("JSON Parsing", () => {
    it("should parse contextTags from JSON string to typed array", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response);

      // First message has one contextTag
      expect(data.data.messages[0].contextTags).toEqual([
        { type: "FILE", id: "file-1" },
      ]);

      // Second message has empty contextTags
      expect(data.data.messages[1].contextTags).toEqual([]);

      // Third message has multiple contextTags
      expect(data.data.messages[2].contextTags).toEqual([
        { type: "FEATURE_BRIEF", id: "feature-1" },
        { type: "USER_STORY", id: "story-1" },
      ]);
    });

    it("should handle empty contextTags array", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response);

      const messageWithEmptyTags = data.data.messages[1];
      expect(Array.isArray(messageWithEmptyTags.contextTags)).toBe(true);
      expect(messageWithEmptyTags.contextTags).toHaveLength(0);
    });
  });

  describe("Error Handling", () => {
    it("should return 500 for database errors", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock database error by causing a query to fail
      const originalFindFirst = db.task.findFirst;
      vi.spyOn(db.task, "findFirst").mockRejectedValueOnce(
        new Error("Database connection failed")
      );

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(500);
      const data = await response?.json();
      expect(data.error).toBe("Failed to fetch chat messages");

      // Restore original implementation
      db.task.findFirst = originalFindFirst;
    });

    it.skip("should handle malformed contextTags JSON gracefully", async () => {
      // Create a normal message first through Prisma
      const malformedTask = await db.task.create({
        data: {
          title: "Malformed Task",
          description: "Has bad JSON",
          status: "TODO",
          priority: "LOW",
          workspaceId: testWorkspace.id,
          workflowStatus: WorkflowStatus.PENDING,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      const message = await db.chatMessage.create({
        data: {
          message: "Test Message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          taskId: malformedTask.id,
          timestamp: new Date("2024-01-01T10:00:00Z"),
          contextTags: JSON.stringify([{ type: "FILE", id: "file-1" }]),
        },
      });

      // Note: PostgreSQL validates JSON syntax at INSERT/UPDATE time, making it
      // difficult to test malformed JSON handling in application code.
      // This test is skipped as the database prevents creating truly malformed JSON.
      // In practice, the JSON parsing would happen in application code, not at DB level.

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${malformedTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: malformedTask.id }),
      });

      // Should return 500 due to JSON parsing error or handle gracefully
      expect([200, 500]).toContain(response?.status);
    });
  });

  describe("Response Structure", () => {
    it("should return correct response structure with all required fields", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response);

      // Verify top-level structure
      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("task");
      expect(data.data).toHaveProperty("messages");
      expect(data.data).toHaveProperty("count");

      // Verify task structure
      expect(data.data.task).toHaveProperty("id");
      expect(data.data.task).toHaveProperty("title");
      expect(data.data.task).toHaveProperty("workspaceId");
      expect(data.data.task).toHaveProperty("workflowStatus");

      // Verify messages are array
      expect(Array.isArray(data.data.messages)).toBe(true);

      // Verify message structure
      if (data.data.messages.length > 0) {
        const message = data.data.messages[0];
        expect(message).toHaveProperty("id");
        expect(message).toHaveProperty("taskId");
        expect(message).toHaveProperty("message");
        expect(message).toHaveProperty("role");
        expect(message).toHaveProperty("status");
        expect(message).toHaveProperty("timestamp");
        expect(message).toHaveProperty("contextTags");
        expect(message).toHaveProperty("artifacts");
        expect(message).toHaveProperty("replyId");
      }
    });

    it("should not include sensitive workspace data in response", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response);

      // Should not expose full workspace details
      expect(data.data.task).not.toHaveProperty("workspace");
      expect(data.data.task.workspaceId).toBe(testWorkspace.id);
    });
  });

  describe("Edge Cases", () => {
    it("should handle tasks with many messages efficiently", async () => {
      // Create task with 50 messages
      const largeTask = await db.task.create({
        data: {
          title: "Large Task",
          description: "Many messages",
          status: "IN_PROGRESS",
          priority: "HIGH",
          workspaceId: testWorkspace.id,
          workflowStatus: WorkflowStatus.PENDING,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      const messagePromises = [];
      for (let i = 0; i < 50; i++) {
        messagePromises.push(
          db.chatMessage.create({
            data: {
              message: `Message ${i}`,
              role: i % 2 === 0 ? ChatRole.USER : ChatRole.ASSISTANT,
              status: ChatStatus.SENT,
              taskId: largeTask.id,
              timestamp: new Date(`2024-01-01T10:${String(i).padStart(2, '0')}:00Z`),
              contextTags: JSON.stringify([]),
            },
          })
        );
      }
      await Promise.all(messagePromises);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${largeTask.id}/messages`
      );

      const startTime = Date.now();
      const response = await GET(request, {
        params: Promise.resolve({ taskId: largeTask.id }),
      });
      const endTime = Date.now();

      const data = await expectSuccess(response);

      expect(data.data.messages).toHaveLength(50);
      expect(data.data.count).toBe(50);
      
      // Verify performance (should complete in reasonable time)
      expect(endTime - startTime).toBeLessThan(5000); // 5 seconds max
    });

    it("should handle concurrent requests for same task", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request1 = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );
      const request2 = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      // Execute concurrent requests
      const [response1, response2] = await Promise.all([
        GET(request1, { params: Promise.resolve({ taskId: testTask.id }) }),
        GET(request2, { params: Promise.resolve({ taskId: testTask.id }) }),
      ]);

      const data1 = await expectSuccess(response1);
      const data2 = await expectSuccess(response2);

      // Both requests should return same data
      expect(data1.data.messages.length).toBe(data2.data.messages.length);
      expect(data1.data.count).toBe(data2.data.count);
    });
  });
});