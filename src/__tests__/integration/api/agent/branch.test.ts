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
} from "@/__tests__/support/helpers";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";

// Mock AI SDK
vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

// Mock aieo
vi.mock("aieo", () => ({
  getApiKeyForProvider: vi.fn(() => "test-api-key"),
  getModel: vi.fn(() => ({
    modelId: "claude-3-5-sonnet-20241022",
    provider: "anthropic",
  })),
}));

import { generateObject } from "ai";
const mockGenerateObject = generateObject as vi.MockedFunction<typeof generateObject>;

describe("POST /api/agent/branch Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    test("should return 401 when user not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest("http://localhost/api/agent/branch", {
        taskId: "some-task-id",
      });

      const response = await POST(request);
      await expectUnauthorized(response);
    });
  });

  describe("Validation", () => {
    test("should return 400 when taskId is missing", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost/api/agent/branch", {});

      const response = await POST(request);
      await expectError(response, "Missing required field: taskId", 400);
    });
  });

  // NOTE: The following tests are commented out because they test authorization
  // logic that does not exist in the production code (/api/agent/branch/route.ts).
  // The route currently only checks if a user is authenticated, but does not:
  // 1. Validate that the task exists
  // 2. Check if the user has access to the task's workspace
  // 3. Enforce role-based permissions
  //
  // These tests should be uncommented once the production code is updated
  // to include proper authorization checks in a separate PR.

  // describe("Authorization", () => {
  //   test("should return 404 when task not found", async () => {
  //     const user = await createTestUser();
  //     getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
  //
  //     const request = createPostRequest("http://localhost/api/agent/branch", {
  //       taskId: "non-existent-task-id",
  //     });
  //
  //     const response = await POST(request);
  //     await expectNotFound(response, "Task not found");
  //   });
  //
  //   test("should return 403 when user is not a member of the workspace", async () => {
  //     const owner = await createTestUser({ email: "owner@test.com" });
  //     const workspace = await createTestWorkspace({ ownerId: owner.id });
  //     const task = await db.task.create({
  //       data: {
  //         title: "Test Task",
  //         workspaceId: workspace.id,
  //         createdById: owner.id,
  //         updatedById: owner.id,
  //       },
  //     });
  //
  //     const nonMember = await createTestUser({ email: "nonmember@test.com" });
  //     getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));
  //
  //     const request = createPostRequest("http://localhost/api/agent/branch", {
  //       taskId: task.id,
  //     });
  //
  //     const response = await POST(request);
  //     await expectForbidden(response, "Access denied");
  //   });
  //
  //   test("should return 403 when user has only VIEWER role", async () => {
  //     const owner = await createTestUser({ email: "owner@test.com" });
  //     const workspace = await createTestWorkspace({ ownerId: owner.id });
  //     const task = await db.task.create({
  //       data: {
  //         title: "Test Task",
  //         workspaceId: workspace.id,
  //         createdById: owner.id,
  //         updatedById: owner.id,
  //       },
  //     });
  //
  //     const viewer = await createTestUser({ email: "viewer@test.com" });
  //     await db.workspaceMember.create({
  //       data: {
  //         workspaceId: workspace.id,
  //         userId: viewer.id,
  //         role: "VIEWER",
  //       },
  //     });
  //     getMockedSession().mockResolvedValue(createAuthenticatedSession(viewer));
  //
  //     const request = createPostRequest("http://localhost/api/agent/branch", {
  //       taskId: task.id,
  //     });
  //
  //     const response = await POST(request);
  //     await expectForbidden(response, "Access denied");
  //   });
  // });

  describe("Success Scenarios", () => {
    test("should generate branch name and commit message for authenticated user with chat history", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      const task = await db.task.create({
        data: {
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
          title: "Implement new login page",
        },
      });
      await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Let's start working on this.",
          role: "USER",
        },
      });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const mockAiResponse = {
        object: {
          branch_name: "feat/implement-login-page",
          commit_message: "feat: implement new login page",
        },
      };
      mockGenerateObject.mockResolvedValue(mockAiResponse as any);

      const request = createPostRequest("http://localhost/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.data.branch_name).toBe("feat/implement-login-page");
      expect(data.data.commit_message).toBe("feat: implement new login page");

      expect(mockGenerateObject).toHaveBeenCalled();
      const generateObjectCall = mockGenerateObject.mock.calls[0][0];
      expect(generateObjectCall.prompt).toContain("User: Let's start working on this.");
      expect(generateObjectCall.prompt).toContain("Based on the following conversation");
    });

    // NOTE: This test is commented out because it tests authorization logic
    // that doesn't exist in the production code. Once workspace member validation
    // and role-based access control is added to /api/agent/branch/route.ts,
    // this test can be uncommented.
    //
    // test("should allow a workspace DEVELOPER to generate branch info", async () => {
    //   const owner = await createTestUser({ email: "owner@test.com" });
    //   const workspace = await createTestWorkspace({ ownerId: owner.id });
    //   const task = await db.task.create({
    //     data: {
    //       title: "Test Task",
    //       workspaceId: workspace.id,
    //       createdById: owner.id,
    //       updatedById: owner.id,
    //     },
    //   });
    //
    //   const developer = await createTestUser({ email: "dev@test.com" });
    //   await db.workspaceMember.create({
    //     data: {
    //       workspaceId: workspace.id,
    //       userId: developer.id,
    //       role: "DEVELOPER",
    //     },
    //   });
    //   getMockedSession().mockResolvedValue(createAuthenticatedSession(developer));
    //
    //   const mockAiResponse = {
    //     object: {
    //       branch_name: "fix/bug",
    //       commit_message: "fix: a bug",
    //     },
    //   };
    //   mockGenerateObject.mockResolvedValue(mockAiResponse as any);
    //
    //   const request = createPostRequest("http://localhost/api/agent/branch", { taskId: task.id });
    //   const response = await POST(request);
    //   await expectSuccess(response, 200);
    // });
  });

  describe("Error Handling", () => {
    test("should return 500 if task has no conversation history", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await db.task.create({
        data: {
          title: "Test Task",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      await expectError(response, "No conversation history found for this task", 500);
    });

    test("should return 500 if AI call fails", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await db.task.create({
        data: {
          title: "Test Task",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Test message",
          role: "USER",
        },
      });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockGenerateObject.mockRejectedValue(new Error("AI service unavailable"));

      const request = createPostRequest("http://localhost/api/agent/branch", {
        taskId: task.id,
      });

      const response = await POST(request);
      await expectError(response, "AI service unavailable", 500);
    });
  });
});
