import { describe, test, expect } from "vitest";
import { GET } from "@/app/api/tasks/route";
import { db } from "@/lib/db";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";
import { createAuthenticatedGetRequest } from "@/__tests__/support/helpers/request-builders";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import { TaskStatus, WorkflowStatus } from "@prisma/client";
import { expectSuccess } from "@/__tests__/support/helpers/api-assertions";

async function createTestFeature(
workspace_id: string,user_id: string,
  options: { title: string; status?: string }
) {
  return db.features.create({
    data: {
      id: generateUniqueId("feature"),
      title: options.title,
      status: (options.status as any) || "BACKLOG",
      workspaceId,created_by_id: userId,updated_by_id: userId,
    },
  });
}

async function createTestTask(
workspace_id: string,user_id: string,
  options: {
    title: string;
feature_id?: string | null;
    status?: TaskStatus;
  }
) {
  return db.tasks.create({
    data: {
      id: generateUniqueId("task"),
      title: options.title,
      workspaceId,created_by_id: userId,updated_by_id: userId,
      status: options.status || TaskStatus.IN_PROGRESS,workflow_status: WorkflowStatus.PENDING,feature_id: options.featureId ?? null,
    },
  });
}

async function cleanup(workspaceIds: string[], userIds: string[]) {
  await db.tasks.deleteMany({
    where: {workspace_id: { in: workspaceIds } },
  });
  await db.features.deleteMany({
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

describe("GET /api/tasks - Cancelled Feature Filtering", () => {
  test("excludes tasks from cancelled features", async () => {
    const testUser = await createTestUser({ name: "Test User" });
    const testWorkspace = await createTestWorkspace({owner_id: testUser.id });

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
      title: "Task on cancelled feature",feature_id: cancelledFeature.id,
    });
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Task on active feature",feature_id: activeFeature.id,
    });
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Task with no feature",feature_id: null,
    });

    try {
      const request = createAuthenticatedGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}&showAllStatuses=true`,
        testUser
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
    const testWorkspace = await createTestWorkspace({owner_id: testUser.id });

    const cancelledFeature = await createTestFeature(
      testWorkspace.id,
      testUser.id,
      { title: "Cancelled Feature", status: "CANCELLED" }
    );

    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Searchable cancelled task",feature_id: cancelledFeature.id,
    });
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Searchable active task",feature_id: null,
    });

    try {
      const request = createAuthenticatedGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}&showAllStatuses=true&search=Searchable`,
        testUser
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
    const testWorkspace = await createTestWorkspace({owner_id: testUser.id });

    const cancelledFeature = await createTestFeature(
      testWorkspace.id,
      testUser.id,
      { title: "Cancelled Feature", status: "CANCELLED" }
    );

    // IN_PROGRESS status passes visibility filter (non-TODO)
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Active visible task",feature_id: null,
      status: TaskStatus.IN_PROGRESS,
    });
    await createTestTask(testWorkspace.id, testUser.id, {
      title: "Cancelled visible task",feature_id: cancelledFeature.id,
      status: TaskStatus.IN_PROGRESS,
    });

    try {
      // No showAllStatuses — triggers visibility OR rules (Recent tab)
      const request = createAuthenticatedGetRequest(
        `/api/tasks?workspaceId=${testWorkspace.id}`,
        testUser
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
