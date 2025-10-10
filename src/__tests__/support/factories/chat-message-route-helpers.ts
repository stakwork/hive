import { ChatRole, ChatStatus, ArtifactType } from "@prisma/client";

// Test Data Helpers - Centralized test data creation for Chat Message Route tests
export const createMockSession = (userId?: string) => ({
  user: {
    id: userId || "user-123",
    email: "test@example.com",
    name: "Test User",
  },
  expires: new Date(Date.now() + 86400000).toISOString(),
});

export const createMockUser = (overrides = {}) => ({
  id: "user-123",
  name: "Test User",
  email: "test@example.com",
  ...overrides,
});

export const createMockWorkspace = (overrides = {}) => ({
  id: "workspace-123",
  name: "Test Workspace",
  slug: "test-workspace",
  ownerId: "user-123",
  description: "Test workspace description",
  deleted: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

export const createMockSwarm = (overrides = {}) => ({
  id: "swarm-123",
  swarmUrl: "https://test-swarm.sphinx.chat/api",
  swarmSecretAlias: "{{SWARM_123_API_KEY}}",
  poolName: "test-pool",
  name: "test-swarm",
  ...overrides,
});

export const createMockTask = (overrides = {}) => ({
  id: "task-123",
  workspaceId: "workspace-123",
  workspace: {
    ownerId: "user-123",
    swarm: createMockSwarm(),
    members: [],
  },
  ...overrides,
});

export const createMockChatMessage = (overrides = {}) => ({
  id: "message-123",
  taskId: "task-123",
  message: "Test message",
  role: ChatRole.USER,
  contextTags: "[]",
  status: ChatStatus.SENT,
  sourceWebsocketID: null,
  replyId: null,
  artifacts: [],
  attachments: [],
  task: {
    id: "task-123",
    title: "Test Task",
  },
  timestamp: new Date(),
  ...overrides,
});

export const createMockGithubProfile = (overrides = {}) => ({
  username: "testuser",
  token: "github_pat_test123",
  ...overrides,
});

export const createMockStakworkResponse = (overrides = {}) => ({
  success: true,
  data: {
    project_id: 456,
    workflow_id: 789,
    status: "pending",
    ...overrides,
  },
});

export const createMockRequestBody = (overrides = {}) => ({
  taskId: "task-123",
  message: "Test message for Stakwork",
  contextTags: [],
  artifacts: [],
  attachments: [],
  ...overrides,
});

// Common test setup for successful database operations
export const setupSuccessfulDatabaseMocks = (
  mockDbTaskFindFirst: any,
  mockDbUserFindUnique: any,
  mockDbWorkspaceFindUnique: any,
  mockGetGithubUsernameAndPAT: any,
  mockDbChatMessageCreate: any,
  mockTransformSwarmUrlToRepo2Graph: any
) => {
  mockDbTaskFindFirst.mockResolvedValue(createMockTask());
  mockDbUserFindUnique.mockResolvedValue(createMockUser());
  mockDbWorkspaceFindUnique.mockResolvedValue({ slug: "test-workspace" });
  mockGetGithubUsernameAndPAT.mockResolvedValue(createMockGithubProfile());
  mockDbChatMessageCreate.mockResolvedValue(createMockChatMessage());
  mockTransformSwarmUrlToRepo2Graph.mockReturnValue("https://test-swarm.sphinx.chat:3355");
};
