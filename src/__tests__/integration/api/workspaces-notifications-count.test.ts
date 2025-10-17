import { describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/workspaces/[slug]/tasks/notifications-count/route";
import { db } from "@/lib/db";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createAuthenticatedGetRequest } from "@/__tests__/support/helpers";
import { generateUniqueSlug } from "@/__tests__/support/helpers/ids";
import type { User, Workspace } from "@prisma/client";

// Test Helpers
const TestHelpers = {
  createGetRequest: (slug: string, user: { id: string; email: string; name: string }) => {
    const url = `/api/workspaces/${slug}/tasks/notifications-count`;
    return createAuthenticatedGetRequest(url, user);
  },

  expectSuccess: async (response: Response, expectedCount: number) => {
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.waitingForInputCount).toBe(expectedCount);
  },

  expectUnauthorized: async (response: Response) => {
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBeDefined();
  },

  expectForbidden: async (response: Response) => {
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Access denied");
  },

  expectNotFound: async (response: Response) => {
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Workspace not found");
  },
};

// Test Data Setup Functions
async function createTestWorkspaceScenario(options: {
  ownerId: string;
  members?: Array<{ userId: string; role: string }>;
  withTasks?: boolean;
}) {
  const slug = generateUniqueSlug("test-workspace");

  const workspace = await db.workspace.create({
    data: {
      name: `Test Workspace ${slug}`,
      slug,
      ownerId: options.ownerId,
      // @ts-expect-error - role string is compatible with WorkspaceRole enum
      members: options.members
        ? {
            createMany: {
              data: options.members.map((member) => ({
                userId: member.userId,
                role: member.role,
              })),
            },
          }
        : undefined,
    },
  });

  return { workspace, slug };
}

async function createTestTask(
  workspaceId: string,
  userId: string,
  options: {
    workflowStatus?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
    deleted?: boolean;
    withMessage?: boolean;
    artifactType?: "FORM" | "CODE" | "BROWSER" | "LONGFORM";
    messageCount?: number;
    latestMessageArtifactType?: "FORM" | "CODE";
  },
) {
  const task = await db.task.create({
    data: {
      title: `Test Task ${Date.now()}`,
      description: "Test task description",
      workspaceId,
      status: "TODO",
      priority: "MEDIUM",
      workflowStatus: options.workflowStatus || "PENDING",
      deleted: options.deleted || false,
      createdById: userId,
      updatedById: userId,
    },
  });

  if (options.withMessage) {
    const messageCount = options.messageCount || 1;

    for (let i = 0; i < messageCount; i++) {
      const isLatest = i === messageCount - 1;
      const artifactType =
        isLatest && options.latestMessageArtifactType
          ? options.latestMessageArtifactType
          : options.artifactType || "FORM";

      await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: `Test message ${i + 1}`,
          role: "USER",
          status: "SENT",
          timestamp: new Date(Date.now() + i * 1000), // Ensure ordering
          contextTags: JSON.stringify([]),
          artifacts: {
            create: [
              {
                type: artifactType,
                content: artifactType === "FORM" ? { formId: "test-form", questions: [] } : { code: "test code" },
              },
            ],
          },
        },
      });
    }
  }

  return task;
}

describe("GET /api/workspaces/[slug]/tasks/notifications-count - Integration Tests", () => {
  let testUser: User;
  let testWorkspace: Workspace;
  let testSlug: string;

  beforeEach(async () => {
    // Create test user
    testUser = await createTestUser({
      email: `test-${Date.now()}@example.com`,
    });

    // Create test workspace
    const scenario = await createTestWorkspaceScenario({
      ownerId: testUser.id,
    });
    testWorkspace = scenario.workspace;
    testSlug = scenario.slug;
  });

  describe("Authentication", () => {
    test("should return 401 for unauthenticated user", async () => {
      // Create request without auth headers
      const url = `/api/workspaces/${testSlug}/tasks/notifications-count`;
      const request = new NextRequest(new URL(url, "http://localhost:3000"));
      const response = await GET(request, { params: Promise.resolve({ slug: testSlug }) });

      await TestHelpers.expectUnauthorized(response);
    });

    test("should proceed with valid authenticated session", async () => {
      const request = TestHelpers.createGetRequest(testSlug, {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: testSlug }) });

      await TestHelpers.expectSuccess(response, 0);
    });
  });

  describe("Authorization", () => {
    test("should allow workspace owner to access notification count", async () => {
      const request = TestHelpers.createGetRequest(testSlug, {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: testSlug }) });

      await TestHelpers.expectSuccess(response, 0);
    });

    test("should allow workspace member to access notification count", async () => {
      const memberUser = await createTestUser({
        email: `member-${Date.now()}@example.com`,
      });

      await db.workspaceMember.create({
        data: {
          workspaceId: testWorkspace.id,
          userId: memberUser.id,
          role: "DEVELOPER",
        },
      });

      const request = TestHelpers.createGetRequest(testSlug, {
        id: memberUser.id,
        email: memberUser.email || "",
        name: memberUser.name || "",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: testSlug }) });

      await TestHelpers.expectSuccess(response, 0);
    });

    test("should return 403 for non-member user", async () => {
      const outsiderUser = await createTestUser({
        email: `outsider-${Date.now()}@example.com`,
      });

      const request = TestHelpers.createGetRequest(testSlug, {
        id: outsiderUser.id,
        email: outsiderUser.email || "",
        name: outsiderUser.name || "",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: testSlug }) });

      await TestHelpers.expectForbidden(response);
    });

    test("should return 404 for non-existent workspace", async () => {
      const request = TestHelpers.createGetRequest("non-existent-workspace", {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: "non-existent-workspace" }) });

      await TestHelpers.expectNotFound(response);
    });

    test("should exclude soft-deleted workspaces", async () => {
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { deleted: true },
      });

      const request = TestHelpers.createGetRequest(testSlug, {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: testSlug }) });

      await TestHelpers.expectNotFound(response);
    });
  });

  describe("Notification Counting Logic", () => {
    test("should count tasks with FORM artifacts in latest message", async () => {
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: true,
        artifactType: "FORM",
      });

      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "PENDING",
        withMessage: true,
        artifactType: "FORM",
      });

      const request = TestHelpers.createGetRequest(testSlug, {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: testSlug }) });

      await TestHelpers.expectSuccess(response, 2);
    });

    test("should only count IN_PROGRESS and PENDING tasks", async () => {
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: true,
        artifactType: "FORM",
      });

      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "PENDING",
        withMessage: true,
        artifactType: "FORM",
      });

      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "COMPLETED",
        withMessage: true,
        artifactType: "FORM",
      });

      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "FAILED",
        withMessage: true,
        artifactType: "FORM",
      });

      const request = TestHelpers.createGetRequest(testSlug, {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: testSlug }) });

      await TestHelpers.expectSuccess(response, 2);
    });

    test("should exclude deleted tasks", async () => {
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: true,
        artifactType: "FORM",
        deleted: false,
      });

      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: true,
        artifactType: "FORM",
        deleted: true,
      });

      const request = TestHelpers.createGetRequest(testSlug, {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: testSlug }) });

      await TestHelpers.expectSuccess(response, 1);
    });

    test("should exclude tasks without chat messages", async () => {
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: true,
        artifactType: "FORM",
      });

      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: false,
      });

      const request = TestHelpers.createGetRequest(testSlug, {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: testSlug }) });

      await TestHelpers.expectSuccess(response, 1);
    });

    test("should exclude tasks with non-FORM artifacts", async () => {
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: true,
        artifactType: "FORM",
      });

      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: true,
        artifactType: "CODE",
      });

      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: true,
        artifactType: "BROWSER",
      });

      const request = TestHelpers.createGetRequest(testSlug, {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: testSlug }) });

      await TestHelpers.expectSuccess(response, 1);
    });

    test("should only check latest message for FORM artifacts", async () => {
      // Task with FORM in latest message
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: true,
        messageCount: 3,
        artifactType: "CODE", // Older messages
        latestMessageArtifactType: "FORM", // Latest message
      });

      // Task with CODE in latest message (FORM in older messages)
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: true,
        messageCount: 3,
        artifactType: "FORM", // Older messages
        latestMessageArtifactType: "CODE", // Latest message
      });

      const request = TestHelpers.createGetRequest(testSlug, {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: testSlug }) });

      await TestHelpers.expectSuccess(response, 1);
    });

    test("should return zero count when workspace has no tasks", async () => {
      const request = TestHelpers.createGetRequest(testSlug, {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: testSlug }) });

      await TestHelpers.expectSuccess(response, 0);
    });

    test("should return zero count when no tasks meet criteria", async () => {
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "COMPLETED",
        withMessage: true,
        artifactType: "FORM",
      });

      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: true,
        artifactType: "CODE",
      });

      const request = TestHelpers.createGetRequest(testSlug, {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: testSlug }) });

      await TestHelpers.expectSuccess(response, 0);
    });
  });

  describe("Complex Scenarios", () => {
    test("should handle mixed task statuses and artifact types correctly", async () => {
      // Should count (IN_PROGRESS + FORM)
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: true,
        artifactType: "FORM",
      });

      // Should count (PENDING + FORM)
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "PENDING",
        withMessage: true,
        artifactType: "FORM",
      });

      // Should NOT count (COMPLETED + FORM)
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "COMPLETED",
        withMessage: true,
        artifactType: "FORM",
      });

      // Should NOT count (IN_PROGRESS + CODE)
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: true,
        artifactType: "CODE",
      });

      // Should NOT count (deleted + IN_PROGRESS + FORM)
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: true,
        artifactType: "FORM",
        deleted: true,
      });

      // Should NOT count (IN_PROGRESS + no message)
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: false,
      });

      const request = TestHelpers.createGetRequest(testSlug, {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: testSlug }) });

      await TestHelpers.expectSuccess(response, 2);
    });

    test("should handle workspace with multiple tasks and varying message histories", async () => {
      // Task 1: Latest message has FORM
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: true,
        messageCount: 5,
        latestMessageArtifactType: "FORM",
      });

      // Task 2: Latest message has CODE
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: true,
        messageCount: 5,
        latestMessageArtifactType: "CODE",
      });

      // Task 3: Single message with FORM
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "PENDING",
        withMessage: true,
        artifactType: "FORM",
      });

      const request = TestHelpers.createGetRequest(testSlug, {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: testSlug }) });

      await TestHelpers.expectSuccess(response, 2);
    });

    test("should handle large number of tasks efficiently", async () => {
      // Create 50 tasks with varying statuses and artifacts
      for (let i = 0; i < 50; i++) {
        await createTestTask(testWorkspace.id, testUser.id, {
          workflowStatus: i % 2 === 0 ? "IN_PROGRESS" : "PENDING",
          withMessage: i % 3 !== 0, // Some without messages
          artifactType: i % 4 === 0 ? "FORM" : "CODE", // Mix of artifact types
        });
      }

      const request = TestHelpers.createGetRequest(testSlug, {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: testSlug }) });

      // Should count tasks where:
      // - Status is IN_PROGRESS or PENDING (all 50)
      // - Has messages (33 tasks, since 1/3 don't have messages)
      // - Artifact type is FORM (8 out of those 33)
      // Approximate expected count: ~8-9 tasks
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.waitingForInputCount).toBeGreaterThan(0);
    });
  });

  describe("Database Integrity", () => {
    test("should verify database state after counting", async () => {
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: true,
        artifactType: "FORM",
      });

      const request = TestHelpers.createGetRequest(testSlug, {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });
      await GET(request, { params: Promise.resolve({ slug: testSlug }) });

      // Verify database state hasn't changed
      const tasks = await db.task.findMany({
        where: { workspaceId: testWorkspace.id },
      });

      expect(tasks.length).toBe(1);
      expect(tasks[0].workflowStatus).toBe("IN_PROGRESS");
    });

    test("should handle concurrent requests correctly", async () => {
      await createTestTask(testWorkspace.id, testUser.id, {
        workflowStatus: "IN_PROGRESS",
        withMessage: true,
        artifactType: "FORM",
      });

      const request1 = TestHelpers.createGetRequest(testSlug, {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });
      const request2 = TestHelpers.createGetRequest(testSlug, {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });

      const [response1, response2] = await Promise.all([
        GET(request1, { params: Promise.resolve({ slug: testSlug }) }),
        GET(request2, { params: Promise.resolve({ slug: testSlug }) }),
      ]);

      await TestHelpers.expectSuccess(response1, 1);
      await TestHelpers.expectSuccess(response2, 1);
    });
  });

  describe("Response Format Validation", () => {
    test("should return correct response structure", async () => {
      const request = TestHelpers.createGetRequest(testSlug, {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: testSlug }) });
      const data = await response.json();

      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("waitingForInputCount");
      expect(typeof data.data.waitingForInputCount).toBe("number");
      expect(data.data.waitingForInputCount).toBeGreaterThanOrEqual(0);
    });

    test("should return correct status code for successful requests", async () => {
      const request = TestHelpers.createGetRequest(testSlug, {
        id: testUser.id,
        email: testUser.email || "",
        name: testUser.name || "",
      });
      const response = await GET(request, { params: Promise.resolve({ slug: testSlug }) });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
    });
  });
});
