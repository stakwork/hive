import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/tasks/[taskId]/messages/save/route";
import { db } from "@/lib/db";
import {
  createAuthenticatedSession,
  getMockedSession,
  mockUnauthenticatedSession,
} from "@/__tests__/support/helpers/auth";
import {
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
} from "@/__tests__/support/helpers/api-assertions";
import { createPostRequest } from "@/__tests__/support/helpers/request-builders";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

// Mock NextAuth
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

describe("POST /api/tasks/[taskId]/messages/save", () => {
  let testUser: any;
  let testWorkspace: any;
  let testTask: any;
  let otherUser: any;
  let memberUser: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    const testData = await db.$transaction(async (tx) => {
      // 1. Create primary user (workspace owner)
      const user = await tx.user.create({
        data: {
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      // 2. Create workspace
      const workspace = await tx.workspace.create({
        data: {
          name: "Test Workspace",
          slug: `test-workspace-${generateUniqueId()}`,
          ownerId: user.id,
        },
      });

      // 3. Create task
      const task = await tx.task.create({
        data: {
          title: "Test Task",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // 4. Create other user (for 403 testing)
      const otherUser = await tx.user.create({
        data: {
          email: `other-${generateUniqueId()}@example.com`,
          name: "Unauthorized User",
        },
      });

      // 5. Create member user with access
      const memberUser = await tx.user.create({
        data: {
          email: `member-${generateUniqueId()}@example.com`,
          name: "Member User",
        },
      });

      await tx.workspaceMember.create({
        data: {
          userId: memberUser.id,
          workspaceId: workspace.id,
          role: "DEVELOPER",
        },
      });

      return { user, workspace, task, otherUser, memberUser };
    });

    testUser = testData.user;
    testWorkspace = testData.workspace;
    testTask = testData.task;
    otherUser = testData.otherUser;
    memberUser = testData.memberUser;

    // Mock authenticated session for primary user
    getMockedSession().mockResolvedValue(
      createAuthenticatedSession(testUser)
    );
  });

  describe("Authentication", () => {
    it("should return 401 when no session provided", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "Test message", role: "USER" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      await expectUnauthorized(response);
    });

    it("should return 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const request = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "Test message", role: "USER" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      await expectUnauthorized(response);
    });

    it("should return 401 when session user has no id", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const request = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "Test message", role: "USER" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Invalid user session");
    });
  });

  describe("Task Existence", () => {
    it("should return 404 when task does not exist", async () => {
      const nonExistentId = "00000000-0000-0000-0000-000000000000";

      const request = createPostRequest(
        `/api/tasks/${nonExistentId}/messages/save`,
        { message: "Test message", role: "USER" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: nonExistentId }),
      });

      await expectNotFound(response);
    });

    it("should return 404 for soft-deleted tasks", async () => {
      await db.task.update({
        where: { id: testTask.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const request = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "Test message", role: "USER" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      await expectNotFound(response);
    });
  });

  describe("Workspace Access Control", () => {
    it("should return 403 when user is not workspace owner or member", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(otherUser)
      );

      const request = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "Test message", role: "USER" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      await expectForbidden(response);
    });

    it("should allow workspace owner to save USER messages", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "Owner's message", role: "USER" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response, 201);
      expect(data.success).toBe(true);
      expect(data.data.message).toBe("Owner's message");
      expect(data.data.role).toBe("USER");
      expect(data.data.taskId).toBe(testTask.id);
    });

    it("should allow workspace owner to save ASSISTANT messages", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "Assistant response", role: "ASSISTANT" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response, 201);
      expect(data.success).toBe(true);
      expect(data.data.message).toBe("Assistant response");
      expect(data.data.role).toBe("ASSISTANT");
      expect(data.data.taskId).toBe(testTask.id);
    });

    it("should allow workspace member to save messages", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(memberUser)
      );

      const request = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "Member's message", role: "USER" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response, 201);
      expect(data.success).toBe(true);
      expect(data.data.message).toBe("Member's message");
      expect(data.data.role).toBe("USER");
    });
  });

  describe("Input Validation", () => {
    it("should return 400 when message field is missing", async () => {
      const request = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { role: "USER" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Message is required");
    });

    it("should return 400 when message is empty string", async () => {
      const request = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "", role: "USER" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Message is required");
    });

    it("should return 400 when role field is missing", async () => {
      const request = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "Test message" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Valid role is required");
    });

    it("should return 400 when role is invalid", async () => {
      const request = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "Test message", role: "INVALID_ROLE" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Valid role is required");
    });

    it("should accept USER role", async () => {
      const request = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "Test message", role: "USER" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response, 201);
      expect(data.data.role).toBe("USER");
    });

    it("should accept ASSISTANT role", async () => {
      const request = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "Test message", role: "ASSISTANT" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response, 201);
      expect(data.data.role).toBe("ASSISTANT");
    });
  });

  describe("Database Persistence", () => {
    it("should persist USER message to database", async () => {
      const request = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "Test user message", role: "USER" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response, 201);

      // Verify response structure
      expect(data.data).toMatchObject({
        message: "Test user message",
        role: "USER",
        status: "SENT",
        taskId: testTask.id,
      });

      // Verify database persistence
      const savedMessage = await db.chatMessage.findFirst({
        where: { id: data.data.id },
      });

      expect(savedMessage).toBeTruthy();
      expect(savedMessage?.message).toBe("Test user message");
      expect(savedMessage?.role).toBe("USER");
      expect(savedMessage?.taskId).toBe(testTask.id);
      expect(savedMessage?.status).toBe("SENT");
    });

    it("should persist ASSISTANT message with correct status", async () => {
      const request = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "Assistant response", role: "ASSISTANT" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response, 201);

      // Verify response
      expect(data.data.role).toBe("ASSISTANT");
      expect(data.data.status).toBe("SENT");

      // Verify database persistence
      const savedMessage = await db.chatMessage.findFirst({
        where: { id: data.data.id },
      });

      expect(savedMessage?.role).toBe("ASSISTANT");
      expect(savedMessage?.status).toBe("SENT");
    });

    it("should return 201 status on successful creation", async () => {
      const request = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "Test message", role: "USER" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it("should set contextTags as empty array", async () => {
      const request = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "Test message", role: "USER" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response, 201);

      // Verify database has contextTags as stringified empty array (per route implementation)
      const savedMessage = await db.chatMessage.findFirst({
        where: { id: data.data.id },
      });

      expect(savedMessage?.contextTags).toBe("[]");
    });

    it("should create message with timestamp", async () => {
      const beforeCreate = new Date();

      const request = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "Test message", role: "USER" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data = await expectSuccess(response, 201);
      const afterCreate = new Date();

      // Verify timestamp is within reasonable range
      const savedMessage = await db.chatMessage.findFirst({
        where: { id: data.data.id },
      });

      expect(savedMessage?.timestamp).toBeTruthy();
      const timestamp = new Date(savedMessage!.timestamp);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
    });

    it("should allow multiple messages for same task", async () => {
      // Create first message
      const request1 = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "First message", role: "USER" }
      );

      const response1 = await POST(request1, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data1 = await expectSuccess(response1, 201);

      // Create second message
      const request2 = createPostRequest(
        `/api/tasks/${testTask.id}/messages/save`,
        { message: "Second message", role: "ASSISTANT" }
      );

      const response2 = await POST(request2, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      const data2 = await expectSuccess(response2, 201);

      // Verify both messages exist
      expect(data1.data.id).not.toBe(data2.data.id);

      const messages = await db.chatMessage.findMany({
        where: { taskId: testTask.id },
        orderBy: { createdAt: "asc" },
      });

      expect(messages).toHaveLength(2);
      expect(messages[0].message).toBe("First message");
      expect(messages[0].role).toBe("USER");
      expect(messages[1].message).toBe("Second message");
      expect(messages[1].role).toBe("ASSISTANT");
    });
  });
});