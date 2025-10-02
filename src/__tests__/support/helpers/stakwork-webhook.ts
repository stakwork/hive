import { vi } from "vitest";
import { db } from "@/lib/db";
import { mapStakworkStatus } from "@/utils/conversions";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { WorkflowStatus } from "@prisma/client";
import type { CreateMockTaskOptions } from "@/__tests__/support/fixtures/stakwork";

/**
 * Sets up commonly used mocks for Stakwork webhook tests
 * Returns mock functions for easy assertion checking
 */
export function setupStakworkWebhookMocks() {
  // Database mocks
  const mockDbTaskFindFirst = vi.mocked(db.task.findFirst);
  const mockDbTaskUpdate = vi.mocked(db.task.update);
  
  // Status mapping mock
  const mockMapStakworkStatus = vi.mocked(mapStakworkStatus);
  
  // Pusher mocks
  const mockPusherTrigger = vi.mocked(pusherServer.trigger);
  const mockGetTaskChannelName = vi.mocked(getTaskChannelName);

  return {
    database: {
      findFirst: mockDbTaskFindFirst,
      update: mockDbTaskUpdate,
    },
    statusMapping: mockMapStakworkStatus,
    pusher: {
      trigger: mockPusherTrigger,
      getChannelName: mockGetTaskChannelName,
    },
  };
}

/**
 * Sets up database mocks with typical task responses
 * Returns the mock objects for use in tests
 */
export function setupDatabaseMocks(taskOptions: CreateMockTaskOptions = {}) {
  const { createMockTask } = require("@/__tests__/support/fixtures/stakwork");
  
  const mockTask = createMockTask(taskOptions);
  const mockUpdatedTask = createMockTask({
    ...taskOptions,
    workflowStatus: WorkflowStatus.COMPLETED,
    workflowCompletedAt: new Date(),
    updatedAt: new Date(),
  });

  vi.mocked(db.task.findFirst).mockResolvedValue(mockTask);
  vi.mocked(db.task.update).mockResolvedValue(mockUpdatedTask);

  return { mockTask, mockUpdatedTask };
}

/**
 * Sets up status mapping mock to return specific workflow status
 */
export function setupStatusMapping(status: string, workflowStatus: WorkflowStatus | null) {
  vi.mocked(mapStakworkStatus).mockReturnValue(workflowStatus);
}

/**
 * Sets up Pusher mock with default responses
 */
export function setupPusherMock(taskId: string = "test-task-id") {
  vi.mocked(pusherServer.trigger).mockResolvedValue({} as any);
  vi.mocked(getTaskChannelName).mockReturnValue(`task-${taskId}`);
}

/**
 * Helper to configure common test scenarios
 */
export const StakworkWebhookTestScenarios = {
  /**
   * Sets up mocks for a successful completed webhook scenario
   */
  completedWorkflow(taskId: string = "test-task-id") {
    const { mockTask, mockUpdatedTask } = setupDatabaseMocks({
      id: taskId,
      workflowStatus: WorkflowStatus.PENDING,
    });
    setupStatusMapping("completed", WorkflowStatus.COMPLETED);
    setupPusherMock(taskId);
    
    return { mockTask, mockUpdatedTask };
  },

  /**
   * Sets up mocks for an in-progress webhook scenario  
   */
  inProgressWorkflow(taskId: string = "test-task-id") {
    const { mockTask, mockUpdatedTask } = setupDatabaseMocks({
      id: taskId,
      workflowStatus: WorkflowStatus.PENDING,
    });
    setupStatusMapping("in_progress", WorkflowStatus.IN_PROGRESS);
    setupPusherMock(taskId);
    
    return { mockTask, mockUpdatedTask };
  },

  /**
   * Sets up mocks for a failed webhook scenario
   */
  failedWorkflow(taskId: string = "test-task-id") {
    const { mockTask, mockUpdatedTask } = setupDatabaseMocks({
      id: taskId,
      workflowStatus: WorkflowStatus.PENDING,
    });
    setupStatusMapping("failed", WorkflowStatus.FAILED);
    setupPusherMock(taskId);
    
    return { mockTask, mockUpdatedTask };
  },

  /**
   * Sets up mocks for an unknown status scenario
   */
  unknownStatus(taskId: string = "test-task-id") {
    const { mockTask } = setupDatabaseMocks({
      id: taskId,
      workflowStatus: WorkflowStatus.PENDING,
    });
    setupStatusMapping("unknown_status", null);
    setupPusherMock(taskId);
    
    return { mockTask };
  },

  /**
   * Sets up mocks for a task not found scenario
   */
  taskNotFound() {
    vi.mocked(db.task.findFirst).mockResolvedValue(null);
    setupPusherMock();
  },

  /**
   * Sets up mocks for a database error scenario
   */
  databaseError() {
    vi.mocked(db.task.findFirst).mockRejectedValue(new Error("Database error"));
  },
};
