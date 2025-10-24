import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/tickets/[ticketId]/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestTask,
  findTestTask,
} from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  expectNotFound,
  createAuthenticatedGetRequest,
  createGetRequest,
} from "@/__tests__/support/helpers";
import type { User, Task, Feature, Workspace } from "@prisma/client";

describe("GET /api/tickets/[ticketId]", () => {
  let owner: User;
  let member: User;
  let outsider: User;
  let workspace: Workspace;
  let feature: Feature;
  let task: Task;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test users
    owner = await createTestUser({ name: "Owner", email: "owner@test.com" });
    member = await createTestUser({ name: "Member", email: "member@test.com" });
    outsider = await createTestUser({
      name: "Outsider",
      email: "outsider@test.com",
    });

    // Create workspace
    workspace = await createTestWorkspace({
      ownerId: owner.id,
      name: "Test Workspace",
      slug: "test-workspace",
    });

    // Add member to workspace
    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: member.id,
        role: "DEVELOPER",
      },
    });

    // Create feature
    feature = await db.feature.create({
      data: {
        title: "Test Feature",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    // Create test task with comprehensive data
    task = await createTestTask({
      title: "Test Ticket",
      description: "Test ticket description",
      workspaceId: workspace.id,
      featureId: feature.id,
      createdById: owner.id,
      assigneeId: member.id,
      status: "TODO",
      priority: "HIGH",
      order: 0,
    });
  });

  describe("Successful Retrieval", () => {
    test("owner can fetch ticket details with all fields", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      const result = await expectSuccess(response, 200);
      expect(result.data).toBeDefined();
      expect(result.data.id).toBe(task.id);
      expect(result.data.title).toBe("Test Ticket");
      expect(result.data.description).toBe("Test ticket description");
      expect(result.data.status).toBe("TODO");
      expect(result.data.priority).toBe("HIGH");
      expect(result.data.order).toBe(0);
      expect(result.data.featureId).toBe(feature.id);
      expect(result.data.phaseId).toBeNull();
      expect(result.data.bountyCode).toBeDefined();
      expect(result.data.dependsOnTaskIds).toEqual([]);
      expect(result.data.createdAt).toBeDefined();
      expect(result.data.updatedAt).toBeDefined();
    });

    test("member can fetch ticket details", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        member
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      const result = await expectSuccess(response, 200);
      expect(result.data.id).toBe(task.id);
      expect(result.data.title).toBe("Test Ticket");
    });

    test("returns ticket with assignee details", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      const result = await expectSuccess(response, 200);
      expect(result.data.assignee).toBeDefined();
      expect(result.data.assignee?.id).toBe(member.id);
      expect(result.data.assignee?.name).toBe("Member");
      expect(result.data.assignee?.email).toBe("member@test.com");
    });

    test("returns ticket with feature context", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      const result = await expectSuccess(response, 200);
      expect(result.data.feature).toBeDefined();
      expect(result.data.feature.id).toBe(feature.id);
      expect(result.data.feature.title).toBe("Test Feature");
      expect(result.data.feature.workspaceId).toBe(workspace.id);
    });

    test("returns ticket with createdBy and updatedBy details", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      const result = await expectSuccess(response, 200);
      expect(result.data.createdBy).toBeDefined();
      expect(result.data.createdBy.id).toBe(owner.id);
      expect(result.data.createdBy.name).toBe("Owner");
      expect(result.data.updatedBy).toBeDefined();
      expect(result.data.updatedBy.id).toBe(owner.id);
    });

    test("returns ticket with phase details when assigned to phase", async () => {
      // Create phase
      const phase = await db.phase.create({
        data: {
          name: "Test Phase",
          featureId: feature.id,
          order: 0,
        },
      });

      // Update task to include phase
      await db.task.update({
        where: { id: task.id },
        data: { phaseId: phase.id },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      const result = await expectSuccess(response, 200);
      expect(result.data.phase).toBeDefined();
      expect(result.data.phase?.id).toBe(phase.id);
      expect(result.data.phase?.name).toBe("Test Phase");
      expect(result.data.phaseId).toBe(phase.id);
    });

    test("returns ticket with null phase when not assigned", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      const result = await expectSuccess(response, 200);
      expect(result.data.phase).toBeNull();
      expect(result.data.phaseId).toBeNull();
    });

    test("returns ticket with dependsOnTaskIds array", async () => {
      // Create dependency task
      const dependencyTask = await createTestTask({
        title: "Dependency Task",
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
      });

      // Update task to depend on dependency task
      await db.task.update({
        where: { id: task.id },
        data: { dependsOnTaskIds: [dependencyTask.id] },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      const result = await expectSuccess(response, 200);
      expect(result.data.dependsOnTaskIds).toEqual([dependencyTask.id]);
    });
  });

  describe("Authorization", () => {
    test("unauthenticated user cannot fetch ticket", async () => {
      const request = createGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      await expectUnauthorized(response);
    });

    test("outsider cannot fetch ticket from workspace they don't belong to", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        outsider
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      await expectError(response, "Access denied", 403);
    });

    test("workspace admin can fetch ticket", async () => {
      const admin = await createTestUser({ email: "admin@test.com" });
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: admin.id,
          role: "ADMIN",
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        admin
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      const result = await expectSuccess(response, 200);
      expect(result.data.id).toBe(task.id);
    });

    test("workspace PM can fetch ticket", async () => {
      const pm = await createTestUser({ email: "pm@test.com" });
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: pm.id,
          role: "PM",
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        pm
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      const result = await expectSuccess(response, 200);
      expect(result.data.id).toBe(task.id);
    });
  });

  describe("Error Handling", () => {
    test("returns 404 for non-existent ticket", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/non-existent-id`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: "non-existent-id" }),
      });

      await expectNotFound(response, "not found");
    });

    test("returns 404 for soft-deleted ticket", async () => {
      // Soft delete the task
      await db.task.update({
        where: { id: task.id },
        data: {
          deleted: true,
          deletedAt: new Date(),
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      await expectNotFound(response, "Task not found");
    });

    test("returns 404 when ticket belongs to deleted workspace", async () => {
      // Soft delete the workspace
      await db.workspace.update({
        where: { id: workspace.id },
        data: {
          deleted: true,
          deletedAt: new Date(),
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      await expectNotFound(response, "Task not found");
    });

    test("handles malformed ticket ID gracefully", async () => {
      const invalidId = "invalid-cuid-format";
      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${invalidId}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: invalidId }),
      });

      // Should return 404 or 500 depending on database error handling
      expect([404, 500]).toContain(response.status);
      const json = await response.json();
      expect(json.error).toBeTruthy();
    });
  });

  describe("Data Consistency", () => {
    test("ticket data matches database state", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      const result = await expectSuccess(response, 200);

      // Verify against database
      const dbTask = await findTestTask(task.id);
      expect(result.data.title).toBe(dbTask?.title);
      expect(result.data.description).toBe(dbTask?.description);
      expect(result.data.status).toBe(dbTask?.status);
      expect(result.data.priority).toBe(dbTask?.priority);
      expect(result.data.order).toBe(dbTask?.order);
      expect(result.data.featureId).toBe(dbTask?.featureId);
    });

    test("timestamps are in ISO format and valid", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      const result = await expectSuccess(response, 200);

      expect(result.data.createdAt).toBeDefined();
      expect(result.data.updatedAt).toBeDefined();

      // Verify timestamps are valid dates
      const createdAt = new Date(result.data.createdAt);
      const updatedAt = new Date(result.data.updatedAt);

      expect(createdAt.getTime()).toBeGreaterThan(0);
      expect(updatedAt.getTime()).toBeGreaterThan(0);
      expect(updatedAt.getTime()).toBeGreaterThanOrEqual(createdAt.getTime());
    });

    test("bountyCode is nullable for existing tasks", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      const result = await expectSuccess(response, 200);

      // bountyCode can be null for tasks created directly in the database
      // (as opposed to through the API which generates bounty codes)
      if (result.data.bountyCode !== null) {
        expect(typeof result.data.bountyCode).toBe("string");
        expect(result.data.bountyCode.length).toBeGreaterThan(0);
      }
    });

    test("nested relations are properly populated", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      const result = await expectSuccess(response, 200);

      // Verify feature relation
      expect(result.data.feature).toBeDefined();
      expect(result.data.feature.id).toBeTruthy();
      expect(result.data.feature.title).toBeTruthy();
      expect(result.data.feature.workspaceId).toBeTruthy();

      // Verify user relations
      expect(result.data.createdBy).toBeDefined();
      expect(result.data.createdBy.id).toBeTruthy();
      expect(result.data.updatedBy).toBeDefined();
      expect(result.data.updatedBy.id).toBeTruthy();

      // Verify assignee if present
      if (result.data.assignee) {
        expect(result.data.assignee.id).toBeTruthy();
        expect(result.data.assignee.email).toBeTruthy();
      }
    });
  });

  describe("System Assignees", () => {
    test("returns system assignee as virtual user object for task-coordinator", async () => {
      // Update task with system assignee
      await db.task.update({
        where: { id: task.id },
        data: {
          assigneeId: null,
          systemAssigneeType: "TASK_COORDINATOR",
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      const result = await expectSuccess(response, 200);
      expect(result.data.assignee).toBeDefined();
      expect(result.data.assignee?.id).toBe("system:task-coordinator");
      expect(result.data.assignee?.name).toBe("Task Coordinator");
      expect(result.data.assignee?.icon).toBe("bot");
    });

    test("returns system assignee as virtual user object for bounty-hunter", async () => {
      // Update task with system assignee
      await db.task.update({
        where: { id: task.id },
        data: {
          assigneeId: null,
          systemAssigneeType: "BOUNTY_HUNTER",
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      const result = await expectSuccess(response, 200);
      expect(result.data.assignee).toBeDefined();
      expect(result.data.assignee?.id).toBe("system:bounty-hunter");
      expect(result.data.assignee?.name).toBe("Bounty Hunter");
      expect(result.data.assignee?.image).toBe("/sphinx_icon.png");
    });
  });

  describe("Edge Cases", () => {
    test("handles ticket with null description", async () => {
      // Create task with no description
      const taskNoDesc = await createTestTask({
        title: "Task Without Description",
        description: null,
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${taskNoDesc.id}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: taskNoDesc.id }),
      });

      const result = await expectSuccess(response, 200);
      expect(result.data.description).toBeNull();
    });

    test("handles ticket with no assignee", async () => {
      // Create task without assignee
      const taskNoAssignee = await createTestTask({
        title: "Unassigned Task",
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
        assigneeId: undefined,
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${taskNoAssignee.id}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: taskNoAssignee.id }),
      });

      const result = await expectSuccess(response, 200);
      expect(result.data.assignee).toBeNull();
    });

    test("handles ticket with empty dependsOnTaskIds array", async () => {
      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      const result = await expectSuccess(response, 200);
      expect(result.data.dependsOnTaskIds).toEqual([]);
      expect(Array.isArray(result.data.dependsOnTaskIds)).toBe(true);
    });

    test("handles ticket with multiple dependencies", async () => {
      // Create multiple dependency tasks
      const dep1 = await createTestTask({
        title: "Dependency 1",
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
      });

      const dep2 = await createTestTask({
        title: "Dependency 2",
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
      });

      // Update task with dependencies
      await db.task.update({
        where: { id: task.id },
        data: { dependsOnTaskIds: [dep1.id, dep2.id] },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/tickets/${task.id}`,
        owner
      );

      const response = await GET(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      const result = await expectSuccess(response, 200);
      expect(result.data.dependsOnTaskIds).toHaveLength(2);
      expect(result.data.dependsOnTaskIds).toContain(dep1.id);
      expect(result.data.dependsOnTaskIds).toContain(dep2.id);
    });
  });
});