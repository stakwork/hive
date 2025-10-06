import { vi } from "vitest";
import { ChatRole, ChatStatus } from "@prisma/client";

// Mock all external dependencies at module level
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/env", () => ({
  config: {},
}));

vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn(),
}));

vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

// Mock fetch globally
global.fetch = vi.fn();

// Import mocked modules for type safety and re-export
const { db: mockDb } = await import("@/lib/db");
const { config: mockConfig } = await import("@/lib/env");
const { getGithubUsernameAndPAT: mockGetGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
const mockFetch = fetch as vi.MockedFunction<typeof fetch>;

export interface TestMocks {
  mockDb: typeof mockDb;
  mockConfig: typeof mockConfig;
  mockGetGithubUsernameAndPAT: typeof mockGetGithubUsernameAndPAT;
  mockFetch: typeof mockFetch;
}

/**
 * Test data factories for common test objects
 */
export const createMockTask = (overrides: Record<string, any> = {}) => ({
  id: "test-task-id",
  title: "Test Task",
  workspaceId: "test-workspace-id",
  sourceType: "USER",
  workspace: {
    id: "test-workspace-id",
    slug: "test-workspace",
    swarm: {
      id: "swarm-id",
      swarmUrl: "https://swarm.example.com/api",
      swarmSecretAlias: "test-alias",
      poolName: "test-pool",
      name: "test-swarm",
    },
  },
  ...overrides,
});

export const createMockChatMessage = (overrides: Record<string, any> = {}) => ({
  id: "message-id",
  taskId: "test-task-id",
  message: "Test message",
  role: ChatRole.USER,
  contextTags: "[]",
  status: ChatStatus.SENT,
  sourceWebsocketID: null,
  replyId: null,
  artifacts: [],
  attachments: [],
  task: {
    id: "test-task-id",
    title: "Test Task",
  },
  timestamp: new Date(),
  ...overrides,
});

export const createMockUser = (overrides: Record<string, any> = {}) => ({
  name: "Test User",
  ...overrides,
});

export const createMockGithubCredentials = (overrides: Record<string, any> = {}) => ({
  username: "testuser",
  token: "token123",
  ...overrides,
});

/**
 * Setup function to initialize all mocks with default values
 */
export const setupMocks = () => {
  const mocks: TestMocks = {
    mockDb,
    mockConfig,
    mockGetGithubUsernameAndPAT,
    mockFetch,
  };

  return mocks;
};

/**
 * Common mock configurations for different test scenarios
 */
export const mockConfigurations = {
  stakworkEnabled: {
    STAKWORK_API_KEY: "test-api-key",
    STAKWORK_BASE_URL: "https://stakwork.example.com",
    STAKWORK_WORKFLOW_ID: "123,456,789",
  },
  stakworkDisabled: {
    STAKWORK_API_KEY: undefined,
    STAKWORK_BASE_URL: undefined,
    STAKWORK_WORKFLOW_ID: undefined,
  },
};

/**
 * Common fetch response mocks
 */
export const mockFetchResponses = {
  success: {
    ok: true,
    json: async () => ({ success: true, data: { project_id: 123 } }),
  },
  failure: {
    ok: false,
    statusText: "Server Error",
  },
  networkError: () => {
    throw new Error("Network timeout");
  },
};

/**
 * Helper to setup default mocks for a clean test state
 */
export const setupDefaultMocks = () => {
  const mockTask = createMockTask();
  const mockUser = createMockUser();
  const mockChatMessage = createMockChatMessage();
  const mockGithubCredentials = createMockGithubCredentials();

  // Reset mock config to defaults
  Object.assign(mockConfig, mockConfigurations.stakworkEnabled);

  // Setup default mock implementations
  mockDb.task.findFirst.mockResolvedValue(mockTask as any);
  mockDb.task.create.mockResolvedValue(mockTask as any);
  mockDb.task.update.mockResolvedValue({} as any);
  mockDb.user.findUnique.mockResolvedValue(mockUser as any);
  mockDb.chatMessage.create.mockResolvedValue(mockChatMessage as any);
  mockGetGithubUsernameAndPAT.mockResolvedValue(mockGithubCredentials);

  // Setup default fetch mock
  mockFetch.mockResolvedValue(mockFetchResponses.success as any);

  return {
    mockTask,
    mockUser,
    mockChatMessage,
    mockGithubCredentials,
  };
};
