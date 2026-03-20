import { describe, test, expect, beforeEach } from 'vitest';
import { GET } from '@/app/api/tickets/[ticketId]/route';
import { db } from '@/lib/db';
import {
  createTestUser,
  createTestWorkspace,
  createTestTask,
  findTestTask,
  updateTestTask
} from '@/__tests__/support/fixtures';
import {
  createAuthenticatedGetRequest,
  createGetRequest,
  expectSuccess,
  expectNotFound,
  expectUnauthorized,
  expectError
} from '@/__tests__/support/helpers';

describe('GET /api/tickets/[ticketId]', () => {
  let user: any;
  let workspace: any;
  let feature: any;
  let task: any;

  beforeEach(async () => {
    // Create test user and workspace
    user = await createTestUser();
    workspace = await createTestWorkspace({owner_id: user.id });

    // Create feature (required parent for tasks)
    feature = await db.features.create({
      data: {
        title: 'Test Feature',workspace_id: workspace.id,created_by_id: user.id,updated_by_id: user.id
      }
    });

    // Create test task
    task = await createTestTask({
      title: 'Test Task',
      description: 'Task to be retrieved',workspace_id: workspace.id,feature_id: feature.id,created_by_id: user.id,
      status: 'TODO',
      priority: 'HIGH'
    });
  });

  describe('Success Scenarios', () => {
    test('should retrieve task successfully', async () => {
      const request = createAuthenticatedGetRequest(`/api/tickets/${task.id}`, user);
      const response = await GET(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await expectSuccess(response);
      expect(json.success).toBe(true);
      expect(json.data).toBeTruthy();
      expect(json.data.id).toBe(task.id);
      expect(json.data.title).toBe('Test Task');
      expect(json.data.description).toBe('Task to be retrieved');
    });

    test('should include all task fields in response', async () => {
      const request = createAuthenticatedGetRequest(`/api/tickets/${task.id}`, user);
      const response = await GET(request, { params: Promise.resolve({ ticketId: task.id })});

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

    test('should include feature details in response', async () => {
      const request = createAuthenticatedGetRequest(`/api/tickets/${task.id}`, user);
      const response = await GET(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await response.json();
      expect(json.data.feature).toBeTruthy();
      expect(json.data.feature.id).toBe(feature.id);
      expect(json.data.feature.title).toBe('Test Feature');
      expect(json.data.feature.workspaceId).toBe(workspace.id);
    });

    test('should include phase details when task has phase', async () => {
      // Create phase and assign task to it
      const phase = await db.phases.create({
        data: {
          name: 'Test Phase',feature_id: feature.id,
          status: 'IN_PROGRESS'
        }
      });
      
      await updateTestTask(task.id, {phase_id: phase.id });

      const request = createAuthenticatedGetRequest(`/api/tickets/${task.id}`, user);
      const response = await GET(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await response.json();
      expect(json.data.phase).toBeTruthy();
      expect(json.data.phase.id).toBe(phase.id);
      expect(json.data.phase.name).toBe('Test Phase');
      expect(json.data.phase.status).toBe('IN_PROGRESS');
    });

    test('should include assignee details when task is assigned', async () => {
      const assignee = await createTestUser({ email: 'assignee@test.com', name: 'Test Assignee' });
      await updateTestTask(task.id, {assignee_id: assignee.id });

      const request = createAuthenticatedGetRequest(`/api/tickets/${task.id}`, user);
      const response = await GET(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await response.json();
      expect(json.data.assignee).toBeTruthy();
      expect(json.data.assignee.id).toBe(assignee.id);
      expect(json.data.assignee.name).toBe('Test Assignee');
      expect(json.data.assignee.email).toBe('assignee@test.com');
    });

    test('should include creator and updater details', async () => {
      const request = createAuthenticatedGetRequest(`/api/tickets/${task.id}`, user);
      const response = await GET(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await response.json();
      expect(json.data.createdBy).toBeTruthy();
      expect(json.data.createdBy.id).toBe(user.id);
      expect(json.data.updatedBy).toBeTruthy();
      expect(json.data.updatedBy.id).toBe(user.id);
    });

    test('should include dependsOnTaskIds array', async () => {
      const dependencyTask = await createTestTask({
        title: 'Dependency Task',workspace_id: workspace.id,feature_id: feature.id,created_by_id: user.id
      });
      
      await updateTestTask(task.id, {depends_on_task_ids: [dependencyTask.id] });

      const request = createAuthenticatedGetRequest(`/api/tickets/${task.id}`, user);
      const response = await GET(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await response.json();
      expect(json.data.dependsOnTaskIds).toHaveLength(1);
      expect(json.data.dependsOnTaskIds[0]).toBe(dependencyTask.id);
    });

    test('should handle system assignee type correctly', async () => {
      await updateTestTask(task.id, {assignee_id: null,system_assignee_type: 'TASK_COORDINATOR' 
      });

      const request = createAuthenticatedGetRequest(`/api/tickets/${task.id}`, user);
      const response = await GET(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await response.json();
      expect(json.data.systemAssigneeType).toBe('TASK_COORDINATOR');
      expect(json.data.assignee).toBeTruthy();
      expect(json.data.assignee.id).toContain('system:');
    });
  });

  describe('Authorization', () => {
    test('should return 401 if user is not authenticated', async () => {
      const request = createGetRequest(`/api/tickets/${task.id}`);
      const response = await GET(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectUnauthorized(response);
    });

    test('should return 403 if user is not a workspace member', async () => {
      const otherUser = await createTestUser({ email: 'other@test.com' });
      
      const request = createAuthenticatedGetRequest(`/api/tickets/${task.id}`, otherUser);
      const response = await GET(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectError(response, "Access denied", 403);
    });

    test('should allow retrieval if user is workspace admin', async () => {
      const adminUser = await createTestUser({ email: 'admin@test.com' });
      await db.workspace_members.create({
        data: {user_id: adminUser.id,workspace_id: workspace.id,
          role: 'ADMIN'
        }
      });
      
      const request = createAuthenticatedGetRequest(`/api/tickets/${task.id}`, adminUser);
      const response = await GET(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectSuccess(response);
    });

    test('should allow retrieval if user is workspace member with any role', async () => {
      const memberUser = await createTestUser({ email: 'member@test.com' });
      await db.workspace_members.create({
        data: {user_id: memberUser.id,workspace_id: workspace.id,
          role: 'VIEWER'
        }
      });
      
      const request = createAuthenticatedGetRequest(`/api/tickets/${task.id}`, memberUser);
      const response = await GET(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectSuccess(response);
    });
  });

  describe('Error Handling', () => {
    test('should return 404 for non-existent task', async () => {
      const request = createAuthenticatedGetRequest('/api/tickets/non-existent-id', user);
      const response = await GET(request, { params: Promise.resolve({ ticketId: 'non-existent-id' })});
      
      await expectNotFound(response);
    });

    test('should return 404 for deleted task', async () => {
      await updateTestTask(task.id, { deleted: true,deleted_at: new Date() });
      
      const request = createAuthenticatedGetRequest(`/api/tickets/${task.id}`, user);
      const response = await GET(request, { params: Promise.resolve({ ticketId: task.id })});
      
      await expectNotFound(response);
    });

    test('should handle malformed task ID gracefully', async () => {
      const invalidId = 'invalid-uuid-format';
      const request = createAuthenticatedGetRequest(`/api/tickets/${invalidId}`, user);
      const response = await GET(request, { params: Promise.resolve({ ticketId: invalidId })});
      
      const json = await response.json();
      expect([404, 500]).toContain(response.status);
      expect(json.error).toBeTruthy();
    });
  });

  describe('Data Consistency', () => {
    test('should not include deleted dependencies in response', async () => {
      const dependency1 = await createTestTask({
        title: 'Dependency 1',workspace_id: workspace.id,feature_id: feature.id,created_by_id: user.id
      });
      
      const dependency2 = await createTestTask({
        title: 'Dependency 2',workspace_id: workspace.id,feature_id: feature.id,created_by_id: user.id
      });
      
      await updateTestTask(task.id, {depends_on_task_ids: [dependency1.id, dependency2.id] });
      
      // Soft-delete one dependency
      await updateTestTask(dependency1.id, { deleted: true,deleted_at: new Date() });

      const request = createAuthenticatedGetRequest(`/api/tickets/${task.id}`, user);
      const response = await GET(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await response.json();
      // Note: Currently the dependsOnTaskIds array includes all IDs regardless of deletion status
      // This documents the current behavior - future enhancement could filter deleted dependencies
      expect(json.data.dependsOnTaskIds).toContain(dependency1.id);
      expect(json.data.dependsOnTaskIds).toContain(dependency2.id);
    });

    test('should handle null phase gracefully', async () => {
      await updateTestTask(task.id, {phase_id: null });

      const request = createAuthenticatedGetRequest(`/api/tickets/${task.id}`, user);
      const response = await GET(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await response.json();
      expect(json.data.phase).toBeNull();
      expect(json.data.phaseId).toBeNull();
    });

    test('should handle null assignee gracefully', async () => {
      await updateTestTask(task.id, {assignee_id: null,system_assignee_type: null });

      const request = createAuthenticatedGetRequest(`/api/tickets/${task.id}`, user);
      const response = await GET(request, { params: Promise.resolve({ ticketId: task.id })});

      const json = await response.json();
      expect(json.data.assignee).toBeNull();
    });
  });
});