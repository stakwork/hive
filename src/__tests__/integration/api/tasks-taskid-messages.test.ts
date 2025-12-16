import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/tasks/[taskId]/messages/route";
import { db } from "@/lib/db";
import { ChatRole, ChatStatus, ArtifactType } from "@prisma/client";
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
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";

describe("GET /api/tasks/[taskId]/messages", () => {
  let testUser: { id: string; email: string; name: string };
  let testWorkspace: { id: string; slug: string; ownerId: string };
  let testTask: { id: string; workspaceId: string };
  let testMessage1: { id: string; taskId: string; timestamp: Date };
  let testMessage2: { id: string; taskId: string; timestamp: Date };
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
          description: "Test task for messages",
          status: "IN_PROGRESS",
          priority: "MEDIUM",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
          workflowStatus: "IN_PROGRESS",
          stakworkProjectId: 12345,
        },
      });

      // Create first message with artifacts and attachments
      const message1 = await tx.chatMessage.create({
        data: {
          message: "First message in chronological order",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          taskId: task.id,
          timestamp: new Date("2024-01-01T10:00:00Z"),
          contextTags: JSON.stringify([
            { type: "FEATURE_BRIEF", id: "feature-1" },
            { type: "PRODUCT_BRIEF", id: "product-1" },
          ]),
        },
      });

      // Create artifact for first message (will test ordering by createdAt)
      await tx.artifact.create({
        data: {
          type: ArtifactType.CODE,
          content: {
            language: "javascript",
            code: "console.log('test artifact 1');",
          },
          messageId: message1.id,
          createdAt: new Date("2024-01-01T10:00:01Z"),
        },
      });

      // Create attachment for first message
      await tx.attachment.create({
        data: {
          filename: "test-file.pdf",
          path: "https://s3.example.com/test-file.pdf",
          size: 2048,
          mimeType: "application/pdf",
          messageId: message1.id,
        },
      });

      // Create second message with replyId (threading)
      const message2 = await tx.chatMessage.create({
        data: {
          message: "Second message replying to first",
          role: ChatRole.ASSISTANT,
          status: ChatStatus.SENT,
          taskId: task.id,
          timestamp: new Date("2024-01-01T10:05:00Z"),
          contextTags: JSON.stringify([]),
          replyId: message1.id, // Threading reference
        },
      });

      // Create multiple artifacts for second message (test ordering)
      await tx.artifact.create({
        data: {
          type: ArtifactType.CODE,
          content: { code: "console.log('artifact 2a');" },
          messageId: message2.id,
          createdAt: new Date("2024-01-01T10:05:02Z"),
        },
      });

      await tx.artifact.create({
        data: {
          type: ArtifactType.FORM,
          content: { actionText: "Submit", options: [] },
          messageId: message2.id,
          createdAt: new Date("2024-01-01T10:05:01Z"), // Earlier than 2a
        },
      });

      // Create other user for unauthorized access testing
      const otherUser = await tx.user.create({
        data: {
          email: `other-user-${Date.now()}@example.com`,
          name: "Other User",
        },
      });

      // Create member user with workspace access
      const memberUser = await tx.user.create({
        data: {
          email: `member-user-${Date.now()}@example.com`,
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
        message1,
        message2,
        otherUser,
        memberUser,
      };
    });

    testUser = testData.user;
    testWorkspace = testData.workspace;
    testTask = testData.task;
    testMessage1 = testData.message1;
    testMessage2 = testData.message2;
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

      const request = createGetRequest(
        "http://localhost:3000/api/tasks//messages"
      );

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

    it("should return 404 for soft-deleted tasks", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      // Soft-delete the task
      await db.task.update({
        where: { id: testTask.id },
        data: { deleted: true, deletedAt: new Date() },
      });

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

  describe("Message Retrieval with Relations", () => {
    it("should return messages with artifacts and attachments", async () => {
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
      expect(data.data.messages).toHaveLength(2);

      // Verify first message has artifact and attachment
      const firstMessage = data.data.messages[0];
      expect(firstMessage.message).toBe(
        "First message in chronological order"
      );
      expect(firstMessage.artifacts).toHaveLength(1);
      expect(firstMessage.artifacts[0].type).toBe(ArtifactType.CODE);
      expect(firstMessage.artifacts[0].content.code).toContain(
        "test artifact 1"
      );
      expect(firstMessage.attachments).toHaveLength(1);
      expect(firstMessage.attachments[0].filename).toBe("test-file.pdf");

      // Verify second message has multiple artifacts
      const secondMessage = data.data.messages[1];
      expect(secondMessage.artifacts).toHaveLength(2);
    });

    it("should include task metadata in response", async () => {
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
        title: "Test Task",
        workspaceId: testWorkspace.id,
        workflowStatus: "IN_PROGRESS",
        stakworkProjectId: 12345,
      });
    });
  });

  describe("Chronological Ordering", () => {
    it("should return messages ordered by timestamp ascending", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      const messages = data.data.messages;
      expect(messages).toHaveLength(2);

      // Verify chronological order (oldest first)
      const timestamp1 = new Date(messages[0].timestamp).getTime();
      const timestamp2 = new Date(messages[1].timestamp).getTime();
      expect(timestamp1).toBeLessThan(timestamp2);

      // Verify correct message order
      expect(messages[0].message).toBe(
        "First message in chronological order"
      );
      expect(messages[1].message).toBe("Second message replying to first");
    });

    it("should order artifacts by createdAt ascending", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      // Second message has 2 artifacts with different createdAt values
      const secondMessage = data.data.messages[1];
      expect(secondMessage.artifacts).toHaveLength(2);

      // Verify artifacts are ordered by createdAt ASC (FORM before CODE)
      expect(secondMessage.artifacts[0].type).toBe(ArtifactType.FORM);
      expect(secondMessage.artifacts[1].type).toBe(ArtifactType.CODE);

      const artifact1Time = new Date(
        secondMessage.artifacts[0].createdAt
      ).getTime();
      const artifact2Time = new Date(
        secondMessage.artifacts[1].createdAt
      ).getTime();
      expect(artifact1Time).toBeLessThan(artifact2Time);
    });
  });

  describe("Message Threading via replyId", () => {
    it("should preserve replyId field for message threading", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      const messages = data.data.messages;

      // First message has no replyId (root message)
      expect(messages[0].replyId).toBeNull();

      // Second message has replyId pointing to first message
      expect(messages[1].replyId).toBe(testMessage1.id);
      expect(messages[1].message).toContain("replying to first");
    });
  });

  describe("contextTags JSON Parsing", () => {
    it("should parse contextTags from JSON string to array", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      // First message has contextTags array
      const firstMessage = data.data.messages[0];
      expect(Array.isArray(firstMessage.contextTags)).toBe(true);
      expect(firstMessage.contextTags).toHaveLength(2);
      expect(firstMessage.contextTags[0]).toEqual({
        type: "FEATURE_BRIEF",
        id: "feature-1",
      });
      expect(firstMessage.contextTags[1]).toEqual({
        type: "PRODUCT_BRIEF",
        id: "product-1",
      });

      // Second message has empty contextTags array
      const secondMessage = data.data.messages[1];
      expect(Array.isArray(secondMessage.contextTags)).toBe(true);
      expect(secondMessage.contextTags).toHaveLength(0);
    });
  });

  describe("Response Structure", () => {
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

      // Verify messages is an array and count matches
      expect(Array.isArray(data.data.messages)).toBe(true);
      expect(data.data.count).toBe(data.data.messages.length);
      expect(data.data.count).toBe(2);
    });

    it("should not expose sensitive workspace data", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${testTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      // Task should include workspaceId but not nested workspace object
      expect(data.data.task).toHaveProperty("workspaceId");
      expect(data.data.task).not.toHaveProperty("workspace");

      // Should not expose workspace members or owner details
      const responseString = JSON.stringify(data);
      expect(responseString).not.toContain("members");
      expect(responseString).not.toContain("ownerId");
    });

    it("should return empty messages array for task with no messages", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      // Create a new task without messages
      const emptyTask = await db.task.create({
        data: {
          title: "Empty Task",
          status: "TODO",
          priority: "LOW",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${emptyTask.id}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: emptyTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      expect(data.success).toBe(true);
      expect(data.data.messages).toEqual([]);
      expect(data.data.count).toBe(0);
    });
  });

  describe("Error Handling", () => {
    it("should handle database errors gracefully", async () => {
      getMockedSession().mockResolvedValue({ user: { id: testUser.id } });

      // Use invalid task ID format that might cause database issues
      const invalidTaskId = "invalid-uuid-format";
      const request = createGetRequest(
        `http://localhost:3000/api/tasks/${invalidTaskId}/messages`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: invalidTaskId }),
      });

      // Should handle gracefully with proper error response
      expect(response?.status).toBeOneOf([404, 500]);
      const data = await response?.json();
      expect(data).toHaveProperty("error");
      expect(typeof data.error).toBe("string");
    });
  });

  describe("Security Headers", () => {
    it("should return appropriate content-type header", async () => {
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