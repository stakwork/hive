import { describe, test, expect, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/tasks/route";
import { db } from "@/lib/db";
import { TaskStatus, Priority } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  expectNotFound,
  expectForbidden,
  generateUniqueId,
  generateUniqueSlug,
  createPostRequest,
  createGetRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import {
  createTestUser,
  createTestWorkspace,
  createTestRepository,
} from "@/__tests__/support/fixtures";

describe("Task API - Integration Tests", () => {
  beforeEach(() => {
    // Cleanup is handled by global integration test setup
  });

  describe("POST /api/tasks - Task Creation Flow", () => {
    test("should create task and persist to database", async () => {
      const { user, workspace } = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `test-${generateUniqueId()}@example.com`,
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            id: generateUniqueId("workspace"),
            name: "Test Workspace",
            slug: generateUniqueSlug("test-workspace"),
            ownerId: user.id,
          },
        });

        await tx.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: user.id,
            role: "OWNER",
          },
        });

        return { user, workspace };
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Integration Test Task",
        description: "Test description",
        workspaceSlug: workspace.slug,
        priority: "HIGH",
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      expect(data.data).toMatchObject({
        title: "Integration Test Task",
        description: "Test description",
        workspaceId: workspace.id,
        status: TaskStatus.TODO,
        priority: Priority.HIGH,
        createdById: user.id,
        updatedById: user.id,
      });

      // Verify database persistence
      const dbTask = await db.task.findUnique({
        where: { id: data.data.id },
      });

      expect(dbTask).toBeTruthy();
      expect(dbTask?.title).toBe("Integration Test Task");
      expect(dbTask?.deleted).toBe(false);
    });

    test("should create task with assignee and repository", async () => {
      const { user, workspace, assignee, repository } = await db.$transaction(
        async (tx) => {
          const user = await tx.user.create({
            data: {
              id: generateUniqueId("user"),
              email: `owner-${generateUniqueId()}@example.com`,
              name: "Owner User",
            },
          });

          const assignee = await tx.user.create({
            data: {
              id: generateUniqueId("assignee"),
              email: `assignee-${generateUniqueId()}@example.com`,
              name: "Assignee User",
            },
          });

          const workspace = await tx.workspace.create({
            data: {
              id: generateUniqueId("workspace"),
              name: "Test Workspace",
              slug: generateUniqueSlug("test-workspace"),
              ownerId: user.id,
            },
          });

          await tx.workspaceMember.create({
            data: {
              workspaceId: workspace.id,
              userId: user.id,
              role: "OWNER",
            },
          });

          const repository = await tx.repository.create({
            data: {
              id: generateUniqueId("repo"),
              name: "Test Repo",
              repositoryUrl: `https://github.com/test/repo-${generateUniqueId()}`,
              workspaceId: workspace.id,
            },
          });

          return { user, workspace, assignee, repository };
        }
      );

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Task with Relations",
        workspaceSlug: workspace.slug,
        assigneeId: assignee.id,
        repositoryId: repository.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      expect(data.data.assigneeId).toBe(assignee.id);
      expect(data.data.repositoryId).toBe(repository.id);
      expect(data.data.assignee).toMatchObject({
        id: assignee.id,
        name: assignee.name,
        email: assignee.email,
      });
      expect(data.data.repository).toMatchObject({
        id: repository.id,
        name: repository.name,
      });
    });

    test("should enforce audit trail fields", async () => {
      const { user, workspace } = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `test-${generateUniqueId()}@example.com`,
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            id: generateUniqueId("workspace"),
            name: "Test Workspace",
            slug: generateUniqueSlug("test-workspace"),
            ownerId: user.id,
          },
        });

        return { user, workspace };
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const beforeCreate = new Date();

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Audit Trail Test",
        workspaceSlug: workspace.slug,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      const afterCreate = new Date();

      expect(data.data.createdById).toBe(user.id);
      expect(data.data.updatedById).toBe(user.id);
      expect(new Date(data.data.createdAt).getTime()).toBeGreaterThanOrEqual(
        beforeCreate.getTime()
      );
      expect(new Date(data.data.createdAt).getTime()).toBeLessThanOrEqual(
        afterCreate.getTime()
      );
      expect(new Date(data.data.updatedAt).getTime()).toBeGreaterThanOrEqual(
        beforeCreate.getTime()
      );
    });

    test("should handle status mapping from active to IN_PROGRESS", async () => {
      const { user, workspace } = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `test-${generateUniqueId()}@example.com`,
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            id: generateUniqueId("workspace"),
            name: "Test Workspace",
            slug: generateUniqueSlug("test-workspace"),
            ownerId: user.id,
          },
        });

        return { user, workspace };
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Active Status Task",
        workspaceSlug: workspace.slug,
        status: "active",
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      expect(data.data.status).toBe(TaskStatus.IN_PROGRESS);

      // Verify in database
      const dbTask = await db.task.findUnique({
        where: { id: data.data.id },
      });
      expect(dbTask?.status).toBe(TaskStatus.IN_PROGRESS);
    });
  });

  describe("GET /api/tasks - Task Retrieval Flow", () => {
    test("should retrieve tasks with pagination", async () => {
      const { user, workspace, tasks } = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `test-${generateUniqueId()}@example.com`,
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            id: generateUniqueId("workspace"),
            name: "Test Workspace",
            slug: generateUniqueSlug("test-workspace"),
            ownerId: user.id,
          },
        });

        const tasks = await Promise.all(
          Array.from({ length: 12 }, async (_, i) => {
            return tx.task.create({
              data: {
                id: generateUniqueId(`task-${i}`),
                title: `Task ${i + 1}`,
                workspaceId: workspace.id,
                status: TaskStatus.TODO,
                createdById: user.id,
                updatedById: user.id,
              },
            });
          })
        );

        return { user, workspace, tasks };
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Test first page
      const request1 = createGetRequest("http://localhost:3000/api/tasks", {
        workspaceId: workspace.id,
        page: "1",
        limit: "5",
      });

      const response1 = await GET(request1);
      const data1 = await expectSuccess(response1, 200);

      expect(data1.data).toHaveLength(5);
      expect(data1.pagination).toMatchObject({
        page: 1,
        limit: 5,
        totalCount: 12,
        totalPages: 3,
        hasMore: true,
      });

      // Test second page
      const request2 = createGetRequest("http://localhost:3000/api/tasks", {
        workspaceId: workspace.id,
        page: "2",
        limit: "5",
      });

      const response2 = await GET(request2);
      const data2 = await expectSuccess(response2, 200);

      expect(data2.data).toHaveLength(5);
      expect(data2.pagination).toMatchObject({
        page: 2,
        hasMore: true,
      });

      // Test last page
      const request3 = createGetRequest("http://localhost:3000/api/tasks", {
        workspaceId: workspace.id,
        page: "3",
        limit: "5",
      });

      const response3 = await GET(request3);
      const data3 = await expectSuccess(response3, 200);

      expect(data3.data).toHaveLength(2);
      expect(data3.pagination).toMatchObject({
        page: 3,
        hasMore: false,
      });
    });

    test("should exclude soft-deleted tasks", async () => {
      const { user, workspace } = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `test-${generateUniqueId()}@example.com`,
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            id: generateUniqueId("workspace"),
            name: "Test Workspace",
            slug: generateUniqueSlug("test-workspace"),
            ownerId: user.id,
          },
        });

        // Create workspace member entry for proper access control  
        await tx.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: user.id,
            role: "OWNER",
          },
        });

        // Create active task
        await tx.task.create({
          data: {
            id: generateUniqueId("active-task"),
            title: "Active Task",
            workspaceId: workspace.id,
            status: TaskStatus.TODO,
            createdById: user.id,
            updatedById: user.id,
            deleted: false,
          },
        });

        // Create soft-deleted task
        await tx.task.create({
          data: {
            id: generateUniqueId("deleted-task"),
            title: "Deleted Task",
            workspaceId: workspace.id,
            status: TaskStatus.TODO,
            createdById: user.id,
            updatedById: user.id,
            deleted: true,
            deletedAt: new Date(),
          },
        });

        return { user, workspace };
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest("http://localhost:3000/api/tasks", {
        workspaceId: workspace.id,
      });

      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      expect(data.data).toHaveLength(1);
      expect(data.data[0].title).toBe("Active Task");
      expect(data.pagination.totalCount).toBe(1);
    });

    test("should enforce workspace access control for members", async () => {
      const { member, workspace } = await db.$transaction(async (tx) => {
        const owner = await tx.user.create({
          data: {
            id: generateUniqueId("owner"),
            email: `owner-${generateUniqueId()}@example.com`,
            name: "Owner User",
          },
        });

        const member = await tx.user.create({
          data: {
            id: generateUniqueId("member"),
            email: `member-${generateUniqueId()}@example.com`,
            name: "Member User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            id: generateUniqueId("workspace"),
            name: "Test Workspace",
            slug: generateUniqueSlug("test-workspace"),
            ownerId: owner.id,
          },
        });

        await tx.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: member.id,
            role: "DEVELOPER",
          },
        });

        await tx.task.create({
          data: {
            id: generateUniqueId("task"),
            title: "Test Task",
            workspaceId: workspace.id,
            status: TaskStatus.TODO,
            createdById: owner.id,
            updatedById: owner.id,
          },
        });

        return { member, workspace };
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(member));

      const request = createGetRequest("http://localhost:3000/api/tasks", {
        workspaceId: workspace.id,
      });

      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      expect(data.data).toHaveLength(1);
    });

    test("should deny access to non-members", async () => {
      const { nonMember, workspace } = await db.$transaction(async (tx) => {
        const owner = await tx.user.create({
          data: {
            id: generateUniqueId("owner"),
            email: `owner-${generateUniqueId()}@example.com`,
            name: "Owner User",
          },
        });

        const nonMember = await tx.user.create({
          data: {
            id: generateUniqueId("nonmember"),
            email: `nonmember-${generateUniqueId()}@example.com`,
            name: "Non-Member User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            id: generateUniqueId("workspace"),
            name: "Test Workspace",
            slug: generateUniqueSlug("test-workspace"),
            ownerId: owner.id,
          },
        });

        return { nonMember, workspace };
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(nonMember)
      );

      const request = createGetRequest("http://localhost:3000/api/tasks", {
        workspaceId: workspace.id,
      });

      const response = await GET(request);
      await expectForbidden(response);
    });
  });

  describe("Full Create-Retrieve Cycle", () => {
    test("should create task and retrieve it immediately", async () => {
      const { user, workspace } = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `test-${generateUniqueId()}@example.com`,
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            id: generateUniqueId("workspace"),
            name: "Test Workspace",
            slug: generateUniqueSlug("test-workspace"),
            ownerId: user.id,
          },
        });

        return { user, workspace };
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Create task
      const createRequest = createPostRequest(
        "http://localhost:3000/api/tasks",
        {
          title: "Cycle Test Task",
          description: "Test cycle",
          workspaceSlug: workspace.slug,
          priority: "HIGH",
        }
      );

      const createResponse = await POST(createRequest);
      const createData = await expectSuccess(createResponse, 201);

      const taskId = createData.data.id;

      // Retrieve task
      const getRequest = createGetRequest("http://localhost:3000/api/tasks", {
        workspaceId: workspace.id,
      });

      const getResponse = await GET(getRequest);
      const getData = await expectSuccess(getResponse, 200);

      const retrievedTask = getData.data.find((t: any) => t.id === taskId);

      expect(retrievedTask).toBeTruthy();
      expect(retrievedTask).toMatchObject({
        id: taskId,
        title: "Cycle Test Task",
        description: "Test cycle",
        priority: Priority.HIGH,
        status: TaskStatus.TODO,
      });
    });

    test("should maintain data integrity across operations", async () => {
      const { user, workspace } = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `test-${generateUniqueId()}@example.com`,
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            id: generateUniqueId("workspace"),
            name: "Test Workspace",
            slug: generateUniqueSlug("test-workspace"),
            ownerId: user.id,
          },
        });

        return { user, workspace };
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Create task
      const createRequest = createPostRequest(
        "http://localhost:3000/api/tasks",
        {
          title: "Integrity Test",
          description: "Testing data integrity",
          workspaceSlug: workspace.slug,
          priority: "CRITICAL",
          status: "TODO",
        }
      );

      const createResponse = await POST(createRequest);
      const createData = await expectSuccess(createResponse, 201);

      // Retrieve via API
      const getRequest = createGetRequest("http://localhost:3000/api/tasks", {
        workspaceId: workspace.id,
      });

      const getResponse = await GET(getRequest);
      const getData = await expectSuccess(getResponse, 200);

      const apiTask = getData.data.find(
        (t: any) => t.id === createData.data.id
      );

      // Retrieve via database
      const dbTask = await db.task.findUnique({
        where: { id: createData.data.id },
      });

      // Ensure we found the task in the API response
      expect(apiTask).toBeTruthy();
      expect(dbTask).toBeTruthy();

      // Verify consistency between API response and database
      expect(apiTask.title).toBe(dbTask?.title);
      expect(apiTask.description).toBe(dbTask?.description);
      expect(apiTask.status).toBe(dbTask?.status);
      expect(apiTask.priority).toBe(dbTask?.priority);
      
      // Verify data integrity in database
      expect(dbTask?.workspaceId).toBe(workspace.id);
      expect(dbTask?.createdById).toBe(user.id);
      
      // Note: GET API doesn't return createdById, but POST API does
      expect(apiTask.createdById).toBeUndefined();
    });
  });

  describe("Edge Cases and Boundary Conditions", () => {
    test("should handle workspace with no tasks", async () => {
      const { user, workspace } = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `test-${generateUniqueId()}@example.com`,
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            id: generateUniqueId("workspace"),
            name: "Empty Workspace",
            slug: generateUniqueSlug("empty-workspace"),
            ownerId: user.id,
          },
        });

        return { user, workspace };
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest("http://localhost:3000/api/tasks", {
        workspaceId: workspace.id,
      });

      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      expect(data.data).toEqual([]);
      expect(data.pagination).toMatchObject({
        totalCount: 0,
        totalPages: 0,
        hasMore: false,
      });
    });

    test("should handle maximum pagination limit", async () => {
      const { user, workspace } = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `test-${generateUniqueId()}@example.com`,
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            id: generateUniqueId("workspace"),
            name: "Test Workspace",
            slug: generateUniqueSlug("test-workspace"),
            ownerId: user.id,
          },
        });

        // Create 150 tasks
        await Promise.all(
          Array.from({ length: 150 }, async (_, i) => {
            return tx.task.create({
              data: {
                id: generateUniqueId(`task-${i}`),
                title: `Task ${i + 1}`,
                workspaceId: workspace.id,
                status: TaskStatus.TODO,
                createdById: user.id,
                updatedById: user.id,
              },
            });
          })
        );

        return { user, workspace };
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest("http://localhost:3000/api/tasks", {
        workspaceId: workspace.id,
        limit: "100",
      });

      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      expect(data.data).toHaveLength(100);
      expect(data.pagination.limit).toBe(100);
    });

    test("should reject limit exceeding maximum", async () => {
      const { user, workspace } = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `test-${generateUniqueId()}@example.com`,
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            id: generateUniqueId("workspace"),
            name: "Test Workspace",
            slug: generateUniqueSlug("test-workspace"),
            ownerId: user.id,
          },
        });

        return { user, workspace };
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest("http://localhost:3000/api/tasks", {
        workspaceId: workspace.id,
        limit: "200",
      });

      const response = await GET(request);
      await expectError(response, "Invalid pagination parameters", 400);
    });

    test("should handle task with null optional fields", async () => {
      const { user, workspace } = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `test-${generateUniqueId()}@example.com`,
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            id: generateUniqueId("workspace"),
            name: "Test Workspace",
            slug: generateUniqueSlug("test-workspace"),
            ownerId: user.id,
          },
        });

        return { user, workspace };
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/tasks", {
        title: "Minimal Task",
        workspaceSlug: workspace.slug,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      expect(data.data.description).toBeNull();
      expect(data.data.assigneeId).toBeNull();
      expect(data.data.repositoryId).toBeNull();
      expect(data.data.estimatedHours).toBeNull();
      expect(data.data.actualHours).toBeNull();
    });
  });
});