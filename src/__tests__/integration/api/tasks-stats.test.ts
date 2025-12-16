import { describe, test, expect, beforeEach } from "vitest";
import { GET } from "@/app/api/tasks/stats/route";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@/lib/chat";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import {
  createAuthenticatedGetRequest,
  createGetRequest,
} from "@/__tests__/support/helpers/request-builders";
import { generateUniqueSlug, generateUniqueId } from "@/__tests__/support/helpers/ids";
import type { User, Workspace } from "@prisma/client";

// Test Helpers
const TestHelpers = {
  expectSuccess: async (response: Response, expected: { total: number; inProgress: number; waitingForInput: number }) => {
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data).toMatchObject(expected);
  },

  expectUnauthorized: async (response: Response) => {
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBeDefined();
  },

  expectBadRequest: async (response: Response, errorMessage: string) => {
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe(errorMessage);
  },

  expectForbidden: async (response: Response) => {
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toContain("access denied");
  },

  expectNotFound: async (response: Response) => {
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toContain("not found");
  },
};

// Test Data Setup Functions
async function createTestWorkspace(ownerId: string, options?: { deleted?: boolean }) {
  const slug = generateUniqueSlug("test-workspace");

  const workspace = await db.workspace.create({
    data: {
      name: `Test Workspace ${slug}`,
      slug,
      ownerId,
      deleted: options?.deleted || false,
      members: {
        create: {
          userId: ownerId,
          role: "OWNER",
        },
      },
    },
  });

  return workspace;
}

async function addWorkspaceMember(workspaceId: string, userId: string, role: string) {
  await db.workspaceMember.create({
    data: {
      workspaceId,
      userId,
      role: role as any,
    },
  });
}

async function createTestTask(
  workspaceId: string,
  userId: string,
  options?: {
    workflowStatus?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
    deleted?: boolean;
    withFormArtifact?: boolean;
  },
) {
  const task = await db.task.create({
    data: {
      title: `Test Task ${generateUniqueId("task")}`,
      description: "Test task description",
      workspaceId,
      status: "TODO",
      priority: "MEDIUM",
      workflowStatus: options?.workflowStatus || "PENDING",
      deleted: options?.deleted || false,
      createdById: userId,
      updatedById: userId,
    },
  });

  // Create a message with FORM artifact if requested
  if (options?.withFormArtifact) {
    await db.chatMessage.create({
      data: {
        taskId: task.id,
        message: "Test message with form",
        role: "ASSISTANT",
        status: "SENT",
        timestamp: new Date(),
        contextTags: JSON.stringify([]),
        artifacts: {
          create: [
            {
              type: "FORM",
              content: { formId: "test-form", questions: [] },
            },
          ],
        },
      },
    });
  }

  return task;
}

describe("GET /api/tasks/stats - Integration Tests", () => {
  let testUser: User;
  let testWorkspace: Workspace;

  beforeEach(async () => {
    // Create test user
    testUser = await createTestUser({
      email: `test-${Date.now()}@example.com`,
    });

    // Create test workspace
    testWorkspace = await createTestWorkspace(testUser.id);
  });

  describe("Authentication", () => {
    test("should return 401 for unauthenticated user", async () => {
      const request = createGetRequest(`/api/tasks/stats?workspaceId=${testWorkspace.id}`);
      const response = await GET(request);

      await TestHelpers.expectUnauthorized(response);
    });

    test("should proceed with valid authenticated session", async () => {
      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const response = await GET(request);

      await TestHelpers.expectSuccess(response, { total: 0, inProgress: 0, waitingForInput: 0 });
    });
  });

  describe("Request Validation", () => {
    test("should return 400 when workspaceId parameter is missing", async () => {
      const request = createAuthenticatedGetRequest("/api/tasks/stats", testUser);
      const response = await GET(request);

      await TestHelpers.expectBadRequest(response, "workspaceId query parameter is required");
    });

    test("should return 403 for non-existent workspace", async () => {
      const fakeWorkspaceId = generateUniqueId("workspace");
      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${fakeWorkspaceId}`,
        testUser
      );
      const response = await GET(request);

      await TestHelpers.expectNotFound(response);
    });

    test("should return 403 for soft-deleted workspace", async () => {
      const deletedWorkspace = await createTestWorkspace(testUser.id, { deleted: true });
      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${deletedWorkspace.id}`,
        testUser
      );
      const response = await GET(request);

      await TestHelpers.expectNotFound(response);
    });
  });

  describe("Authorization", () => {
    test("should allow workspace owner to access stats", async () => {
      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const response = await GET(request);

      await TestHelpers.expectSuccess(response, { total: 0, inProgress: 0, waitingForInput: 0 });
    });

    test("should allow workspace member to access stats", async () => {
      const memberUser = await createTestUser({
        email: `member-${Date.now()}@example.com`,
      });

      await addWorkspaceMember(testWorkspace.id, memberUser.id, "DEVELOPER");

      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        memberUser
      );
      const response = await GET(request);

      await TestHelpers.expectSuccess(response, { total: 0, inProgress: 0, waitingForInput: 0 });
    });

    test("should return 403 for non-member user", async () => {
      const outsiderUser = await createTestUser({
        email: `outsider-${Date.now()}@example.com`,
      });

      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        outsiderUser
      );
      const response = await GET(request);

      await TestHelpers.expectForbidden(response);
    });
  });

  describe("Task Counting - Total", () => {
    test("should count all non-deleted tasks", async () => {
      await createTestTask(testWorkspace.id, testUser.id, { workflowStatus: "PENDING" });
      await createTestTask(testWorkspace.id, testUser.id, { workflowStatus: "IN_PROGRESS" });
      await createTestTask(testWorkspace.id, testUser.id, { workflowStatus: "COMPLETED" });
      await createTestTask(testWorkspace.id, testUser.id, { workflowStatus: "FAILED" });

      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const response = await GET(request);

      await TestHelpers.expectSuccess(response, { total: 4, inProgress: 1, waitingForInput: 0 });
    });

    test("should exclude deleted tasks from total count", async () => {
      await createTestTask(testWorkspace.id, testUser.id, { workflowStatus: "PENDING" });
      await createTestTask(testWorkspace.id, testUser.id, { workflowStatus: "PENDING", deleted: true });
      await createTestTask(testWorkspace.id, testUser.id, { workflowStatus: "PENDING", deleted: true });

      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const response = await GET(request);

      await TestHelpers.expectSuccess(response, { total: 1, inProgress: 0, waitingForInput: 0 });
    });

    test("should return zero when workspace has no tasks", async () => {
      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const response = await GET(request);

      await TestHelpers.expectSuccess(response, { total: 0, inProgress: 0, waitingForInput: 0 });
    });
  });

  describe("Task Counting - In Progress", () => {
    test("should count only tasks with IN_PROGRESS workflow status", async () => {
      await createTestTask(testWorkspace.id, testUser.id, { workflowStatus: "IN_PROGRESS" });
      await createTestTask(testWorkspace.id, testUser.id, { workflowStatus: "IN_PROGRESS" });
      await createTestTask(testWorkspace.id, testUser.id, { workflowStatus: "PENDING" });
      await createTestTask(testWorkspace.id, testUser.id, { workflowStatus: "COMPLETED" });

      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const response = await GET(request);

      await TestHelpers.expectSuccess(response, { total: 4, inProgress: 2, waitingForInput: 0 });
    });

    test("should exclude deleted IN_PROGRESS tasks", async () => {
      await createTestTask(testWorkspace.id, testUser.id, { workflowStatus: "IN_PROGRESS" });
      await createTestTask(testWorkspace.id, testUser.id, { workflowStatus: "IN_PROGRESS", deleted: true });

      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const response = await GET(request);

      await TestHelpers.expectSuccess(response, { total: 1, inProgress: 1, waitingForInput: 0 });
    });
  });

  describe("Task Counting - Waiting For Input", () => {
    test("should count tasks with IN_PROGRESS status and FORM artifacts", async () => {
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withFormArtifact: true,
      });
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withFormArtifact: true,
      });

      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const response = await GET(request);

      await TestHelpers.expectSuccess(response, { total: 2, inProgress: 2, waitingForInput: 2 });
    });

    test("should count tasks with PENDING status and FORM artifacts", async () => {
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "PENDING",
        withFormArtifact: true,
      });
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "PENDING",
        withFormArtifact: true,
      });

      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const response = await GET(request);

      await TestHelpers.expectSuccess(response, { total: 2, inProgress: 0, waitingForInput: 2 });
    });

    test("should not count tasks without FORM artifacts", async () => {
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withFormArtifact: false,
      });
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "PENDING",
        withFormArtifact: false,
      });

      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const response = await GET(request);

      await TestHelpers.expectSuccess(response, { total: 2, inProgress: 1, waitingForInput: 0 });
    });

    test("should not count COMPLETED tasks with FORM artifacts", async () => {
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "COMPLETED",
        withFormArtifact: true,
      });

      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const response = await GET(request);

      await TestHelpers.expectSuccess(response, { total: 1, inProgress: 0, waitingForInput: 0 });
    });

    test("should not count FAILED tasks with FORM artifacts", async () => {
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "FAILED",
        withFormArtifact: true,
      });

      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const response = await GET(request);

      await TestHelpers.expectSuccess(response, { total: 1, inProgress: 0, waitingForInput: 0 });
    });

    test("should exclude deleted tasks from waitingForInput count", async () => {
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withFormArtifact: true,
      });
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withFormArtifact: true,
        deleted: true,
      });

      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const response = await GET(request);

      await TestHelpers.expectSuccess(response, { total: 1, inProgress: 1, waitingForInput: 1 });
    });
  });

  describe("Complex Scenarios", () => {
    test("should handle mixed task statuses and types correctly", async () => {
      // Should count in total and inProgress
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withFormArtifact: false,
      });

      // Should count in total, inProgress, and waitingForInput
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withFormArtifact: true,
      });

      // Should count in total and waitingForInput
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "PENDING",
        withFormArtifact: true,
      });

      // Should count in total only
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "COMPLETED",
        withFormArtifact: true,
      });

      // Should NOT count (deleted)
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withFormArtifact: true,
        deleted: true,
      });

      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const response = await GET(request);

      await TestHelpers.expectSuccess(response, { total: 4, inProgress: 2, waitingForInput: 2 });
    });

    test("should handle large number of tasks efficiently", async () => {
      // Create 50 tasks with varying statuses
      for (let i = 0; i < 50; i++) {
        await createTestTask(testWorkspace.id, testUser.id, {
          workflowStatus: i % 3 === 0 ? "IN_PROGRESS" : i % 3 === 1 ? "PENDING" : "COMPLETED",
          withFormArtifact: i % 2 === 0,
          deleted: i % 10 === 0, // 10% deleted
        });
      }

      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.total).toBeGreaterThan(0);
      expect(data.data.total).toBeLessThanOrEqual(50);
    });
  });

  describe("Response Format", () => {
    test("should return correct response structure", async () => {
      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const response = await GET(request);
      const data = await response.json();

      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("total");
      expect(data.data).toHaveProperty("inProgress");
      expect(data.data).toHaveProperty("waitingForInput");
      expect(typeof data.data.total).toBe("number");
      expect(typeof data.data.inProgress).toBe("number");
      expect(typeof data.data.waitingForInput).toBe("number");
    });

    test("should return correct status code and headers", async () => {
      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
    });
  });

  describe("Concurrent Requests", () => {
    test("should handle concurrent requests correctly", async () => {
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withFormArtifact: true,
      });

      const request1 = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const request2 = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const request3 = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );

      const [response1, response2, response3] = await Promise.all([
        GET(request1),
        GET(request2),
        GET(request3),
      ]);

      await TestHelpers.expectSuccess(response1, { total: 1, inProgress: 1, waitingForInput: 1 });
      await TestHelpers.expectSuccess(response2, { total: 1, inProgress: 1, waitingForInput: 1 });
      await TestHelpers.expectSuccess(response3, { total: 1, inProgress: 1, waitingForInput: 1 });
    });
  });

  describe("Edge Cases", () => {
    test("should handle workspace with only deleted tasks", async () => {
      await createTestTask(testWorkspace.id, testUser.id, { deleted: true });
      await createTestTask(testWorkspace.id, testUser.id, { deleted: true });

      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const response = await GET(request);

      await TestHelpers.expectSuccess(response, { total: 0, inProgress: 0, waitingForInput: 0 });
    });

    test("should handle workspace with all tasks in same status", async () => {
      await createTestTask(testWorkspace.id, testUser.id, { workflowStatus: "COMPLETED" });
      await createTestTask(testWorkspace.id, testUser.id, { workflowStatus: "COMPLETED" });
      await createTestTask(testWorkspace.id, testUser.id, { workflowStatus: "COMPLETED" });

      const request = createAuthenticatedGetRequest(
        `/api/tasks/stats?workspaceId=${testWorkspace.id}`,
        testUser
      );
      const response = await GET(request);

      await TestHelpers.expectSuccess(response, { total: 3, inProgress: 0, waitingForInput: 0 });
    });
  });
});
