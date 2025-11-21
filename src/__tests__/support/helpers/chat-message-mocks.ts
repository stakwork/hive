import { vi } from "vitest";
import { ChatRole, ChatStatus } from "@/lib/chat";
import { db } from "@/lib/db";

/**
 * Default mock IDs for chat message tests
 */
export const DEFAULT_MOCK_IDS = {
  userId: "user-123",
  taskId: "task-456",
  workspaceId: "workspace-789",
  messageId: "message-abc",
  swarmId: "swarm-123",
};

/**
 * Helper to create a standard mock task object with workspace and swarm data
 */
export function createMockTask(
  options: {
    workspaceId?: string;
    ownerId?: string;
    members?: Array<{ userId: string; role: string }>;
    swarmUrl?: string;
    swarmSecretAlias?: string;
    poolName?: string;
    swarmName?: string;
    swarmId?: string;
  } = {},
) {
  const {
    workspaceId = DEFAULT_MOCK_IDS.workspaceId,
    ownerId = DEFAULT_MOCK_IDS.userId,
    members = [],
    swarmUrl = "https://test-swarm.com/api",
    swarmSecretAlias = "test-secret",
    poolName = "test-pool",
    swarmName = "Test Swarm",
    swarmId = DEFAULT_MOCK_IDS.swarmId,
  } = options;

  return {
    workspaceId,
    workspace: {
      ownerId,
      members,
      swarm: {
        swarmUrl,
        swarmSecretAlias,
        poolName,
        name: swarmName,
        id: swarmId,
      },
    },
  };
}

/**
 * Helper to create a standard mock chat message
 */
export function createMockChatMessage(
  options: {
    id?: string;
    taskId?: string;
    message?: string;
    role?: ChatRole;
    contextTags?: string;
    status?: ChatStatus;
    artifacts?: unknown[];
    attachments?: unknown[];
    task?: { id: string; title: string };
  } = {},
) {
  const {
    id = DEFAULT_MOCK_IDS.messageId,
    taskId = DEFAULT_MOCK_IDS.taskId,
    message = "Test",
    role = ChatRole.USER,
    contextTags = "[]",
    status = ChatStatus.SENT,
    artifacts = [],
    attachments = [],
    task = { id: DEFAULT_MOCK_IDS.taskId, title: "Test Task" },
  } = options;

  return {
    id,
    taskId,
    message,
    role,
    contextTags,
    status,
    artifacts,
    attachments,
    task,
  };
}

/**
 * Helper to setup standard database mocks for chat message tests
 */
export function setupChatMessageDatabaseMocks(
  options: {
    taskMock?: ReturnType<typeof createMockTask>;
    userMock?: { id: string; name: string };
    workspaceMock?: { id: string; slug: string };
    chatMessageMock?: ReturnType<typeof createMockChatMessage>;
    chatHistoryMock?: unknown[];
  } = {},
) {
  const {
    taskMock = createMockTask(),
    userMock = { id: DEFAULT_MOCK_IDS.userId, name: "Test User" },
    workspaceMock = { id: DEFAULT_MOCK_IDS.workspaceId, slug: "test-workspace" },
    chatMessageMock = createMockChatMessage(),
    chatHistoryMock = [],
  } = options;

  vi.mocked(db.task.findFirst).mockResolvedValue(taskMock as any);
  vi.mocked(db.user.findUnique).mockResolvedValue(userMock as any);
  vi.mocked(db.workspace.findUnique).mockResolvedValue(workspaceMock as any);
  vi.mocked(db.chatMessage.create).mockResolvedValue(chatMessageMock as any);
  vi.mocked(db.chatMessage.findMany).mockResolvedValue(chatHistoryMock as any);
  vi.mocked(db.task.update).mockResolvedValue({} as any);
}

/**
 * Helper to create a mock Stakwork API success response
 */
export function createMockStakworkSuccessResponse(projectId = 12345, workflowId = "workflow-abc") {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: {
        project_id: projectId,
        ...(workflowId && { workflow_id: workflowId }),
      },
    }),
  } as Response;
}

/**
 * Helper to create a mock Stakwork API error response
 */
export function createMockStakworkErrorResponse(statusText = "Internal Server Error") {
  return {
    ok: false,
    statusText,
  } as Response;
}
