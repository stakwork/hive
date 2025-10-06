import { TaskStatus, Priority, WorkflowStatus } from "@prisma/client";

/**
 * Centralized task test fixtures
 * Following DRY principles - all task test data creation in one place
 */

export const mockTaskData = {
  id: "task-123",
  title: "Test Task",
  description: "Test task description",
  status: TaskStatus.TODO,
  priority: Priority.MEDIUM,
  workflowStatus: null,
  sourceType: "USER" as const,
  stakworkProjectId: null,
  estimatedHours: null,
  actualHours: null,
  deleted: false,
  deletedAt: null,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};

export const mockAssigneeData = {
  id: "assignee-123",
  name: "John Assignee",
  email: "assignee@example.com",
};

export const mockRepositoryData = {
  id: "repo-123",
  name: "test-repo",
  repositoryUrl: "https://github.com/test/repo",
};

export const mockCreatedByData = {
  id: "creator-123",
  name: "Jane Creator",
  email: "creator@example.com",
  image: "https://avatar.example.com/jane.jpg",
  githubAuth: {
    githubUsername: "janecreator",
  },
};

/**
 * Create a complete mock task with all relations
 */
export function createMockTask(overrides: Partial<typeof mockTaskData> = {}) {
  return {
    ...mockTaskData,
    ...overrides,
    assignee: mockAssigneeData,
    repository: mockRepositoryData,
    createdBy: mockCreatedByData,
    _count: {
      chatMessages: 3,
    },
  };
}

/**
 * Create a minimal mock task without optional fields
 */
export function createMinimalMockTask(overrides: Partial<typeof mockTaskData> = {}) {
  return {
    ...mockTaskData,
    ...overrides,
    description: null,
    assignee: null,
    repository: null,
    estimatedHours: null,
    actualHours: null,
    createdBy: mockCreatedByData,
    _count: {
      chatMessages: 0,
    },
  };
}

/**
 * Create a list of mock tasks for pagination testing
 */
export function createMockTaskList(count: number, overrides: Partial<typeof mockTaskData> = {}) {
  return Array.from({ length: count }, (_, index) =>
    createMockTask({
      ...overrides,
      id: `task-${index + 1}`,
      title: `Test Task ${index + 1}`,
      createdAt: new Date(`2024-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
    })
  );
}

/**
 * Create mock task with workflow status and action artifact
 */
export function createMockTaskWithActionArtifact(overrides: Partial<typeof mockTaskData> = {}) {
  const task = createMockTask({
    ...overrides,
    workflowStatus: WorkflowStatus.IN_PROGRESS,
  });

  return {
    ...task,
    chatMessages: [
      {
        id: "message-1",
        timestamp: new Date("2024-01-01T12:00:00Z"),
        artifacts: [
          {
            id: "artifact-1",
            type: "FORM",
          },
        ],
      },
    ],
    hasActionArtifact: true,
  };
}

/**
 * Create paginated response structure
 */
export function createMockPaginatedResponse(
  tasks: any[],
  page: number = 1,
  limit: number = 5,
  totalCount: number = tasks.length
) {
  const totalPages = Math.ceil(totalCount / limit);
  const hasMore = page < totalPages;

  return {
    success: true,
    data: tasks,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
      hasMore,
    },
  };
}

/**
 * Build query parameters for GET /api/tasks
 */
export function buildTasksQueryParams(params: {
  workspaceId: string;
  page?: number;
  limit?: number;
  includeLatestMessage?: boolean;
}) {
  const searchParams = new URLSearchParams({
    workspaceId: params.workspaceId,
    ...(params.page !== undefined && { page: params.page.toString() }),
    ...(params.limit !== undefined && { limit: params.limit.toString() }),
    ...(params.includeLatestMessage !== undefined && {
      includeLatestMessage: params.includeLatestMessage.toString(),
    }),
  });

  return searchParams.toString();
}