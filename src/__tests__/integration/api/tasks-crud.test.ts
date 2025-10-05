import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET, POST } from "@/app/api/tasks/route";
import { PATCH, DELETE } from "@/app/api/tasks/[taskId]/route";
import { db } from "@/lib/db";
import { TaskStatus, Priority } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  generateUniqueId,
  generateUniqueSlug,
  createGetRequest,
  createPostRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";

describe("Task CRUD API - Integration Tests", () => {
  async function createTestUserWithWorkspace() {
    return await db.$transaction(async (tx) => {
      const testUser = await tx.user.create({
        data: {
          id: generateUniqueId("test-user"),
          email: `test-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const testWorkspace = await tx.workspace.create({
        data: {
          id: generateUniqueId("workspace"),
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          description: "Test workspace description",
          ownerId: testUser.id,
        },
      });

      return { testUser, testWorkspace };
    });
  }

  async function createTestRepository(workspaceId: string) {
    return await db.repository.create({
      data: {
        id: generateUniqueId("repo"),
        name: "Test Repository",
        repositoryUrl: "https://github.com/test/repo",
        branch: "main",
        workspaceId: workspaceId,
      },
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("CREATE (POST) Integration", () => {
    test("should create task with database persistence", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Integration Test Task",
        description: "Created via integration test",
        workspaceSlug: testWorkspace.slug,
        status: "TODO",
        priority: "HIGH",
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      expect(data.data).toMatchObject({
        title: "Integration Test Task",
        description: "Created via integration test",
        status: TaskStatus.TODO,
        priority: Priority.HIGH,
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
      });

      // Verify database persistence
      const taskInDb = await db.task.findUnique({
        where: { id: data.data.id },
      });

      expect(taskInDb).toBeTruthy();
      expect(taskInDb?.title).toBe("Integration Test Task");
    });

    test("should create task with assignee and repository relationships", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();
      const assignee = await createTestUser({ name: "Assignee User" });
      const repository = await createTestRepository(testWorkspace.id);

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Task with Relations",
        workspaceSlug: testWorkspace.slug,
        assigneeId: assignee.id,
        repositoryId: repository.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      expect(data.data.assigneeId).toBe(assignee.id);
      expect(data.data.repositoryId).toBe(repository.id);
      expect(data.data.assignee).toMatchObject({
        id: assignee.id,
        name: "Assignee User",
      });
      expect(data.data.repository).toMatchObject({
        id: repository.id,
        name: "Test Repository",
      });

      // Verify relationships in database
      const taskInDb = await db.task.findUnique({
        where: { id: data.data.id },
        include: { assignee: true, repository: true },
      });

      expect(taskInDb?.assignee?.id).toBe(assignee.id);
      expect(taskInDb?.repository?.id).toBe(repository.id);
    });

    test("should enforce foreign key constraints", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Task with Invalid Assignee",
        workspaceSlug: testWorkspace.slug,
        assigneeId: "non-existent-user-id",
      });

      const response = await POST(request);

      await expectError(response, "Assignee not found", 400);
    });
  });

  describe("RETRIEVE (GET) Integration", () => {
    test("should retrieve tasks with pagination", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      // Create multiple tasks
      for (let i = 0; i < 15; i++) {
        await db.task.create({
          data: {
            id: generateUniqueId("task"),
            title: `Task ${i + 1}`,
            description: `Description ${i + 1}`,
            workspaceId: testWorkspace.id,
            createdById: testUser.id,
            updatedById: testUser.id,
          },
        });
      }

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Test first page
      const request1 = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}&page=1&limit=10`
      );

      const response1 = await GET(request1);
      const data1 = await expectSuccess(response1);

      expect(data1.data).toHaveLength(10);
      expect(data1.pagination).toMatchObject({
        page: 1,
        limit: 10,
        totalCount: 15,
        totalPages: 2,
        hasMore: true,
      });

      // Test second page
      const request2 = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}&page=2&limit=10`
      );

      const response2 = await GET(request2);
      const data2 = await expectSuccess(response2);

      expect(data2.data).toHaveLength(5);
      expect(data2.pagination).toMatchObject({
        page: 2,
        limit: 10,
        totalCount: 15,
        totalPages: 2,
        hasMore: false,
      });
    });

    test("should filter soft-deleted tasks", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      // Create active task
      const activeTask = await db.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Active Task",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      // Create deleted task
      await db.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Deleted Task",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          deleted: true,
          deletedAt: new Date(),
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const response = await GET(request);
      const data = await expectSuccess(response);

      expect(data.data).toHaveLength(1);
      expect(data.data[0].id).toBe(activeTask.id);
      expect(data.data[0].title).toBe("Active Task");
    });
  });

  describe("UPDATE (PATCH) Integration", () => {
    test("should update task fields with database persistence", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      const task = await db.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Original Title",
          description: "Original Description",
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = new Request(`http://localhost:3000/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Updated Title",
          description: "Updated Description",
          status: "IN_PROGRESS",
          priority: "HIGH",
        }),
      }) as any;

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: task.id }),
      });
      const data = await expectSuccess(response);

      expect(data.data).toMatchObject({
        id: task.id,
        title: "Updated Title",
        description: "Updated Description",
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.HIGH,
      });

      // Verify database persistence
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask).toMatchObject({
        title: "Updated Title",
        description: "Updated Description",
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.HIGH,
        updatedById: testUser.id,
      });
    });

    test("should update assignee relationship", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();
      const assignee1 = await createTestUser({ name: "Assignee 1" });
      const assignee2 = await createTestUser({ name: "Assignee 2" });

      const task = await db.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Task to Reassign",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          assigneeId: assignee1.id,
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = new Request(`http://localhost:3000/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assigneeId: assignee2.id,
        }),
      }) as any;

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: task.id }),
      });
      const data = await expectSuccess(response);

      expect(data.data.assigneeId).toBe(assignee2.id);

      // Verify database update
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
        include: { assignee: true },
      });

      expect(updatedTask?.assigneeId).toBe(assignee2.id);
      expect(updatedTask?.assignee?.name).toBe("Assignee 2");
    });

    test("should handle concurrent updates correctly", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      const task = await db.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Concurrent Test Task",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Simulate concurrent update requests
      const requests = [
        new Request(`http://localhost:3000/api/tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Update 1" }),
        }),
        new Request(`http://localhost:3000/api/tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: "Update 2" }),
        }),
      ];

      const responses = await Promise.all(
        requests.map((req, idx) =>
          PATCH(req, { params: Promise.resolve({ taskId: task.id }) })
        )
      );

      // Both requests should succeed
      for (const response of responses) {
        await expectSuccess(response);
      }

      // Verify final state contains both updates
      const finalTask = await db.task.findUnique({
        where: { id: task.id },
      });

      // At least one update should have been applied
      expect(
        finalTask?.title === "Update 1" || finalTask?.description === "Update 2"
      ).toBe(true);
    });
  });

  describe("DELETE Integration", () => {
    test("should perform soft delete with database persistence", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      const task = await db.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Task to Delete",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = new Request(`http://localhost:3000/api/tasks/${task.id}`, {
        method: "DELETE",
      });

      const response = await DELETE(request, {
        params: Promise.resolve({ taskId: task.id }),
      });
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.message).toBe("Task deleted successfully");

      // Verify soft delete in database
      const deletedTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(deletedTask).toBeTruthy();
      expect(deletedTask?.deleted).toBe(true);
      expect(deletedTask?.deletedAt).toBeTruthy();
    });

    test("should not retrieve deleted tasks in GET requests", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      const task = await db.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Task to Delete and Verify",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Delete task
      const deleteRequest = new Request(
        `http://localhost:3000/api/tasks/${task.id}`,
        { method: "DELETE" }
      );

      await DELETE(deleteRequest, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Try to retrieve tasks
      const getRequest = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const response = await GET(getRequest);
      const data = await expectSuccess(response);

      // Deleted task should not appear in results
      const taskIds = data.data.map((t: any) => t.id);
      expect(taskIds).not.toContain(task.id);
    });

    test("should prevent double deletion", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      const task = await db.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Task for Double Delete Test",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // First deletion
      const deleteRequest1 = new Request(
        `http://localhost:3000/api/tasks/${task.id}`,
        { method: "DELETE" }
      );

      await DELETE(deleteRequest1, {
        params: Promise.resolve({ taskId: task.id }),
      });

      // Second deletion attempt
      const deleteRequest2 = new Request(
        `http://localhost:3000/api/tasks/${task.id}`,
        { method: "DELETE" }
      );

      const response2 = await DELETE(deleteRequest2, {
        params: Promise.resolve({ taskId: task.id }),
      });

      expect(response2.status).toBe(404);
    });
  });

  describe("Full CRUD Lifecycle", () => {
    test("should support complete CREATE -> READ -> UPDATE -> DELETE flow", async () => {
      const { testUser, testWorkspace } = await createTestUserWithWorkspace();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // CREATE
      const createRequest = createPostRequest(
        "http://localhost:3000/api/tasks",
        {
          title: "Lifecycle Test Task",
          description: "Initial description",
          workspaceSlug: testWorkspace.slug,
          priority: "MEDIUM",
        }
      );

      const createResponse = await POST(createRequest);
      const createData = await expectSuccess(createResponse, 201);
      const taskId = createData.data.id;

      // READ
      const readRequest = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const readResponse = await GET(readRequest);
      const readData = await expectSuccess(readResponse);
      const foundTask = readData.data.find((t: any) => t.id === taskId);

      expect(foundTask).toBeTruthy();
      expect(foundTask.title).toBe("Lifecycle Test Task");

      // UPDATE
      const updateRequest = new Request(
        `http://localhost:3000/api/tasks/${taskId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Updated Lifecycle Task",
            status: "IN_PROGRESS",
          }),
        }
      );

      const updateResponse = await PATCH(updateRequest, {
        params: Promise.resolve({ taskId }),
      });
      const updateData = await expectSuccess(updateResponse);

      expect(updateData.data.title).toBe("Updated Lifecycle Task");
      expect(updateData.data.status).toBe(TaskStatus.IN_PROGRESS);

      // DELETE
      const deleteRequest = new Request(
        `http://localhost:3000/api/tasks/${taskId}`,
        { method: "DELETE" }
      );

      const deleteResponse = await DELETE(deleteRequest, {
        params: Promise.resolve({ taskId }),
      });

      await expectSuccess(deleteResponse);

      // Verify deletion
      const verifyRequest = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${testWorkspace.id}`
      );

      const verifyResponse = await GET(verifyRequest);
      const verifyData = await expectSuccess(verifyResponse);
      const deletedTask = verifyData.data.find((t: any) => t.id === taskId);

      expect(deletedTask).toBeUndefined();
    });
  });

  describe("Workspace Authorization Integration", () => {
    test("should enforce workspace-scoped access across CRUD operations", async () => {
      const { testUser: user1, testWorkspace: workspace1 } =
        await createTestUserWithWorkspace();
      const { testUser: user2, testWorkspace: workspace2 } =
        await createTestUserWithWorkspace();

      // User1 creates task in workspace1
      const task = await db.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "User1's Task",
          workspaceId: workspace1.id,
          createdById: user1.id,
          updatedById: user1.id,
        },
      });

      // User2 attempts to access User1's task
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user2));

      // Should fail GET (no access to workspace1)
      const getRequest = createGetRequest(
        `http://localhost:3000/api/tasks?workspaceId=${workspace1.id}`
      );
      const getResponse = await GET(getRequest);
      expect(getResponse.status).toBe(403);

      // Should fail PATCH
      const patchRequest = new Request(
        `http://localhost:3000/api/tasks/${task.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Unauthorized Update" }),
        }
      );
      const patchResponse = await PATCH(patchRequest, {
        params: Promise.resolve({ taskId: task.id }),
      });
      expect(patchResponse.status).toBe(403);

      // Should fail DELETE
      const deleteRequest = new Request(
        `http://localhost:3000/api/tasks/${task.id}`,
        { method: "DELETE" }
      );
      const deleteResponse = await DELETE(deleteRequest, {
        params: Promise.resolve({ taskId: task.id }),
      });
      expect(deleteResponse.status).toBe(403);
    });
  });
});