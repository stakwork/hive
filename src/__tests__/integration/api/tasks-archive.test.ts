import { describe, test, expect, vi } from "vitest";
import { PATCH } from "@/app/api/tasks/[taskId]/route";
import { GET } from "@/app/api/tasks/route";
import { db } from "@/lib/db";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import {
  createAuthenticatedPatchRequest,
  createGetRequest,
} from "@/__tests__/support/helpers/request-builders";
import {
  createAuthenticatedSession,
  getMockedSession,
} from "@/__tests__/support/helpers/auth";
import { generateUniqueSlug, generateUniqueId } from "@/__tests__/support/helpers/ids";
import type { User, Workspace, Task } from "@prisma/client";

// Mock NextAuth for GET tests that use auth
vi.mock("next-auth/next", () => ({
  auth: vi.fn(),
}));

vi.mock("@/auth", () => ({
  authOptions: {},
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
  options?: { archived?: boolean }
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
      archived: options?.archived || false,
      archivedAt: options?.archived ? new Date() : null,
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
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.task.archived).toBe(true);
      expect(data.task.archivedAt).toBeDefined();

      // Verify in database
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
        select: { archived: true, archivedAt: true },
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
        params: Promise.resolve({ taskId: archivedTask.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.task.archived).toBe(false);
      expect(data.task.archivedAt).toBeNull();

      // Verify in database
      const updatedTask = await db.task.findUnique({
        where: { id: archivedTask.id },
        select: { archived: true, archivedAt: true },
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
        params: Promise.resolve({ taskId: testTask.id }),
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
        params: Promise.resolve({ taskId: "non-existent-task-id" }),
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
      // Mock NextAuth session for GET request
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}`
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
      // Mock NextAuth session for GET request
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}&includeArchived=true`
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
      // Mock NextAuth session for GET request
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}&includeArchived=false`
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
