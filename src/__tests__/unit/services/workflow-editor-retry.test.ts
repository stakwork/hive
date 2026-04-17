import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db");

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue({}) },
  getTaskChannelName: vi.fn((id: string) => `task-${id}`),
  PUSHER_EVENTS: { NEW_MESSAGE: "new-message" },
}));

vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn().mockResolvedValue({
    username: "test-user",
    token: "test-token",
  }),
}));

vi.mock("@/lib/vercel/stakwork-token", () => ({
  getStakworkTokenReference: vi.fn().mockReturnValue("{{HIVE_STAGING}}"),
}));

vi.mock("@/lib/utils/swarm", () => ({
  transformSwarmUrlToRepo2Graph: vi.fn().mockReturnValue("http://swarm:3355"),
}));

vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn().mockReturnValue("http://localhost:3000"),
}));

vi.mock("@/lib/helpers/chat-history", () => ({
  fetchChatHistory: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    STAKWORK_API_KEY: "test-api-key",
    STAKWORK_WORKFLOW_EDITOR_WORKFLOW_ID: "42",
  },
}));

// ─── Subject ──────────────────────────────────────────────────────────────────

import { retryWorkflowEditorTask, executeWorkflowEditorRetry } from "@/services/workflow-editor-retry";
import { db } from "@/lib/db";
import { ChatRole, WorkflowStatus } from "@prisma/client";
import { pusherServer } from "@/lib/pusher";

const mockedDb = vi.mocked(db);
const mockedPusher = vi.mocked(pusherServer);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Full task shape returned by executeWorkflowEditorRetry's DB query */
function makeFullTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    createdById: "user-1",
    workspaceId: "ws-1",
    workspace: {
      slug: "test-workspace",
      ownerId: "user-1",
      swarm: {
        swarmUrl: "http://swarm/api",
        swarmSecretAlias: "secret",
        poolName: "pool-1",
        name: "swarm-1",
        id: "swarm-id-1",
      },
    },
    chatMessages: [
      {
        role: ChatRole.USER,
        message: "Make the workflow faster",
        artifacts: [],
      },
      {
        role: ChatRole.ASSISTANT,
        message: "",
        artifacts: [
          {
            type: "WORKFLOW",
            content: {
              workflowId: 99,
              workflowName: "My Workflow",
              workflowRefId: "ref-abc-123",
              workflowVersionId: "v1",
              projectId: "proj-1",
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

/** Minimal task shape returned by retryWorkflowEditorTask's guard query */
function makeGuardTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    mode: "workflow_editor",
    haltRetryAttempted: false,
    createdById: "user-1",
    ...overrides,
  };
}

function mockFetchSuccess(projectId = 777) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { project_id: projectId } }),
  }) as unknown as typeof fetch;
}

function mockFetchNotOk() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    statusText: "Internal Server Error",
    json: async () => ({ success: false }),
  }) as unknown as typeof fetch;
}

// ─── executeWorkflowEditorRetry tests ─────────────────────────────────────────

describe("executeWorkflowEditorRetry", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = global.fetch;
    mockedDb.task.update = vi.fn().mockResolvedValue({}) as never;
    mockedDb.chatMessage.create = vi.fn().mockResolvedValue({ id: "msg-new" }) as never;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("returns false when task is not found", async () => {
    mockedDb.task.findFirst = vi.fn().mockResolvedValue(null) as never;
    const result = await executeWorkflowEditorRetry("task-1", "user-1");
    expect(result).toBe(false);
  });

  test("returns false when no WORKFLOW artifact exists in chat history", async () => {
    mockedDb.task.findFirst = vi.fn().mockResolvedValue(
      makeFullTask({
        chatMessages: [{ role: ChatRole.USER, message: "hello", artifacts: [] }],
      }),
    ) as never;
    const result = await executeWorkflowEditorRetry("task-1", "user-1");
    expect(result).toBe(false);
  });

  test("returns false when WORKFLOW artifact has no workflowRefId", async () => {
    mockedDb.task.findFirst = vi.fn().mockResolvedValue(
      makeFullTask({
        chatMessages: [
          {
            role: ChatRole.ASSISTANT,
            message: "",
            artifacts: [
              {
                type: "WORKFLOW",
                content: { workflowId: 99, workflowName: "x", workflowRefId: "" },
              },
            ],
          },
          { role: ChatRole.USER, message: "do it", artifacts: [] },
        ],
      }),
    ) as never;
    const result = await executeWorkflowEditorRetry("task-1", "user-1");
    expect(result).toBe(false);
  });

  test("returns false when no USER message exists", async () => {
    mockedDb.task.findFirst = vi.fn().mockResolvedValue(
      makeFullTask({
        chatMessages: [
          {
            role: ChatRole.ASSISTANT,
            message: "",
            artifacts: [
              {
                type: "WORKFLOW",
                content: {
                  workflowId: 99,
                  workflowName: "My Workflow",
                  workflowRefId: "ref-abc-123",
                },
              },
            ],
          },
        ],
      }),
    ) as never;
    const result = await executeWorkflowEditorRetry("task-1", "user-1");
    expect(result).toBe(false);
  });

  test("returns true and updates task on Stakwork success", async () => {
    mockedDb.task.findFirst = vi.fn().mockResolvedValue(makeFullTask()) as never;
    mockFetchSuccess(888);

    const updateCalls: unknown[] = [];
    mockedDb.task.update = vi.fn().mockImplementation(async (args: unknown) => {
      updateCalls.push(args);
      return {};
    }) as never;

    const result = await executeWorkflowEditorRetry("task-1", "user-1");

    expect(result).toBe(true);
    const update = updateCalls[0] as { data: Record<string, unknown> };
    expect(update.data.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
    expect(update.data.haltRetryAttempted).toBe(false);
    expect(update.data.stakworkProjectId).toBe(888);
  });

  test("returns false when Stakwork returns !ok", async () => {
    mockedDb.task.findFirst = vi.fn().mockResolvedValue(makeFullTask()) as never;
    mockFetchNotOk();

    const result = await executeWorkflowEditorRetry("task-1", "user-1");

    expect(result).toBe(false);
    expect(mockedDb.task.update).not.toHaveBeenCalled();
  });

  test("returns false when Stakwork returns success:false", async () => {
    mockedDb.task.findFirst = vi.fn().mockResolvedValue(makeFullTask()) as never;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false }),
    }) as unknown as typeof fetch;

    const result = await executeWorkflowEditorRetry("task-1", "user-1");
    expect(result).toBe(false);
    expect(mockedDb.task.update).not.toHaveBeenCalled();
  });

  test("correctly picks LAST WORKFLOW artifact when multiple exist", async () => {
    mockedDb.task.findFirst = vi.fn().mockResolvedValue(
      makeFullTask({
        chatMessages: [
          { role: ChatRole.USER, message: "first", artifacts: [] },
          {
            role: ChatRole.ASSISTANT,
            message: "",
            artifacts: [
              {
                type: "WORKFLOW",
                content: {
                  workflowId: 10,
                  workflowName: "First",
                  workflowRefId: "ref-first",
                  workflowVersionId: "v1",
                },
              },
            ],
          },
          { role: ChatRole.USER, message: "last user msg", artifacts: [] },
          {
            role: ChatRole.ASSISTANT,
            message: "",
            artifacts: [
              {
                type: "WORKFLOW",
                content: {
                  workflowId: 20,
                  workflowName: "Second",
                  workflowRefId: "ref-second",
                  workflowVersionId: "v2",
                },
              },
            ],
          },
        ],
      }),
    ) as never;
    mockFetchSuccess();

    await executeWorkflowEditorRetry("task-1", "user-1");

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    const vars = body.workflow_params.set_var.attributes.vars;

    expect(vars.workflow_id).toBe(20);
    expect(vars.workflow_ref_id).toBe("ref-second");
    expect(vars.workflow_version_id).toBe("v2");
    expect(vars.message).toBe("last user msg");
  });

  test("creates assistant WORKFLOW artifact message on success", async () => {
    mockedDb.task.findFirst = vi.fn().mockResolvedValue(makeFullTask()) as never;
    mockFetchSuccess(999);

    await executeWorkflowEditorRetry("task-1", "user-1");

    expect(mockedDb.chatMessage.create).toHaveBeenCalledTimes(1);
    const createArg = (mockedDb.chatMessage.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { data: Record<string, unknown> };
    expect(createArg.data.taskId).toBe("task-1");
    expect(createArg.data.role).toBe(ChatRole.ASSISTANT);
  });

  test("triggers Pusher NEW_MESSAGE on success", async () => {
    mockedDb.task.findFirst = vi.fn().mockResolvedValue(makeFullTask()) as never;
    mockFetchSuccess();

    await executeWorkflowEditorRetry("task-1", "user-1");

    expect(mockedPusher.trigger).toHaveBeenCalledWith(
      "task-task-1",
      "new-message",
      expect.anything(),
    );
  });
});

// ─── retryWorkflowEditorTask tests ────────────────────────────────────────────

describe("retryWorkflowEditorTask", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = global.fetch;
    mockedDb.task.update = vi.fn().mockResolvedValue({}) as never;
    mockedDb.chatMessage.create = vi.fn().mockResolvedValue({ id: "msg-new" }) as never;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("returns false when mode !== 'workflow_editor'", async () => {
    // Guard query returns non-workflow_editor mode
    mockedDb.task.findFirst = vi.fn().mockResolvedValueOnce(
      makeGuardTask({ mode: "live" }),
    ) as never;
    const result = await retryWorkflowEditorTask("task-1");
    expect(result).toBe(false);
    expect(mockedDb.task.update).not.toHaveBeenCalled();
  });

  test("returns false when haltRetryAttempted is true", async () => {
    mockedDb.task.findFirst = vi.fn().mockResolvedValueOnce(
      makeGuardTask({ haltRetryAttempted: true }),
    ) as never;
    const result = await retryWorkflowEditorTask("task-1");
    expect(result).toBe(false);
    expect(mockedDb.task.update).not.toHaveBeenCalled();
  });

  test("returns false when task is not found", async () => {
    mockedDb.task.findFirst = vi.fn().mockResolvedValue(null) as never;
    const result = await retryWorkflowEditorTask("task-1");
    expect(result).toBe(false);
  });

  test("sets haltRetryAttempted = true BEFORE delegating to executeWorkflowEditorRetry", async () => {
    // First findFirst: guard query; second findFirst: executeWorkflowEditorRetry's query
    mockedDb.task.findFirst = vi.fn()
      .mockResolvedValueOnce(makeGuardTask())
      .mockResolvedValueOnce(makeFullTask()) as never;
    mockFetchSuccess();

    const updateCalls: unknown[] = [];
    mockedDb.task.update = vi.fn().mockImplementation(async (args: unknown) => {
      updateCalls.push(args);
      return {};
    }) as never;

    await retryWorkflowEditorTask("task-1");

    // First update MUST be the guard: haltRetryAttempted = true
    const guardUpdate = updateCalls[0] as { data: Record<string, unknown> };
    expect(guardUpdate.data).toEqual({ haltRetryAttempted: true });
  });

  test("delegates to executeWorkflowEditorRetry and returns true on success", async () => {
    mockedDb.task.findFirst = vi.fn()
      .mockResolvedValueOnce(makeGuardTask())
      .mockResolvedValueOnce(makeFullTask()) as never;
    mockFetchSuccess(888);

    const updateCalls: unknown[] = [];
    mockedDb.task.update = vi.fn().mockImplementation(async (args: unknown) => {
      updateCalls.push(args);
      return {};
    }) as never;

    const result = await retryWorkflowEditorTask("task-1");

    expect(result).toBe(true);
    // Second update from executeWorkflowEditorRetry: IN_PROGRESS, haltRetryAttempted = false
    const successUpdate = updateCalls[1] as { data: Record<string, unknown> };
    expect(successUpdate.data.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
    expect(successUpdate.data.haltRetryAttempted).toBe(false);
    expect(successUpdate.data.stakworkProjectId).toBe(888);
  });

  test("returns false when executeWorkflowEditorRetry fails (Stakwork !ok)", async () => {
    mockedDb.task.findFirst = vi.fn()
      .mockResolvedValueOnce(makeGuardTask())
      .mockResolvedValueOnce(makeFullTask()) as never;
    mockFetchNotOk();

    const result = await retryWorkflowEditorTask("task-1");

    expect(result).toBe(false);
    // Guard update called once; executeWorkflowEditorRetry finds !ok, no more updates
    expect(mockedDb.task.update).toHaveBeenCalledTimes(1);
    const guardUpdate = (mockedDb.task.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(guardUpdate.data.haltRetryAttempted).toBe(true);
  });
});
