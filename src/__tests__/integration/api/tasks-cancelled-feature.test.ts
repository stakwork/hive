import { describe, test, expect, vi } from "vitest";
import { GET } from "@/app/api/tasks/route";
import { db } from "@/lib/db";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";
import { createGetRequest } from "@/__tests__/support/helpers/request-builders";
import {
  createAuthenticatedSession,
  getMockedSession,
} from "@/__tests__/support/helpers/auth";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import { TaskStatus, WorkflowStatus } from "@prisma/client";
import { expectSuccess } from "@/__tests__/support/helpers/api-assertions";

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

async function createTestFeature(
  workspaceId: string,
  userId: string,
  options: { title: string; status?: string }
) {
  return db.feature.create({
    data: {
      id: generateUniqueId("feature"),
      title: options.title,
      status: (options.status as any) || "BACKLOG",
      workspaceId,
      createdById: userId,
      updatedById: userId,
    },
  });
}

async function createTestTask(
  workspaceId: string,
  userId: string,
  options: {
    title: string;
    featureId?: string | null;
    status?: TaskStatus;
  }
) {
  return db.task.create({
    data: {
      id: generateUniqueId("task"),
      title: options.title,
      workspaceId,
      createdById: userId,
      updatedById: userId,
      status: options.status || TaskStatus.IN_PROGRESS,
      workflowStatus: WorkflowStatus.PENDING,
      featureId: options.featureId ?? null,
    },
  });
}

async function cleanup(workspaceIds: string[], userIds: string[]) {
  await db.task.deleteMany({
    where: { workspaceId: { in: workspaceIds } },
  });
  await db.feature.deleteMany({
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

describe("GET /api/tasks - Cancelled Feature Filtering", () => {
  test("excludes tasks from cancelled features", async () => {
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

    const cancelledFeature = await createTestFeature(
      testWorkspace.id,
      testUser.id,
      { title: "Cancelled Feature", status: "CANCELLED" }
    );
    const activeFeature = await createTestFeature(
      testWorkspace.id,
      testUser.id,
      { title: "Active Feature", status: "IN_PROGRESS" }
    );

    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Task on cancelled feature",
      featureId: cancelledFeature.id,
    });
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Task on active feature",
      featureId: activeFeature.id,
    });
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Task with no feature",
      featureId: null,
    });

    try {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}&showAllStatuses=true`
      );
      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      const titles = data.data.map((t: any) => t.title);
      expect(titles).toContain("Task on active feature");
      expect(titles).toContain("Task with no feature");
      expect(titles).not.toContain("Task on cancelled feature");
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("works with search filter and cancelled feature exclusion", async () => {
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

    const cancelledFeature = await createTestFeature(
      testWorkspace.id,
      testUser.id,
      { title: "Cancelled Feature", status: "CANCELLED" }
    );

    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Searchable cancelled task",
      featureId: cancelledFeature.id,
    });
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Searchable active task",
      featureId: null,
    });

    try {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}&showAllStatuses=true&search=Searchable`
      );
      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      const titles = data.data.map((t: any) => t.title);
      expect(titles).toContain("Searchable active task");
      expect(titles).not.toContain("Searchable cancelled task");
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });

  test("works with visibility rules (Recent tab) and cancelled feature exclusion", async () => {
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace({ ownerId: testUser.id });

    const cancelledFeature = await createTestFeature(
      testWorkspace.id,
      testUser.id,
      { title: "Cancelled Feature", status: "CANCELLED" }
    );

    // IN_PROGRESS status passes visibility filter (non-TODO)
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Active visible task",
      featureId: null,
      status: TaskStatus.IN_PROGRESS,
    });
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Cancelled visible task",
      featureId: cancelledFeature.id,
      status: TaskStatus.IN_PROGRESS,
    });

    try {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // No showAllStatuses — triggers visibility OR rules (Recent tab)
      const request = createGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}`
      );
      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      const titles = data.data.map((t: any) => t.title);
      expect(titles).toContain("Active visible task");
      expect(titles).not.toContain("Cancelled visible task");
    } finally {
      await cleanup([testWorkspace.id], [testUser.id]);
    }
  });
});
