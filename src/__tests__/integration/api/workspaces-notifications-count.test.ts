import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/workspaces/[slug]/tasks/notifications-count/route";
import { db } from "@/lib/db";
import { WorkflowStatus, ArtifactType, ChatRole, ChatStatus } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
  generateUniqueId,
  createGetRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures/workspace";

describe("GET /api/workspaces/[slug]/tasks/notifications-count Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("Authentication Tests", () => {
    test("should return 401 for unauthenticated user", async () => {
      const scenario = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: scenario.workspace.slug }),
      });

      await expectUnauthorized(response);
    });

    test("should return 401 for session without user ID", async () => {
      const scenario = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" }, // Missing id
      });

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: scenario.workspace.slug }),
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Invalid user session" });
    });
  });

  describe("Authorization Tests", () => {
    test("should return 403 for non-member user", async () => {
      const scenario = await createTestWorkspaceScenario();
      const nonMemberUser = await createTestUser({ name: "Non-Member User" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMemberUser));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: scenario.workspace.slug }),
      });

      await expectForbidden(response, "Access denied");
    });

    test("should allow access for workspace owner", async () => {
      const scenario = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: scenario.workspace.slug }),
      });

      const data = await expectSuccess(response);
      expect(data.data).toHaveProperty("waitingForInputCount");
      expect(typeof data.data.waitingForInputCount).toBe("number");
    });

    test("should allow access for active workspace member", async () => {
      const scenario = await createTestWorkspaceScenario({
        members: [{ role: "DEVELOPER" }],
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.members[0]));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: scenario.workspace.slug }),
      });

      const data = await expectSuccess(response);
      expect(data.data).toHaveProperty("waitingForInputCount");
    });

    test("should return 404 for non-existent workspace", async () => {
      const user = await createTestUser({ name: "Test User" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/nonexistent-slug/tasks/notifications-count"
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: "nonexistent-slug" }),
      });

      await expectNotFound(response, "Workspace not found");
    });

    test("should deny access for inactive workspace member (leftAt set)", async () => {
      const scenario = await createTestWorkspaceScenario({
        members: [{ role: "DEVELOPER" }],
      });

      // Mark member as inactive by setting leftAt
      await db.workspaceMember.update({
        where: {
          workspaceId_userId: {
            workspaceId: scenario.workspace.id,
            userId: scenario.members[0].id,
          },
        },
        data: {
          leftAt: new Date(),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.members[0]));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: scenario.workspace.slug }),
      });

      await expectForbidden(response, "Access denied");
    });
  });

  describe("Counting Logic Tests", () => {
    test("should count tasks with FORM artifacts in latest message", async () => {
      const scenario = await createTestWorkspaceScenario();

      // Create task with FORM artifact in latest message
      const task = await db.task.create({
        data: {
          title: "Task with FORM",
          description: "Test task",
          status: "TODO",
          priority: "MEDIUM",
          workspaceId: scenario.workspace.id,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
        },
      });

      const message = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Test message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          contextTags: JSON.stringify([]),
        },
      });

      await db.artifact.create({
        data: {
          messageId: message.id,
          type: ArtifactType.FORM,
          content: { formData: "test" },
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: scenario.workspace.slug }),
      });

      const data = await expectSuccess(response);
      expect(data.data.waitingForInputCount).toBe(1);
    });

    test("should exclude tasks without FORM artifacts", async () => {
      const scenario = await createTestWorkspaceScenario();

      // Create task with CODE artifact (not FORM)
      const task = await db.task.create({
        data: {
          title: "Task with CODE",
          description: "Test task",
          status: "TODO",
          priority: "MEDIUM",
          workspaceId: scenario.workspace.id,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
        },
      });

      const message = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Test message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          contextTags: JSON.stringify([]),
        },
      });

      await db.artifact.create({
        data: {
          messageId: message.id,
          type: ArtifactType.CODE,
          content: { language: "javascript", code: "console.log('test')" },
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: scenario.workspace.slug }),
      });

      const data = await expectSuccess(response);
      expect(data.data.waitingForInputCount).toBe(0);
    });

    test("should only count FORM artifacts in latest message, not older messages", async () => {
      const scenario = await createTestWorkspaceScenario();

      const task = await db.task.create({
        data: {
          title: "Task with multiple messages",
          description: "Test task",
          status: "TODO",
          priority: "MEDIUM",
          workspaceId: scenario.workspace.id,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
        },
      });

      // Older message with FORM artifact
      const olderMessage = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Older message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          contextTags: JSON.stringify([]),
          timestamp: new Date(Date.now() - 10000), // 10 seconds ago
        },
      });

      await db.artifact.create({
        data: {
          messageId: olderMessage.id,
          type: ArtifactType.FORM,
          content: { formData: "old form" },
        },
      });

      // Latest message with CODE artifact (not FORM)
      const latestMessage = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Latest message",
          role: ChatRole.ASSISTANT,
          status: ChatStatus.SENT,
          contextTags: JSON.stringify([]),
          timestamp: new Date(), // Now
        },
      });

      await db.artifact.create({
        data: {
          messageId: latestMessage.id,
          type: ArtifactType.CODE,
          content: { language: "javascript", code: "console.log('latest')" },
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: scenario.workspace.slug }),
      });

      const data = await expectSuccess(response);
      expect(data.data.waitingForInputCount).toBe(0); // Latest message has CODE, not FORM
    });

    test("should only count IN_PROGRESS and PENDING tasks", async () => {
      const scenario = await createTestWorkspaceScenario();

      // Create IN_PROGRESS task with FORM artifact
      const inProgressTask = await db.task.create({
        data: {
          title: "In Progress Task",
          description: "Test task",
          status: "TODO",
          priority: "MEDIUM",
          workspaceId: scenario.workspace.id,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
        },
      });

      const inProgressMessage = await db.chatMessage.create({
        data: {
          taskId: inProgressTask.id,
          message: "Test message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          contextTags: JSON.stringify([]),
        },
      });

      await db.artifact.create({
        data: {
          messageId: inProgressMessage.id,
          type: ArtifactType.FORM,
          content: { formData: "test" },
        },
      });

      // Create PENDING task with FORM artifact
      const pendingTask = await db.task.create({
        data: {
          title: "Pending Task",
          description: "Test task",
          status: "TODO",
          priority: "MEDIUM",
          workspaceId: scenario.workspace.id,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
          workflowStatus: WorkflowStatus.PENDING,
        },
      });

      const pendingMessage = await db.chatMessage.create({
        data: {
          taskId: pendingTask.id,
          message: "Test message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          contextTags: JSON.stringify([]),
        },
      });

      await db.artifact.create({
        data: {
          messageId: pendingMessage.id,
          type: ArtifactType.FORM,
          content: { formData: "test" },
        },
      });

      // Create COMPLETED task with FORM artifact (should NOT be counted)
      const completedTask = await db.task.create({
        data: {
          title: "Completed Task",
          description: "Test task",
          status: "DONE",
          priority: "MEDIUM",
          workspaceId: scenario.workspace.id,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
          workflowStatus: WorkflowStatus.COMPLETED,
        },
      });

      const completedMessage = await db.chatMessage.create({
        data: {
          taskId: completedTask.id,
          message: "Test message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          contextTags: JSON.stringify([]),
        },
      });

      await db.artifact.create({
        data: {
          messageId: completedMessage.id,
          type: ArtifactType.FORM,
          content: { formData: "test" },
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: scenario.workspace.slug }),
      });

      const data = await expectSuccess(response);
      expect(data.data.waitingForInputCount).toBe(2); // Only IN_PROGRESS and PENDING
    });

    test("should exclude soft-deleted tasks", async () => {
      const scenario = await createTestWorkspaceScenario();

      // Create active task with FORM artifact
      const activeTask = await db.task.create({
        data: {
          title: "Active Task",
          description: "Test task",
          status: "TODO",
          priority: "MEDIUM",
          workspaceId: scenario.workspace.id,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          deleted: false,
        },
      });

      const activeMessage = await db.chatMessage.create({
        data: {
          taskId: activeTask.id,
          message: "Test message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          contextTags: JSON.stringify([]),
        },
      });

      await db.artifact.create({
        data: {
          messageId: activeMessage.id,
          type: ArtifactType.FORM,
          content: { formData: "test" },
        },
      });

      // Create deleted task with FORM artifact (should NOT be counted)
      const deletedTask = await db.task.create({
        data: {
          title: "Deleted Task",
          description: "Test task",
          status: "TODO",
          priority: "MEDIUM",
          workspaceId: scenario.workspace.id,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          deleted: true,
          deletedAt: new Date(),
        },
      });

      const deletedMessage = await db.chatMessage.create({
        data: {
          taskId: deletedTask.id,
          message: "Test message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          contextTags: JSON.stringify([]),
        },
      });

      await db.artifact.create({
        data: {
          messageId: deletedMessage.id,
          type: ArtifactType.FORM,
          content: { formData: "test" },
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: scenario.workspace.slug }),
      });

      const data = await expectSuccess(response);
      expect(data.data.waitingForInputCount).toBe(1); // Only active task
    });
  });

  describe("Data Consistency Tests", () => {
    test("should return zero count when no tasks exist", async () => {
      const scenario = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: scenario.workspace.slug }),
      });

      const data = await expectSuccess(response);
      expect(data.data.waitingForInputCount).toBe(0);
    });

    test("should return zero count for tasks with no chat messages", async () => {
      const scenario = await createTestWorkspaceScenario();

      // Create task without any messages
      await db.task.create({
        data: {
          title: "Task without messages",
          description: "Test task",
          status: "TODO",
          priority: "MEDIUM",
          workspaceId: scenario.workspace.id,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: scenario.workspace.slug }),
      });

      const data = await expectSuccess(response);
      expect(data.data.waitingForInputCount).toBe(0);
    });

    test("should return zero count for messages without artifacts", async () => {
      const scenario = await createTestWorkspaceScenario();

      const task = await db.task.create({
        data: {
          title: "Task with message but no artifacts",
          description: "Test task",
          status: "TODO",
          priority: "MEDIUM",
          workspaceId: scenario.workspace.id,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
        },
      });

      await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Test message without artifacts",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          contextTags: JSON.stringify([]),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: scenario.workspace.slug }),
      });

      const data = await expectSuccess(response);
      expect(data.data.waitingForInputCount).toBe(0);
    });

    test("should handle multiple tasks with mixed artifact types", async () => {
      const scenario = await createTestWorkspaceScenario();

      // Task 1: FORM artifact in latest message (should count)
      const task1 = await db.task.create({
        data: {
          title: "Task 1",
          description: "Test task",
          status: "TODO",
          priority: "MEDIUM",
          workspaceId: scenario.workspace.id,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
        },
      });

      const message1 = await db.chatMessage.create({
        data: {
          taskId: task1.id,
          message: "Test message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          contextTags: JSON.stringify([]),
        },
      });

      await db.artifact.create({
        data: {
          messageId: message1.id,
          type: ArtifactType.FORM,
          content: { formData: "test" },
        },
      });

      // Task 2: CODE artifact in latest message (should NOT count)
      const task2 = await db.task.create({
        data: {
          title: "Task 2",
          description: "Test task",
          status: "TODO",
          priority: "MEDIUM",
          workspaceId: scenario.workspace.id,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
        },
      });

      const message2 = await db.chatMessage.create({
        data: {
          taskId: task2.id,
          message: "Test message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          contextTags: JSON.stringify([]),
        },
      });

      await db.artifact.create({
        data: {
          messageId: message2.id,
          type: ArtifactType.CODE,
          content: { language: "javascript", code: "console.log('test')" },
        },
      });

      // Task 3: BROWSER artifact in latest message (should NOT count)
      const task3 = await db.task.create({
        data: {
          title: "Task 3",
          description: "Test task",
          status: "TODO",
          priority: "MEDIUM",
          workspaceId: scenario.workspace.id,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
          workflowStatus: WorkflowStatus.PENDING,
        },
      });

      const message3 = await db.chatMessage.create({
        data: {
          taskId: task3.id,
          message: "Test message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          contextTags: JSON.stringify([]),
        },
      });

      await db.artifact.create({
        data: {
          messageId: message3.id,
          type: ArtifactType.BROWSER,
          content: { url: "https://example.com" },
        },
      });

      // Task 4: Another FORM artifact (should count)
      const task4 = await db.task.create({
        data: {
          title: "Task 4",
          description: "Test task",
          status: "TODO",
          priority: "MEDIUM",
          workspaceId: scenario.workspace.id,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
          workflowStatus: WorkflowStatus.PENDING,
        },
      });

      const message4 = await db.chatMessage.create({
        data: {
          taskId: task4.id,
          message: "Test message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          contextTags: JSON.stringify([]),
        },
      });

      await db.artifact.create({
        data: {
          messageId: message4.id,
          type: ArtifactType.FORM,
          content: { formData: "another form" },
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: scenario.workspace.slug }),
      });

      const data = await expectSuccess(response);
      expect(data.data.waitingForInputCount).toBe(2); // Only task1 and task4 with FORM artifacts
    });

    test("should handle message with multiple artifacts (only FORM matters)", async () => {
      const scenario = await createTestWorkspaceScenario();

      const task = await db.task.create({
        data: {
          title: "Task with multiple artifacts",
          description: "Test task",
          status: "TODO",
          priority: "MEDIUM",
          workspaceId: scenario.workspace.id,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
        },
      });

      const message = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Test message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          contextTags: JSON.stringify([]),
        },
      });

      // Create multiple artifacts for same message
      await db.artifact.create({
        data: {
          messageId: message.id,
          type: ArtifactType.CODE,
          content: { language: "javascript", code: "console.log('test')" },
        },
      });

      await db.artifact.create({
        data: {
          messageId: message.id,
          type: ArtifactType.FORM,
          content: { formData: "test" },
        },
      });

      await db.artifact.create({
        data: {
          messageId: message.id,
          type: ArtifactType.BROWSER,
          content: { url: "https://example.com" },
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: scenario.workspace.slug }),
      });

      const data = await expectSuccess(response);
      expect(data.data.waitingForInputCount).toBe(1); // Task counts because it has FORM artifact
    });
  });

  describe("Response Structure Tests", () => {
    test("should return properly formatted success response", async () => {
      const scenario = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: scenario.workspace.slug }),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("success");
      expect(data.success).toBe(true);
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("waitingForInputCount");
      expect(typeof data.data.waitingForInputCount).toBe("number");
      expect(data.data.waitingForInputCount).toBeGreaterThanOrEqual(0);
    });

    test("should return content-type application/json header", async () => {
      const scenario = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: scenario.workspace.slug }),
      });

      const contentType = response.headers.get("content-type");
      expect(contentType).toContain("application/json");
    });
  });

  describe("Edge Cases", () => {
    test("should handle workspace with deleted flag set", async () => {
      const scenario = await createTestWorkspaceScenario();

      // Soft-delete the workspace
      await db.workspace.update({
        where: { id: scenario.workspace.id },
        data: {
          deleted: true,
          deletedAt: new Date(),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      const request = createGetRequest(
        `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: scenario.workspace.slug }),
      });

      await expectNotFound(response, "Workspace not found");
    });

    test("should handle concurrent requests correctly", async () => {
      const scenario = await createTestWorkspaceScenario();

      // Create task with FORM artifact
      const task = await db.task.create({
        data: {
          title: "Task for concurrent test",
          description: "Test task",
          status: "TODO",
          priority: "MEDIUM",
          workspaceId: scenario.workspace.id,
          createdById: scenario.owner.id,
          updatedById: scenario.owner.id,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
        },
      });

      const message = await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Test message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          contextTags: JSON.stringify([]),
        },
      });

      await db.artifact.create({
        data: {
          messageId: message.id,
          type: ArtifactType.FORM,
          content: { formData: "test" },
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

      // Make multiple concurrent requests
      const requests = Array.from({ length: 5 }, () =>
        GET(
          createGetRequest(
            `http://localhost:3000/api/workspaces/${scenario.workspace.slug}/tasks/notifications-count`
          ),
          {
            params: Promise.resolve({ slug: scenario.workspace.slug }),
          }
        )
      );

      const responses = await Promise.all(requests);

      // All responses should be successful and return same count
      for (const response of responses) {
        const data = await response.json();
        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.data.waitingForInputCount).toBe(1);
      }
    });
  });
});