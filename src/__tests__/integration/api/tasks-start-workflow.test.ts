import { describe, test, expect, vi, beforeEach } from "vitest";
import { PATCH } from "@/app/api/tasks/[taskId]/route";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createAuthenticatedPatchRequest } from "@/__tests__/support/helpers/request-builders";
import { generateUniqueSlug, generateUniqueId } from "@/__tests__/support/helpers/ids";

// Mock the startTaskWorkflow service
vi.mock("@/services/task-workflow", () => ({
  startTaskWorkflow: vi.fn().mockResolvedValue({
    stakworkData: {
      project_id: "test-project-123",
      run_id: "test-run-456",
    },
  }),
}));

// Test Data Setup Functions
async function createTestWorkspace(ownerId: string) {
  const slug = generateUniqueSlug("test-workspace");

  const workspace = await db.workspace.create({
    data: {
      name: `Test Workspace ${slug}`,
      slug,
      ownerId,
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

async function createTestTask(
  workspaceId: string,
  userId: string,
  options?: { workflowStatus?: WorkflowStatus }
) {
  const taskId = generateUniqueId("task");

  const task = await db.task.create({
    data: {
      id: taskId,
      title: `Test Task ${taskId}`,
      description: "Test description",
      workspaceId,
      createdById: userId,
      updatedById: userId,
      workflowStatus: options?.workflowStatus || WorkflowStatus.NOT_STARTED,
    },
  });

  return task;
}

// Cleanup
async function cleanup(workspaceIds: string[], userIds: string[]) {
  await db.task.deleteMany({
    where: { workspaceId: { in: workspaceIds } },
  });
  await db.workspaceMember.deleteMany({
    where: { workspaceId: { in: workspaceIds } },
  });
  await db.workspace.deleteMany({
    where: { id: { in: workspaceIds } },
  });
  await db.user.deleteMany({
    where: { id: { in: userIds } },
  });
}

describe("PATCH /api/tasks/[taskId] - Start Workflow Guard", () => {
  test("should successfully start workflow for task with NOT_STARTED status", async () => {
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    const testTask = await createTestTask(testWorkspace.id, testUser.id, {
      workflowStatus: WorkflowStatus.NOT_STARTED,
    });

    try {
      const request = createAuthenticatedPatchRequest(
        "http://localhost",
        { startWorkflow: true, mode: "live" },
        testUser
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.task).toBeDefined();
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("should prevent re-starting task with IN_PROGRESS workflow status", async () => {
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    const testTask = await createTestTask(testWorkspace.id, testUser.id, {
      workflowStatus: WorkflowStatus.IN_PROGRESS,
    });

    try {
      const request = createAuthenticatedPatchRequest(
        "http://localhost",
        { startWorkflow: true, mode: "live" },
        testUser
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(409);
      const data = await response.json();
      expect(data.error).toBe("Task has already been started");
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("should prevent re-starting task with COMPLETED workflow status", async () => {
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    const testTask = await createTestTask(testWorkspace.id, testUser.id, {
      workflowStatus: WorkflowStatus.COMPLETED,
    });

    try {
      const request = createAuthenticatedPatchRequest(
        "http://localhost",
        { startWorkflow: true, mode: "live" },
        testUser
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(409);
      const data = await response.json();
      expect(data.error).toBe("Task has already been started");
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("should allow starting workflow for task with ERROR status", async () => {
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    const testTask = await createTestTask(testWorkspace.id, testUser.id, {
      workflowStatus: WorkflowStatus.ERROR,
    });

    try {
      const request = createAuthenticatedPatchRequest(
        "http://localhost",
        { startWorkflow: true, mode: "live" },
        testUser
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.task).toBeDefined();
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("should allow starting workflow for task with FAILED status", async () => {
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    const testTask = await createTestTask(testWorkspace.id, testUser.id, {
      workflowStatus: WorkflowStatus.FAILED,
    });

    try {
      const request = createAuthenticatedPatchRequest(
        "http://localhost",
        { startWorkflow: true, mode: "live" },
        testUser
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.task).toBeDefined();
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });
});
