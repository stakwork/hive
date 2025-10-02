import { describe, test, expect, beforeEach } from "vitest";
import { POST as createTask } from "@/app/api/tasks/route";
import { GET as listTasks } from "@/app/api/tasks/route";
import { GET as getStats } from "@/app/api/tasks/stats/route";
import { GET as getMessages } from "@/app/api/tasks/[taskId]/messages/route";
import { PUT as updateTitle } from "@/app/api/tasks/[taskId]/title/route";
import { db } from "@/lib/db";
import { WorkflowStatus, User, Workspace } from "@prisma/client";
import {
  expectSuccess,
  generateUniqueId,
  createPostRequest,
  createGetRequest,
  getMockedSession,
  createAuthenticatedSession,
} from "@/__tests__/support/helpers";

describe("Task Lifecycle Integration Tests", () => {
  let testUser: User;
  let testWorkspace: Workspace;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      testUser = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `test-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      testWorkspace = await tx.workspace.create({
        data: {
          id: generateUniqueId("workspace"),
          name: "Test Workspace",
          slug: generateUniqueId("test-workspace"),
          description: "Test workspace for task lifecycle",
          ownerId: testUser.id,
        },
      });
    });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
  });

  test("complete task lifecycle: create → list → stats → messages → update title", async () => {
    const taskTitle = "Integration Test Task";
    const taskDescription = "Testing complete task lifecycle";

    const createRequest = createPostRequest("http://localhost:3000/api/tasks", {
      title: taskTitle,
      description: taskDescription,
      workspaceSlug: testWorkspace.slug,
    });
    
    const createResponse = await createTask(createRequest);
    const createResult = await expectSuccess(createResponse, 201);
    const createData = createResult.data;
    
    expect(createData.id).toBeDefined();
    expect(createData.title).toBe(taskTitle);
    expect(createData.description).toBe(taskDescription);
    expect(createData.workspaceId).toBe(testWorkspace.id);
    expect(createData.workflowStatus).toBe(WorkflowStatus.PENDING);

    const taskId = createData.id;

    const listRequest = createGetRequest(
      `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
    );
    const listResponse = await listTasks(listRequest);
    const listData = await expectSuccess(listResponse);
    
    expect(listData.data).toBeDefined();
    expect(Array.isArray(listData.data)).toBe(true);
    expect(listData.data.length).toBeGreaterThan(0);
    
    const createdTask = listData.data.find((t: unknown) => (t as { id: string }).id === taskId);
    expect(createdTask).toBeDefined();
    expect(createdTask.title).toBe(taskTitle);

    const statsRequest = createGetRequest(
      `http://localhost:3000/api/tasks/stats?workspaceId=${testWorkspace.id}`
    );
    const statsResponse = await getStats(statsRequest);
    const statsData = await expectSuccess(statsResponse);
    
    expect(statsData.data.total).toBeGreaterThan(0);
    expect(statsData.data.inProgress).toBeGreaterThanOrEqual(0);
    expect(statsData.data.waitingForInput).toBeGreaterThanOrEqual(0);

    const messagesRequest = createGetRequest(`http://localhost:3000/api/tasks/${taskId}/messages`);
    const messagesParams = Promise.resolve({ taskId });
    const messagesResponse = await getMessages(messagesRequest, { params: messagesParams });
    const messagesData = await expectSuccess(messagesResponse);
    
    expect(messagesData.data.task).toBeDefined();
    expect(messagesData.data.task.id).toBe(taskId);
    expect(messagesData.data.messages).toBeDefined();
    expect(Array.isArray(messagesData.data.messages)).toBe(true);
    expect(messagesData.data.count).toBe(0);

    const newTitle = "Updated Task Title";
    const updateRequest = createPostRequest(`http://localhost:3000/api/tasks/${taskId}/title`, {
      title: newTitle,
    });
    updateRequest.headers.set("x-api-token", process.env.API_TOKEN!);
    
    const updateParams = Promise.resolve({ taskId });
    const updateResponse = await updateTitle(updateRequest, { params: updateParams });
    const updateData = await expectSuccess(updateResponse);
    
    expect(updateData.success).toBe(true);
    expect(updateData.data.title).toBe(newTitle);
    expect(updateData.data.id).toBe(taskId);

    const verifyRequest = createGetRequest(
      `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
    );
    const verifyResponse = await listTasks(verifyRequest);
    const verifyData = await expectSuccess(verifyResponse);
    
    const updatedTask = verifyData.data.find((t: unknown) => (t as { id: string }).id === taskId);
    expect(updatedTask).toBeDefined();
    expect(updatedTask.title).toBe(newTitle);
  });

  test("task stats should reflect newly created tasks", async () => {
    const statsBeforeRequest = createGetRequest(
      `http://localhost:3000/api/tasks/stats?workspaceId=${testWorkspace.id}`
    );
    const statsBeforeResponse = await getStats(statsBeforeRequest);
    const statsBefore = await expectSuccess(statsBeforeResponse);
    
    const initialTotal = statsBefore.data.total;

    const createRequest = createPostRequest("http://localhost:3000/api/tasks", {
      title: "Stats Test Task",
      description: "Testing stats updates",
      workspaceSlug: testWorkspace.slug,
    });
    
    await createTask(createRequest);

    const statsAfterRequest = createGetRequest(
      `http://localhost:3000/api/tasks/stats?workspaceId=${testWorkspace.id}`
    );
    const statsAfterResponse = await getStats(statsAfterRequest);
    const statsAfter = await expectSuccess(statsAfterResponse);
    
    expect(statsAfter.data.total).toBe(initialTotal + 1);
  });

  test("task list pagination should work correctly", async () => {
    await Promise.all([
      createTask(createPostRequest("http://localhost:3000/api/tasks", {
        title: "Task 1",
        workspaceSlug: testWorkspace.slug,
      })),
      createTask(createPostRequest("http://localhost:3000/api/tasks", {
        title: "Task 2",
        workspaceSlug: testWorkspace.slug,
      })),
      createTask(createPostRequest("http://localhost:3000/api/tasks", {
        title: "Task 3",
        workspaceSlug: testWorkspace.slug,
      })),
    ]);

    const page1Request = createGetRequest(
      `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}&page=1&limit=2`
    );
    const page1Response = await listTasks(page1Request);
    const page1Data = await expectSuccess(page1Response);
    
    expect(page1Data.data.length).toBe(2);
    expect(page1Data.pagination.page).toBe(1);
    expect(page1Data.pagination.limit).toBe(2);
    expect(page1Data.pagination.totalCount).toBeGreaterThanOrEqual(3);

    const page2Request = createGetRequest(
      `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}&page=2&limit=2`
    );
    const page2Response = await listTasks(page2Request);
    const page2Data = await expectSuccess(page2Response);
    
    expect(page2Data.data.length).toBeGreaterThanOrEqual(1);
    expect(page2Data.pagination.page).toBe(2);
  });

  test("messages endpoint should return task and workspace info", async () => {
    const createRequest = createPostRequest("http://localhost:3000/api/tasks", {
      title: "Messages Test Task",
      description: "Testing messages endpoint",
      workspaceSlug: testWorkspace.slug,
    });
    
    const createResponse = await createTask(createRequest);
    const createResult = await expectSuccess(createResponse, 201);
    const taskId = createResult.data.id;

    const messagesRequest = createGetRequest(`http://localhost:3000/api/tasks/${taskId}/messages`);
    const messagesParams = Promise.resolve({ taskId });
    const messagesResponse = await getMessages(messagesRequest, { params: messagesParams });
    const messagesData = await expectSuccess(messagesResponse);
    
    expect(messagesData.data.task.id).toBe(taskId);
    expect(messagesData.data.task.title).toBe("Messages Test Task");
    expect(messagesData.data.task.workspaceId).toBe(testWorkspace.id);
    expect(messagesData.data.task.workflowStatus).toBe(WorkflowStatus.PENDING);
  });

  test("title updates should be reflected in subsequent list calls", async () => {
    const originalTitle = "Original Title";
    const updatedTitle = "Updated Title After Creation";

    const createRequest = createPostRequest("http://localhost:3000/api/tasks", {
      title: originalTitle,
      workspaceSlug: testWorkspace.slug,
    });
    
    const createResponse = await createTask(createRequest);
    const createResult = await expectSuccess(createResponse, 201);
    const taskId = createResult.data.id;

    const updateRequest = createPostRequest(`http://localhost:3000/api/tasks/${taskId}/title`, {
      title: updatedTitle,
    });
    updateRequest.headers.set("x-api-token", process.env.API_TOKEN!);
    
    const updateParams = Promise.resolve({ taskId });
    await updateTitle(updateRequest, { params: updateParams });

    const listRequest = createGetRequest(
      `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
    );
    const listResponse = await listTasks(listRequest);
    const listData = await expectSuccess(listResponse);
    
    const updatedTask = listData.data.find((t: unknown) => (t as { id: string }).id === taskId);
    expect(updatedTask).toBeDefined();
    expect(updatedTask.title).toBe(updatedTitle);
    expect(updatedTask.title).not.toBe(originalTitle);
  });
});
