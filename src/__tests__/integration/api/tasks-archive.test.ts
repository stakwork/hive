import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { PATCH } from "@/app/api/tasks/[taskId]/route";
import { GET } from "@/app/api/tasks/route";
import { db } from "@/lib/db";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import {
  createAuthenticatedPatchRequest,
  createAuthenticatedGetRequest,
} from "@/__tests__/support/helpers/request-builders";
import { generateUniqueSlug, generateUniqueId } from "@/__tests__/support/helpers/ids";
import type { User, Workspace, Task } from "@prisma/client";

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
  let testUser: User;
  let testWorkspace: Workspace;
  let testTask: Task;

  beforeEach(async () => {
    // Create test user and workspace
    testUser = await createTestUser({ name: "Test User" });
    testWorkspace = await createTestWorkspace(testUser.id);
    testTask = await createTestTask(testWorkspace.id, testUser.id);
  });

  afterEach(async () => {
    await cleanup([testWorkspace.id], [testUser.id]);
  });

  test("should archive a task successfully", async () => {
    const request = createAuthenticatedPatchRequest(testUser.email!, {
      archived: true,
    });

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
  });

  test("should unarchive a task successfully", async () => {
    // First archive the task
    const archivedTask = await createTestTask(testWorkspace.id, testUser.id, {
      archived: true,
    });

    const request = createAuthenticatedPatchRequest(testUser.email!, {
      archived: false,
    });

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
  });

  test("should reject invalid archived value", async () => {
    const request = createAuthenticatedPatchRequest(testUser.email!, {
      archived: "invalid",
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: testTask.id }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Invalid archived value");
  });

  test("should return 404 for non-existent task", async () => {
    const request = createAuthenticatedPatchRequest(testUser.email!, {
      archived: true,
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ taskId: "non-existent-task-id" }),
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Task not found");
  });
});

describe("GET /api/tasks - Archive Filtering", () => {
  let testUser: User;
  let testWorkspace: Workspace;
  let recentTask: Task;
  let archivedTask: Task;

  beforeEach(async () => {
    // Create test user and workspace
    testUser = await createTestUser({ name: "Test User" });
    testWorkspace = await createTestWorkspace(testUser.id);

    // Create one recent and one archived task
    recentTask = await createTestTask(testWorkspace.id, testUser.id, {
      archived: false,
    });
    archivedTask = await createTestTask(testWorkspace.id, testUser.id, {
      archived: true,
    });
  });

  afterEach(async () => {
    await cleanup([testWorkspace.id], [testUser.id]);
  });

  test("should return only non-archived tasks by default", async () => {
    const request = createAuthenticatedGetRequest(
      testUser.email!,
      `/api/tasks?workspaceId=${testWorkspace.id}`
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data).toHaveLength(0); // Recent task is TODO status, which is filtered by default
  });

  test("should return only archived tasks when includeArchived=true", async () => {
    const request = createAuthenticatedGetRequest(
      testUser.email!,
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
  });

  test("should filter archived tasks from recent list", async () => {
    const request = createAuthenticatedGetRequest(
      testUser.email!,
      `/api/tasks?workspaceId=${testWorkspace.id}&includeArchived=false`
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    const taskIds = data.data.map((t: Task) => t.id);
    expect(taskIds).not.toContain(archivedTask.id);
  });
});
