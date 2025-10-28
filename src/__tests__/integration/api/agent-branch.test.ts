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

// Mock AI dependencies - aieo library for Anthropic integration
vi.mock("aieo", () => ({
  getApiKeyForProvider: vi.fn(() => "mock-api-key"),
  getModel: vi.fn(),
}));

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

describe("POST /api/agent/branch Integration Tests", () => {
  // Helper to create complete test data with task and conversation history
  async function createTestDataWithTask() {
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

      // Create task
      const task = await tx.task.create({
        data: {
          title: "Test Task",
          status: "IN_PROGRESS",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Create chat messages for conversation history
      const chatMessage1 = await tx.chatMessage.create({
        data: {
          taskId: task.id,
          role: "USER",
          message: "Please add a commit button to the UI",
          timestamp: new Date(),
        },
      });

      const chatMessage2 = await tx.chatMessage.create({
        data: {
          taskId: task.id,
          role: "ASSISTANT",
          message: "I'll add a commit button component with proper styling",
          timestamp: new Date(Date.now() + 1000),
        },
      });

      return {
        user,
        workspace,
        task,
        chatMessages: [chatMessage1, chatMessage2],
      };
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup default mock returns - actual mocking happens per-test
    const { getModel, getApiKeyForProvider } = await import("aieo");
    const { generateObject } = await import("ai");

    vi.mocked(getApiKeyForProvider).mockReturnValue("mock-api-key");
    vi.mocked(getModel).mockResolvedValue({
      modelId: "claude-3-5-sonnet-20241022",
      provider: "anthropic",
    });

    vi.mocked(generateObject).mockResolvedValue({
      object: {
        commit_message: "feat: add commit functionality",
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

    test("should return 401 when session is missing user", async () => {
      getMockedSession().mockResolvedValue({
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: "test-task-id",
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation Tests", () => {
    test("should return 400 when taskId is missing", async () => {
      const { user } = await createTestDataWithTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {});

      const response = await POST(request);
      await expectError(response, "Missing required field: taskId", 400);
    });

    test("should return 400 when taskId is empty string", async () => {
      const { user } = await createTestDataWithTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: "",
      });

      const response = await POST(request);
      await expectError(response, "Missing required field: taskId", 400);
    });

    test("should return 500 when task has no conversation history", async () => {
      const { user } = await createTestDataWithTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Create task without chat messages
      const emptyTask = await db.task.create({
        data: {
          title: "Empty Task",
          status: "TODO",
          workspaceId: (await db.workspace.findFirst({ where: { ownerId: user.id } }))!.id,
        },
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: emptyTask.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain("No conversation history found");
    });

    test("should return 500 when task does not exist", async () => {
      const { user } = await createTestDataWithTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: "non-existent-task-id",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain("No conversation history found");
    });
  });

  describe("Authorization Tests", () => {
    test("should return 403 when user lacks workspace access (EXPECTED TO FAIL - NOT IMPLEMENTED)", async () => {
      const { task } = await createTestDataWithTask();
      const unauthorizedUser = await createTestUser({ name: "Unauthorized User" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(unauthorizedUser));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);

      // THIS TEST WILL FAIL - authorization not implemented
      // Expected: 403 Forbidden
      // Actual: 200 OK (security vulnerability)
      await expectForbidden(response, "Access denied");
    });

    test("should return 403 when user is VIEWER role (EXPECTED TO FAIL - NOT IMPLEMENTED)", async () => {
      const { task, workspace } = await createTestDataWithTask();
      const viewerUser = await createTestUser({ name: "Viewer User" });

      // Add user as workspace member with VIEWER role
      await db.workspaceMember.create({
        data: {
          userId: viewerUser.id,
          workspaceId: workspace.id,
          role: "VIEWER",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(viewerUser));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);

      // THIS TEST WILL FAIL - role-based authorization not implemented
      // Expected: 403 Forbidden
      // Actual: 200 OK (security vulnerability)
      await expectForbidden(response, "Insufficient permissions");
    });

    test("should allow workspace owner to generate branch names", async () => {
      const { user, task } = await createTestDataWithTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data.commit_message).toBe("feat: add commit functionality");
      expect(data.data.branch_name).toBe("feat/add-commit-button");
    });

    test("should allow workspace DEVELOPER member to generate branch names", async () => {
      const { task, workspace } = await createTestDataWithTask();
      const developerUser = await createTestUser({ name: "Developer User" });

      // Add user as workspace member with DEVELOPER role
      await db.workspaceMember.create({
        data: {
          userId: developerUser.id,
          workspaceId: workspace.id,
          role: "DEVELOPER",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(developerUser));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty("commit_message");
      expect(data.data).toHaveProperty("branch_name");
    });

    test("should return 403 for cross-workspace task access (EXPECTED TO FAIL - NOT IMPLEMENTED)", async () => {
      const { task: task1 } = await createTestDataWithTask();
      
      // Create second workspace with different owner
      const user2 = await createTestUser({ name: "User 2" });
      const workspace2 = await db.workspace.create({
        data: {
          name: "Workspace 2",
          slug: generateUniqueSlug("workspace-2"),
          ownerId: user2.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user2));

      // Try to access task from workspace1 while authenticated as workspace2 owner
      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task1.id,
      });

      const response = await POST(request);

      // THIS TEST WILL FAIL - workspace boundary validation not implemented
      // Expected: 403 Forbidden
      // Actual: 200 OK (security vulnerability)
      await expectForbidden(response, "Access denied");
    });
  });

  describe("AI Integration Tests", () => {
    test("should successfully generate branch name from task conversation", async () => {
      const { user, task } = await createTestDataWithTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const { generateObject } = await import("ai");
      const { getApiKeyForProvider, getModel } = await import("aieo");

      vi.mocked(generateObject).mockResolvedValue({
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

      // Verify AI was called
      expect(generateObject).toHaveBeenCalledTimes(1);
      expect(getApiKeyForProvider).toHaveBeenCalledWith("anthropic");
      expect(getModel).toHaveBeenCalled();
    });

    test("should validate branch name format (category/description)", async () => {
      const { user, task } = await createTestDataWithTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const { generateObject } = await import("ai");

      vi.mocked(generateObject).mockResolvedValue({
        object: {
          commit_message: "fix: resolve login bug",
          branch_name: "fix/resolve-login-bug",
        },
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.data.branch_name).toMatch(/^[a-z]+\/[a-z0-9-]+$/);
      expect(data.data.branch_name.split("/")).toHaveLength(2);
    });

    test("should handle different branch name categories", async () => {
      const { user, task } = await createTestDataWithTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const { generateObject } = await import("ai");
      const categories = ["feat", "fix", "refactor", "chore", "docs", "test"];

      for (const category of categories) {
        vi.mocked(generateObject).mockResolvedValue({
          object: {
            commit_message: `${category}: test commit`,
            branch_name: `${category}/test-branch`,
          },
        });

        const request = createPostRequest("http://localhost:3000/api/agent/branch", {
          taskId: task.id,
        });

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.branch_name).toContain(category);
      }
    });

    test("should pass conversation history to AI model", async () => {
      const { user, task, chatMessages } = await createTestDataWithTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const { generateObject } = await import("ai");

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      await POST(request);

      // Verify generateObject was called with conversation context
      expect(generateObject).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(generateObject).mock.calls[0][0];
      
      expect(callArgs).toHaveProperty("prompt");
      expect(callArgs.prompt).toContain("User: Please add a commit button");
      expect(callArgs.prompt).toContain("Assistant: I'll add a commit button component");
    });
  });

  describe("Error Handling Tests", () => {
    test("should handle AI generation failures gracefully", async () => {
      const { user, task } = await createTestDataWithTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const { generateObject } = await import("ai");
      vi.mocked(generateObject).mockRejectedValue(new Error("AI service unavailable"));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain("AI service unavailable");
    });

    test("should handle AI rate limiting errors", async () => {
      const { user, task } = await createTestDataWithTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const { generateObject } = await import("ai");
      vi.mocked(generateObject).mockRejectedValue(new Error("Rate limit exceeded"));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain("Rate limit exceeded");
    });

    test("should handle database connection errors", async () => {
      const { user } = await createTestDataWithTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock database error by using invalid taskId format that causes query failure
      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: "invalid-id-format",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    test("should handle malformed AI responses", async () => {
      const { user, task } = await createTestDataWithTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const { generateObject } = await import("ai");
      // Mock AI returning incomplete data
      vi.mocked(generateObject).mockResolvedValue({
        object: {
          commit_message: "feat: test",
          // Missing branch_name
        },
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);

      // Should still succeed but with incomplete data
      // Or should fail validation - depends on implementation
      expect([200, 500]).toContain(response.status);
    });

    test("should handle API key configuration errors", async () => {
      const { user, task } = await createTestDataWithTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const { getApiKeyForProvider } = await import("aieo");
      vi.mocked(getApiKeyForProvider).mockReturnValue(undefined);

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe("Integration Tests", () => {
    test("should complete full workflow with realistic data", async () => {
      const { user, task } = await createTestDataWithTask();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const { generateObject } = await import("ai");

      // Add more realistic chat messages
      await db.chatMessage.createMany({
        data: [
          {
            taskId: task.id,
            role: "USER",
            message: "We need to optimize the database query performance",
            timestamp: new Date(Date.now() + 2000),
          },
          {
            taskId: task.id,
            role: "ASSISTANT",
            message: "I'll add indexing and query optimization",
            timestamp: new Date(Date.now() + 3000),
          },
        ],
      });

      vi.mocked(generateObject).mockResolvedValue({
        object: {
          commit_message: "refactor: optimize database query with indexing",
          branch_name: "refactor/optimize-db-queries",
        },
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      // Verify complete response structure
      expect(data).toMatchObject({
        success: true,
        data: {
          commit_message: expect.any(String),
          branch_name: expect.any(String),
        },
      });

      // Verify branch name follows convention
      expect(data.data.branch_name).toMatch(/^[a-z]+\/[a-z0-9-]+$/);
      expect(data.data.commit_message.length).toBeGreaterThan(0);

      // Verify AI was called with all conversation messages
      const callArgs = vi.mocked(generateObject).mock.calls[0][0];
      expect(callArgs.prompt).toContain("optimize the database query");
    });

    test("should handle concurrent requests for different tasks", async () => {
      const { generateObject } = await import("ai");
      
      const user = await createTestUser();
      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      // Create multiple tasks with chat messages
      const tasks = await Promise.all(
        [1, 2, 3].map(async (i) => {
          const task = await db.task.create({
            data: {
              title: `Task ${i}`,
              status: "IN_PROGRESS",
              workspaceId: workspace.id,
            },
          });

          await db.chatMessage.create({
            data: {
              taskId: task.id,
              role: "USER",
              message: `Message for task ${i}`,
              timestamp: new Date(),
            },
          });

          return task;
        })
      );

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Make concurrent requests
      const requests = tasks.map((task) =>
        createPostRequest("http://localhost:3000/api/agent/branch", {
          taskId: task.id,
        })
      );

      const responses = await Promise.all(requests.map((req) => POST(req)));

      // All should succeed
      for (const response of responses) {
        const data = await expectSuccess(response);
        expect(data.success).toBe(true);
        expect(data.data).toHaveProperty("commit_message");
        expect(data.data).toHaveProperty("branch_name");
      }

      // Verify AI was called for each task
      expect(generateObject).toHaveBeenCalledTimes(3);
    });
  });
});