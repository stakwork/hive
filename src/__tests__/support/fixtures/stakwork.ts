import { WorkflowStatus } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

export interface CreateMockTaskOptions {
  id?: string;
  title?: string;
  description?: string;
  workspaceId?: string;
  assigneeId?: string | null;
  repositoryId?: string | null;
  status?: string;
  priority?: string;
  workflowStatus?: WorkflowStatus;
  workflowStartedAt?: Date | null;
  workflowCompletedAt?: Date | null;
  stakworkProjectId?: string | null;
  sourceType?: string;
  createdById?: string;
  updatedById?: string;
  deleted?: boolean;
  deletedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateWebhookPayloadOptions {
  project_status?: string;
  task_id?: string;
  workflow_id?: number;
  workflow_version_id?: number;
  workflow_version?: number;
  project_output?: Record<string, any>;
}

/**
 * Create a mock task object for testing
 * Follows the pattern of existing fixtures but for test-only objects (not DB records)
 */
export function createMockTask(options: CreateMockTaskOptions = {}) {
  const uniqueId = options.id || generateUniqueId("task");
  
  return {
    id: uniqueId,
    title: options.title || "Test Task",
    description: options.description || "Test Description",
    workspaceId: options.workspaceId || generateUniqueId("workspace"),
    assigneeId: options.assigneeId ?? null,
    repositoryId: options.repositoryId ?? null,
    status: options.status || "TODO",
    priority: options.priority || "MEDIUM",
    workflowStatus: options.workflowStatus || WorkflowStatus.PENDING,
    workflowStartedAt: options.workflowStartedAt ?? null,
    workflowCompletedAt: options.workflowCompletedAt ?? null,
    stakworkProjectId: options.stakworkProjectId ?? null,
    sourceType: options.sourceType || "USER",
    createdById: options.createdById || generateUniqueId("user"),
    updatedById: options.updatedById || generateUniqueId("user"),
    deleted: options.deleted || false,
    deletedAt: options.deletedAt ?? null,
    createdAt: options.createdAt || new Date("2024-01-01"),
    updatedAt: options.updatedAt || new Date("2024-01-01"),
  };
}

/**
 * Create a stakwork webhook payload for testing
 */
export function createWebhookPayload(options: CreateWebhookPayloadOptions = {}) {
  return {
    project_status: options.project_status || "completed",
    task_id: options.task_id || generateUniqueId("task"),
    workflow_id: options.workflow_id || 12345,
    workflow_version_id: options.workflow_version_id || 1,
    workflow_version: options.workflow_version || 1,
    project_output: options.project_output || {},
  };
}

/**
 * Create common webhook payload variations
 */
export const StakworkWebhookFixtures = {
  completed: (taskId?: string) => createWebhookPayload({
    project_status: "completed",
    task_id: taskId,
  }),
  
  inProgress: (taskId?: string) => createWebhookPayload({
    project_status: "in_progress", 
    task_id: taskId,
  }),
  
  failed: (taskId?: string) => createWebhookPayload({
    project_status: "failed",
    task_id: taskId,
  }),
  
  halted: (taskId?: string) => createWebhookPayload({
    project_status: "halted",
    task_id: taskId,
  }),

  unknown: (taskId?: string) => createWebhookPayload({
    project_status: "unknown_status",
    task_id: taskId,
  }),
};

/**
 * Create common task mock variations for different workflow states
 */
export const StakworkTaskFixtures = {
  pending: (options: CreateMockTaskOptions = {}) => createMockTask({
    workflowStatus: WorkflowStatus.PENDING,
    ...options,
  }),

  inProgress: (options: CreateMockTaskOptions = {}) => createMockTask({
    workflowStatus: WorkflowStatus.IN_PROGRESS,
    workflowStartedAt: new Date(),
    ...options,
  }),

  completed: (options: CreateMockTaskOptions = {}) => createMockTask({
    workflowStatus: WorkflowStatus.COMPLETED,
    workflowStartedAt: new Date("2024-01-01T10:00:00Z"),
    workflowCompletedAt: new Date("2024-01-01T12:00:00Z"),
    ...options,
  }),

  failed: (options: CreateMockTaskOptions = {}) => createMockTask({
    workflowStatus: WorkflowStatus.FAILED,
    workflowStartedAt: new Date("2024-01-01T10:00:00Z"),
    workflowCompletedAt: new Date("2024-01-01T11:00:00Z"),
    ...options,
  }),

  halted: (options: CreateMockTaskOptions = {}) => createMockTask({
    workflowStatus: WorkflowStatus.HALTED,
    workflowStartedAt: new Date("2024-01-01T10:00:00Z"),
    workflowCompletedAt: new Date("2024-01-01T11:30:00Z"),
    ...options,
  }),
};
