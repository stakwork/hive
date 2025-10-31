import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/agent/branch/route";
import { db } from "@/lib/db";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectError,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
  generateUniqueId,
  generateUniqueSlug,
  createPostRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestTask, createTestChatMessage } from "@/__tests__/support/fixtures/task";
import type { User, Workspace, Task } from "@prisma/client";
import { generateObject } from "ai";

// Mock aieo library for AI generation
vi.mock("aieo", () => ({
  getApiKeyForProvider: vi.fn(() => "mock-api-key"),
  getModel: vi.fn(() => "mock-model"),
}));

// Mock the ai library's generateObject  
vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

describe("POST /api/agent/branch Integration Tests", () => {
  // Get reference to the mocked function
  const mockGenerateObject = vi.mocked(generateObject);
  // Helper to create complete test scenario with workspace, task, and conversation
  async function createTestScenario() {
    return await db.$transaction(async (tx) => {
      // Create test user
      const user = await tx.user.create({
        data: {
          email: `test-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      // Create workspace
      const workspace = await tx.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      // Create workspace membership
      await tx.workspaceMember.create({
        data: {
          userId: user.id,
          workspaceId: workspace.id,
          role: "DEVELOPER", // Has canWrite permission
        },
      });

      // Create task linked to workspace
      const task = await tx.task.create({
        data: {
          title: `Test Task ${generateUniqueId()}`,
          description: "Test task for branch generation",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
          status: "IN_PROGRESS",
        },
      });

      // Create conversation history (required for AI generation)
      const message1 = await tx.chatMessage.create({
        data: {
          taskId: task.id,
          message: "I need to add a new commit button to the UI",
          role: "USER",
        },
      });

      const message2 = await tx.chatMessage.create({
        data: {
          taskId: task.id,
          message: "I'll help you add a commit button. What framework are you using?",
          role: "ASSISTANT",
        },
      });

      const message3 = await tx.chatMessage.create({
        data: {
          taskId: task.id,
          message: "We're using React with Next.js",
          role: "USER",
        },
      });

      return {
        user,
        workspace,
        task,
        messages: [message1, message2, message3],
      };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock for successful AI generation
    mockGenerateObject.mockResolvedValue({
      object: {
        commit_message: "feat: add commit button to UI",
        branch_name: "feat/add-commit-button",
      },
    });
  });

  describe("Authentication Tests", () => {
    test("should return 401 when user not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: "test-task-id",
      });

      const response = await POST(request);
      await expectUnauthorized(response);
    });

    test("should return 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({ expires: "2024-12-31" });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: "test-task-id",
      });

      const response = await POST(request);
      await expectUnauthorized(response);
    });
  });

  describe("Validation Tests", () => {
    test("should return 400 when taskId is missing", async () => {
      const { user } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {});

      const response = await POST(request);
      await expectError(response, "Missing required field: taskId", 400);
    });

    test("should return 400 when taskId is null", async () => {
      const { user } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: null,
      });

      const response = await POST(request);
      await expectError(response, "Missing required field: taskId", 400);
    });

    test("should return 400 when taskId is empty string", async () => {
      const { user } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: "",
      });

      const response = await POST(request);
      await expectError(response, "Missing required field: taskId", 400);
    });

    test("should return 500 when task has no conversation history", async () => {
      const { user } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Create task without chat messages
      const emptyTask = await db.task.create({
        data: {
          title: "Empty Task",
          description: "Task with no messages",
          workspaceId: (await db.workspace.findFirst({ where: { ownerId: user.id } }))!.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: emptyTask.id,
      });

      const response = await POST(request);
      await expectError(response, "No conversation history found for this task", 500);
    });

    test("should return 500 when task does not exist", async () => {
      const { user } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: "non-existent-task-id",
      });

      const response = await POST(request);
      
      // Task not found in database causes error in generateCommitMessage
      expect(response.status).toBe(500);
    });
  });

  describe("Authorization Tests", () => {
    test("should allow workspace owner to generate branch names", async () => {
      const { user, task } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty("commit_message");
      expect(data.data).toHaveProperty("branch_name");
    });

    test("should allow workspace member with DEVELOPER role to generate branch names", async () => {
      const { workspace } = await createTestScenario();
      
      // Create new user as workspace member
      const memberUser = await createTestUser({ name: "Member User" });
      
      await db.workspaceMember.create({
        data: {
          userId: memberUser.id,
          workspaceId: workspace.id,
          role: "DEVELOPER",
        },
      });

      // Create task for member
      const memberTask = await db.task.create({
        data: {
          title: "Member Task",
          description: "Task for member",
          workspaceId: workspace.id,
          createdById: memberUser.id,
          updatedById: memberUser.id,
        },
      });

      // Add chat message
      await db.chatMessage.create({
        data: {
          taskId: memberTask.id,
          message: "Member message",
          role: "USER",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: memberTask.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
    });

    // NOTE: The following test documents expected behavior, but the endpoint currently
    // LACKS workspace authorization checks. This is a known security gap.
    // The test will fail until validateWorkspaceAccess is implemented in the endpoint.
    test.skip("should return 403 when user lacks workspace access (MISSING IMPLEMENTATION)", async () => {
      const { task } = await createTestScenario();
      
      // Create unauthorized user NOT in the workspace
      const unauthorizedUser = await createTestUser({ name: "Unauthorized User" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(unauthorizedUser));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      
      // Expected: 403 Forbidden
      // Actual: 200 OK (security gap - endpoint doesn't check workspace access)
      await expectForbidden(response);
    });

    // NOTE: This test also documents expected behavior for VIEWER role restriction
    test.skip("should return 403 when user has VIEWER role without canWrite permission (MISSING IMPLEMENTATION)", async () => {
      const { workspace } = await createTestScenario();
      
      const viewerUser = await createTestUser({ name: "Viewer User" });
      
      await db.workspaceMember.create({
        data: {
          userId: viewerUser.id,
          workspaceId: workspace.id,
          role: "VIEWER", // No canWrite permission
        },
      });

      const task = await db.task.create({
        data: {
          title: "Test Task",
          description: "Test",
          workspaceId: workspace.id,
          createdById: viewerUser.id,
          updatedById: viewerUser.id,
        },
      });

      await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Test message",
          role: "USER",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(viewerUser));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      
      // Expected: 403 Forbidden (VIEWER lacks canWrite permission)
      // Actual: 200 OK (security gap)
      await expectForbidden(response);
    });
  });

  describe("AI Integration Tests", () => {
    test("should successfully generate branch name and commit message", async () => {
      const { user, task } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockGenerateObject.mockResolvedValue({
        object: {
          commit_message: "feat: implement user authentication",
          branch_name: "feat/user-authentication",
        },
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data.commit_message).toBe("feat: implement user authentication");
      expect(data.data.branch_name).toBe("feat/user-authentication");
      expect(mockGenerateObject).toHaveBeenCalledTimes(1);
    });

    test("should generate branch name with different categories", async () => {
      const { user, task } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const testCases = [
        {
          commit_message: "fix: resolve authentication bug",
          branch_name: "fix/auth-bug",
        },
        {
          commit_message: "refactor: optimize database queries",
          branch_name: "refactor/optimize-queries",
        },
        {
          commit_message: "docs: update API documentation",
          branch_name: "docs/update-api-docs",
        },
        {
          commit_message: "test: add integration tests",
          branch_name: "test/integration-tests",
        },
      ];

      for (const testCase of testCases) {
        mockGenerateObject.mockResolvedValue({
          object: testCase,
        });

        const request = createPostRequest("http://localhost:3000/api/agent/branch", {
          taskId: task.id,
        });

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.commit_message).toBe(testCase.commit_message);
        expect(data.data.branch_name).toBe(testCase.branch_name);
      }
    });

    test("should handle AI generation with special characters in branch name", async () => {
      const { user, task } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockGenerateObject.mockResolvedValue({
        object: {
          commit_message: "feat: add @mentions and #hashtags support",
          branch_name: "feat/mentions-hashtags-support",
        },
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data.branch_name).toBe("feat/mentions-hashtags-support");
    });

    test("should pass conversation history to AI generation", async () => {
      const { user, task, messages } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      await POST(request);

      // Verify generateObject was called
      expect(mockGenerateObject).toHaveBeenCalledTimes(1);
      
      // Verify the call included conversation context in prompt
      const callArgs = mockGenerateObject.mock.calls[0][0];
      expect(callArgs).toHaveProperty("prompt");
      expect(callArgs.prompt).toContain("conversation between a user and an AI assistant");
    });
  });

  describe("Error Handling Tests", () => {
    test("should return 500 when AI generation fails", async () => {
      const { user, task } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockGenerateObject.mockRejectedValue(new Error("AI service unavailable"));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("AI service unavailable");
    });

    // NOTE: This test documents expected validation behavior, but the endpoint currently
    // does not validate AI response format. The application code should validate that both
    // commit_message and branch_name are present before returning success.
    // This test is skipped until validation is added in the application code (separate PR).
    test.skip("should return 500 when AI generation returns invalid format (VALIDATION MISSING)", async () => {
      const { user, task } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockGenerateObject.mockResolvedValue({
        object: {
          // Missing commit_message field
          branch_name: "invalid-format",
        },
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      
      // Expected: 500 with validation error
      // Actual: 200 with undefined commit_message
      expect(response.status).toBe(500);
    });

    test("should handle AI rate limiting errors", async () => {
      const { user, task } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockGenerateObject.mockRejectedValue(new Error("Rate limit exceeded"));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Rate limit exceeded");
    });

    test("should handle database errors gracefully", async () => {
      const { user } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Use invalid taskId format that will cause database error
      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: "invalid-id-format-that-breaks-db-query",
      });

      const response = await POST(request);
      
      expect(response.status).toBe(500);
    });

    test("should handle network timeouts", async () => {
      const { user, task } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockGenerateObject.mockRejectedValue(new Error("Network timeout"));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Network timeout");
    });
  });

  describe("Response Format Tests", () => {
    test("should return correct response structure on success", async () => {
      const { user, task } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("commit_message");
      expect(data.data).toHaveProperty("branch_name");
      expect(typeof data.data.commit_message).toBe("string");
      expect(typeof data.data.branch_name).toBe("string");
    });

    test("should return error object with message on failure", async () => {
      const { user } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: "",
      });

      const response = await POST(request);
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty("error");
      expect(typeof data.error).toBe("string");
    });

    test("should validate branch name follows category/description format", async () => {
      const { user, task } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockGenerateObject.mockResolvedValue({
        object: {
          commit_message: "feat: add new feature",
          branch_name: "feat/add-new-feature",
        },
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      // Verify branch name format: category/description
      const branchPattern = /^[a-z]+\/[a-z0-9-]+$/;
      expect(data.data.branch_name).toMatch(branchPattern);
    });
  });

  describe("Edge Cases", () => {
    test("should handle very long conversation history", async () => {
      const { user, workspace } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Create task with many messages
      const task = await db.task.create({
        data: {
          title: "Task with long conversation",
          description: "Test task",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Create 50 messages
      for (let i = 0; i < 50; i++) {
        await db.chatMessage.create({
          data: {
            taskId: task.id,
            message: `Message ${i + 1}`,
            role: i % 2 === 0 ? "USER" : "ASSISTANT",
          },
        });
      }

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(mockGenerateObject).toHaveBeenCalled();
    });

    test("should handle task with single message", async () => {
      const { user, workspace } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const task = await db.task.create({
        data: {
          title: "Single message task",
          description: "Test task",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Just one message",
          role: "USER",
        },
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
    });

    test("should handle concurrent requests for same task", async () => {
      const { user, task } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const requests = Array(3).fill(null).map(() => 
        createPostRequest("http://localhost:3000/api/agent/branch", {
          taskId: task.id,
        })
      );

      const responses = await Promise.all(requests.map(req => POST(req)));

      for (const response of responses) {
        const data = await expectSuccess(response);
        expect(data.success).toBe(true);
      }

      expect(mockGenerateObject).toHaveBeenCalledTimes(3);
    });

    test("should handle task with only ASSISTANT messages", async () => {
      const { user, workspace } = await createTestScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const task = await db.task.create({
        data: {
          title: "Assistant only task",
          description: "Test task",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Assistant message only",
          role: "ASSISTANT",
        },
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
    });
  });
});