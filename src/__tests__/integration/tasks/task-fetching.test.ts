import { NextRequest } from "next/server";
import { GET } from "@/app/api/tasks/route";
import { db } from "@/lib/db";
import { TaskStatus, Priority } from "@prisma/client";
import {
  createTestUser,
  createTestWorkspace,
  createTestWorkspaceMember,
  createTestTask,
  createTestRepository,
  cleanupDatabase,
  mockGetServerSession,
  mockNextRequest,
  expectSuccessResponse,
  expectErrorResponse,
  mockConsole,
} from "@/tests/utils/test-helpers";
import { mockUsers, mockWorkspaces, mockUrls } from "@/tests/utils/mock-data";

// Mock NextAuth - use real database for integration testing
jest.mock("next-auth/next");

describe("Task Fetching Integration Tests", () => {
  let testUser: any;
  let testWorkspace: any;
  let testRepository: any;
  let memberUser: any;
  let nonMemberUser: any;

  mockConsole();

  beforeAll(async () => {
    // Set up test data
    testUser = await createTestUser({
      id: mockUsers.owner.id,
      name: mockUsers.owner.name,
      email: mockUsers.owner.email,
    });

    memberUser = await createTestUser({
      id: mockUsers.member.id,
      name: mockUsers.member.name,
      email: mockUsers.member.email,
    });

    nonMemberUser = await createTestUser({
      id: mockUsers.nonMember.id,
      name: mockUsers.nonMember.name,
      email: mockUsers.nonMember.email,
    });

    testWorkspace = await createTestWorkspace(testUser.id, {
      id: mockWorkspaces.primary.id,
      name: mockWorkspaces.primary.name,
      slug: mockWorkspaces.primary.slug,
    });

    // Add member to workspace
    await createTestWorkspaceMember(testWorkspace.id, memberUser.id);

    testRepository = await createTestRepository(testWorkspace.id, {
      id: "test-repo-id",
      name: "Test Repository",
      repositoryUrl: "https://github.com/test/repo",
    });
  });

  afterAll(async () => {
    await cleanupDatabase();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Task List Fetching Workflow", () => {
    it("should fetch empty task list for workspace owner", async () => {
      mockGetServerSession({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      const request = mockNextRequest(mockUrls.getTasks(testWorkspace.id));
      const response = await GET(request);

      expectSuccessResponse(response, 200);
      expect(response.data.data).toEqual([]);
    });

    it("should fetch tasks with all relationships for workspace owner", async () => {
      // Create test tasks with different configurations
      const taskWithAssignee = await createTestTask({
        id: "task-with-assignee",
        title: "Task with Assignee",
        description: "Task assigned to member",
        workspaceId: testWorkspace.id,
        status: TaskStatus.TODO,
        priority: Priority.HIGH,
        assigneeId: memberUser.id,
        repositoryId: testRepository.id,
        createdById: testUser.id,
        estimatedHours: 4,
      });

      const taskWithoutAssignee = await createTestTask({
        id: "task-without-assignee",
        title: "Task without Assignee",
        description: "Unassigned task",
        workspaceId: testWorkspace.id,
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.MEDIUM,
        assigneeId: null,
        repositoryId: null,
        createdById: memberUser.id,
        estimatedHours: 2,
      });

      mockGetServerSession({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      const request = mockNextRequest(mockUrls.getTasks(testWorkspace.id));
      const response = await GET(request);

      expectSuccessResponse(response, 200);
      expect(response.data.data).toHaveLength(2);

      // Verify task with assignee and repository
      const fetchedTaskWithAssignee = response.data.data.find(
        (task: any) => task.id === taskWithAssignee.id
      );
      expect(fetchedTaskWithAssignee).toMatchObject({
        id: taskWithAssignee.id,
        title: taskWithAssignee.title,
        description: taskWithAssignee.description,
        status: TaskStatus.TODO,
        priority: Priority.HIGH,
        estimatedHours: 4,
        assignee: {
          id: memberUser.id,
          name: memberUser.name,
          email: memberUser.email,
        },
        repository: {
          id: testRepository.id,
          name: testRepository.name,
          repositoryUrl: testRepository.repositoryUrl,
        },
        createdBy: {
          id: testUser.id,
          name: testUser.name,
          email: testUser.email,
        },
        _count: {
          chatMessages: 0,
          comments: 0,
        },
      });

      // Verify task without assignee and repository
      const fetchedTaskWithoutAssignee = response.data.data.find(
        (task: any) => task.id === taskWithoutAssignee.id
      );
      expect(fetchedTaskWithoutAssignee).toMatchObject({
        id: taskWithoutAssignee.id,
        title: taskWithoutAssignee.title,
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.MEDIUM,
        assignee: null,
        repository: null,
        createdBy: {
          id: memberUser.id,
          name: memberUser.name,
          email: memberUser.email,
        },
      });

      // Cleanup tasks
      await db.task.deleteMany({ where: { workspaceId: testWorkspace.id } });
    });

    it("should fetch tasks for workspace member with proper authorization", async () => {
      // Create a task as workspace owner
      const task = await createTestTask({
        title: "Member Access Task",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      });

      // Member should be able to fetch tasks
      mockGetServerSession({
        user: { id: memberUser.id, name: memberUser.name, email: memberUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      const request = mockNextRequest(mockUrls.getTasks(testWorkspace.id));
      const response = await GET(request);

      expectSuccessResponse(response, 200);
      expect(response.data.data).toHaveLength(1);
      expect(response.data.data[0].id).toBe(task.id);

      // Cleanup
      await db.task.delete({ where: { id: task.id } });
    });

    it("should deny access for non-member users", async () => {
      mockGetServerSession({
        user: { id: nonMemberUser.id, name: nonMemberUser.name, email: nonMemberUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      const request = mockNextRequest(mockUrls.getTasks(testWorkspace.id));
      const response = await GET(request);

      expectErrorResponse(response, 403, "Access denied");
    });

    it("should exclude deleted tasks from results", async () => {
      // Create active and deleted tasks
      const activeTask = await createTestTask({
        id: "active-task",
        title: "Active Task",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      });

      const deletedTask = await db.task.create({
        data: {
          id: "deleted-task",
          title: "Deleted Task",
          workspaceId: testWorkspace.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: testUser.id,
          updatedById: testUser.id,
          deleted: true, // Mark as deleted
        },
      });

      mockGetServerSession({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      const request = mockNextRequest(mockUrls.getTasks(testWorkspace.id));
      const response = await GET(request);

      expectSuccessResponse(response, 200);
      expect(response.data.data).toHaveLength(1);
      expect(response.data.data[0].id).toBe(activeTask.id);
      expect(response.data.data.find((t: any) => t.id === deletedTask.id)).toBeUndefined();

      // Cleanup
      await db.task.deleteMany({ where: { workspaceId: testWorkspace.id } });
    });

    it("should return tasks ordered by creation date (newest first)", async () => {
      // Create tasks with slight delays to ensure different timestamps
      const task1 = await createTestTask({
        id: "task-1",
        title: "First Task",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      });

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      const task2 = await createTestTask({
        id: "task-2",
        title: "Second Task",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const task3 = await createTestTask({
        id: "task-3",
        title: "Third Task",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      });

      mockGetServerSession({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      const request = mockNextRequest(mockUrls.getTasks(testWorkspace.id));
      const response = await GET(request);

      expectSuccessResponse(response, 200);
      expect(response.data.data).toHaveLength(3);

      // Verify descending order (newest first)
      const taskIds = response.data.data.map((task: any) => task.id);
      expect(taskIds).toEqual([task3.id, task2.id, task1.id]);

      // Cleanup
      await db.task.deleteMany({ where: { workspaceId: testWorkspace.id } });
    });
  });

  describe("Complex Relationship Scenarios", () => {
    it("should handle tasks with complex workspace relationships", async () => {
      // Create a secondary workspace
      const secondaryWorkspace = await createTestWorkspace(testUser.id, {
        id: "secondary-workspace",
        name: "Secondary Workspace",
        slug: "secondary-workspace",
      });

      // Create tasks in both workspaces
      const primaryTask = await createTestTask({
        id: "primary-task",
        title: "Primary Workspace Task",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
      });

      const secondaryTask = await createTestTask({
        id: "secondary-task",
        title: "Secondary Workspace Task",
        workspaceId: secondaryWorkspace.id,
        createdById: testUser.id,
      });

      mockGetServerSession({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      // Fetch tasks from primary workspace - should only get primary task
      const request = mockNextRequest(mockUrls.getTasks(testWorkspace.id));
      const response = await GET(request);

      expectSuccessResponse(response, 200);
      expect(response.data.data).toHaveLength(1);
      expect(response.data.data[0].id).toBe(primaryTask.id);

      // Cleanup
      await db.task.deleteMany({ where: { workspaceId: testWorkspace.id } });
      await db.task.deleteMany({ where: { workspaceId: secondaryWorkspace.id } });
      await db.workspace.delete({ where: { id: secondaryWorkspace.id } });
    });

    it("should handle multiple assignees and repositories correctly", async () => {
      // Create additional test data
      const assigneeUser1 = await createTestUser({
        id: "assignee-1",
        name: "Assignee One",
        email: "assignee1@example.com",
      });

      const assigneeUser2 = await createTestUser({
        id: "assignee-2",
        name: "Assignee Two",
        email: "assignee2@example.com",
      });

      const repo1 = await createTestRepository(testWorkspace.id, {
        id: "repo-1",
        name: "Repository One",
        repositoryUrl: "https://github.com/test/repo1",
      });

      const repo2 = await createTestRepository(testWorkspace.id, {
        id: "repo-2",
        name: "Repository Two",
        repositoryUrl: "https://github.com/test/repo2",
      });

      // Create tasks with different assignees and repositories
      await createTestTask({
        id: "task-assignee-1",
        title: "Task Assignee 1",
        workspaceId: testWorkspace.id,
        assigneeId: assigneeUser1.id,
        repositoryId: repo1.id,
        createdById: testUser.id,
      });

      await createTestTask({
        id: "task-assignee-2",
        title: "Task Assignee 2",
        workspaceId: testWorkspace.id,
        assigneeId: assigneeUser2.id,
        repositoryId: repo2.id,
        createdById: testUser.id,
      });

      mockGetServerSession({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      const request = mockNextRequest(mockUrls.getTasks(testWorkspace.id));
      const response = await GET(request);

      expectSuccessResponse(response, 200);
      expect(response.data.data).toHaveLength(2);

      // Verify correct assignee and repository relationships
      const taskWithAssignee1 = response.data.data.find(
        (task: any) => task.assignee?.id === assigneeUser1.id
      );
      expect(taskWithAssignee1.repository.id).toBe(repo1.id);

      const taskWithAssignee2 = response.data.data.find(
        (task: any) => task.assignee?.id === assigneeUser2.id
      );
      expect(taskWithAssignee2.repository.id).toBe(repo2.id);

      // Cleanup
      await db.task.deleteMany({ where: { workspaceId: testWorkspace.id } });
      await db.repository.deleteMany({ where: { workspaceId: testWorkspace.id } });
      await db.user.deleteMany({ where: { id: { in: [assigneeUser1.id, assigneeUser2.id] } } });
    });
  });

  describe("Error Scenarios", () => {
    it("should handle database connection failures gracefully", async () => {
      mockGetServerSession({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      // Mock database failure
      const originalFindFirst = db.workspace.findFirst;
      (db.workspace.findFirst as jest.Mock) = jest
        .fn()
        .mockRejectedValue(new Error("Database connection failed"));

      const request = mockNextRequest(mockUrls.getTasks(testWorkspace.id));
      const response = await GET(request);

      expectErrorResponse(response, 500, "Failed to fetch tasks");

      // Restore original method
      db.workspace.findFirst = originalFindFirst;
    });

    it("should handle malformed workspace ID parameters", async () => {
      mockGetServerSession({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      const invalidWorkspaceId = "invalid-workspace-id";
      const request = mockNextRequest(mockUrls.getTasks(invalidWorkspaceId));
      const response = await GET(request);

      expectErrorResponse(response, 404, "Workspace not found");
    });
  });

  describe("Performance and Scale Testing", () => {
    it("should handle fetching large number of tasks efficiently", async () => {
      // Create many tasks to test performance
      const taskPromises = [];
      const taskCount = 50;

      for (let i = 0; i < taskCount; i++) {
        taskPromises.push(
          createTestTask({
            id: `bulk-task-${i}`,
            title: `Bulk Task ${i}`,
            workspaceId: testWorkspace.id,
            createdById: testUser.id,
            priority: i % 2 === 0 ? Priority.HIGH : Priority.LOW,
            status: i % 3 === 0 ? TaskStatus.DONE : TaskStatus.TODO,
          })
        );
      }

      await Promise.all(taskPromises);

      mockGetServerSession({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      const startTime = Date.now();
      const request = mockNextRequest(mockUrls.getTasks(testWorkspace.id));
      const response = await GET(request);
      const endTime = Date.now();

      expectSuccessResponse(response, 200);
      expect(response.data.data).toHaveLength(taskCount);

      // Performance assertion - should complete within reasonable time
      expect(endTime - startTime).toBeLessThan(1000); // 1 second

      // Verify all tasks are returned with proper relationships
      response.data.data.forEach((task: any) => {
        expect(task).toHaveProperty("id");
        expect(task).toHaveProperty("title");
        expect(task).toHaveProperty("createdBy");
        expect(task).toHaveProperty("_count");
      });

      // Cleanup
      await db.task.deleteMany({ where: { workspaceId: testWorkspace.id } });
    });
  });
});