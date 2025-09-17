import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/stakwork/webhook/route';
import { db } from '@/lib/db';
import { pusherServer } from '@/lib/pusher';
import { WorkflowStatus } from '@prisma/client';

// Mock external dependencies
vi.mock('@/lib/db', () => ({
  db: {
    task: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/pusher', () => ({
  pusherServer: {
    trigger: vi.fn(),
  },
  getTaskChannelName: vi.fn((taskId: string) => `task-${taskId}`),
  PUSHER_EVENTS: {
    WORKFLOW_STATUS_UPDATE: 'workflow-status-update',
  },
}));

const mockDb = db as {
  task: {
    findFirst: Mock;
    update: Mock;
  };
};

const mockPusher = pusherServer as {
  trigger: Mock;
};

describe('/api/stakwork/webhook Integration Tests', () => {
  const mockTask = {
    id: 'task-123',
    workflowStatus: WorkflowStatus.PENDING,
    workflowStartedAt: null,
    workflowCompletedAt: null,
    deleted: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.task.findFirst.mockResolvedValue(mockTask);
    mockDb.task.update.mockResolvedValue({
      ...mockTask,
      workflowStatus: WorkflowStatus.IN_PROGRESS,
      workflowStartedAt: new Date(),
    });
    mockPusher.trigger.mockResolvedValue(true);
  });

  const createRequest = (body: Record<string, unknown>, searchParams?: Record<string, string>) => {
    const url = new URL('http://localhost/api/stakwork/webhook');
    if (searchParams) {
      Object.entries(searchParams).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }
    
    return new NextRequest(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
      },
    });
  };

  describe('Successful Status Updates', () => {
    it('should successfully update task to IN_PROGRESS status', async () => {
      const request = createRequest({
        project_status: 'in_progress',
        task_id: 'task-123',
        workflow_id: 456,
        workflow_version_id: 789,
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.data.taskId).toBe('task-123');
      expect(responseData.data.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);

      // Verify database update was called correctly
      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: 'task-123' },
        data: expect.objectContaining({
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: expect.any(Date),
          updatedAt: expect.any(Date),
        }),
      });

      // Verify Pusher broadcast was triggered
      expect(mockPusher.trigger).toHaveBeenCalledWith(
        'task-task-123',
        'workflow-status-update',
        expect.objectContaining({
          taskId: 'task-123',
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          timestamp: expect.any(Date),
        })
      );
    });

    it('should successfully update task to COMPLETED status', async () => {
      const request = createRequest({
        project_status: 'completed',
        task_id: 'task-123',
      });

      mockDb.task.update.mockResolvedValue({
        ...mockTask,
        workflowStatus: WorkflowStatus.COMPLETED,
        workflowCompletedAt: new Date(),
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.data.workflowStatus).toBe(WorkflowStatus.COMPLETED);

      // Verify completion timestamp was set
      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: 'task-123' },
        data: expect.objectContaining({
          workflowStatus: WorkflowStatus.COMPLETED,
          workflowCompletedAt: expect.any(Date),
          updatedAt: expect.any(Date),
        }),
      });
    });

    it('should use task_id from query parameter when not in body', async () => {
      const request = createRequest(
        { project_status: 'in_progress' },
        { task_id: 'task-456' }
      );

      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.data.taskId).toBe('task-456');
      
      expect(mockDb.task.findFirst).toHaveBeenCalledWith({
        where: { id: 'task-456', deleted: false },
      });
    });
  });

  describe('Unknown Status Handling', () => {
    it('should handle unknown status gracefully without updating task', async () => {
      const request = createRequest({
        project_status: 'unknown_status',
        task_id: 'task-123',
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.message).toContain("Unknown status 'unknown_status'");
      expect(responseData.data.action).toBe('ignored');
      expect(responseData.data.receivedStatus).toBe('unknown_status');

      // Verify no database update or Pusher broadcast
      expect(mockDb.task.update).not.toHaveBeenCalled();
      expect(mockPusher.trigger).not.toHaveBeenCalled();
    });

    it('should handle empty status string', async () => {
      const request = createRequest({
        project_status: '',
        task_id: 'task-123',
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(400);
      expect(responseData.error).toBe('project_status is required');
    });
  });

  describe('Error Handling', () => {
    it('should return 400 when task_id is missing', async () => {
      const request = createRequest({
        project_status: 'in_progress',
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(400);
      expect(responseData.error).toBe('task_id is required');
    });

    it('should return 400 when project_status is missing', async () => {
      const request = createRequest({
        task_id: 'task-123',
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(400);
      expect(responseData.error).toBe('project_status is required');
    });

    it('should return 404 when task is not found', async () => {
      mockDb.task.findFirst.mockResolvedValue(null);

      const request = createRequest({
        project_status: 'in_progress',
        task_id: 'nonexistent-task',
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(404);
      expect(responseData.error).toBe('Task not found');
    });

    it('should return 404 when task is deleted', async () => {
      mockDb.task.findFirst.mockResolvedValue(null);

      const request = createRequest({
        project_status: 'in_progress',
        task_id: 'deleted-task',
      });

      const response = await POST(request);
      
      expect(response.status).toBe(404);
    });

    it('should handle database errors gracefully', async () => {
      mockDb.task.findFirst.mockRejectedValue(new Error('Database connection failed'));

      const request = createRequest({
        project_status: 'in_progress',
        task_id: 'task-123',
      });

      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.error).toBe('Failed to process webhook');
    });

    it('should handle Pusher broadcast errors gracefully but still update task', async () => {
      mockPusher.trigger.mockRejectedValue(new Error('Pusher connection failed'));

      const request = createRequest({
        project_status: 'in_progress',
        task_id: 'task-123',
      });

      const response = await POST(request);
      const responseData = await response.json();

      // Should still return success even if Pusher fails
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      
      // Task should still be updated
      expect(mockDb.task.update).toHaveBeenCalled();
    });
  });

  describe('State Transitions', () => {
    it('should set workflowStartedAt when transitioning to IN_PROGRESS', async () => {
      const request = createRequest({
        project_status: 'in_progress',
        task_id: 'task-123',
      });

      await POST(request);

      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: 'task-123' },
        data: expect.objectContaining({
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: expect.any(Date),
        }),
      });
    });

    it('should set workflowCompletedAt for terminal statuses', async () => {
      const terminalStatuses = [
        { status: 'completed', expected: WorkflowStatus.COMPLETED },
        { status: 'failed', expected: WorkflowStatus.FAILED },
        { status: 'halted', expected: WorkflowStatus.HALTED },
      ];

      for (const { status, expected } of terminalStatuses) {
        vi.clearAllMocks();
        
        const request = createRequest({
          project_status: status,
          task_id: 'task-123',
        });

        await POST(request);

        expect(mockDb.task.update).toHaveBeenCalledWith({
          where: { id: 'task-123' },
          data: expect.objectContaining({
            workflowStatus: expected,
            workflowCompletedAt: expect.any(Date),
          }),
        });
      }
    });

    it('should not set timestamps for non-transitional updates', async () => {
      // Mock a status that doesn't trigger timestamp updates
      const request = createRequest({
        project_status: 'some_other_status',
        task_id: 'task-123',
      });

      // This would be handled as unknown status, so no database update
      const response = await POST(request);
      
      expect(response.status).toBe(200);
      expect(mockDb.task.update).not.toHaveBeenCalled();
    });
  });

  describe('Payload Validation', () => {
    it('should handle malformed JSON gracefully', async () => {
      const request = new NextRequest('http://localhost/api/stakwork/webhook', {
        method: 'POST',
        body: 'invalid json {',
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      
      expect(response.status).toBe(500);
    });

    it('should handle missing request body', async () => {
      const request = new NextRequest('http://localhost/api/stakwork/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      
      expect(response.status).toBe(500);
    });
  });
});