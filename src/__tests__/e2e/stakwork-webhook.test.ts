import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkflowStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { pusherServer } from '@/lib/pusher';

// Only run these tests in integration test environment
const isIntegrationTest = process.env.TEST_SUITE === 'integration';

describe.skipIf(!isIntegrationTest)('Stakwork Webhook E2E Tests', () => {
  let testTask: any;
  let mockPusherEvents: any[] = [];

  beforeEach(async () => {
    // Clear any previous test data
    mockPusherEvents = [];

    // Mock Pusher to capture events instead of actually broadcasting
    vi.spyOn(pusherServer, 'trigger').mockImplementation(async (channel, event, data) => {
      mockPusherEvents.push({ channel, event, data });
      return true;
    });

    // Create a test task in the database
    testTask = await db.task.create({
      data: {
        id: `test-task-${Date.now()}`,
        title: 'Test Task for Webhook',
        description: 'Test task for webhook integration testing',
        workflowStatus: WorkflowStatus.PENDING,
        workspaceId: 'test-workspace-1',
        createdById: 'test-user-1',
        deleted: false,
      },
    });
  });

  afterEach(async () => {
    // Clean up test data
    if (testTask) {
      await db.task.delete({
        where: { id: testTask.id },
      });
    }

    // Restore mocks
    vi.restoreAllMocks();
  });

  const sendWebhook = async (payload: Record<string, unknown>) => {
    const response = await fetch(`http://localhost:3000/api/stakwork/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    return {
      response,
      data: await response.json(),
    };
  };

  describe('Complete Workflow Status Updates', () => {
    it('should handle complete workflow: PENDING → IN_PROGRESS → COMPLETED', async () => {
      // Step 1: Start workflow (PENDING → IN_PROGRESS)
      const startResult = await sendWebhook({
        project_status: 'in_progress',
        task_id: testTask.id,
        workflow_id: 123,
        workflow_version_id: 456,
      });

      expect(startResult.response.status).toBe(200);
      expect(startResult.data.success).toBe(true);
      expect(startResult.data.data.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);

      // Verify database was updated
      const taskAfterStart = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(taskAfterStart?.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
      expect(taskAfterStart?.workflowStartedAt).toBeTruthy();
      expect(taskAfterStart?.workflowCompletedAt).toBeNull();

      // Verify Pusher event was triggered
      expect(mockPusherEvents).toHaveLength(1);
      expect(mockPusherEvents[0]).toMatchObject({
        channel: `task-${testTask.id}`,
        event: 'workflow-status-update',
        data: expect.objectContaining({
          taskId: testTask.id,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
        }),
      });

      // Step 2: Complete workflow (IN_PROGRESS → COMPLETED)
      mockPusherEvents = []; // Reset events array
      
      const completeResult = await sendWebhook({
        project_status: 'completed',
        task_id: testTask.id,
        workflow_id: 123,
        workflow_version_id: 456,
      });

      expect(completeResult.response.status).toBe(200);
      expect(completeResult.data.success).toBe(true);
      expect(completeResult.data.data.workflowStatus).toBe(WorkflowStatus.COMPLETED);

      // Verify final database state
      const taskAfterComplete = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(taskAfterComplete?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
      expect(taskAfterComplete?.workflowStartedAt).toBeTruthy();
      expect(taskAfterComplete?.workflowCompletedAt).toBeTruthy();

      // Verify second Pusher event
      expect(mockPusherEvents).toHaveLength(1);
      expect(mockPusherEvents[0]).toMatchObject({
        channel: `task-${testTask.id}`,
        event: 'workflow-status-update',
        data: expect.objectContaining({
          taskId: testTask.id,
          workflowStatus: WorkflowStatus.COMPLETED,
        }),
      });
    });

    it('should handle failure workflow: PENDING → IN_PROGRESS → FAILED', async () => {
      // Start workflow
      await sendWebhook({
        project_status: 'in_progress',
        task_id: testTask.id,
      });

      // Fail workflow
      mockPusherEvents = [];
      
      const failResult = await sendWebhook({
        project_status: 'failed',
        task_id: testTask.id,
      });

      expect(failResult.response.status).toBe(200);
      expect(failResult.data.data.workflowStatus).toBe(WorkflowStatus.FAILED);

      // Verify database state
      const failedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(failedTask?.workflowStatus).toBe(WorkflowStatus.FAILED);
      expect(failedTask?.workflowCompletedAt).toBeTruthy();
    });

    it('should handle halted workflow: PENDING → IN_PROGRESS → HALTED', async () => {
      // Start workflow
      await sendWebhook({
        project_status: 'processing',
        task_id: testTask.id,
      });

      // Halt workflow
      mockPusherEvents = [];
      
      const haltResult = await sendWebhook({
        project_status: 'halted',
        task_id: testTask.id,
      });

      expect(haltResult.response.status).toBe(200);
      expect(haltResult.data.data.workflowStatus).toBe(WorkflowStatus.HALTED);

      // Verify database state
      const haltedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(haltedTask?.workflowStatus).toBe(WorkflowStatus.HALTED);
      expect(haltedTask?.workflowCompletedAt).toBeTruthy();
    });
  });

  describe('Error Scenarios', () => {
    it('should handle unknown status without affecting task state', async () => {
      const originalStatus = testTask.workflowStatus;
      
      const result = await sendWebhook({
        project_status: 'completely_unknown_status',
        task_id: testTask.id,
      });

      expect(result.response.status).toBe(200);
      expect(result.data.success).toBe(true);
      expect(result.data.message).toContain('Unknown status');
      expect(result.data.data.action).toBe('ignored');

      // Verify task state unchanged
      const unchangedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(unchangedTask?.workflowStatus).toBe(originalStatus);

      // Verify no Pusher events
      expect(mockPusherEvents).toHaveLength(0);
    });

    it('should handle non-existent task gracefully', async () => {
      const result = await sendWebhook({
        project_status: 'in_progress',
        task_id: 'non-existent-task-id',
      });

      expect(result.response.status).toBe(404);
      expect(result.data.error).toBe('Task not found');
    });

    it('should handle malformed webhook payload', async () => {
      const response = await fetch(`http://localhost:3000/api/stakwork/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: 'invalid json payload',
      });

      expect(response.status).toBe(500);
    });
  });

  describe('Pusher Broadcasting Validation', () => {
    it('should broadcast correct event structure for all status updates', async () => {
      const statusUpdates = [
        { status: 'in_progress', expected: WorkflowStatus.IN_PROGRESS },
        { status: 'completed', expected: WorkflowStatus.COMPLETED },
      ];

      for (const { status, expected } of statusUpdates) {
        mockPusherEvents = [];
        
        await sendWebhook({
          project_status: status,
          task_id: testTask.id,
        });

        expect(mockPusherEvents).toHaveLength(1);
        
        const event = mockPusherEvents[0];
        expect(event.channel).toBe(`task-${testTask.id}`);
        expect(event.event).toBe('workflow-status-update');
        expect(event.data).toMatchObject({
          taskId: testTask.id,
          workflowStatus: expected,
          timestamp: expect.any(Date),
        });

        // Check for appropriate timestamps in the broadcast
        if (expected === WorkflowStatus.IN_PROGRESS) {
          expect(event.data.workflowStartedAt).toBeTruthy();
        }
        if ([WorkflowStatus.COMPLETED, WorkflowStatus.FAILED, WorkflowStatus.HALTED].includes(expected)) {
          expect(event.data.workflowCompletedAt).toBeTruthy();
        }
      }
    });

    it('should use correct channel naming convention', async () => {
      await sendWebhook({
        project_status: 'in_progress',
        task_id: testTask.id,
      });

      expect(mockPusherEvents[0].channel).toBe(`task-${testTask.id}`);
    });

    it('should handle Pusher failures without affecting webhook success', async () => {
      // Make Pusher fail
      vi.spyOn(pusherServer, 'trigger').mockRejectedValue(new Error('Pusher service unavailable'));

      const result = await sendWebhook({
        project_status: 'in_progress',
        task_id: testTask.id,
      });

      // Webhook should still succeed
      expect(result.response.status).toBe(200);
      expect(result.data.success).toBe(true);

      // Task should still be updated in database
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
    });
  });

  describe('Task ID Resolution', () => {
    it('should use task_id from request body when available', async () => {
      const result = await sendWebhook({
        project_status: 'in_progress',
        task_id: testTask.id,
      });

      expect(result.response.status).toBe(200);
      expect(result.data.data.taskId).toBe(testTask.id);
    });

    it('should use task_id from query parameter when not in body', async () => {
      const response = await fetch(`http://localhost:3000/api/stakwork/webhook?task_id=${testTask.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project_status: 'in_progress',
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.data.taskId).toBe(testTask.id);
    });

    it('should prioritize body task_id over query parameter', async () => {
      const response = await fetch(`http://localhost:3000/api/stakwork/webhook?task_id=wrong-id`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project_status: 'in_progress',
          task_id: testTask.id, // This should take precedence
        }),
      });

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.data.taskId).toBe(testTask.id);
    });
  });
});