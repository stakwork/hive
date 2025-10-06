import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/workspaces/[slug]/tasks/notifications-count/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspaceScenario,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { NextRequest } from "next/server";

// Helper to create NextRequest with proper params
const createGetRequest = (slug: string) => {
  const url = `http://localhost:3000/api/workspaces/${slug}/tasks/notifications-count`;
  return new NextRequest(url);
};

// Helper to create tasks with chat messages and artifacts
async function createTaskWithMessage(
  workspaceId: string,
  userId: string,
  options: {
    workflowStatus?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "ERROR";
    artifactType?: "FORM" | "CODE" | "BROWSER" | "IDE";
    deleted?: boolean;
    multipleMessages?: boolean;
  } = {}
) {
  const {
    workflowStatus = "IN_PROGRESS",
    artifactType = "FORM",
    deleted = false,
    multipleMessages = false,
  } = options;

  const task = await db.task.create({
    data: {
      title: `Test Task ${Date.now()}`,
      workspaceId,
      createdById: userId,
      updatedById: userId,
      status: "IN_PROGRESS",
      workflowStatus,
      deleted,
      deletedAt: deleted ? new Date() : null,
    },
  });

  // Create older message first (if multipleMessages is true)
  if (multipleMessages) {
    await db.chatMessage.create({
      data: {
        taskId: task.id,
        message: "Older message",
        role: "ASSISTANT",
        timestamp: new Date(Date.now() - 60000), // 1 minute ago
        artifacts: {
          create: [
            {
              type: "CODE",
              content: {},
            },
          ],
        },
      },
    });
  }

  // Create latest message
  await db.chatMessage.create({
    data: {
      taskId: task.id,
      message: "Latest message",
      role: "ASSISTANT",
      timestamp: new Date(),
      artifacts: {
        create: [
          {
            type: artifactType,
            content: {},
          },
        ],
      },
    },
  });

  return task;
}

describe("GET /api/workspaces/[slug]/tasks/notifications-count - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    test("should return 401 for unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const { workspace } = await createTestWorkspaceScenario();
      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ error: "Unauthorized" });
    });
  });

  describe("Authorization", () => {
    test("should allow workspace owner to access notification count", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty("waitingForInputCount");
    });

    test("should allow workspace member to access notification count", async () => {
      const { workspace, members } = await createTestWorkspaceScenario({
        memberCount: 1,
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(members[0])
      );

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    test("should deny access to non-members", async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const nonMember = await createTestUser({ email: "nonmember@test.com" });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(nonMember)
      );

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data).toEqual({ error: "Access denied" });
    });

    test("should return 404 for non-existent workspace", async () => {
      const user = await createTestUser();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest("nonexistent-workspace");
      const params = Promise.resolve({ slug: "nonexistent-workspace" });

      const response = await GET(request, { params });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toEqual({ error: "Workspace not found" });
    });

    test("should exclude soft-deleted workspaces", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      // Soft-delete the workspace
      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toEqual({ error: "Workspace not found" });
    });

    test("should exclude inactive members (leftAt not null)", async () => {
      const { workspace, members, memberships } =
        await createTestWorkspaceScenario({
          memberCount: 1,
        });

      // Mark member as inactive
      await db.workspaceMember.update({
        where: { id: memberships[0].id },
        data: { leftAt: new Date() },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(members[0])
      );

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data).toEqual({ error: "Access denied" });
    });
  });

  describe("Notification Counting - FORM Artifacts", () => {
    test("should count tasks with FORM artifacts in latest message", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      // Create tasks with FORM artifacts
      await createTaskWithMessage(workspace.id, owner.id, {
        artifactType: "FORM",
      });
      await createTaskWithMessage(workspace.id, owner.id, {
        artifactType: "FORM",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.waitingForInputCount).toBe(2);
    });

    test("should exclude tasks without FORM artifacts", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      // Create tasks with non-FORM artifacts
      await createTaskWithMessage(workspace.id, owner.id, {
        artifactType: "CODE",
      });
      await createTaskWithMessage(workspace.id, owner.id, {
        artifactType: "BROWSER",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.waitingForInputCount).toBe(0);
    });

    test("should only check latest message for FORM artifacts", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      // Create task with older FORM message and newer non-FORM message
      await createTaskWithMessage(workspace.id, owner.id, {
        artifactType: "CODE",
        multipleMessages: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      // Should be 0 because latest message has CODE, not FORM
      expect(data.data.waitingForInputCount).toBe(0);
    });

    test("should count task with multiple artifacts if FORM is present", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const task = await db.task.create({
        data: {
          title: "Multi-artifact task",
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
          status: "IN_PROGRESS",
          workflowStatus: "IN_PROGRESS",
        },
      });

      // Create message with multiple artifact types including FORM
      await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Multi-artifact message",
          role: "ASSISTANT",
          artifacts: {
            create: [
              { type: "FORM", content: {} },
              { type: "CODE", content: {} },
              { type: "BROWSER", content: {} },
            ],
          },
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.waitingForInputCount).toBe(1);
    });
  });

  describe("Workflow Status Filtering", () => {
    test("should count IN_PROGRESS tasks with FORM artifacts", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTaskWithMessage(workspace.id, owner.id, {
        workflowStatus: "IN_PROGRESS",
        artifactType: "FORM",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.waitingForInputCount).toBe(1);
    });

    test("should count PENDING tasks with FORM artifacts", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTaskWithMessage(workspace.id, owner.id, {
        workflowStatus: "PENDING",
        artifactType: "FORM",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.waitingForInputCount).toBe(1);
    });

    test("should exclude COMPLETED tasks even with FORM artifacts", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTaskWithMessage(workspace.id, owner.id, {
        workflowStatus: "COMPLETED",
        artifactType: "FORM",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.waitingForInputCount).toBe(0);
    });

    test("should exclude ERROR tasks even with FORM artifacts", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTaskWithMessage(workspace.id, owner.id, {
        workflowStatus: "ERROR",
        artifactType: "FORM",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.waitingForInputCount).toBe(0);
    });

    test("should count both IN_PROGRESS and PENDING tasks with FORM artifacts", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTaskWithMessage(workspace.id, owner.id, {
        workflowStatus: "IN_PROGRESS",
        artifactType: "FORM",
      });
      await createTaskWithMessage(workspace.id, owner.id, {
        workflowStatus: "PENDING",
        artifactType: "FORM",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.waitingForInputCount).toBe(2);
    });
  });

  describe("Soft-Delete Exclusion", () => {
    test("should exclude soft-deleted tasks from count", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      // Create active task
      await createTaskWithMessage(workspace.id, owner.id, {
        artifactType: "FORM",
        deleted: false,
      });

      // Create soft-deleted task
      await createTaskWithMessage(workspace.id, owner.id, {
        artifactType: "FORM",
        deleted: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      // Should only count the active task
      expect(data.data.waitingForInputCount).toBe(1);
    });

    test("should return 0 when all tasks are soft-deleted", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      // Create only soft-deleted tasks
      await createTaskWithMessage(workspace.id, owner.id, {
        artifactType: "FORM",
        deleted: true,
      });
      await createTaskWithMessage(workspace.id, owner.id, {
        artifactType: "FORM",
        deleted: true,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.waitingForInputCount).toBe(0);
    });
  });

  describe("Edge Cases", () => {
    test("should return 0 when workspace has no tasks", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.waitingForInputCount).toBe(0);
    });

    test("should return 0 when tasks have no chat messages", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      // Create task without messages
      await db.task.create({
        data: {
          title: "Task without messages",
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
          status: "IN_PROGRESS",
          workflowStatus: "IN_PROGRESS",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.waitingForInputCount).toBe(0);
    });

    test("should return 0 when messages have no artifacts", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const task = await db.task.create({
        data: {
          title: "Task with message but no artifacts",
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
          status: "IN_PROGRESS",
          workflowStatus: "IN_PROGRESS",
        },
      });

      // Create message without artifacts
      await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Message without artifacts",
          role: "ASSISTANT",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.waitingForInputCount).toBe(0);
    });

    test("should handle complex scenario with mixed task states", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      // Create various task scenarios
      await createTaskWithMessage(workspace.id, owner.id, {
        workflowStatus: "IN_PROGRESS",
        artifactType: "FORM",
      }); // Should count
      await createTaskWithMessage(workspace.id, owner.id, {
        workflowStatus: "PENDING",
        artifactType: "FORM",
      }); // Should count
      await createTaskWithMessage(workspace.id, owner.id, {
        workflowStatus: "COMPLETED",
        artifactType: "FORM",
      }); // Should not count (wrong status)
      await createTaskWithMessage(workspace.id, owner.id, {
        workflowStatus: "IN_PROGRESS",
        artifactType: "CODE",
      }); // Should not count (wrong artifact type)
      await createTaskWithMessage(workspace.id, owner.id, {
        workflowStatus: "IN_PROGRESS",
        artifactType: "FORM",
        deleted: true,
      }); // Should not count (soft-deleted)

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createGetRequest(workspace.slug);
      const params = Promise.resolve({ slug: workspace.slug });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      // Should only count the first 2 tasks
      expect(data.data.waitingForInputCount).toBe(2);
    });
  });
});