import { describe, test, expect, vi } from "vitest";
import { GET as GET_TASKS } from "@/app/api/tasks/route";
import { GET as GET_TASK } from "@/app/api/task/[taskId]/route";
import { db } from "@/lib/db";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";
import { createGetRequest } from "@/__tests__/support/helpers/request-builders";
import {
  createAuthenticatedSession,
  getMockedSession,
} from "@/__tests__/support/helpers/auth";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

describe("GET /api/tasks - Summary Field Exclusion", () => {
  test("should not include summary field in task list response", async () => {
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

    // Create a task with summary
    const taskId = generateUniqueId("task");
    await db.task.create({
      data: {
        id: taskId,
        title: "Test Task",
        description: "Test description",
        summary: "## Task Complete\n\n- Fixed bug\n- Added tests",
        status: "IN_PROGRESS", // Non-TODO status so it shows up in results
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
      },
    });

    try {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `http://localhost/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const response = await GET_TASKS(request);

      expect(response.status).toBe(200);
      const responseData = await response.json();
      expect(responseData.success).toBe(true);
      expect(responseData.data).toBeDefined();
      expect(responseData.data.length).toBeGreaterThan(0);

      // Verify summary field is NOT included
      responseData.data.forEach((task: any) => {
        expect(task).not.toHaveProperty("summary");
      });

      // Verify other fields ARE included
      const task = responseData.data[0];
      expect(task).toHaveProperty("id");
      expect(task).toHaveProperty("title");
      expect(task).toHaveProperty("description");
    } finally {
      // Cleanup
      await db.task.deleteMany({ where: { workspaceId: testWorkspace.id } });
      await db.workspaceMember.deleteMany({
        where: { workspaceId: testWorkspace.id },
      });
      await db.workspace.deleteMany({ where: { id: testWorkspace.id } });
      await db.user.deleteMany({ where: { id: testUser.id } });
    }
  });
});

describe("GET /api/task/[taskId] - Summary Field Exclusion", () => {
  test("should not include summary field in single task response", async () => {
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

    // Create a task with summary
    const taskId = generateUniqueId("task");
    await db.task.create({
      data: {
        id: taskId,
        title: "Test Task",
        description: "Test description",
        summary: "## Task Complete\n\n- Fixed bug\n- Added tests",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
      },
    });

    try {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(`http://localhost/api/task/${taskId}`);

      const response = await GET_TASK(request, {
        params: Promise.resolve({ taskId }),
      });

      expect(response.status).toBe(200);
      const responseData = await response.json();
      expect(responseData.success).toBe(true);
      expect(responseData.data).toBeDefined();

      // Verify summary field is NOT included
      expect(responseData.data).not.toHaveProperty("summary");

      // Verify other fields ARE included
      expect(responseData.data).toHaveProperty("id");
      expect(responseData.data).toHaveProperty("title");
      expect(responseData.data).toHaveProperty("description");
      expect(responseData.data).toHaveProperty("workspaceId");
    } finally {
      // Cleanup
      await db.task.deleteMany({ where: { workspaceId: testWorkspace.id } });
      await db.workspaceMember.deleteMany({
        where: { workspaceId: testWorkspace.id },
      });
      await db.workspace.deleteMany({ where: { id: testWorkspace.id } });
      await db.user.deleteMany({ where: { id: testUser.id } });
    }
  });

  test("should not include summary field even when task has no summary", async () => {
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

    // Create a task without summary
    const taskId = generateUniqueId("task");
    await db.task.create({
      data: {
        id: taskId,
        title: "Test Task",
        description: "Test description",
        summary: null,
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
      },
    });

    try {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(`http://localhost/api/task/${taskId}`);

      const response = await GET_TASK(request, {
        params: Promise.resolve({ taskId }),
      });

      expect(response.status).toBe(200);
      const responseData = await response.json();
      expect(responseData.success).toBe(true);
      expect(responseData.data).toBeDefined();

      // Verify summary field is NOT included
      expect(responseData.data).not.toHaveProperty("summary");
    } finally {
      // Cleanup
      await db.task.deleteMany({ where: { workspaceId: testWorkspace.id } });
      await db.workspaceMember.deleteMany({
        where: { workspaceId: testWorkspace.id },
      });
      await db.workspace.deleteMany({ where: { id: testWorkspace.id } });
      await db.user.deleteMany({ where: { id: testUser.id } });
    }
  });
});
