import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/agent/branch/route";
import {
  createPostRequest,
  expectSuccess,
  expectUnauthorized,
  expectError,
  createAuthenticatedSession,
  getMockedSession,
  mockUnauthenticatedSession,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";

// Mock the AI commit message generation
vi.mock("@/lib/ai/commit-msg", () => ({
  generateCommitMessage: vi.fn(),
}));

import { generateCommitMessage } from "@/lib/ai/commit-msg";

const mockedGenerateCommitMessage = generateCommitMessage as ReturnType<typeof vi.fn>;

describe("POST /api/agent/branch Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication Tests", () => {
    test("returns 401 when user not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: "test-task-123",
      });

      const response = await POST(request);

      await expectUnauthorized(response);
      expect(mockedGenerateCommitMessage).not.toHaveBeenCalled();
    });

    test("returns 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({
        expires: new Date().toISOString(),
        user: undefined,
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: "test-task-123",
      });

      const response = await POST(request);

      await expectUnauthorized(response);
      expect(mockedGenerateCommitMessage).not.toHaveBeenCalled();
    });

    test("accepts requests with valid session", async () => {
      const user = await createTestUser({
        email: "authenticated@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockedGenerateCommitMessage.mockResolvedValue({
        commit_message: "feat: add authentication test",
        branch_name: "feat/add-authentication-test",
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: "test-task-123",
      });

      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(mockedGenerateCommitMessage).toHaveBeenCalledWith("test-task-123");
    });
  });

  describe("Validation Tests", () => {
    test("returns 400 when taskId is missing", async () => {
      const user = await createTestUser({
        email: "validation-test@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {});

      const response = await POST(request);

      await expectError(response, "Missing required field: taskId", 400);
      expect(mockedGenerateCommitMessage).not.toHaveBeenCalled();
    });

    test("returns 400 when taskId is null", async () => {
      const user = await createTestUser({
        email: "validation-null@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: null,
      });

      const response = await POST(request);

      await expectError(response, "Missing required field: taskId", 400);
      expect(mockedGenerateCommitMessage).not.toHaveBeenCalled();
    });

    test("returns 400 when taskId is empty string", async () => {
      const user = await createTestUser({
        email: "validation-empty@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: "",
      });

      const response = await POST(request);

      await expectError(response, "Missing required field: taskId", 400);
      expect(mockedGenerateCommitMessage).not.toHaveBeenCalled();
    });

    test("returns 400 when request body is invalid JSON", async () => {
      const user = await createTestUser({
        email: "validation-json@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Create request with invalid JSON body
      const request = new Request("http://localhost:3000/api/agent/branch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "invalid json {",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe("Success Cases", () => {
    test("successfully generates commit message and branch name", async () => {
      const user = await createTestUser({
        email: "success-test@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockCommitMessage = "feat: implement user authentication system";
      const mockBranchName = "feat/implement-user-authentication";

      mockedGenerateCommitMessage.mockResolvedValue({
        commit_message: mockCommitMessage,
        branch_name: mockBranchName,
      });

      const taskId = generateUniqueId("task");

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId,
      });

      const response = await POST(request);

      const data = await expectSuccess(response, 200);

      expect(data).toEqual({
        success: true,
        data: {
          commit_message: mockCommitMessage,
          branch_name: mockBranchName,
        },
      });

      expect(mockedGenerateCommitMessage).toHaveBeenCalledWith(taskId);
      expect(mockedGenerateCommitMessage).toHaveBeenCalledTimes(1);
    });

    test("returns proper response format with various commit types", async () => {
      const user = await createTestUser({
        email: "commit-types@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const testCases = [
        {
          commit_message: "fix: resolve authentication bug in login flow",
          branch_name: "fix/resolve-authentication-bug",
        },
        {
          commit_message: "refactor: improve code structure in user service",
          branch_name: "refactor/improve-user-service",
        },
        {
          commit_message: "docs: update API documentation for authentication",
          branch_name: "docs/update-api-docs",
        },
        {
          commit_message: "test: add integration tests for branch endpoint",
          branch_name: "test/add-branch-tests",
        },
      ];

      for (const testCase of testCases) {
        mockedGenerateCommitMessage.mockResolvedValue(testCase);

        const request = createPostRequest("http://localhost:3000/api/agent/branch", {
          taskId: generateUniqueId("task"),
        });

        const response = await POST(request);
        const data = await expectSuccess(response, 200);

        expect(data.success).toBe(true);
        expect(data.data.commit_message).toBe(testCase.commit_message);
        expect(data.data.branch_name).toBe(testCase.branch_name);
      }
    });

    test("handles long commit messages and branch names", async () => {
      const user = await createTestUser({
        email: "long-messages@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const longCommitMessage = "feat: implement comprehensive user authentication system with OAuth2 integration, role-based access control, and secure session management";
      const longBranchName = "feat/implement-comprehensive-user-authentication-oauth2-rbac";

      mockedGenerateCommitMessage.mockResolvedValue({
        commit_message: longCommitMessage,
        branch_name: longBranchName,
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: generateUniqueId("task"),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.commit_message).toBe(longCommitMessage);
      expect(data.data.branch_name).toBe(longBranchName);
    });

    test("handles special characters in commit messages", async () => {
      const user = await createTestUser({
        email: "special-chars@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const commitWithSpecialChars = "fix: resolve issue #123 with @mentions & <tags>";
      const branchWithSpecialChars = "fix/resolve-issue-123";

      mockedGenerateCommitMessage.mockResolvedValue({
        commit_message: commitWithSpecialChars,
        branch_name: branchWithSpecialChars,
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: generateUniqueId("task"),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.commit_message).toContain("#123");
      expect(data.data.commit_message).toContain("@mentions");
    });
  });

  describe("Error Handling - AI Generation Failures", () => {
    test("returns 500 when generateCommitMessage throws 'No conversation history' error", async () => {
      const user = await createTestUser({
        email: "no-history@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockedGenerateCommitMessage.mockRejectedValue(
        new Error("No conversation history found for this task")
      );

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: generateUniqueId("task"),
      });

      const response = await POST(request);

      await expectError(response, "No conversation history found for this task", 500);
    });

    test("returns 500 when generateCommitMessage throws generic Error", async () => {
      const user = await createTestUser({
        email: "generic-error@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockedGenerateCommitMessage.mockRejectedValue(new Error("AI service unavailable"));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: generateUniqueId("task"),
      });

      const response = await POST(request);

      await expectError(response, "AI service unavailable", 500);
    });

    test("returns 500 with generic message when generateCommitMessage throws non-Error", async () => {
      const user = await createTestUser({
        email: "non-error@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockedGenerateCommitMessage.mockRejectedValue("String error");

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: generateUniqueId("task"),
      });

      const response = await POST(request);

      await expectError(response, "Failed to generate commit message", 500);
    });

    test("returns 500 when generateCommitMessage times out", async () => {
      const user = await createTestUser({
        email: "timeout@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockedGenerateCommitMessage.mockRejectedValue(new Error("AI request timeout"));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: generateUniqueId("task"),
      });

      const response = await POST(request);

      await expectError(response, "AI request timeout", 500);
    });

    test("returns 500 when generateCommitMessage throws network error", async () => {
      const user = await createTestUser({
        email: "network-error@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockedGenerateCommitMessage.mockRejectedValue(new Error("Network connection failed"));

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: generateUniqueId("task"),
      });

      const response = await POST(request);

      await expectError(response, "Network connection failed", 500);
    });
  });

  describe("Data Integrity", () => {
    test("validates response structure matches expected format", async () => {
      const user = await createTestUser({
        email: "structure-test@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockedGenerateCommitMessage.mockResolvedValue({
        commit_message: "feat: test commit",
        branch_name: "feat/test-commit",
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: generateUniqueId("task"),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      // Verify structure
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("commit_message");
      expect(data.data).toHaveProperty("branch_name");

      // Verify types
      expect(typeof data.success).toBe("boolean");
      expect(typeof data.data.commit_message).toBe("string");
      expect(typeof data.data.branch_name).toBe("string");

      // Verify values
      expect(data.success).toBe(true);
      expect(data.data.commit_message.length).toBeGreaterThan(0);
      expect(data.data.branch_name.length).toBeGreaterThan(0);
    });

    test("verifies commit_message and branch_name are non-empty strings", async () => {
      const user = await createTestUser({
        email: "non-empty@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockedGenerateCommitMessage.mockResolvedValue({
        commit_message: "fix: bug fix",
        branch_name: "fix/bug-fix",
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: generateUniqueId("task"),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.data.commit_message).toBeTruthy();
      expect(data.data.branch_name).toBeTruthy();
      expect(data.data.commit_message.trim()).not.toBe("");
      expect(data.data.branch_name.trim()).not.toBe("");
    });

    test("handles taskId with special characters", async () => {
      const user = await createTestUser({
        email: "special-taskid@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockedGenerateCommitMessage.mockResolvedValue({
        commit_message: "feat: special task",
        branch_name: "feat/special-task",
      });

      const specialTaskIds = [
        "task-with-dashes-123",
        "task_with_underscores_456",
        "TASK-UPPERCASE-789",
        "task.with.dots.012",
      ];

      for (const taskId of specialTaskIds) {
        const request = createPostRequest("http://localhost:3000/api/agent/branch", {
          taskId,
        });

        const response = await POST(request);
        const data = await expectSuccess(response, 200);

        expect(data.success).toBe(true);
        expect(mockedGenerateCommitMessage).toHaveBeenCalledWith(taskId);
      }
    });

    test("verifies generateCommitMessage is called with exact taskId", async () => {
      const user = await createTestUser({
        email: "exact-taskid@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const exactTaskId = "exact-task-id-12345678";

      mockedGenerateCommitMessage.mockResolvedValue({
        commit_message: "feat: exact test",
        branch_name: "feat/exact-test",
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: exactTaskId,
      });

      await POST(request);

      expect(mockedGenerateCommitMessage).toHaveBeenCalledWith(exactTaskId);
      expect(mockedGenerateCommitMessage).toHaveBeenCalledTimes(1);

      const callArgs = mockedGenerateCommitMessage.mock.calls[0];
      expect(callArgs[0]).toBe(exactTaskId);
    });
  });

  describe("Edge Cases", () => {
    test("handles multiple concurrent requests", async () => {
      const user = await createTestUser({
        email: "concurrent@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockedGenerateCommitMessage.mockImplementation((taskId) =>
        Promise.resolve({
          commit_message: `feat: commit for ${taskId}`,
          branch_name: `feat/commit-${taskId}`,
        })
      );

      const requests = Array.from({ length: 5 }, (_, i) =>
        createPostRequest("http://localhost:3000/api/agent/branch", {
          taskId: `task-${i}`,
        })
      );

      const responses = await Promise.all(requests.map((req) => POST(req)));

      for (let i = 0; i < responses.length; i++) {
        const data = await expectSuccess(responses[i], 200);
        expect(data.success).toBe(true);
        expect(data.data.commit_message).toContain(`task-${i}`);
      }

      expect(mockedGenerateCommitMessage).toHaveBeenCalledTimes(5);
    });

    test("handles very long taskId", async () => {
      const user = await createTestUser({
        email: "long-taskid@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockedGenerateCommitMessage.mockResolvedValue({
        commit_message: "feat: long task",
        branch_name: "feat/long-task",
      });

      const longTaskId = "a".repeat(200);

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: longTaskId,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(mockedGenerateCommitMessage).toHaveBeenCalledWith(longTaskId);
    });

    test("handles generateCommitMessage returning empty strings", async () => {
      const user = await createTestUser({
        email: "empty-strings@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockedGenerateCommitMessage.mockResolvedValue({
        commit_message: "",
        branch_name: "",
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: generateUniqueId("task"),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.commit_message).toBe("");
      expect(data.data.branch_name).toBe("");
    });

    test("handles generateCommitMessage with whitespace-only strings", async () => {
      const user = await createTestUser({
        email: "whitespace@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockedGenerateCommitMessage.mockResolvedValue({
        commit_message: "   ",
        branch_name: "   ",
      });

      const request = createPostRequest("http://localhost:3000/api/agent/branch", {
        taskId: generateUniqueId("task"),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.commit_message).toBe("   ");
      expect(data.data.branch_name).toBe("   ");
    });
  });

  describe("Request Content Type Handling", () => {
    test("accepts application/json content type", async () => {
      const user = await createTestUser({
        email: "content-type@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockedGenerateCommitMessage.mockResolvedValue({
        commit_message: "feat: content type test",
        branch_name: "feat/content-type-test",
      });

      const request = new Request("http://localhost:3000/api/agent/branch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ taskId: "test-task" }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
    });

    test("handles missing Content-Type header", async () => {
      const user = await createTestUser({
        email: "no-content-type@example.com",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockedGenerateCommitMessage.mockResolvedValue({
        commit_message: "feat: no content type",
        branch_name: "feat/no-content-type",
      });

      const request = new Request("http://localhost:3000/api/agent/branch", {
        method: "POST",
        body: JSON.stringify({ taskId: "test-task" }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
    });
  });
});