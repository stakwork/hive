import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/agent/branch/route";
import { db } from "@/lib/db";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectError,
  expectUnauthorized,
  createPostRequest,
  getMockedSession,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestTask, createTestChatMessage } from "@/__tests__/support/fixtures/task";

// Mock the AI function that generates commit messages and branch names
vi.mock("@/lib/ai/commit-msg", () => ({
  generateCommitMessage: vi.fn(),
}));

describe("POST /api/agent/branch Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    test("should return 401 when user session has no user object", async () => {
      getMockedSession().mockResolvedValue({ expires: new Date().toISOString() } as any);

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: "test-task-id",
      });

      const response = await POST(request);
      await expectUnauthorized(response);
    });
  });

  describe("Validation Tests", () => {
    test("should return 400 when taskId is missing", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {});

      const response = await POST(request);
      await expectError(response, "Missing required field: taskId", 400);
    });

    test("should return 500 when task has no conversation history", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Create workspace first
      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      // Create task with no chat messages
      const task = await createTestTask({
        title: "Test Task",
        workspaceId: workspace.id,
        createdById: user.id,
      });

      // Mock AI function to throw error for no conversation history
      const { generateCommitMessage } = await import("@/lib/ai/commit-msg");
      vi.mocked(generateCommitMessage).mockRejectedValue(
        new Error("No conversation history found for this task")
      );

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain("No conversation history found");
    });

    test("should return 500 when generateCommitMessage fails for non-existent task", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock AI function to throw task not found error
      const { generateCommitMessage } = await import("@/lib/ai/commit-msg");
      vi.mocked(generateCommitMessage).mockRejectedValue(
        new Error("No conversation history found for this task")
      );

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: "non-existent-task-id",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain("No conversation history found");
    });
  });

  describe("Authorization Tests - Security Gap Documentation", () => {
    test("SECURITY GAP: currently allows any authenticated user to generate branch names for any task", async () => {
      // This test documents the current behavior where workspace authorization is missing
      // Expected secure behavior: Should validate user has workspace access and return 403
      // Current behavior: Allows any authenticated user to generate branch names

      const ownerUser = await createTestUser({ name: "Owner User" });
      const unauthorizedUser = await createTestUser({ name: "Unauthorized User" });

      // Create workspace owned by ownerUser
      const workspace = await db.workspace.create({
        data: {
          name: "Owner's Workspace",
          slug: generateUniqueSlug("owner-workspace"),
          ownerId: ownerUser.id,
        },
      });

      // Create task in owner's workspace
      const task = await createTestTask({
        title: "Owner's Task",
        workspaceId: workspace.id,
        createdById: ownerUser.id,
      });

      // Add chat message for task (required by generateCommitMessage)
      await createTestChatMessage({
        taskId: task.id,
        message: "Add new feature",
        role: "USER",
      });

      // Mock successful AI generation
      const { generateCommitMessage } = await import("@/lib/ai/commit-msg");
      vi.mocked(generateCommitMessage).mockResolvedValue({
        commit_message: "feat: add new feature",
        branch_name: "feat/add-new-feature",
      });

      // Authenticate as unauthorized user (not workspace owner or member)
      getMockedSession().mockResolvedValue(createAuthenticatedSession(unauthorizedUser));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);

      // CURRENT BEHAVIOR: Returns 200 and generates branch name
      // EXPECTED SECURE BEHAVIOR: Should return 403 Access Denied
      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
      expect(data.data.branch_name).toBe("feat/add-new-feature");

      // TODO: Implement workspace authorization using validateWorkspaceAccess()
      // Expected implementation:
      // const task = await db.task.findUnique({ where: { id: taskId }, include: { workspace: true } });
      // if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
      // const access = await validateWorkspaceAccess(task.workspace.slug, userId);
      // if (!access.hasAccess || !access.canWrite) {
      //   return NextResponse.json({ error: "Access denied" }, { status: 403 });
      // }
    });
  });

  describe("Core Functionality Tests", () => {
    test("should successfully generate branch name from task conversation", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Create workspace and task
      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      const task = await createTestTask({
        title: "Add commit functionality",
        workspaceId: workspace.id,
        createdById: user.id,
      });

      // Add chat messages
      await createTestChatMessage({
        taskId: task.id,
        message: "We need to add a commit button to the UI",
        role: "USER",
      });

      // Mock AI generation
      const { generateCommitMessage } = await import("@/lib/ai/commit-msg");
      vi.mocked(generateCommitMessage).mockResolvedValue({
        commit_message: "feat: add commit button to UI",
        branch_name: "feat/add-commit-button",
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.commit_message).toBe("feat: add commit button to UI");
      expect(data.data.branch_name).toBe("feat/add-commit-button");
    });

    test("should return both commit_message and branch_name fields", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      const task = await createTestTask({
        title: "Fix authentication bug",
        workspaceId: workspace.id,
        createdById: user.id,
      });

      await createTestChatMessage({
        taskId: task.id,
        message: "Fix the authentication issue",
        role: "USER",
      });

      const { generateCommitMessage } = await import("@/lib/ai/commit-msg");
      vi.mocked(generateCommitMessage).mockResolvedValue({
        commit_message: "fix: resolve authentication token expiration",
        branch_name: "fix/auth-token-expiration",
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.data).toHaveProperty("commit_message");
      expect(data.data).toHaveProperty("branch_name");
      expect(typeof data.data.commit_message).toBe("string");
      expect(typeof data.data.branch_name).toBe("string");
    });

    test("should validate branch name format follows category/description pattern", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      const task = await createTestTask({
        title: "Refactor database queries",
        workspaceId: workspace.id,
        createdById: user.id,
      });

      await createTestChatMessage({
        taskId: task.id,
        message: "Optimize database queries for better performance",
        role: "USER",
      });

      const { generateCommitMessage } = await import("@/lib/ai/commit-msg");
      vi.mocked(generateCommitMessage).mockResolvedValue({
        commit_message: "refactor: optimize database query performance",
        branch_name: "refactor/optimize-db-queries",
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      // Verify branch name follows category/description format
      expect(data.data.branch_name).toMatch(/^[a-z]+\/[a-z0-9-]+$/);
      expect(data.data.branch_name).toContain("/");

      const [category, description] = data.data.branch_name.split("/");
      expect(category).toBeTruthy();
      expect(description).toBeTruthy();
      expect(["feat", "fix", "refactor", "docs", "test", "chore"]).toContain(category);
    });
  });

  describe("Error Handling Tests", () => {
    test("should handle AI generation errors gracefully", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      const task = await createTestTask({
        title: "Test Task",
        workspaceId: workspace.id,
        createdById: user.id,
      });

      // Mock AI generation failure
      const { generateCommitMessage } = await import("@/lib/ai/commit-msg");
      vi.mocked(generateCommitMessage).mockRejectedValue(
        new Error("AI service unavailable")
      );

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain("AI service unavailable");
    });

    test("should handle malformed AI responses", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      const task = await createTestTask({
        title: "Test Task",
        workspaceId: workspace.id,
        createdById: user.id,
      });

      await createTestChatMessage({
        taskId: task.id,
        message: "Test message",
        role: "USER",
      });

      // Mock incomplete AI response
      const { generateCommitMessage } = await import("@/lib/ai/commit-msg");
      vi.mocked(generateCommitMessage).mockResolvedValue({
        commit_message: "test message",
        branch_name: "", // Empty branch name
      } as any);

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      // Current behavior: endpoint returns whatever AI generates
      // In production, should validate AI response format
      expect(data.data.branch_name).toBe("");
    });

    test("should handle network timeouts from AI provider", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      const task = await createTestTask({
        title: "Test Task",
        workspaceId: workspace.id,
        createdById: user.id,
      });

      // Mock timeout error
      const { generateCommitMessage } = await import("@/lib/ai/commit-msg");
      vi.mocked(generateCommitMessage).mockRejectedValue(
        new Error("Request timeout: AI provider did not respond")
      );

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain("timeout");
    });

    test("should handle rate limiting from AI provider", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      const task = await createTestTask({
        title: "Test Task",
        workspaceId: workspace.id,
        createdById: user.id,
      });

      // Mock rate limiting error
      const { generateCommitMessage } = await import("@/lib/ai/commit-msg");
      vi.mocked(generateCommitMessage).mockRejectedValue(
        new Error("Rate limit exceeded. Please try again later.")
      );

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain("Rate limit exceeded");
    });
  });

  describe("Integration Tests", () => {
    test("should complete full branch name generation workflow", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Create workspace
      const workspace = await db.workspace.create({
        data: {
          name: "Integration Test Workspace",
          slug: generateUniqueSlug("integration-workspace"),
          ownerId: user.id,
        },
      });

      // Create task
      const task = await createTestTask({
        title: "Add integration tests for branch endpoint",
        workspaceId: workspace.id,
        createdById: user.id,
      });

      // Add multiple chat messages to simulate real conversation
      await createTestChatMessage({
        taskId: task.id,
        message: "We need to add integration tests for the branch creation endpoint",
        role: "USER",
      });

      await createTestChatMessage({
        taskId: task.id,
        message: "I'll create comprehensive tests covering authentication, validation, and authorization",
        role: "ASSISTANT",
      });

      await createTestChatMessage({
        taskId: task.id,
        message: "Great! Make sure to test the AI integration as well",
        role: "USER",
      });

      // Mock AI generation with realistic response
      const { generateCommitMessage } = await import("@/lib/ai/commit-msg");
      vi.mocked(generateCommitMessage).mockResolvedValue({
        commit_message: "test: add comprehensive integration tests for branch endpoint",
        branch_name: "test/branch-endpoint-integration",
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
          commit_message: expect.stringContaining("integration tests"),
          branch_name: expect.stringMatching(/^test\/.+/),
        },
      });

      // Verify AI function was called with correct taskId
      expect(generateCommitMessage).toHaveBeenCalledWith(task.id);
      expect(generateCommitMessage).toHaveBeenCalledTimes(1);
    });

    test("should work with different branch name categories", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      const testCases = [
        { category: "feat", description: "add-new-feature" },
        { category: "fix", description: "resolve-bug" },
        { category: "refactor", description: "improve-code" },
        { category: "docs", description: "update-readme" },
        { category: "test", description: "add-tests" },
        { category: "chore", description: "update-dependencies" },
      ];

      for (const { category, description } of testCases) {
        const task = await createTestTask({
          title: `${category} task`,
          workspaceId: workspace.id,
          createdById: user.id,
        });

        await createTestChatMessage({
          taskId: task.id,
          message: `${category} task message`,
          role: "USER",
        });

        const { generateCommitMessage } = await import("@/lib/ai/commit-msg");
        vi.mocked(generateCommitMessage).mockResolvedValue({
          commit_message: `${category}: ${description.replace(/-/g, " ")}`,
          branch_name: `${category}/${description}`,
        });

        const request = createPostRequest("http://localhost:3000/api/agent/branch", {
          taskId: task.id,
        });

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.branch_name).toBe(`${category}/${description}`);
      }
    });
  });
});