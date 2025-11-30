import { ChatRole, ChatStatus, TaskStatus } from "@prisma/client";
import { vi } from "vitest";

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

export function createMockWorkspace(overrides = {}) {
  return {
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
  mockGetGithubUsernameAndPAT?: any;
  mockGetBaseUrl?: any;
  mockConfig: any;
  mockFetch: any;
}) {
  const { 
    mockDb, 
    mockConfig, 
    mockFetch 
  } = mocks;
  
  let { mockGetGithubUsernameAndPAT, mockGetBaseUrl } = mocks;

  // Ensure mockDb has the proper structure with vi.fn() mocks
  // This handles both cases: when db is auto-mocked and when it's manually created
  if (!mockDb.chatMessage || typeof mockDb.chatMessage.create !== 'function') {
    mockDb.chatMessage = {
      create: vi.fn(),
    };
  }
  if (typeof mockDb.chatMessage.create?.mockResolvedValue !== 'function') {
    mockDb.chatMessage.create = vi.fn();
  }
  
  if (!mockDb.user || typeof mockDb.user.findUnique !== 'function') {
    mockDb.user = {
      findUnique: vi.fn(),
    };
  }
  if (typeof mockDb.user.findUnique?.mockResolvedValue !== 'function') {
    mockDb.user.findUnique = vi.fn();
  }
  
  if (!mockDb.task || typeof mockDb.task.create !== 'function') {
    mockDb.task = {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    };
  } else {
    // Ensure each method is a proper vi.fn()
    if (typeof mockDb.task.create?.mockResolvedValue !== 'function') {
      mockDb.task.create = vi.fn();
    }
    if (typeof mockDb.task.update?.mockResolvedValue !== 'function') {
      mockDb.task.update = vi.fn();
    }
    if (typeof mockDb.task.findFirst?.mockResolvedValue !== 'function') {
      mockDb.task.findFirst = vi.fn();
    }
    if (typeof mockDb.task.findUnique?.mockResolvedValue !== 'function') {
      mockDb.task.findUnique = vi.fn();
    }
  }

  // Set default resolved values for database operations
  mockDb.chatMessage.create.mockResolvedValue(createMockChatMessage() as any);
  mockDb.user.findUnique.mockResolvedValue(createMockUser() as any);
  mockDb.task.create.mockResolvedValue(createMockTask() as any);
  mockDb.task.update.mockResolvedValue({} as any);
  mockDb.task.findFirst.mockResolvedValue(createMockTask() as any);
  mockDb.task.findUnique.mockResolvedValue({ status: TaskStatus.TODO } as any);

  // Create mock functions if not provided
  if (!mockGetGithubUsernameAndPAT) {
    mockGetGithubUsernameAndPAT = vi.fn();
  }
  if (!mockGetBaseUrl) {
    mockGetBaseUrl = vi.fn();
  }

  // Set default values for mocks
  mockGetGithubUsernameAndPAT.mockResolvedValue({
    githubUsername: "testuser",
    githubPat: "github-token-123",
  });

  mockGetBaseUrl.mockReturnValue("http://localhost:3000");

  mockConfig.STAKWORK_API_KEY = "test-stakwork-key";
  mockConfig.STAKWORK_BASE_URL = "https://stakwork.example.com";
  mockConfig.STAKWORK_WORKFLOW_ID = "123,456,789";
  mockConfig.NEXTAUTH_URL = "http://localhost:3000";

  // Setup fetch mock - create if not provided or not a proper vi.fn()
  if (!mockFetch || typeof mockFetch.mockResolvedValue !== 'function') {
    mockFetch = vi.fn();
  }
  
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => createMockStakworkResponse(),
  } as Response);

  // Return all mocks for the new test structure
  return {
    db: mockDb,
    fetchMock: mockFetch,
    getGithubUsernameAndPAT: mockGetGithubUsernameAndPAT,
    getBaseUrl: mockGetBaseUrl,
    config: mockConfig,
  };
}
