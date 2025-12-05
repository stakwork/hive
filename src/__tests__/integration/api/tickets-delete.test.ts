import { describe, test, expect, beforeEach, vi } from 'vitest';
import { DELETE } from '@/app/api/tickets/[ticketId]/route';
import { db } from '@/lib/db';
import {
  createTestUser,
  createTestWorkspace,
  createTestTask,
  updateTestTask,
  findTestTask,
} from '@/__tests__/support/fixtures';
import {
  createDeleteRequest,
  createAuthenticatedDeleteRequest,
} from '@/__tests__/support/helpers/request-builders';
import {
  expectUnauthorized,
  expectError,
  expectSuccess,
} from '@/__tests__/support/helpers/api-assertions';
import type { User, Workspace, Task, Feature } from '@prisma/client';

describe('DELETE /api/tickets/[ticketId]', () => {
  let workspace: Workspace;
  let owner: User;
  let feature: Feature;
  let testTask: Task;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test workspace with owner
    owner = await createTestUser({ email: 'owner@test.com' });
    workspace = await createTestWorkspace({
      name: 'Test Workspace',
      slug: 'test-workspace',
      ownerId: owner.id,
    });

    // Create workspace membership for owner
    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: owner.id,
        role: 'OWNER',
      },
    });

    // Create a feature (required for roadmap tasks)
    feature = await db.feature.create({
      data: {
        title: 'Test Feature',
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    // Create a test task for deletion
    testTask = await createTestTask({
      title: 'Test Task',
      description: 'Task to be deleted',
      workspaceId: workspace.id,
      featureId: feature.id,
        createdById: owner.id,
      featureId: feature.id,
    });
  });

  describe('Authorization', () => {
    test('returns 401 when user is not authenticated', async () => {
      const request = createDeleteRequest(
        `/api/tickets/${testTask.id}`
      );

      const response = await DELETE(request, {
        params: { ticketId: testTask.id },
      });

      await expectUnauthorized(response);

      // Verify task was NOT deleted
      const taskAfter = await findTestTask(testTask.id);
      expect(taskAfter).toBeDefined();
      expect(taskAfter?.deleted).toBe(false);
    });

    test('returns 403 when user is not a workspace member', async () => {
      const nonMember = await createTestUser({ email: 'outsider@test.com' });
      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${testTask.id}`,
        nonMember
      );

      const response = await DELETE(request, {
        params: { ticketId: testTask.id },
      });

      await expectError(response, 'Access denied', 403);

      // Verify task was NOT deleted
      const taskAfter = await findTestTask(testTask.id);
      expect(taskAfter).toBeDefined();
      expect(taskAfter?.deleted).toBe(false);
    });

    test('allows workspace OWNER to delete task', async () => {
      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${testTask.id}`,
        owner
      );

      const response = await DELETE(request, {
        params: { ticketId: testTask.id },
      });

      await expectSuccess(response, 200);

      // Verify task was soft-deleted
      const taskAfter = await findTestTask(testTask.id);
      expect(taskAfter).toBeDefined();
      expect(taskAfter?.deleted).toBe(true);
      expect(taskAfter?.deletedAt).toBeDefined();
    });

    test('allows workspace ADMIN to delete task', async () => {
      const admin = await createTestUser({ email: 'admin@test.com' });
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: admin.id,
          role: 'ADMIN',
        },
      });

      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${testTask.id}`,
        admin
      );

      const response = await DELETE(request, {
        params: { ticketId: testTask.id },
      });

      await expectSuccess(response, 200);

      // Verify task was soft-deleted
      const taskAfter = await findTestTask(testTask.id);
      expect(taskAfter?.deleted).toBe(true);
    });

    test('allows workspace MEMBER to delete task', async () => {
      const member = await createTestUser({ email: 'member@test.com' });
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: member.id,
          role: 'DEVELOPER',
        },
      });

      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${testTask.id}`,
        member
      );

      const response = await DELETE(request, {
        params: { ticketId: testTask.id },
      });

      await expectSuccess(response, 200);

      // Verify task was soft-deleted
      const taskAfter = await findTestTask(testTask.id);
      expect(taskAfter?.deleted).toBe(true);
    });

    test('allows workspace VIEWER to delete task', async () => {
      const viewer = await createTestUser({ email: 'viewer@test.com' });
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: viewer.id,
          role: 'VIEWER',
        },
      });

      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${testTask.id}`,
        viewer
      );

      const response = await DELETE(request, {
        params: { ticketId: testTask.id },
      });

      await expectSuccess(response, 200);

      // Verify task was soft-deleted
      const taskAfter = await findTestTask(testTask.id);
      expect(taskAfter?.deleted).toBe(true);
    });
  });

  describe('Cascading Cleanup - Dependency Management', () => {
    test('removes deleted task ID from single dependent task', async () => {
      // Create taskA and taskB where B depends on A
      const taskA = await createTestTask({
        title: 'Task A',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
      });

      const taskB = await createTestTask({
        title: 'Task B',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
        dependsOnTaskIds: [taskA.id],
      });

      // Delete taskA
      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${taskA.id}`,
        owner
      );
      const response = await DELETE(request, {
        params: { ticketId: taskA.id },
      });

      await expectSuccess(response, 200);

      // Verify taskB's dependencies are cleaned up
      const taskBAfter = await findTestTask(taskB.id);
      expect(taskBAfter).toBeDefined();
      expect(taskBAfter?.dependsOnTaskIds).toEqual([]);
      expect(taskBAfter?.dependsOnTaskIds).not.toContain(taskA.id);
    });

    test('removes deleted task ID from multiple dependent tasks', async () => {
      // Create taskA, taskB, taskC where B and C both depend on A
      const taskA = await createTestTask({
        title: 'Task A',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
      });

      const taskB = await createTestTask({
        title: 'Task B',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
        dependsOnTaskIds: [taskA.id],
      });

      const taskC = await createTestTask({
        title: 'Task C',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
        dependsOnTaskIds: [taskA.id],
      });

      // Delete taskA
      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${taskA.id}`,
        owner
      );
      const response = await DELETE(request, {
        params: { ticketId: taskA.id },
      });

      await expectSuccess(response, 200);

      // Verify both taskB and taskC have cleaned dependencies
      const taskBAfter = await findTestTask(taskB.id);
      expect(taskBAfter?.dependsOnTaskIds).toEqual([]);

      const taskCAfter = await findTestTask(taskC.id);
      expect(taskCAfter?.dependsOnTaskIds).toEqual([]);
    });

    test('removes only deleted task ID from tasks with mixed dependencies', async () => {
      // Create taskA, taskB, taskC where C depends on both A and B
      const taskA = await createTestTask({
        title: 'Task A',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
      });

      const taskB = await createTestTask({
        title: 'Task B',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
      });

      const taskC = await createTestTask({
        title: 'Task C',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
        dependsOnTaskIds: [taskA.id, taskB.id],
      });

      // Delete taskA only
      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${taskA.id}`,
        owner
      );
      const response = await DELETE(request, {
        params: { ticketId: taskA.id },
      });

      await expectSuccess(response, 200);

      // Verify taskC still has taskB but not taskA
      const taskCAfter = await findTestTask(taskC.id);
      expect(taskCAfter?.dependsOnTaskIds).toHaveLength(1);
      expect(taskCAfter?.dependsOnTaskIds).toContain(taskB.id);
      expect(taskCAfter?.dependsOnTaskIds).not.toContain(taskA.id);
    });

    test('handles deletion of task with no dependents gracefully', async () => {
      const isolatedTask = await createTestTask({
        title: 'Isolated Task',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
      });

      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${isolatedTask.id}`,
        owner
      );
      const response = await DELETE(request, {
        params: { ticketId: isolatedTask.id },
      });

      await expectSuccess(response, 200);

      // Verify deletion succeeded
      const taskAfter = await findTestTask(isolatedTask.id);
      expect(taskAfter?.deleted).toBe(true);
    });

    test('handles deletion of task that is itself a dependent', async () => {
      const taskA = await createTestTask({
        title: 'Task A',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
      });

      const taskB = await createTestTask({
        title: 'Task B (depends on A)',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
        dependsOnTaskIds: [taskA.id],
      });

      // Delete taskB (which depends on taskA)
      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${taskB.id}`,
        owner
      );
      const response = await DELETE(request, {
        params: { ticketId: taskB.id },
      });

      await expectSuccess(response, 200);

      // Verify taskB is deleted
      const taskBAfter = await findTestTask(taskB.id);
      expect(taskBAfter?.deleted).toBe(true);

      // Verify taskA is unaffected
      const taskAAfter = await findTestTask(taskA.id);
      expect(taskAAfter?.deleted).toBe(false);
    });
  });

  describe('Soft-Delete Verification', () => {
    test('sets deleted flag to true', async () => {
      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${testTask.id}`,
        owner
      );

      await DELETE(request, { params: { ticketId: testTask.id } });

      const taskAfter = await findTestTask(testTask.id);
      expect(taskAfter?.deleted).toBe(true);
    });

    test('sets deletedAt timestamp', async () => {
      const beforeDelete = new Date();
      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${testTask.id}`,
        owner
      );

      await DELETE(request, { params: { ticketId: testTask.id } });

      const taskAfter = await findTestTask(testTask.id);
      expect(taskAfter?.deletedAt).toBeDefined();
      expect(taskAfter?.deletedAt).toBeInstanceOf(Date);
      expect(taskAfter!.deletedAt!.getTime()).toBeGreaterThanOrEqual(
        beforeDelete.getTime()
      );
    });

    test('preserves original task data', async () => {
      const originalTitle = testTask.title;
      const originalDescription = testTask.description;

      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${testTask.id}`,
        owner
      );

      await DELETE(request, { params: { ticketId: testTask.id } });

      const taskAfter = await findTestTask(testTask.id);
      expect(taskAfter?.title).toBe(originalTitle);
      expect(taskAfter?.description).toBe(originalDescription);
    });

    test('returns 404 when attempting to delete already deleted task (idempotency)', async () => {
      // First deletion
      const request1 = createAuthenticatedDeleteRequest(
        `/api/tickets/${testTask.id}`,
        owner
      );
      await DELETE(request1, { params: { ticketId: testTask.id } });

      // Verify first deletion succeeded
      const taskAfter = await findTestTask(testTask.id);
      expect(taskAfter?.deleted).toBe(true);

      // Second deletion attempt
      const request2 = createAuthenticatedDeleteRequest(
        `/api/tickets/${testTask.id}`,
        owner
      );
      const response = await DELETE(request2, {
        params: { ticketId: testTask.id },
      });

      await expectError(response, 'Task not found', 404);
    });

    test('returns 404 when attempting to delete non-existent task', async () => {
      const nonExistentId = 'non-existent-task-id';
      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${nonExistentId}`,
        owner
      );

      const response = await DELETE(request, {
        params: { ticketId: nonExistentId },
      });

      await expectError(response, 'Task not found', 404);
    });
  });

  describe('Related Entity Handling', () => {
    test('does not delete parent feature when task is deleted', async () => {
      // Create a feature
      const feature = await db.feature.create({
        data: {
          title: 'Test Feature',
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      // Create task linked to feature
      const taskWithFeature = await createTestTask({
        title: 'Task with Feature',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
        featureId: feature.id,
      });

      // Delete task
      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${taskWithFeature.id}`,
        owner
      );
      const response = await DELETE(request, {
        params: { ticketId: taskWithFeature.id },
      });

      await expectSuccess(response, 200);

      // Verify feature still exists
      const featureAfter = await db.feature.findUnique({
        where: { id: feature.id },
      });
      expect(featureAfter).toBeDefined();
      expect(featureAfter?.id).toBe(feature.id);
    });

    test('handles task deletion when associated phase is deleted', async () => {
      // Create a feature first (required for phase)
      const feature = await db.feature.create({
        data: {
          title: 'Test Feature',
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      // Create a phase
      const phase = await db.phase.create({
        data: {
          name: 'Test Phase',
          featureId: feature.id,
        },
      });

      // Create task linked to phase
      const taskWithPhase = await createTestTask({
        title: 'Task with Phase',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
        phaseId: phase.id,
      });

      // Delete phase (Prisma schema has onDelete: SetNull)
      await db.phase.delete({
        where: { id: phase.id },
      });

      // Verify task still exists but phaseId is null
      const taskAfterPhaseDelete = await findTestTask(taskWithPhase.id);
      expect(taskAfterPhaseDelete).toBeDefined();
      expect(taskAfterPhaseDelete?.phaseId).toBeNull();
      expect(taskAfterPhaseDelete?.deleted).toBe(false);

      // Now delete the task
      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${taskWithPhase.id}`,
        owner
      );
      const response = await DELETE(request, {
        params: { ticketId: taskWithPhase.id },
      });

      await expectSuccess(response, 200);

      // Verify task is soft-deleted
      const taskAfterDelete = await findTestTask(taskWithPhase.id);
      expect(taskAfterDelete?.deleted).toBe(true);
    });

    test('preserves workspace relationship after task deletion', async () => {
      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${testTask.id}`,
        owner
      );

      await DELETE(request, { params: { ticketId: testTask.id } });

      const taskAfter = await findTestTask(testTask.id);
      expect(taskAfter?.workspaceId).toBe(workspace.id);

      // Verify workspace still exists and is unaffected
      const workspaceAfter = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(workspaceAfter).toBeDefined();
    });
  });

  describe('Complex Scenarios', () => {
    test('handles deletion of task with multiple dependencies in dependency chain', async () => {
      // Create chain: A -> B -> C -> D (each depends on previous)
      const taskA = await createTestTask({
        title: 'Task A',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
      });

      const taskB = await createTestTask({
        title: 'Task B',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
        dependsOnTaskIds: [taskA.id],
      });

      const taskC = await createTestTask({
        title: 'Task C',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
        dependsOnTaskIds: [taskB.id],
      });

      const taskD = await createTestTask({
        title: 'Task D',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
        dependsOnTaskIds: [taskC.id],
      });

      // Delete taskB (middle of chain)
      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${taskB.id}`,
        owner
      );
      const response = await DELETE(request, {
        params: { ticketId: taskB.id },
      });

      await expectSuccess(response, 200);

      // Verify taskC's dependencies are cleaned
      const taskCAfter = await findTestTask(taskC.id);
      expect(taskCAfter?.dependsOnTaskIds).toEqual([]);

      // Verify taskD still depends on taskC (unaffected)
      const taskDAfter = await findTestTask(taskD.id);
      expect(taskDAfter?.dependsOnTaskIds).toContain(taskC.id);

      // Verify taskA is unaffected
      const taskAAfter = await findTestTask(taskA.id);
      expect(taskAAfter?.deleted).toBe(false);
    });

    test('handles deletion when multiple tasks depend on same parent', async () => {
      const parent = await createTestTask({
        title: 'Parent Task',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
      });

      // Create 5 children all depending on parent
      const children = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          createTestTask({
            title: `Child Task ${i + 1}`,
            workspaceId: workspace.id,
            createdById: owner.id,
            dependsOnTaskIds: [parent.id],
          })
        )
      );

      // Delete parent
      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${parent.id}`,
        owner
      );
      const response = await DELETE(request, {
        params: { ticketId: parent.id },
      });

      await expectSuccess(response, 200);

      // Verify all children have cleaned dependencies
      for (const child of children) {
        const childAfter = await findTestTask(child.id);
        expect(childAfter?.dependsOnTaskIds).toEqual([]);
        expect(childAfter?.deleted).toBe(false);
      }
    });

    test('correctly handles task with empty dependsOnTaskIds array', async () => {
      const taskWithEmptyDeps = await createTestTask({
        title: 'Task with empty deps',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
        dependsOnTaskIds: [],
      });

      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${taskWithEmptyDeps.id}`,
        owner
      );
      const response = await DELETE(request, {
        params: { ticketId: taskWithEmptyDeps.id },
      });

      await expectSuccess(response, 200);

      const taskAfter = await findTestTask(taskWithEmptyDeps.id);
      expect(taskAfter?.deleted).toBe(true);
      expect(taskAfter?.dependsOnTaskIds).toEqual([]);
    });

    test('handles deletion across different workspaces correctly', async () => {
      // Create second workspace
      const workspace2 = await createTestWorkspace({
        name: 'Workspace 2',
        slug: 'workspace-2',
        ownerId: owner.id,
      });

      await db.workspaceMember.create({
        data: {
          workspaceId: workspace2.id,
          userId: owner.id,
          role: 'OWNER',
        },
      });

      // Create tasks in both workspaces
      const task1 = await createTestTask({
        title: 'Task in Workspace 1',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
      });

      const task2 = await createTestTask({
        title: 'Task in Workspace 2',
        workspaceId: workspace2.id,
        featureId: feature.id,
        createdById: owner.id,
      });

      // Delete task from workspace1
      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${task1.id}`,
        owner
      );
      const response = await DELETE(request, {
        params: { ticketId: task1.id },
      });

      await expectSuccess(response, 200);

      // Verify task1 deleted, task2 unaffected
      const task1After = await findTestTask(task1.id);
      expect(task1After?.deleted).toBe(true);

      const task2After = await findTestTask(task2.id);
      expect(task2After?.deleted).toBe(false);
    });
  });
});
