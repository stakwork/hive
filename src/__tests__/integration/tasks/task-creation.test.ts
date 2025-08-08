import { NextRequest } from "next/server";
import { POST } from "@/app/api/tasks/route";
import { db } from "@/lib/db";
import { TaskStatus, Priority } from "@prisma/client";
import {
  createTestUser,
  createTestWorkspace,
  createTestWorkspaceMember,
  createTestRepository,
  cleanupDatabase,
  mockGetServerSession,
  mockRequestWithBody,
  expectSuccessResponse,
  expectErrorResponse,
  mockConsole,
} from "@/tests/utils/test-helpers";
import { mockUsers, mockWorkspaces, mockTaskPayloads } from "@/tests/utils/mock-data";

// Mock NextAuth - use real database for integration testing
jest.mock("next-auth/next");

describe("Task Creation Integration Tests", () => {
  let testUser: any;
  let testWorkspace: any;
  let testRepository: any;
  let memberUser: any;
  let nonMemberUser: any;
  let assigneeUser: any;

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

    assigneeUser = await createTestUser({
      id: mockUsers.assignee.id,
      name: mockUsers.assignee.name,
      email: mockUsers.assignee.email,
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

  describe("Basic Task Creation Workflow", () => {
    it("should create minimal task for workspace owner", async () => {
      mockGetServerSession({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      const payload = {
        title: "Integration Test Task",
        workspaceSlug: testWorkspace.slug,
      };

      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      const response = await POST(request);

      expectSuccessResponse(response, 201);

      // Verify task was created in database
      const createdTask = await db.task.findFirst({
        where: {
          title: "Integration Test Task",
          workspaceId: testWorkspace.id,
        },
        include: {
          assignee: true,
          repository: true,
          createdBy: true,
          workspace: true,
        },
      });

      expect(createdTask).not.toBeNull();
      expect(createdTask?.title).toBe("Integration Test Task");
      expect(createdTask?.workspaceId).toBe(testWorkspace.id);
      expect(createdTask?.status).toBe(TaskStatus.TODO);
      expect(createdTask?.priority).toBe(Priority.MEDIUM);
      expect(createdTask?.createdById).toBe(testUser.id);
      expect(createdTask?.assigneeId).toBeNull();
      expect(createdTask?.repositoryId).toBeNull();

      // Verify response includes all expected relationships
      expect(response.data.data).toMatchObject({
        title: "Integration Test Task",
        workspace: {
          id: testWorkspace.id,
          name: testWorkspace.name,
          slug: testWorkspace.slug,
        },
        createdBy: {
          id: testUser.id,
          name: testUser.name,
          email: testUser.email,
        },
      });

      // Cleanup
      if (createdTask) {
        await db.task.delete({ where: { id: createdTask.id } });
      }
    });

    it("should create complete task with all fields for workspace member", async () => {
      mockGetServerSession({
        user: { id: memberUser.id, name: memberUser.name, email: memberUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      const payload = {
        title: "Complete Integration Task",
        description: "A complete task with all fields filled",
        workspaceSlug: testWorkspace.slug,
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.HIGH,
        assigneeId: assigneeUser.id,
        repositoryId: testRepository.id,
        estimatedHours: 8,
        actualHours: null,
      };

      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      const response = await POST(request);

      expectSuccessResponse(response, 201);

      // Verify task was created with all fields
      const createdTask = await db.task.findFirst({
        where: {
          title: "Complete Integration Task",
          workspaceId: testWorkspace.id,
        },
        include: {
          assignee: true,
          repository: true,
          createdBy: true,
        },
      });

      expect(createdTask).not.toBeNull();
      expect(createdTask).toMatchObject({
        title: "Complete Integration Task",
        description: "A complete task with all fields filled",
        workspaceId: testWorkspace.id,
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.HIGH,
        assigneeId: assigneeUser.id,
        repositoryId: testRepository.id,
        estimatedHours: 8,
        actualHours: null,
        createdById: memberUser.id,
      });

      // Verify relationships are properly included in response
      expect(response.data.data).toMatchObject({
        assignee: {
          id: assigneeUser.id,
          name: assigneeUser.name,
          email: assigneeUser.email,
        },
        repository: {
          id: testRepository.id,
          name: testRepository.name,
          repositoryUrl: testRepository.repositoryUrl,
        },
        createdBy: {
          id: memberUser.id,
          name: memberUser.name,
          email: memberUser.email,
        },
      });

      // Cleanup
      if (createdTask) {
        await db.task.delete({ where: { id: createdTask.id } });
      }
    });

    it("should handle 'active' status mapping to IN_PROGRESS", async () => {
      mockGetServerSession({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      const payload = {
        title: "Active Status Task",
        workspaceSlug: testWorkspace.slug,
        status: "active", // Should be mapped to IN_PROGRESS
      };

      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      const response = await POST(request);

      expectSuccessResponse(response, 201);

      // Verify task was created with IN_PROGRESS status
      const createdTask = await db.task.findFirst({
        where: {
          title: "Active Status Task",
          workspaceId: testWorkspace.id,
        },
      });

      expect(createdTask).not.toBeNull();
      expect(createdTask?.status).toBe(TaskStatus.IN_PROGRESS);

      // Cleanup
      if (createdTask) {
        await db.task.delete({ where: { id: createdTask.id } });
      }
    });
  });

  describe("Authorization Workflow Tests", () => {
    it("should deny task creation for non-workspace members", async () => {
      mockGetServerSession({
        user: { id: nonMemberUser.id, name: nonMemberUser.name, email: nonMemberUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      const payload = {
        title: "Unauthorized Task",
        workspaceSlug: testWorkspace.slug,
      };

      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      const response = await POST(request);

      expectErrorResponse(response, 403, "Access denied");

      // Verify task was not created
      const createdTask = await db.task.findFirst({
        where: {
          title: "Unauthorized Task",
          workspaceId: testWorkspace.id,
        },
      });

      expect(createdTask).toBeNull();
    });

    it("should allow both owner and member to create tasks", async () => {
      const ownerTaskTitle = "Owner Created Task";
      const memberTaskTitle = "Member Created Task";

      // Test owner creation
      mockGetServerSession({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      let request = mockRequestWithBody("http://localhost:3000/api/tasks", {
        title: ownerTaskTitle,
        workspaceSlug: testWorkspace.slug,
      });
      let response = await POST(request);
      expectSuccessResponse(response, 201);

      // Test member creation
      mockGetServerSession({
        user: { id: memberUser.id, name: memberUser.name, email: memberUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      request = mockRequestWithBody("http://localhost:3000/api/tasks", {
        title: memberTaskTitle,
        workspaceSlug: testWorkspace.slug,
      });
      response = await POST(request);
      expectSuccessResponse(response, 201);

      // Verify both tasks were created
      const ownerTask = await db.task.findFirst({
        where: { title: ownerTaskTitle, workspaceId: testWorkspace.id },
      });
      const memberTask = await db.task.findFirst({
        where: { title: memberTaskTitle, workspaceId: testWorkspace.id },
      });

      expect(ownerTask).not.toBeNull();
      expect(memberTask).not.toBeNull();
      expect(ownerTask?.createdById).toBe(testUser.id);
      expect(memberTask?.createdById).toBe(memberUser.id);

      // Cleanup
      await db.task.deleteMany({
        where: {
          title: { in: [ownerTaskTitle, memberTaskTitle] },
          workspaceId: testWorkspace.id,
        },
      });
    });
  });

  describe("Validation Workflow Tests", () => {
    beforeEach(() => {
      mockGetServerSession({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });
    });

    it("should reject task creation with non-existent assignee", async () => {
      const payload = {
        title: "Task with Bad Assignee",
        workspaceSlug: testWorkspace.slug,
        assigneeId: "non-existent-user-id",
      };

      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      const response = await POST(request);

      expectErrorResponse(response, 400, "Assignee not found");

      // Verify task was not created
      const createdTask = await db.task.findFirst({
        where: {
          title: "Task with Bad Assignee",
          workspaceId: testWorkspace.id,
        },
      });

      expect(createdTask).toBeNull();
    });

    it("should reject task creation with repository from different workspace", async () => {
      // Create a repository in a different workspace
      const otherWorkspace = await createTestWorkspace(testUser.id, {
        id: "other-workspace-id",
        name: "Other Workspace",
        slug: "other-workspace",
      });

      const otherRepository = await createTestRepository(otherWorkspace.id, {
        id: "other-repo-id",
        name: "Other Repository",
        repositoryUrl: "https://github.com/other/repo",
      });

      const payload = {
        title: "Task with Wrong Repository",
        workspaceSlug: testWorkspace.slug,
        repositoryId: otherRepository.id, // Repository from different workspace
      };

      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      const response = await POST(request);

      expectErrorResponse(response, 400, "Repository not found or does not belong to this workspace");

      // Verify task was not created
      const createdTask = await db.task.findFirst({
        where: {
          title: "Task with Wrong Repository",
          workspaceId: testWorkspace.id,
        },
      });

      expect(createdTask).toBeNull();

      // Cleanup other workspace and repository
      await db.repository.delete({ where: { id: otherRepository.id } });
      await db.workspace.delete({ where: { id: otherWorkspace.id } });
    });

    it("should reject invalid status and priority values", async () => {
      // Test invalid status
      let payload = {
        title: "Invalid Status Task",
        workspaceSlug: testWorkspace.slug,
        status: "invalid-status",
      };

      let request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      let response = await POST(request);

      expectErrorResponse(response, 400);
      expect(response.data.error).toContain("Invalid status");

      // Test invalid priority
      payload = {
        title: "Invalid Priority Task",
        workspaceSlug: testWorkspace.slug,
        priority: "invalid-priority",
      };

      request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      response = await POST(request);

      expectErrorResponse(response, 400);
      expect(response.data.error).toContain("Invalid priority");

      // Verify no tasks were created
      const createdTasks = await db.task.findMany({
        where: {
          title: { in: ["Invalid Status Task", "Invalid Priority Task"] },
          workspaceId: testWorkspace.id,
        },
      });

      expect(createdTasks).toHaveLength(0);
    });

    it("should handle text trimming and null description properly", async () => {
      const payload = {
        title: "   Task with Whitespace   ",
        description: "   Description with whitespace   ",
        workspaceSlug: testWorkspace.slug,
      };

      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      const response = await POST(request);

      expectSuccessResponse(response, 201);

      // Verify task was created with trimmed text
      const createdTask = await db.task.findFirst({
        where: {
          title: "Task with Whitespace",
          workspaceId: testWorkspace.id,
        },
      });

      expect(createdTask).not.toBeNull();
      expect(createdTask?.title).toBe("Task with Whitespace");
      expect(createdTask?.description).toBe("Description with whitespace");

      // Test empty description becomes null
      const payloadEmptyDesc = {
        title: "Task with Empty Description",
        description: "",
        workspaceSlug: testWorkspace.slug,
      };

      const requestEmptyDesc = mockRequestWithBody("http://localhost:3000/api/tasks", payloadEmptyDesc);
      const responseEmptyDesc = await POST(requestEmptyDesc);

      expectSuccessResponse(responseEmptyDesc, 201);

      const taskEmptyDesc = await db.task.findFirst({
        where: {
          title: "Task with Empty Description",
          workspaceId: testWorkspace.id,
        },
      });

      expect(taskEmptyDesc?.description).toBeNull();

      // Cleanup
      await db.task.deleteMany({
        where: {
          title: { in: ["Task with Whitespace", "Task with Empty Description"] },
          workspaceId: testWorkspace.id,
        },
      });
    });
  });

  describe("Complex Integration Scenarios", () => {
    it("should handle concurrent task creation", async () => {
      mockGetServerSession({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      // Create multiple tasks concurrently
      const taskPromises = Array.from({ length: 5 }, (_, i) => {
        const payload = {
          title: `Concurrent Task ${i}`,
          workspaceSlug: testWorkspace.slug,
          priority: i % 2 === 0 ? Priority.HIGH : Priority.LOW,
        };
        const request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
        return POST(request);
      });

      const responses = await Promise.all(taskPromises);

      // Verify all tasks were created successfully
      responses.forEach((response, index) => {
        expectSuccessResponse(response, 201);
        expect(response.data.data.title).toBe(`Concurrent Task ${index}`);
      });

      // Verify all tasks exist in database
      const createdTasks = await db.task.findMany({
        where: {
          title: { startsWith: "Concurrent Task" },
          workspaceId: testWorkspace.id,
        },
      });

      expect(createdTasks).toHaveLength(5);

      // Cleanup
      await db.task.deleteMany({
        where: {
          title: { startsWith: "Concurrent Task" },
          workspaceId: testWorkspace.id,
        },
      });
    });

    it("should handle task creation with complex workspace membership changes", async () => {
      // Create a user who will be added/removed from workspace
      const dynamicUser = await createTestUser({
        id: "dynamic-user-id",
        name: "Dynamic User",
        email: "dynamic@example.com",
      });

      // Initially, user is not a member
      mockGetServerSession({
        user: { id: dynamicUser.id, name: dynamicUser.name, email: dynamicUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      let request = mockRequestWithBody("http://localhost:3000/api/tasks", {
        title: "Should Fail Task",
        workspaceSlug: testWorkspace.slug,
      });
      let response = await POST(request);

      expectErrorResponse(response, 403, "Access denied");

      // Add user to workspace
      await createTestWorkspaceMember(testWorkspace.id, dynamicUser.id);

      // Now user should be able to create tasks
      request = mockRequestWithBody("http://localhost:3000/api/tasks", {
        title: "Should Succeed Task",
        workspaceSlug: testWorkspace.slug,
      });
      response = await POST(request);

      expectSuccessResponse(response, 201);

      // Verify task was created
      const createdTask = await db.task.findFirst({
        where: {
          title: "Should Succeed Task",
          workspaceId: testWorkspace.id,
        },
      });

      expect(createdTask).not.toBeNull();
      expect(createdTask?.createdById).toBe(dynamicUser.id);

      // Cleanup
      await db.task.delete({ where: { id: createdTask!.id } });
      await db.workspaceMember.deleteMany({
        where: { workspaceId: testWorkspace.id, userId: dynamicUser.id },
      });
      await db.user.delete({ where: { id: dynamicUser.id } });
    });
  });

  describe("End-to-End Error Handling", () => {
    it("should handle database transaction failures gracefully", async () => {
      mockGetServerSession({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      // Temporarily break database by creating task with duplicate ID
      const existingTask = await db.task.create({
        data: {
          id: "duplicate-task-id",
          title: "Existing Task",
          workspaceId: testWorkspace.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      // Mock db.task.create to attempt duplicate ID creation
      const originalCreate = db.task.create;
      (db.task.create as jest.Mock) = jest
        .fn()
        .mockRejectedValue(new Error("Unique constraint violation"));

      const payload = {
        title: "Duplicate Task",
        workspaceSlug: testWorkspace.slug,
      };

      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      const response = await POST(request);

      expectErrorResponse(response, 500, "Failed to create task");

      // Verify error was logged
      expect(console.error).toHaveBeenCalled();

      // Restore original method and cleanup
      db.task.create = originalCreate;
      await db.task.delete({ where: { id: existingTask.id } });
    });

    it("should maintain data consistency on validation failures", async () => {
      mockGetServerSession({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      });

      // Count tasks before failed creation attempt
      const taskCountBefore = await db.task.count({
        where: { workspaceId: testWorkspace.id },
      });

      // Attempt to create task with invalid assignee
      const payload = {
        title: "Task with Invalid Assignee",
        workspaceSlug: testWorkspace.slug,
        assigneeId: "non-existent-user",
      };

      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      const response = await POST(request);

      expectErrorResponse(response, 400, "Assignee not found");

      // Verify no tasks were created (data consistency maintained)
      const taskCountAfter = await db.task.count({
        where: { workspaceId: testWorkspace.id },
      });

      expect(taskCountAfter).toBe(taskCountBefore);

      // Verify no partial data was left behind
      const partialTask = await db.task.findFirst({
        where: {
          title: "Task with Invalid Assignee",
          workspaceId: testWorkspace.id,
        },
      });

      expect(partialTask).toBeNull();
    });
  });
});