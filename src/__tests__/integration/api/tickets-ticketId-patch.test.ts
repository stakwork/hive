import { describe, test, expect, beforeEach, vi } from 'vitest';
import { PATCH } from '@/app/api/tickets/[ticketId]/route';
import { db } from '@/lib/db';
import {
  createTestUser,
  createTestWorkspace,
  createTestTask,
  updateTestTask
} from '@/__tests__/support/fixtures';
import {
  createAuthenticatedGetRequest,
  createGetRequest,
  createAuthenticatedPatchRequest,
  createPatchRequest,
  expectSuccess,
  expectError,
  expectUnauthorized,
  expectNotFound
} from '@/__tests__/support/helpers';

describe('PATCH /api/tickets/[ticketId]', () => {
  let user: any;
  let workspace: any;
  let feature: any;
  let task: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Create test user and workspace
    user = await createTestUser();
    workspace = await createTestWorkspace({ ownerId: user.id });

    // Create feature (required parent for tasks)
    feature = await db.feature.create({
      data: {
        title: 'Test Feature',
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id
      }
    });

    // Create test task
    task = await createTestTask({
      title: 'Test Task',
      description: 'Task to be updated',
      workspaceId: workspace.id,
      featureId: feature.id,
      createdById: user.id,
      status: 'TODO',
      priority: 'MEDIUM'
    });
  });

  describe('Success Scenarios - Single Field Updates', () => {
    test('should update task title successfully', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { title: 'Updated Title' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await expectSuccess(response, 200);
      expect(json.data.title).toBe('Updated Title');
      expect(json.data.id).toBe(task.id);

      // Verify database persistence
      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.title).toBe('Updated Title');
      expect(updatedTask?.updatedById).toBe(user.id);
    });

    test('should trim whitespace from title', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { title: '  Trimmed Title  ' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await expectSuccess(response, 200);
      expect(json.data.title).toBe('Trimmed Title');

      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.title).toBe('Trimmed Title');
    });

    test('should update task description successfully', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { description: 'Updated description' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await expectSuccess(response, 200);
      expect(json.data.description).toBe('Updated description');

      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.description).toBe('Updated description');
    });

    test('should clear description when set to empty string', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { description: '' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await expectSuccess(response, 200);
      expect(json.data.description).toBeNull();

      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.description).toBeNull();
    });

    test('should update task status successfully', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { status: 'IN_PROGRESS' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await expectSuccess(response, 200);
      expect(json.data.status).toBe('IN_PROGRESS');

      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.status).toBe('IN_PROGRESS');
    });

    test('should update task priority successfully', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { priority: 'HIGH' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await expectSuccess(response, 200);
      expect(json.data.priority).toBe('HIGH');

      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.priority).toBe('HIGH');
    });

    test('should update task order successfully', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { order: 5 },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await expectSuccess(response, 200);
      expect(json.data.order).toBe(5);

      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.order).toBe(5);
    });
  });

  describe('Success Scenarios - Phase Updates', () => {
    test('should assign task to phase successfully', async () => {
      const phase = await db.phase.create({
        data: {
          name: 'Test Phase',
          featureId: feature.id,
          status: 'IN_PROGRESS'
        }
      });

      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { phaseId: phase.id },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await expectSuccess(response, 200);
      expect(json.data.phaseId).toBe(phase.id);
      expect(json.data.phase).toBeTruthy();
      expect(json.data.phase.name).toBe('Test Phase');

      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.phaseId).toBe(phase.id);
    });

    test('should clear phase assignment when set to null', async () => {
      const phase = await db.phase.create({
        data: {
          name: 'Test Phase',
          featureId: feature.id,
          status: 'IN_PROGRESS'
        }
      });
      await updateTestTask(task.id, { phaseId: phase.id });

      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { phaseId: null },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await expectSuccess(response, 200);
      expect(json.data.phaseId).toBeNull();
      expect(json.data.phase).toBeNull();

      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.phaseId).toBeNull();
    });
  });

  describe('Success Scenarios - Assignee Updates', () => {
    test('should assign task to user successfully', async () => {
      const assignee = await createTestUser({ email: 'assignee@test.com', name: 'Test Assignee' });
      await db.workspaceMember.create({
        data: {
          userId: assignee.id,
          workspaceId: workspace.id,
          role: 'DEVELOPER'
        }
      });

      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { assigneeId: assignee.id },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await expectSuccess(response, 200);
      expect(json.data.assignee).toBeTruthy();
      expect(json.data.assignee.id).toBe(assignee.id);
      expect(json.data.assignee.name).toBe('Test Assignee');

      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.assigneeId).toBe(assignee.id);
    });

    test('should clear assignee when set to null', async () => {
      const assignee = await createTestUser({ email: 'assignee@test.com' });
      await updateTestTask(task.id, { assigneeId: assignee.id });

      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { assigneeId: null },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await expectSuccess(response, 200);
      expect(json.data.assignee).toBeNull();

      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.assigneeId).toBeNull();
      expect(updatedTask?.systemAssigneeType).toBeNull();
    });

    test('should assign to system assignee (task coordinator)', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { assigneeId: 'system:task-coordinator' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await expectSuccess(response, 200);
      expect(json.data.assignee).toBeTruthy();
      expect(json.data.assignee.id).toContain('system:');

      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.assigneeId).toBeNull();
      expect(updatedTask?.systemAssigneeType).toBe('TASK_COORDINATOR');
    });

    test('should assign to system assignee (bounty hunter)', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { assigneeId: 'system:bounty-hunter' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await expectSuccess(response, 200);
      expect(json.data.assignee).toBeTruthy();

      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.systemAssigneeType).toBe('BOUNTY_HUNTER');
    });
  });

  describe('Success Scenarios - Dependency Updates', () => {
    test('should add task dependencies successfully', async () => {
      const dependency1 = await createTestTask({
        title: 'Dependency 1',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: user.id
      });
      const dependency2 = await createTestTask({
        title: 'Dependency 2',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: user.id
      });

      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { dependsOnTaskIds: [dependency1.id, dependency2.id] },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await expectSuccess(response, 200);
      expect(json.data.dependsOnTaskIds).toHaveLength(2);
      expect(json.data.dependsOnTaskIds).toContain(dependency1.id);
      expect(json.data.dependsOnTaskIds).toContain(dependency2.id);

      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.dependsOnTaskIds).toHaveLength(2);
    });

    test('should clear dependencies when set to empty array', async () => {
      const dependency = await createTestTask({
        title: 'Dependency',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: user.id
      });
      await updateTestTask(task.id, { dependsOnTaskIds: [dependency.id] });

      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { dependsOnTaskIds: [] },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await expectSuccess(response, 200);
      expect(json.data.dependsOnTaskIds).toHaveLength(0);

      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.dependsOnTaskIds).toHaveLength(0);
    });
  });

  describe('Success Scenarios - Multiple Field Updates', () => {
    test('should update multiple fields simultaneously', async () => {
      const phase = await db.phase.create({
        data: {
          name: 'Multi-Update Phase',
          featureId: feature.id,
          status: 'IN_PROGRESS'
        }
      });

      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        {
          title: 'Updated Title',
          description: 'Updated description',
          status: 'IN_PROGRESS',
          priority: 'HIGH',
          phaseId: phase.id,
          order: 10
        },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await expectSuccess(response, 200);
      expect(json.data.title).toBe('Updated Title');
      expect(json.data.description).toBe('Updated description');
      expect(json.data.status).toBe('IN_PROGRESS');
      expect(json.data.priority).toBe('HIGH');
      expect(json.data.phaseId).toBe(phase.id);
      expect(json.data.order).toBe(10);

      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.title).toBe('Updated Title');
      expect(updatedTask?.status).toBe('IN_PROGRESS');
      expect(updatedTask?.priority).toBe('HIGH');
      expect(updatedTask?.phaseId).toBe(phase.id);
    });

    test('should preserve unchanged fields', async () => {
      const originalTitle = task.title;
      const originalDescription = task.description;

      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { status: 'DONE' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await expectSuccess(response, 200);
      expect(json.data.title).toBe(originalTitle);
      expect(json.data.description).toBe(originalDescription);
      expect(json.data.status).toBe('DONE');
    });
  });

  describe('Authorization', () => {
    test('should return 401 if user is not authenticated', async () => {
      const request = createPatchRequest(`/api/tickets/${task.id}`, { title: 'New Title' });
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectUnauthorized(response);
    });

    test('should return 403 if user is not a workspace member', async () => {
      const otherUser = await createTestUser({ email: 'other@test.com' });
      
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { title: 'New Title' },
        otherUser
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectError(response, "Access denied", 403);
    });

    test('should allow update if user is workspace owner', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { title: 'Owner Update' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectSuccess(response, 200);
    });

    test('should allow update if user is workspace admin', async () => {
      const adminUser = await createTestUser({ email: 'admin@test.com' });
      await db.workspaceMember.create({
        data: {
          userId: adminUser.id,
          workspaceId: workspace.id,
          role: 'ADMIN'
        }
      });
      
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { title: 'Admin Update' },
        adminUser
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectSuccess(response, 200);
    });

    test('should allow update if user is workspace member with any role', async () => {
      const memberUser = await createTestUser({ email: 'member@test.com' });
      await db.workspaceMember.create({
        data: {
          userId: memberUser.id,
          workspaceId: workspace.id,
          role: 'DEVELOPER'
        }
      });
      
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { title: 'Member Update' },
        memberUser
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectSuccess(response, 200);
    });
  });

  describe('Validation - Title', () => {
    test('should reject empty title', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { title: '' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectError(response, "Title cannot be empty", 400);
    });

    test('should reject whitespace-only title', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { title: '   ' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectError(response, "Title cannot be empty", 400);
    });

    test('should reject non-string title', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { title: 123 },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      const json = await response.json();
      expect(response.status).toBe(400);
      expect(json.error).toBeTruthy();
    });
  });

  describe('Validation - Status and Priority', () => {
    test('should reject invalid status value', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { status: 'INVALID_STATUS' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectError(response, "Invalid status", 400);
    });

    test('should reject invalid priority value', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { priority: 'INVALID_PRIORITY' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectError(response, "Invalid priority", 400);
    });

    test('should accept all valid status values', async () => {
      const validStatuses = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED', 'BLOCKED'];
      
      for (const status of validStatuses) {
        const request = createAuthenticatedPatchRequest(
          `/api/tickets/${task.id}`,
          { status },
          user
        );
        const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
        
        await expectSuccess(response, 200);
      }
    });

    test('should accept all valid priority values', async () => {
      const validPriorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
      
      for (const priority of validPriorities) {
        const request = createAuthenticatedPatchRequest(
          `/api/tickets/${task.id}`,
          { priority },
          user
        );
        const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
        
        await expectSuccess(response, 200);
      }
    });
  });

  describe('Validation - Phase', () => {
    test('should reject non-existent phase', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { phaseId: 'non-existent-phase-id' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectError(response, "Phase not found", 404);
    });

    test('should reject phase from different feature', async () => {
      const otherFeature = await db.feature.create({
        data: {
          title: 'Other Feature',
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id
        }
      });
      const otherPhase = await db.phase.create({
        data: {
          name: 'Other Phase',
          featureId: otherFeature.id,
          status: 'IN_PROGRESS'
        }
      });

      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { phaseId: otherPhase.id },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectError(response, "does not belong to this feature", 404);
    });

    test('should reject phase assignment for task without feature', async () => {
      const standaloneTask = await createTestTask({
        title: 'Standalone Task',
        workspaceId: workspace.id,
        featureId: null,
        createdById: user.id
      });
      const phase = await db.phase.create({
        data: {
          name: 'Test Phase',
          featureId: feature.id,
          status: 'IN_PROGRESS'
        }
      });

      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${standaloneTask.id}`,
        { phaseId: phase.id },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: standaloneTask.id })});
      
      // Task without feature might not be accessible via the validation logic
      await expectError(response, "Task not found", 404);
    });
  });

  describe('Validation - Assignee', () => {
    test('should reject non-existent user assignee', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { assigneeId: 'non-existent-user-id' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectError(response, "Assignee not found", 404);
    });

    test('should allow workspace owner as assignee without explicit membership', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { assigneeId: user.id },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectSuccess(response, 200);
    });
  });

  describe('Validation - Order', () => {
    test('should reject non-numeric order', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { order: 'not-a-number' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectError(response, "Order must be a number", 400);
    });

    test('should accept negative order values', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { order: -5 },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectSuccess(response, 200);
    });

    test('should accept zero as order value', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { order: 0 },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectSuccess(response, 200);
    });
  });

  describe('Validation - Dependencies', () => {
    test('should reject non-array dependsOnTaskIds', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { dependsOnTaskIds: 'not-an-array' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectError(response, "dependsOnTaskIds must be an array", 400);
    });

    test('should reject self-dependency', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { dependsOnTaskIds: [task.id] },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectError(response, "A task cannot depend on itself", 400);
    });

    test('should reject non-existent dependency tasks', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { dependsOnTaskIds: ['non-existent-task-id'] },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectError(response, "One or more dependency tasks not found", 404);
    });

    test('should reject dependencies from different feature', async () => {
      const otherFeature = await db.feature.create({
        data: {
          title: 'Other Feature',
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id
        }
      });
      const otherTask = await createTestTask({
        title: 'Other Task',
        workspaceId: workspace.id,
        featureId: otherFeature.id,
        createdById: user.id
      });

      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { dependsOnTaskIds: [otherTask.id] },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectError(response, "Dependencies must be tasks from the same feature", 400);
    });

    test('should reject circular dependencies (A->B, B->A)', async () => {
      // First create a dependency task without any dependencies
      const dependency = await createTestTask({
        title: 'Dependency Task',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: user.id
      });

      // Make dependency task depend on main task (creates B->A)
      await updateTestTask(dependency.id, { dependsOnTaskIds: [task.id] });

      // Now try to make main task depend on dependency (attempts A->B, which should fail)
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { dependsOnTaskIds: [dependency.id] },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectError(response, "Circular dependency detected", 400);
    });

    test('should ignore deleted tasks in dependency validation', async () => {
      const dependency = await createTestTask({
        title: 'Deleted Dependency',
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: user.id
      });
      await updateTestTask(dependency.id, { deleted: true, deletedAt: new Date() });

      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { dependsOnTaskIds: [dependency.id] },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectError(response, "One or more dependency tasks not found", 404);
    });
  });

  describe('Error Handling', () => {
    test('should return 404 for non-existent task', async () => {
      const request = createAuthenticatedPatchRequest(
        '/api/tickets/non-existent-id',
        { title: 'New Title' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: 'non-existent-id' })});
      
      await expectNotFound(response);
    });

    test('should return 404 for deleted task', async () => {
      await updateTestTask(task.id, { deleted: true, deletedAt: new Date() });
      
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { title: 'New Title' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectNotFound(response);
    });

    test('should handle malformed task ID gracefully', async () => {
      const invalidId = 'invalid-uuid-format';
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${invalidId}`,
        { title: 'New Title' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: invalidId })});
      
      const json = await response.json();
      expect([404, 500]).toContain(response.status);
      expect(json.error).toBeTruthy();
    });

    test('should handle database errors gracefully', async () => {
      // Attempt to update with invalid data that will cause DB constraint violation
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { status: 'DONE', phaseId: 'invalid-uuid' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});
      
      const json = await response.json();
      expect([400, 404, 500]).toContain(response.status);
      expect(json.error).toBeTruthy();
    });
  });

  describe('Database Verification', () => {
    test('should update updatedAt timestamp', async () => {
      const originalTask = await db.task.findUnique({ where: { id: task.id } });
      const originalUpdatedAt = originalTask?.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { title: 'Updated Title' },
        user
      );
      await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt!.getTime());
    });

    test('should set updatedById to current user', async () => {
      const otherUser = await createTestUser({ email: 'other@test.com' });
      await db.workspaceMember.create({
        data: {
          userId: otherUser.id,
          workspaceId: workspace.id,
          role: 'DEVELOPER'
        }
      });

      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { title: 'Updated by other user' },
        otherUser
      );
      await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.updatedById).toBe(otherUser.id);
    });

    test('should persist all changes atomically', async () => {
      const phase = await db.phase.create({
        data: {
          name: 'Atomic Phase',
          featureId: feature.id,
          status: 'IN_PROGRESS'
        }
      });

      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        {
          title: 'Atomic Update',
          status: 'IN_PROGRESS',
          priority: 'HIGH',
          phaseId: phase.id,
          order: 99
        },
        user
      );
      await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.title).toBe('Atomic Update');
      expect(updatedTask?.status).toBe('IN_PROGRESS');
      expect(updatedTask?.priority).toBe('HIGH');
      expect(updatedTask?.phaseId).toBe(phase.id);
      expect(updatedTask?.order).toBe(99);
    });

    test('should not modify createdAt or createdById', async () => {
      const originalTask = await db.task.findUnique({ where: { id: task.id } });

      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { title: 'Updated Title' },
        user
      );
      await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.createdAt).toEqual(originalTask?.createdAt);
      expect(updatedTask?.createdById).toBe(originalTask?.createdById);
    });
  });

  describe('Response Format', () => {
    test('should return success response with correct structure', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { title: 'New Title' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await expectSuccess(response, 200);
      expect(json).toHaveProperty('success', true);
      expect(json).toHaveProperty('data');
      expect(json.data).toHaveProperty('id');
      expect(json.data).toHaveProperty('title');
    });

    test('should include all task fields in response', async () => {
      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { title: 'Complete Response' },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await response.json();
      const taskData = json.data;

      expect(taskData).toHaveProperty('id');
      expect(taskData).toHaveProperty('title');
      expect(taskData).toHaveProperty('description');
      expect(taskData).toHaveProperty('status');
      expect(taskData).toHaveProperty('priority');
      expect(taskData).toHaveProperty('order');
      expect(taskData).toHaveProperty('featureId');
      expect(taskData).toHaveProperty('phaseId');
      expect(taskData).toHaveProperty('dependsOnTaskIds');
      expect(taskData).toHaveProperty('createdAt');
      expect(taskData).toHaveProperty('updatedAt');
    });

    test('should include phase details when phase is assigned', async () => {
      const phase = await db.phase.create({
        data: {
          name: 'Response Phase',
          featureId: feature.id,
          status: 'IN_PROGRESS'
        }
      });

      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { phaseId: phase.id },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await response.json();
      expect(json.data.phase).toBeTruthy();
      expect(json.data.phase.id).toBe(phase.id);
      expect(json.data.phase.name).toBe('Response Phase');
    });

    test('should include assignee details when assignee is set', async () => {
      const assignee = await createTestUser({ email: 'assignee@test.com', name: 'Assignee Name' });
      await db.workspaceMember.create({
        data: {
          userId: assignee.id,
          workspaceId: workspace.id,
          role: 'DEVELOPER'
        }
      });

      const request = createAuthenticatedPatchRequest(
        `/api/tickets/${task.id}`,
        { assigneeId: assignee.id },
        user
      );
      const response = await PATCH(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await response.json();
      expect(json.data.assignee).toBeTruthy();
      expect(json.data.assignee.id).toBe(assignee.id);
      expect(json.data.assignee.name).toBe('Assignee Name');
    });
  });
});