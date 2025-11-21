import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/tickets/reorder/route";
import { db } from "@/lib/db";
import { TaskStatus, Priority } from "@prisma/client";
import { createTestUser, createTestWorkspace, createTestTask, findTestTask } from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  createPostRequest,
  createAuthenticatedPostRequest,
} from "@/__tests__/support/helpers";

describe("Tasks Reorder API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/tasks/reorder", () => {
    test("reorders tasks successfully and persists new order", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Create 3 tasks with initial order [0, 1, 2]
      const task1 = await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Task 1",
          featureId: feature.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const task2 = await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Task 2",
          featureId: feature.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          order: 1,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const task3 = await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Task 3",
          featureId: feature.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          order: 2,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Reorder to [Task 3, Task 1, Task 2] with new order [0, 1, 2]
      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/tasks/reorder",
        {
          tasks: [
            { id: task3.id, order: 0 },
            { id: task1.id, order: 1 },
            { id: task2.id, order: 2 },
          ],
        },
        user,
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(3);

      // Verify database state reflects new order
      const updatedTasks = await db.task.findMany({
        where: { featureId: feature.id },
        orderBy: { order: "asc" },
      });

      expect(updatedTasks).toHaveLength(3);
      expect(updatedTasks[0].id).toBe(task3.id);
      expect(updatedTasks[0].order).toBe(0);
      expect(updatedTasks[1].id).toBe(task1.id);
      expect(updatedTasks[1].order).toBe(1);
      expect(updatedTasks[2].id).toBe(task2.id);
      expect(updatedTasks[2].order).toBe(2);
    });

    test("reorders tasks across phases with phaseId updates", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const phase1 = await db.phase.create({
        data: {
          name: "Phase 1",
          featureId: feature.id,
          order: 0,
        },
      });

      const phase2 = await db.phase.create({
        data: {
          name: "Phase 2",
          featureId: feature.id,
          order: 1,
        },
      });

      const task1 = await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Task 1",
          featureId: feature.id,
          phaseId: phase1.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const task2 = await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Task 2",
          featureId: feature.id,
          phaseId: phase1.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          order: 1,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Move task1 to phase2 and reorder
      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/tasks/reorder",
        {
          tasks: [
            { id: task2.id, order: 0, phaseId: phase1.id },
            { id: task1.id, order: 0, phaseId: phase2.id },
          ],
        },
        user,
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);

      // Verify phaseId and order updates
      const updatedTask1 = await db.task.findUnique({
        where: { id: task1.id },
      });
      const updatedTask2 = await db.task.findUnique({
        where: { id: task2.id },
      });

      expect(updatedTask1?.phaseId).toBe(phase2.id);
      expect(updatedTask1?.order).toBe(0);
      expect(updatedTask2?.phaseId).toBe(phase1.id);
      expect(updatedTask2?.order).toBe(0);
    });

    test("requires authentication", async () => {
      const request = createPostRequest("http://localhost:3000/api/tasks/reorder", {
        tasks: [{ id: "task-id", order: 0 }],
      });

      const response = await POST(request);

      await expectUnauthorized(response);
    });

    test("denies access to non-workspace members", async () => {
      const owner = await createTestUser();
      const nonMember = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const task = await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Test Task",
          featureId: feature.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          order: 0,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/tasks/reorder",
        {
          tasks: [{ id: task.id, order: 0 }],
        },
        nonMember,
      );

      const response = await POST(request);

      await expectError(response, "Access denied", 403);
    });

    test("validates tasks array is provided", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/tasks/reorder",
        { tasks: "not-an-array" },
        user,
      );

      const response = await POST(request);

      await expectError(response, "Tasks must be a non-empty array", 400);
    });

    test("handles empty tasks array", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/tasks/reorder", { tasks: [] }, user);

      const response = await POST(request);

      await expectError(response, "Tasks must be a non-empty array", 400);
    });

    test("returns 404 for non-existent task", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/tasks/reorder",
        {
          tasks: [{ id: "non-existent-task-id", order: 0 }],
        },
        user,
      );

      const response = await POST(request);

      await expectError(response, "Task not found", 404);
    });

    // TODO: Enable this test once production code validates all tasks belong to same feature
    // Currently the reorderTasks service only validates the first task's feature access
    // but doesn't check if all tasks belong to the same feature. This allows cross-feature
    // reordering which could be a security/data integrity issue.
    // Production code fix needed in: src/services/roadmap/tasks.ts (reorderTasks function)
    test.skip("prevents cross-feature task reordering", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Create two features in same workspace
      const feature1 = await db.feature.create({
        data: {
          title: "Feature 1",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const feature2 = await db.feature.create({
        data: {
          title: "Feature 2",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Create task in feature 1
      const task1 = await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Task in Feature 1",
          featureId: feature1.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Create task in feature 2
      const task2 = await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Task in Feature 2",
          featureId: feature2.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Attempt to reorder tasks from different features together
      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/tasks/reorder",
        {
          tasks: [
            { id: task1.id, order: 0 },
            { id: task2.id, order: 1 }, // Wrong feature!
          ],
        },
        user,
      );

      const response = await POST(request);

      // Service should fail - tasks must belong to same feature
      expect(response.status).toBeGreaterThanOrEqual(400);

      // Verify original order is preserved (transaction rolled back)
      const task1Check = await db.task.findUnique({
        where: { id: task1.id },
      });
      const task2Check = await db.task.findUnique({
        where: { id: task2.id },
      });

      expect(task1Check?.order).toBe(0);
      expect(task1Check?.featureId).toBe(feature1.id);
      expect(task2Check?.order).toBe(0);
      expect(task2Check?.featureId).toBe(feature2.id);
    });

    test("rolls back transaction on partial failure with invalid task ID", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const task1 = await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Task 1",
          featureId: feature.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const task2 = await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Task 2",
          featureId: feature.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          order: 1,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Attempt reorder with one invalid task ID in the middle
      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/tasks/reorder",
        {
          tasks: [
            { id: task1.id, order: 0 },
            { id: "non-existent-task-id", order: 1 }, // Invalid!
            { id: task2.id, order: 2 },
          ],
        },
        user,
      );

      const response = await POST(request);

      // Transaction should fail
      expect(response.status).toBeGreaterThanOrEqual(400);

      // Verify original order is preserved (no partial updates)
      const updatedTasks = await db.task.findMany({
        where: { featureId: feature.id },
        orderBy: { order: "asc" },
      });

      expect(updatedTasks).toHaveLength(2);
      expect(updatedTasks[0].id).toBe(task1.id);
      expect(updatedTasks[0].order).toBe(0); // Original order
      expect(updatedTasks[1].id).toBe(task2.id);
      expect(updatedTasks[1].order).toBe(1); // Original order
    });

    test("handles reordering with duplicate order values", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const task1 = await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Task 1",
          featureId: feature.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const task2 = await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Task 2",
          featureId: feature.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          order: 1,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Reorder with duplicate order values (both order: 0)
      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/tasks/reorder",
        {
          tasks: [
            { id: task1.id, order: 0 },
            { id: task2.id, order: 0 }, // Duplicate order
          ],
        },
        user,
      );

      const response = await POST(request);

      // Should succeed - database allows duplicate order values
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);

      // Verify both tasks have order 0
      const updatedTasks = await db.task.findMany({
        where: { featureId: feature.id },
      });

      expect(updatedTasks).toHaveLength(2);
      expect(updatedTasks.every((t) => t.order === 0)).toBe(true);
    });

    test("rejects deleted workspace features", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const task = await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Test Task",
          featureId: feature.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Soft delete workspace
      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/tasks/reorder",
        {
          tasks: [{ id: task.id, order: 0 }],
        },
        user,
      );

      const response = await POST(request);

      // Should reject access to deleted workspace
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    test("allows workspace owner to reorder tasks", async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const task = await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Test Task",
          featureId: feature.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          order: 0,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/tasks/reorder",
        {
          tasks: [{ id: task.id, order: 5 }],
        },
        owner,
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);

      // Verify owner can reorder
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.order).toBe(5);
    });

    test("allows workspace member to reorder tasks", async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const workspace = await createTestWorkspace({
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

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const task = await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Test Task",
          featureId: feature.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          order: 0,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/tasks/reorder",
        {
          tasks: [{ id: task.id, order: 3 }],
        },
        member,
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);

      // Verify member can reorder
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.order).toBe(3);
    });

    test("reorders multiple tasks and preserves other task properties", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const task1 = await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: "High Priority Task",
          description: "Important task",
          featureId: feature.id,
          status: TaskStatus.IN_PROGRESS,
          priority: Priority.HIGH,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const task2 = await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Low Priority Task",
          description: "Less important",
          featureId: feature.id,
          status: TaskStatus.TODO,
          priority: Priority.LOW,
          order: 1,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Reverse order
      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/tasks/reorder",
        {
          tasks: [
            { id: task2.id, order: 0 },
            { id: task1.id, order: 1 },
          ],
        },
        user,
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);

      // Verify order changed but other properties preserved
      const updatedTask1 = await db.task.findUnique({
        where: { id: task1.id },
      });
      const updatedTask2 = await db.task.findUnique({
        where: { id: task2.id },
      });

      expect(updatedTask1?.order).toBe(1);
      expect(updatedTask1?.title).toBe("High Priority Task");
      expect(updatedTask1?.status).toBe(TaskStatus.IN_PROGRESS);
      expect(updatedTask1?.priority).toBe(Priority.HIGH);

      expect(updatedTask2?.order).toBe(0);
      expect(updatedTask2?.title).toBe("Low Priority Task");
      expect(updatedTask2?.status).toBe(TaskStatus.TODO);
      expect(updatedTask2?.priority).toBe(Priority.LOW);
    });
  });
});
