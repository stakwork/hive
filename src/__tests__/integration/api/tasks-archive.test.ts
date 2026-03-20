import { describe, test, expect, vi } from "vitest";
import { PATCH } from "@/app/api/tasks/[taskId]/route";
import { GET } from "@/app/api/tasks/route";
import { db } from "@/lib/db";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import {
  createAuthenticatedPatchRequest,
  createAuthenticatedGetRequest,
} from "@/__tests__/support/helpers/request-builders";
import { generateUniqueSlug, generateUniqueId } from "@/__tests__/support/helpers/ids";
import type { User, Workspace, Task } from "@prisma/client";

// Test Data Setup Functions
async function createTestWorkspace(ownerId: string) {
  const slug = generateUniqueSlug("test-workspace");

  const workspace = await db.workspaces.create({
    data: {
      name: `Test Workspace ${slug}`,
      slug,
      ownerId,
      members: {
        create: {user_id: ownerId,
          role: "OWNER",
        },
      },
    },
  });

  return workspace;
}

async function createTestTask(
workspace_id: string,user_id: string,
  options?: { archived?: boolean }
) {
  const taskId = generateUniqueId("task");

  const task = await db.tasks.create({
    data: {
      id: taskId,
      title: `Test Task ${taskId}`,
      description: "Test description",
      workspaceId,created_by_id: userId,updated_by_id: userId,
      archived: options?.archived || false,archived_at: options?.archived ? new Date() : null,
    },
  });

  return task;
}

// Cleanup
async function cleanup(workspaceIds: string[], userIds: string[]) {
  await db.tasks.deleteMany({
    where: {workspace_id: { in: workspaceIds } },
  });
  await db.workspace_members.deleteMany({
    where: {workspace_id: { in: workspaceIds } },
  });
  await db.workspaces.deleteMany({
    where: { id: { in: workspaceIds } },
  });
  await db.users.deleteMany({
    where: { id: { in: userIds } },
  });
}

// Tests
describe("PATCH /api/tasks/[taskId] - Archive Functionality", () => {
  test("should archive a task successfully", async () => {
    // Setup
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    const testTask = await createTestTask(testWorkspace.id, testUser.id);

    try {
      const request = createAuthenticatedPatchRequest("http://localhost", {
        archived: true,
      }, testUser);

      const response = await PATCH(request, {
        params: Promise.resolve({task_id: testTask.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.task.archived).toBe(true);
      expect(data.task.archivedAt).toBeDefined();

      // Verify in database
      const updatedTask = await db.tasks.findUnique({
        where: { id: testTask.id },
        select: { archived: true,archived_at: true },
      });
      expect(updatedTask?.archived).toBe(true);
      expect(updatedTask?.archivedAt).toBeInstanceOf(Date);
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("should unarchive a task successfully", async () => {
    // Setup
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    const archivedTask = await createTestTask(testWorkspace.id, testUser.id, {
      archived: true,
    });

    try {
      const request = createAuthenticatedPatchRequest("http://localhost", {
        archived: false,
      }, testUser);

      const response = await PATCH(request, {
        params: Promise.resolve({task_id: archivedTask.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.task.archived).toBe(false);
      expect(data.task.archivedAt).toBeNull();

      // Verify in database
      const updatedTask = await db.tasks.findUnique({
        where: { id: archivedTask.id },
        select: { archived: true,archived_at: true },
      });
      expect(updatedTask?.archived).toBe(false);
      expect(updatedTask?.archivedAt).toBeNull();
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("should reject invalid archived value", async () => {
    // Setup
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    const testTask = await createTestTask(testWorkspace.id, testUser.id);

    try {
      const request = createAuthenticatedPatchRequest("http://localhost", {
        archived: "invalid",
      }, testUser);

      const response = await PATCH(request, {
        params: Promise.resolve({task_id: testTask.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Invalid archived value");
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("should return 404 for non-existent task", async () => {
    // Setup
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);

    try {
      const request = createAuthenticatedPatchRequest("http://localhost", {
        archived: true,
      }, testUser);

      const response = await PATCH(request, {
        params: Promise.resolve({task_id: "non-existent-task-id" }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Task not found");
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });
});

describe("GET /api/tasks - Archive Filtering", () => {
  test("should return only non-archived tasks by default", async () => {
    // Setup
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    const recentTask = await createTestTask(testWorkspace.id, testUser.id, {
      archived: false,
    });
    const archivedTask = await createTestTask(testWorkspace.id, testUser.id, {
      archived: true,
    });

    try {
      const request = createAuthenticatedGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}`,
        testUser
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(0); // Recent task is TODO status, which is filtered by default
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("should return only archived tasks when includeArchived=true", async () => {
    // Setup
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    const recentTask = await createTestTask(testWorkspace.id, testUser.id, {
      archived: false,
    });
    const archivedTask = await createTestTask(testWorkspace.id, testUser.id, {
      archived: true,
    });

    try {
      const request = createAuthenticatedGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}&includeArchived=true`,
        testUser
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      // Should include the archived task
      const taskIds = data.data.map((t: Task) => t.id);
      expect(taskIds).toContain(archivedTask.id);
      expect(taskIds).not.toContain(recentTask.id);
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("should filter archived tasks from recent list", async () => {
    // Setup
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace(testUser.id);
    const recentTask = await createTestTask(testWorkspace.id, testUser.id, {
      archived: false,
    });
    const archivedTask = await createTestTask(testWorkspace.id, testUser.id, {
      archived: true,
    });

    try {
      const request = createAuthenticatedGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}&includeArchived=false`,
        testUser
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      const taskIds = data.data.map((t: Task) => t.id);
      expect(taskIds).not.toContain(archivedTask.id);
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });
});
