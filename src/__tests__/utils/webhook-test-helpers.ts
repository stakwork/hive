import { vi } from 'vitest';
import { WorkflowStatus } from '@prisma/client';

/**
 * Mock task data factory for testing
 */
export const createMockTask = (overrides: Partial<any> = {}) => ({
  id: 'test-task-123',
  title: 'Test Task',
  description: 'Test task description',
  workflowStatus: WorkflowStatus.PENDING,
  workflowStartedAt: null,
  workflowCompletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deleted: false,
  workspaceId: 'test-workspace',
  createdById: 'test-user',
  ...overrides,
});

/**
 * Mock Pusher server for testing
 */
export const createMockPusherServer = () => {
  const events: Array<{
    channel: string;
    event: string;
    data: any;
    timestamp: Date;
  }> = [];

  const trigger = vi.fn().mockImplementation(async (channel: string, event: string, data: any) => {
    events.push({
      channel,
      event,
      data,
      timestamp: new Date(),
    });
    return true;
  });

  const getEvents = () => [...events];
  const clearEvents = () => events.splice(0, events.length);
  const getLastEvent = () => events[events.length - 1];
  const getEventsForChannel = (channel: string) => events.filter(e => e.channel === channel);

  return {
    trigger,
    getEvents,
    clearEvents,
    getLastEvent,
    getEventsForChannel,
  };
};

/**
 * Mock database for testing
 */
export const createMockDatabase = () => {
  let tasks = new Map<string, any>();

  const task = {
    findFirst: vi.fn().mockImplementation(({ where }: { where: any }) => {
      const task = tasks.get(where.id);
      if (!task || task.deleted) {
        return Promise.resolve(null);
      }
      return Promise.resolve(task);
    }),

    findUnique: vi.fn().mockImplementation(({ where }: { where: any }) => {
      const task = tasks.get(where.id);
      return Promise.resolve(task || null);
    }),

    update: vi.fn().mockImplementation(({ where, data }: { where: any; data: any }) => {
      const existingTask = tasks.get(where.id);
      if (!existingTask) {
        throw new Error(`Task not found: ${where.id}`);
      }
      
      const updatedTask = {
        ...existingTask,
        ...data,
        updatedAt: new Date(),
      };
      
      tasks.set(where.id, updatedTask);
      return Promise.resolve(updatedTask);
    }),

    create: vi.fn().mockImplementation(({ data }: { data: any }) => {
      const task = {
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      tasks.set(data.id, task);
      return Promise.resolve(task);
    }),

    delete: vi.fn().mockImplementation(({ where }: { where: any }) => {
      const task = tasks.get(where.id);
      if (task) {
        tasks.delete(where.id);
      }
      return Promise.resolve(task);
    }),
  };

  const seedTask = (task: any) => {
    tasks.set(task.id, task);
  };

  const clearTasks = () => {
    tasks.clear();
  };

  const getTasks = () => Array.from(tasks.values());

  return {
    task,
    seedTask,
    clearTasks,
    getTasks,
  };
};

/**
 * Webhook payload factory for testing
 */
export const createWebhookPayload = (overrides: Partial<any> = {}) => ({
  project_status: 'in_progress',
  task_id: 'test-task-123',
  workflow_id: 456,
  workflow_version_id: 789,
  workflow_version: 1,
  project_output: {},
  ...overrides,
});

/**
 * Status mapping test cases
 */
export const statusMappingTestCases = [
  // IN_PROGRESS mappings
  { input: 'in_progress', expected: WorkflowStatus.IN_PROGRESS },
  { input: 'IN_PROGRESS', expected: WorkflowStatus.IN_PROGRESS },
  { input: 'running', expected: WorkflowStatus.IN_PROGRESS },
  { input: 'processing', expected: WorkflowStatus.IN_PROGRESS },

  // COMPLETED mappings
  { input: 'completed', expected: WorkflowStatus.COMPLETED },
  { input: 'COMPLETED', expected: WorkflowStatus.COMPLETED },
  { input: 'success', expected: WorkflowStatus.COMPLETED },
  { input: 'finished', expected: WorkflowStatus.COMPLETED },

  // FAILED mappings
  { input: 'error', expected: WorkflowStatus.FAILED },
  { input: 'failed', expected: WorkflowStatus.FAILED },
  { input: 'ERROR', expected: WorkflowStatus.FAILED },

  // HALTED mappings
  { input: 'halted', expected: WorkflowStatus.HALTED },
  { input: 'HALTED', expected: WorkflowStatus.HALTED },
  { input: 'paused', expected: WorkflowStatus.HALTED },
  { input: 'stopped', expected: WorkflowStatus.HALTED },

  // Unknown status cases
  { input: 'unknown_status', expected: null },
  { input: 'invalid', expected: null },
  { input: '', expected: null },
  { input: 'random_text', expected: null },
];

/**
 * State transition test scenarios
 */
export const stateTransitionScenarios = [
  {
    name: 'successful completion workflow',
    transitions: [
      { from: WorkflowStatus.PENDING, to: 'in_progress', expected: WorkflowStatus.IN_PROGRESS },
      { from: WorkflowStatus.IN_PROGRESS, to: 'completed', expected: WorkflowStatus.COMPLETED },
    ],
  },
  {
    name: 'failure workflow',
    transitions: [
      { from: WorkflowStatus.PENDING, to: 'processing', expected: WorkflowStatus.IN_PROGRESS },
      { from: WorkflowStatus.IN_PROGRESS, to: 'failed', expected: WorkflowStatus.FAILED },
    ],
  },
  {
    name: 'halted workflow',
    transitions: [
      { from: WorkflowStatus.PENDING, to: 'running', expected: WorkflowStatus.IN_PROGRESS },
      { from: WorkflowStatus.IN_PROGRESS, to: 'halted', expected: WorkflowStatus.HALTED },
    ],
  },
];

/**
 * Error scenario test cases
 */
export const errorScenarios = [
  {
    name: 'missing task_id',
    payload: { project_status: 'in_progress' },
    expectedStatus: 400,
    expectedError: 'task_id is required',
  },
  {
    name: 'missing project_status',
    payload: { task_id: 'test-task-123' },
    expectedStatus: 400,
    expectedError: 'project_status is required',
  },
  {
    name: 'empty project_status',
    payload: { task_id: 'test-task-123', project_status: '' },
    expectedStatus: 400,
    expectedError: 'project_status is required',
  },
  {
    name: 'task not found',
    payload: { task_id: 'nonexistent-task', project_status: 'in_progress' },
    setupMocks: (mocks: any) => {
      mocks.db.task.findFirst.mockResolvedValue(null);
    },
    expectedStatus: 404,
    expectedError: 'Task not found',
  },
];

/**
 * Timestamp validation helpers
 */
export const timestampValidators = {
  shouldHaveStartedAt: (statuses: WorkflowStatus[]) => 
    statuses.includes(WorkflowStatus.IN_PROGRESS),
  
  shouldHaveCompletedAt: (statuses: WorkflowStatus[]) => 
    [WorkflowStatus.COMPLETED, WorkflowStatus.FAILED, WorkflowStatus.HALTED].some(s => statuses.includes(s)),
  
  validateTimestampProgression: (startedAt: Date | null, completedAt: Date | null) => {
    if (startedAt && completedAt) {
      return completedAt >= startedAt;
    }
    return true;
  },
};

/**
 * Pusher event validation helpers
 */
export const pusherValidators = {
  validateEventStructure: (event: any, expectedTaskId: string, expectedStatus: WorkflowStatus) => {
    return (
      event.channel === `task-${expectedTaskId}` &&
      event.event === 'workflow-status-update' &&
      event.data.taskId === expectedTaskId &&
      event.data.workflowStatus === expectedStatus &&
      event.data.timestamp instanceof Date
    );
  },

  validateChannelName: (taskId: string) => `task-${taskId}`,
  
  validateEventName: () => 'workflow-status-update',
};