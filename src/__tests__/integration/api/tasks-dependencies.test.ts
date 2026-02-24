import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/tasks/route";
import { db } from "@/lib/db";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";
import { createTestFeature } from "@/__tests__/support/factories/feature.factory";
import { createAuthenticatedGetRequest } from "@/__tests__/support/helpers/request-builders";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import { TaskStatus } from "@prisma/client";
import {
  expectSuccess,
} from "@/__tests__/support/helpers/api-assertions";

// Cleanup helper
async function cleanup(workspaceIds: string[], userIds: string[], featureIds: string[]) {
  await db.task.deleteMany({
    where: { workspaceId: { in: workspaceIds } },
  });
  await db.feature.deleteMany({
    where: { id: { in: featureIds } },
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

describe("GET /api/tasks - Dependencies and Feature Data", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: { id: string; slug: string };
  let testFeature: { id: string; title: string };

  beforeEach(async () => {
    testUser = await createTestUser({ name: "Test User" });
    testWorkspace = await createTestWorkspace({ ownerId: testUser.id });
    
    // Create a test feature using the factory helper
    testFeature = await createTestFeature({
      title: "Test Feature",
      brief: "Test feature for dependency testing",
      workspaceId: testWorkspace.id,
      createdById: testUser.id,
      updatedById: testUser.id,
    });
  });

  afterEach(async () => {
    await cleanup([testWorkspace.id], [testUser.id], [testFeature.id]);
  });

  test("API response includes dependsOnTaskIds array", async () => {
    // Create tasks with dependencies
    const task1 = await db.task.create({
      data: {
        id: generateUniqueId("task"),
        title: "Task 1",
        description: "First task",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
        status: TaskStatus.TODO,
      },
    });

    const task2 = await db.task.create({
      data: {
        id: generateUniqueId("task"),
        title: "Task 2",
        description: "Second task depends on task 1",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
        status: TaskStatus.TODO,
        dependsOnTaskIds: [task1.id],
      },
    });

    const request = createAuthenticatedGetRequest(
      `/api/tasks?workspaceId=${testWorkspace.id}&limit=10&showAllStatuses=true`,
      testUser
    );

    const response = await GET(request);
    

    
    const result = await expectSuccess(response);

    // Find task2 in the response
    const returnedTask2 = result.data.find((t: any) => t.id === task2.id);
    expect(returnedTask2).toBeDefined();
    expect(returnedTask2.dependsOnTaskIds).toBeDefined();
    expect(Array.isArray(returnedTask2.dependsOnTaskIds)).toBe(true);
    expect(returnedTask2.dependsOnTaskIds).toContain(task1.id);
    expect(returnedTask2.dependsOnTaskIds).toHaveLength(1);
  });

  test("API response includes feature object with id and title", async () => {
    // Create task linked to feature
    const task = await db.task.create({
      data: {
        id: generateUniqueId("task"),
        title: "Task with Feature",
        description: "Task linked to a feature",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
        status: TaskStatus.TODO,
        featureId: testFeature.id,
      },
    });

    const request = createAuthenticatedGetRequest(
      `/api/tasks?workspaceId=${testWorkspace.id}&limit=10&showAllStatuses=true`,
      testUser
    );

    const response = await GET(request);
    

    
    const result = await expectSuccess(response);

    // Find task in the response
    const returnedTask = result.data.find((t: any) => t.id === task.id);
    expect(returnedTask).toBeDefined();
    expect(returnedTask.feature).toBeDefined();
    expect(returnedTask.feature).toMatchObject({
      id: testFeature.id,
      title: testFeature.title,
    });
  });

  test("task without dependencies returns empty array", async () => {
    // Create task without dependencies
    const task = await db.task.create({
      data: {
        id: generateUniqueId("task"),
        title: "Independent Task",
        description: "Task with no dependencies",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
        status: TaskStatus.TODO,
      },
    });

    const request = createAuthenticatedGetRequest(
      `/api/tasks?workspaceId=${testWorkspace.id}&limit=10&showAllStatuses=true`,
      testUser
    );

    const response = await GET(request);
    

    
    const result = await expectSuccess(response);

    // Find task in the response
    const returnedTask = result.data.find((t: any) => t.id === task.id);
    expect(returnedTask).toBeDefined();
    expect(returnedTask.dependsOnTaskIds).toBeDefined();
    expect(Array.isArray(returnedTask.dependsOnTaskIds)).toBe(true);
    expect(returnedTask.dependsOnTaskIds).toHaveLength(0);
  });

  test("task without feature returns null for feature field", async () => {
    // Create task without feature
    const task = await db.task.create({
      data: {
        id: generateUniqueId("task"),
        title: "Task Without Feature",
        description: "Task not linked to any feature",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
        status: TaskStatus.TODO,
      },
    });

    const request = createAuthenticatedGetRequest(
      `/api/tasks?workspaceId=${testWorkspace.id}&limit=10&showAllStatuses=true`,
      testUser
    );

    const response = await GET(request);
    

    
    const result = await expectSuccess(response);

    // Find task in the response
    const returnedTask = result.data.find((t: any) => t.id === task.id);
    expect(returnedTask).toBeDefined();
    expect(returnedTask.feature).toBeNull();
  });

  test("task with multiple dependencies returns all dependency IDs", async () => {
    // Create multiple tasks for dependencies
    const task1 = await db.task.create({
      data: {
        id: generateUniqueId("task"),
        title: "Task 1",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
        status: TaskStatus.TODO,
      },
    });

    const task2 = await db.task.create({
      data: {
        id: generateUniqueId("task"),
        title: "Task 2",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
        status: TaskStatus.TODO,
      },
    });

    const task3 = await db.task.create({
      data: {
        id: generateUniqueId("task"),
        title: "Task 3 - Depends on 1 and 2",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
        status: TaskStatus.TODO,
        dependsOnTaskIds: [task1.id, task2.id],
      },
    });

    const request = createAuthenticatedGetRequest(
      `/api/tasks?workspaceId=${testWorkspace.id}&limit=10&showAllStatuses=true`,
      testUser
    );

    const response = await GET(request);
    

    
    const result = await expectSuccess(response);

    // Find task3 in the response
    const returnedTask3 = result.data.find((t: any) => t.id === task3.id);
    expect(returnedTask3).toBeDefined();
    expect(returnedTask3.dependsOnTaskIds).toBeDefined();
    expect(Array.isArray(returnedTask3.dependsOnTaskIds)).toBe(true);
    expect(returnedTask3.dependsOnTaskIds).toHaveLength(2);
    expect(returnedTask3.dependsOnTaskIds).toContain(task1.id);
    expect(returnedTask3.dependsOnTaskIds).toContain(task2.id);
  });

  test("combined test: task with both dependencies and feature", async () => {
    // Create task with dependency
    const task1 = await db.task.create({
      data: {
        id: generateUniqueId("task"),
        title: "Task 1",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
        status: TaskStatus.DONE,
      },
    });

    // Create task with both feature and dependency
    const task2 = await db.task.create({
      data: {
        id: generateUniqueId("task"),
        title: "Task 2 - With Feature and Dependency",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
        status: TaskStatus.IN_PROGRESS,
        featureId: testFeature.id,
        dependsOnTaskIds: [task1.id],
      },
    });

    const request = createAuthenticatedGetRequest(
      `/api/tasks?workspaceId=${testWorkspace.id}&limit=10&showAllStatuses=true`,
      testUser
    );

    const response = await GET(request);
    

    
    const result = await expectSuccess(response);

    // Find task2 in the response
    const returnedTask2 = result.data.find((t: any) => t.id === task2.id);
    expect(returnedTask2).toBeDefined();
    
    // Verify dependencies
    expect(returnedTask2.dependsOnTaskIds).toBeDefined();
    expect(returnedTask2.dependsOnTaskIds).toContain(task1.id);
    
    // Verify feature
    expect(returnedTask2.feature).toBeDefined();
    expect(returnedTask2.feature).toMatchObject({
      id: testFeature.id,
      title: testFeature.title,
    });
  });
});
