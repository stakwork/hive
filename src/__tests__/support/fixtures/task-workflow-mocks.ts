import { ChatRole, ChatStatus, TaskStatus } from "@prisma/client";

/**
 * Mock data factories for task-workflow service tests
 * These factories create consistent test data for task workflow operations
 */

export function createMockUser(overrides = {}) {
  return {
    id: "test-user-id",
    name: "Test User",
    email: "test@example.com",
    ...overrides,
  };
}

export function createMockTask(overrides = {}) {
  return {
    id: "test-task-id",
    title: "Test Task",
    description: "Test Description",
    status: TaskStatus.TODO,
    sourceType: "USER",
    runBuild: true,
    runTestSuite: true,
    workspace: {
      id: "test-workspace-id",
      slug: "test-workspace",
      swarm: {
        id: "swarm-id",
        swarmUrl: "https://test-swarm.example.com/api",
        swarmSecretAlias: "{{TEST_SECRET}}",
        poolName: "test-pool",
        name: "test-swarm",
      },
      repositories: [
        {
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
        },
      ],
    },
    ...overrides,
  };
}

export function createMockChatMessage(overrides = {}) {
  return {
    id: "message-id",
    taskId: "test-task-id",
    message: "Test message",
    role: ChatRole.USER,
    status: ChatStatus.SENT,
    contextTags: "[]",
    createdAt: new Date(),
    task: {
      id: "test-task-id",
      title: "Test Task",
    },
    ...overrides,
  };
}

export function createMockStakworkResponse(overrides = {}) {
  return {
    success: true,
    data: {
      project_id: 12345,
      ...overrides.data,
    },
    ...overrides,
  };
}

/**
 * Setup mock implementations for task-workflow tests
 * Call this in beforeEach to configure standard mock behavior
 */
export function setupTaskWorkflowMocks(mocks: {
  mockDb: any;
  mockGetGithubUsernameAndPAT: any;
  mockGetBaseUrl: any;
  mockConfig: any;
  mockFetch: any;
}) {
  const { mockDb, mockGetGithubUsernameAndPAT, mockGetBaseUrl, mockConfig, mockFetch } = mocks;

  mockDb.chatMessage.create.mockResolvedValue(createMockChatMessage() as any);
  mockDb.user.findUnique.mockResolvedValue(createMockUser() as any);
  mockDb.task.create.mockResolvedValue(createMockTask() as any);
  mockDb.task.update.mockResolvedValue({} as any);
  mockDb.task.findFirst.mockResolvedValue(createMockTask() as any);
  mockDb.task.findUnique.mockResolvedValue({ status: TaskStatus.TODO } as any);

  mockGetGithubUsernameAndPAT.mockResolvedValue({
    username: "testuser",
    token: "github-token-123",
  });

  mockGetBaseUrl.mockReturnValue("http://localhost:3000");

  mockConfig.STAKWORK_API_KEY = "test-stakwork-key";
  mockConfig.STAKWORK_BASE_URL = "https://stakwork.example.com";
  mockConfig.STAKWORK_WORKFLOW_ID = "123,456,789";

  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => createMockStakworkResponse(),
  } as Response);
}
