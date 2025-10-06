import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/tasks/[taskId]/messages/route";
import { db } from "@/lib/db";
import { ChatRole, ChatStatus } from "@/lib/chat";
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
import { createTestTask } from "@/__tests__/support/fixtures/task";

describe("GET /api/tasks/[taskId]/messages", () => {
  let testUser: { id: string; email: string; name: string };
  let testWorkspace: { id: string; slug: string; ownerId: string };
  let testTask: { id: string; workspaceId: string; title: string };
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
          createdById: user.id,
          updatedById: user.id,
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

  describe("Authentication", () => {
    it("should return 401 when no session provided", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

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
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest("http://localhost:3000/api/tasks//messages");

      const response = await GET(request, {
        params: Promise.resolve({ taskId: "" }),
      });

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toBe("Task ID is required");
    });

    it("should return 404 when task does not exist", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const nonExistentId = "non-existent-task-id";
      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${nonExistentId}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: nonExistentId }),
      });

      expect(response?.status).toBe(404);
      const data = await response?.json();
      expect(data.error).toBe("Task not found");
    });

    it("should return 404 when task is soft-deleted", async () => {
      // Soft-delete the task
      await db.task.update({
        where: { id: testTask.id },
        data: { deleted: true },
      });

      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(404);
      const data = await response?.json();
      expect(data.error).toBe("Task not found");
    });
  });

  describe("Authorization & Access Control", () => {
    it("should return 403 when user is not workspace owner or member", async () => {
      getMockedSession().mockResolvedValue({ user: { id: otherUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(403);
      const data = await response?.json();
      expect(data.error).toBe("Access denied");
    });

    it("should allow access for workspace owner", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.task).toBeDefined();
      expect(data.data.messages).toBeInstanceOf(Array);
    });

    it("should allow access for workspace member", async () => {
      getMockedSession().mockResolvedValue({ user: { id: memberUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });
  });

  describe("Message Retrieval & Response Structure", () => {
    it("should return empty messages array when task has no messages", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      expect(data.success).toBe(true);
      expect(data.data.messages).toEqual([]);
      expect(data.data.count).toBe(0);
      expect(data.data.task).toMatchObject({
        id: testTask.id,
        title: testTask.title,
        workspaceId: testWorkspace.id,
      });
    });

    it("should return all messages for the task", async () => {
      // Create multiple messages for the task
      await db.$transaction(async (tx) => {
        await tx.chatMessage.create({
          data: {
            taskId: testTask.id,
            message: "First message",
            role: ChatRole.USER,
            status: ChatStatus.SENT,
            contextTags: JSON.stringify([]),
          },
        });

        await tx.chatMessage.create({
          data: {
            taskId: testTask.id,
            message: "Second message",
            role: ChatRole.ASSISTANT,
            status: ChatStatus.SENT,
            contextTags: JSON.stringify([]),
          },
        });

        await tx.chatMessage.create({
          data: {
            taskId: testTask.id,
            message: "Third message",
            role: ChatRole.USER,
            status: ChatStatus.SENT,
            contextTags: JSON.stringify([]),
          },
        });
      });

      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      expect(data.success).toBe(true);
      expect(data.data.messages).toHaveLength(3);
      expect(data.data.count).toBe(3);

      // Verify message structure
      const firstMessage = data.data.messages[0];
      expect(firstMessage).toHaveProperty("id");
      expect(firstMessage).toHaveProperty("taskId", testTask.id);
      expect(firstMessage).toHaveProperty("message");
      expect(firstMessage).toHaveProperty("role");
      expect(firstMessage).toHaveProperty("status");
      expect(firstMessage).toHaveProperty("contextTags");
      expect(firstMessage).toHaveProperty("timestamp");
    });
  });

  describe("Message Threading", () => {
    it("should preserve replyId parent-child relationships", async () => {
      // Create parent and child messages with threading
      const messages = await db.$transaction(async (tx) => {
        const parentMessage = await tx.chatMessage.create({
          data: {
            taskId: testTask.id,
            message: "Parent message",
            role: ChatRole.USER,
            status: ChatStatus.SENT,
            contextTags: JSON.stringify([]),
          },
        });

        const childMessage = await tx.chatMessage.create({
          data: {
            taskId: testTask.id,
            message: "Child message replying to parent",
            role: ChatRole.ASSISTANT,
            status: ChatStatus.SENT,
            contextTags: JSON.stringify([]),
            replyId: parentMessage.id,
          },
        });

        return { parentMessage, childMessage };
      });

      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      expect(data.data.messages).toHaveLength(2);

      // Find parent and child in response
      const parentInResponse = data.data.messages.find(
        (m: { id: string }) => m.id === messages.parentMessage.id
      );
      const childInResponse = data.data.messages.find(
        (m: { id: string }) => m.id === messages.childMessage.id
      );

      expect(parentInResponse).toBeDefined();
      expect(childInResponse).toBeDefined();
      expect(childInResponse.replyId).toBe(parentInResponse.id);
      expect(parentInResponse.replyId).toBeNull();
    });

    it("should support multiple threaded replies", async () => {
      // Create a thread with multiple replies
      await db.$transaction(async (tx) => {
        const parent = await tx.chatMessage.create({
          data: {
            taskId: testTask.id,
            message: "Original question",
            role: ChatRole.USER,
            status: ChatStatus.SENT,
            contextTags: JSON.stringify([]),
          },
        });

        await tx.chatMessage.create({
          data: {
            taskId: testTask.id,
            message: "First reply",
            role: ChatRole.ASSISTANT,
            status: ChatStatus.SENT,
            contextTags: JSON.stringify([]),
            replyId: parent.id,
          },
        });

        await tx.chatMessage.create({
          data: {
            taskId: testTask.id,
            message: "Second reply",
            role: ChatRole.ASSISTANT,
            status: ChatStatus.SENT,
            contextTags: JSON.stringify([]),
            replyId: parent.id,
          },
        });
      });

      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      expect(data.data.messages).toHaveLength(3);

      // Count replies to parent
      const parentMessage = data.data.messages.find(
        (m: { replyId: null }) => m.replyId === null
      );
      const replies = data.data.messages.filter(
        (m: { replyId: string }) => m.replyId === parentMessage.id
      );

      expect(replies).toHaveLength(2);
    });
  });

  describe("Message Ordering", () => {
    it("should return messages in chronological order by timestamp ASC", async () => {
      // Create messages with explicit timestamps to ensure proper ordering
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const messageIds = [];
      
      for (let i = 0; i < 3; i++) {
        const message = await db.chatMessage.create({
          data: {
            taskId: testTask.id,
            message: `Message ${i + 1}`,
            role: i % 2 === 0 ? ChatRole.USER : ChatRole.ASSISTANT,
            status: ChatStatus.SENT,
            contextTags: JSON.stringify([]),
            timestamp: new Date(baseTime.getTime() + (i * 1000)), // 1 second apart
          },
        });
        messageIds.push(message.id);
      }

      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      expect(data.data.messages).toHaveLength(3);

      // Verify chronological ordering
      const timestamps = data.data.messages.map(
        (m: { timestamp: string }) => new Date(m.timestamp).getTime()
      );

      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
      }

      // Verify messages appear in creation order
      expect(data.data.messages[0].message).toBe("Message 1");
      expect(data.data.messages[1].message).toBe("Message 2");
      expect(data.data.messages[2].message).toBe("Message 3");
    });
  });

  describe("Artifacts & Attachments", () => {
    it("should include artifacts with messages", async () => {
      const messageWithArtifact = await db.$transaction(async (tx) => {
        const message = await tx.chatMessage.create({
          data: {
            taskId: testTask.id,
            message: "Message with artifact",
            role: ChatRole.ASSISTANT,
            status: ChatStatus.SENT,
            contextTags: JSON.stringify([]),
          },
        });

        await tx.artifact.create({
          data: {
            messageId: message.id,
            type: "CODE",
            content: {
              code: "console.log('Hello World');",
              language: "javascript",
            },
          },
        });

        return message;
      });

      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      const messageInResponse = data.data.messages.find(
        (m: { id: string }) => m.id === messageWithArtifact.id
      );

      expect(messageInResponse).toBeDefined();
      expect(messageInResponse.artifacts).toHaveLength(1);
      expect(messageInResponse.artifacts[0].type).toBe("CODE");
      expect(messageInResponse.artifacts[0].content).toBeDefined();
      expect(messageInResponse.artifacts[0].content.code).toBe(
        "console.log('Hello World');"
      );
    });

    it("should order artifacts by createdAt ASC", async () => {
      await db.$transaction(async (tx) => {
        const message = await tx.chatMessage.create({
          data: {
            taskId: testTask.id,
            message: "Message with multiple artifacts",
            role: ChatRole.ASSISTANT,
            status: ChatStatus.SENT,
            contextTags: JSON.stringify([]),
          },
        });

        // Create artifacts with explicit timestamps for ordering
        const baseTime = new Date('2024-01-01T10:00:00Z');
        for (let i = 0; i < 3; i++) {
          await tx.artifact.create({
            data: {
              messageId: message.id,
              type: "CODE",
              content: { code: `Artifact ${i + 1}` },
              createdAt: new Date(baseTime.getTime() + (i * 1000)), // 1 second apart
            },
          });
        }
      });

      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      const message = data.data.messages[0];
      expect(message.artifacts).toHaveLength(3);

      // Verify artifacts are ordered by creation time
      const artifactTimestamps = message.artifacts.map(
        (a: { createdAt: string }) => new Date(a.createdAt).getTime()
      );

      for (let i = 1; i < artifactTimestamps.length; i++) {
        expect(artifactTimestamps[i]).toBeGreaterThanOrEqual(
          artifactTimestamps[i - 1]
        );
      }
    });

    it("should include attachments with messages", async () => {
      const messageWithAttachment = await db.$transaction(async (tx) => {
        const message = await tx.chatMessage.create({
          data: {
            taskId: testTask.id,
            message: "Message with attachment",
            role: ChatRole.USER,
            status: ChatStatus.SENT,
            contextTags: JSON.stringify([]),
          },
        });

        await tx.attachment.create({
          data: {
            messageId: message.id,
            filename: "test-file.pdf",
            path: "https://s3.example.com/files/test-file.pdf",
            size: 1024,
            mimeType: "application/pdf",
          },
        });

        return message;
      });

      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      const messageInResponse = data.data.messages.find(
        (m: { id: string }) => m.id === messageWithAttachment.id
      );

      expect(messageInResponse).toBeDefined();
      expect(messageInResponse.attachments).toHaveLength(1);
      expect(messageInResponse.attachments[0].filename).toBe("test-file.pdf");
      expect(messageInResponse.attachments[0].mimeType).toBe("application/pdf");
      expect(messageInResponse.attachments[0].size).toBe(1024);
    });
  });

  describe("Context Tags & JSON Parsing", () => {
    it("should parse contextTags JSON into typed objects", async () => {
      await db.chatMessage.create({
        data: {
          taskId: testTask.id,
          message: "Message with context tags",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          contextTags: JSON.stringify([
            { type: "file", id: "file-123" },
            { type: "repository", id: "repo-456" },
          ]),
        },
      });

      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      const message = data.data.messages[0];
      expect(message.contextTags).toBeInstanceOf(Array);
      expect(message.contextTags).toHaveLength(2);
      expect(message.contextTags[0]).toMatchObject({
        type: "file",
        id: "file-123",
      });
      expect(message.contextTags[1]).toMatchObject({
        type: "repository",
        id: "repo-456",
      });
    });
  });

  describe("Task Metadata", () => {
    it("should include task metadata in response", async () => {
      // Update task with workflow status and stakwork project ID
      await db.task.update({
        where: { id: testTask.id },
        data: {
          workflowStatus: "IN_PROGRESS",
          stakworkProjectId: 12345,
        },
      });

      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      expect(data.data.task).toMatchObject({
        id: testTask.id,
        title: testTask.title,
        workspaceId: testWorkspace.id,
        workflowStatus: "IN_PROGRESS",
        stakworkProjectId: 12345,
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle database errors gracefully", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      // Use an invalid taskId format that might cause database issues
      const invalidTaskId = "invalid-uuid-format-that-breaks-db";
      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${invalidTaskId}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: invalidTaskId }),
      });

      // Should handle gracefully and return proper error
      expect(response?.status).toBeOneOf([404, 500]);
      const data = await response?.json();
      expect(data).toHaveProperty("error");
      expect(typeof data.error).toBe("string");
    });
  });

  describe("Response Format", () => {
    it("should return correct response structure", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      // Verify top-level structure
      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("data");

      // Verify data structure
      expect(data.data).toHaveProperty("task");
      expect(data.data).toHaveProperty("messages");
      expect(data.data).toHaveProperty("count");

      // Verify types
      expect(typeof data.data.task).toBe("object");
      expect(Array.isArray(data.data.messages)).toBe(true);
      expect(typeof data.data.count).toBe("number");
    });

    it("should have appropriate content-type header", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);

      const contentType = response?.headers.get("content-type");
      expect(contentType).toContain("application/json");
    });
  });
});