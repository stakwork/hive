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

vi.mock("@/services/roadmap/feature-chat", () => ({
  resolveExtraSwarms: vi.fn().mockResolvedValue([]),
  resolveSubAgents: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: vi.fn(() => false),
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    config: {
      ...actual.config,
      STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
      STAKWORK_API_KEY: "test-api-key",
      STAKWORK_WORKFLOW_EDITOR_WORKFLOW_ID: "42",
    },
  };
});

// ─── Subject ──────────────────────────────────────────────────────────────────

import { retryWorkflowEditorTask, executeWorkflowEditorRetry } from "@/services/workflow-editor-retry";
import { db } from "@/lib/db";
import { ChatRole, WorkflowStatus } from "@prisma/client";
import { pusherServer } from "@/lib/pusher";
import { resolveExtraSwarms, resolveSubAgents } from "@/services/roadmap/feature-chat";
import { isDevelopmentMode } from "@/lib/runtime";

const mockResolveExtraSwarms = vi.mocked(resolveExtraSwarms);
const mockResolveSubAgents = vi.mocked(resolveSubAgents);
const mockIsDevelopmentMode = vi.mocked(isDevelopmentMode);

const mockedDb = vi.mocked(db);
const mockedPusher = vi.mocked(pusherServer);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Full task shape returned by executeWorkflowEditorRetry's DB query */
function makeFullTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    createdById: "user-1",
    workspaceId: "ws-1",
    featureId: "feature-1",
    workspace: {
      slug: "stakwork",
      ownerId: "user-1",
      sourceControlOrgId: "org-1",
      members: [{ role: "OWNER" }],
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
    mockIsDevelopmentMode.mockReturnValue(false);
    mockedDb.task.update = vi.fn().mockResolvedValue({}) as never;
    mockedDb.chatMessage.create = vi.fn().mockResolvedValue({ id: "msg-new" }) as never;
    mockedDb.chatMessage.findFirst = vi.fn().mockResolvedValue({ id: "msg-user-1" }) as never;
    mockedDb.chatMessage.update = vi.fn().mockResolvedValue({}) as never;
    mockedDb.stakworkRun = { create: vi.fn().mockResolvedValue({}) } as never;
    mockedDb.feature = { findFirst: vi.fn().mockResolvedValue(null) } as never;
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
    expect(update.data.haltRetryAttempted).toBeUndefined();
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

  test("updates last USER chatMessage stakworkProjectId on successful retry", async () => {
    mockedDb.task.findFirst = vi.fn()
      .mockResolvedValueOnce(makeFullTask()) // executeWorkflowEditorRetry task query
      .mockResolvedValueOnce(null) as never; // unused fallback

    const lastUserMsgId = "chat-msg-user-last";
    mockedDb.chatMessage.findFirst = vi.fn().mockResolvedValue({ id: lastUserMsgId }) as never;
    mockedDb.chatMessage.update = vi.fn().mockResolvedValue({}) as never;
    mockFetchSuccess(55555);

    await executeWorkflowEditorRetry("task-1", "user-1");

    expect(mockedDb.chatMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ taskId: "task-1", role: ChatRole.USER }),
        orderBy: { createdAt: "desc" },
      }),
    );
    expect(mockedDb.chatMessage.update).toHaveBeenCalledWith({
      where: { id: lastUserMsgId },
      data: { stakworkProjectId: "55555" },
    });
  });

  test("does not update chatMessage stakworkProjectId when project_id absent in retry response", async () => {
    mockedDb.task.findFirst = vi.fn().mockResolvedValue(makeFullTask()) as never;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: {} }),
    }) as unknown as typeof fetch;

    mockedDb.chatMessage.update = vi.fn().mockResolvedValue({}) as never;

    await executeWorkflowEditorRetry("task-1", "user-1");

    expect(mockedDb.chatMessage.update).not.toHaveBeenCalled();
  });

  test("creates StakworkRun with WORKFLOW_EDITOR type on successful retry", async () => {
    mockedDb.task.findFirst = vi.fn().mockResolvedValue(makeFullTask()) as never;
    mockFetchSuccess(888);

    await executeWorkflowEditorRetry("task-1", "user-1");

    expect(mockedDb.stakworkRun.create).toHaveBeenCalledWith({
      data: {
        type: "WORKFLOW_EDITOR",
        taskId: "task-1",
        featureId: "feature-1",
        workspaceId: "ws-1",
        projectId: 888,
        status: WorkflowStatus.IN_PROGRESS,
        webhookUrl: "http://localhost:3000/api/stakwork/webhook?task_id=task-1",
      },
    });
  });

  test("does NOT create StakworkRun when project_id is absent in retry response", async () => {
    mockedDb.task.findFirst = vi.fn().mockResolvedValue(makeFullTask()) as never;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: {} }),
    }) as unknown as typeof fetch;

    await executeWorkflowEditorRetry("task-1", "user-1");

    expect(mockedDb.stakworkRun.create).not.toHaveBeenCalled();
  });

  describe("featureContext in retry vars", () => {
    test("includes featureContext in vars when task has featureId and feature is found", async () => {
      mockedDb.task.findFirst = vi.fn().mockResolvedValue(makeFullTask()) as never;
      mockedDb.feature = {
        findFirst: vi.fn().mockResolvedValue({
          id: "feature-1",
          title: "Test Feature",
          brief: "A brief",
          requirements: "Reqs",
          architecture: "Arch",
          userStories: [{ title: "Story A" }],
          workspace: {
            repositories: [
              { id: "repo-1", name: "hive", repositoryUrl: "https://github.com/org/hive", branch: "master" },
            ],
          },
          phases: [
            {
              tasks: [
                { id: "t1", title: "Task One", description: null, status: "TODO", summary: null },
              ],
            },
          ],
        }),
      } as never;
      mockFetchSuccess(888);

      const result = await executeWorkflowEditorRetry("task-1", "user-1");

      expect(result).toBe(true);
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const vars = body.workflow_params.set_var.attributes.vars;
      expect(vars.featureId).toBe("feature-1");
      expect(vars.featureContext).toBeDefined();
      expect(vars.featureContext.feature.id).toBe("feature-1");
      expect(vars.featureContext.currentPhase.name).toBe("All Tasks");
      expect(vars.featureContext.currentPhase.tickets).toHaveLength(1);
      expect(vars.featureContext.workspaceRepositories).toHaveLength(1);
    });

    test("omits featureContext when task has no featureId", async () => {
      mockedDb.task.findFirst = vi.fn().mockResolvedValue(
        makeFullTask({ featureId: null }),
      ) as never;
      mockFetchSuccess();

      await executeWorkflowEditorRetry("task-1", "user-1");

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const vars = body.workflow_params.set_var.attributes.vars;
      expect(Object.prototype.hasOwnProperty.call(vars, "featureId")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(vars, "featureContext")).toBe(false);
    });

    test("omits featureContext when feature lookup returns null (best-effort, non-blocking)", async () => {
      mockedDb.task.findFirst = vi.fn().mockResolvedValue(makeFullTask()) as never;
      mockedDb.feature = { findFirst: vi.fn().mockResolvedValue(null) } as never;
      mockFetchSuccess();

      const result = await executeWorkflowEditorRetry("task-1", "user-1");

      expect(result).toBe(true);
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const vars = body.workflow_params.set_var.attributes.vars;
      expect(Object.prototype.hasOwnProperty.call(vars, "featureContext")).toBe(false);
    });

    test("omits featureContext when feature lookup throws (best-effort, non-blocking)", async () => {
      mockedDb.task.findFirst = vi.fn().mockResolvedValue(makeFullTask()) as never;
      mockedDb.feature = {
        findFirst: vi.fn().mockRejectedValue(new Error("DB error")),
      } as never;
      mockFetchSuccess();

      const result = await executeWorkflowEditorRetry("task-1", "user-1");

      expect(result).toBe(true);
      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const vars = body.workflow_params.set_var.attributes.vars;
      expect(Object.prototype.hasOwnProperty.call(vars, "featureContext")).toBe(false);
    });
  });

  describe("subAgents injection on retry (net-new)", () => {
    const mockOrgSwarm = {
      name: "org-ws",
      url: "https://org.sphinx.chat/api",
      apiKey: "org-key",
      repoUrls: "https://github.com/org/repo",
      toolsConfig: { learn_concepts: true },
    };

    test("sets vars.subAgents when resolveSubAgents returns org workspaces (stakwork slug)", async () => {
      mockedDb.task.findFirst = vi.fn().mockResolvedValue(makeFullTask()) as never;
      mockResolveSubAgents.mockResolvedValueOnce([mockOrgSwarm]);
      mockFetchSuccess(888);

      const result = await executeWorkflowEditorRetry("task-1", "user-1");

      expect(result).toBe(true);
      expect(mockResolveSubAgents).toHaveBeenCalledWith({
        message: "Make the workflow faster",
        userId: "user-1",
        sourceControlOrgId: "org-1",
      });
      expect(mockResolveExtraSwarms).not.toHaveBeenCalled();

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const vars = body.workflow_params.set_var.attributes.vars;
      expect(vars.subAgents).toHaveLength(1);
      expect(vars.subAgents[0].name).toBe("org-ws");
    });

    test("sets vars.subAgents in isDevelopmentMode (non-stakwork slug)", async () => {
      mockIsDevelopmentMode.mockReturnValue(true);
      const devTask = makeFullTask({
        workspace: { ...makeFullTask().workspace, slug: "other-slug" },
      });
      mockedDb.task.findFirst = vi.fn().mockResolvedValue(devTask) as never;
      mockResolveSubAgents.mockResolvedValueOnce([mockOrgSwarm]);
      mockFetchSuccess();

      const result = await executeWorkflowEditorRetry("task-1", "user-1");

      expect(result).toBe(true);
      expect(mockResolveSubAgents).toHaveBeenCalled();
      expect(mockResolveExtraSwarms).not.toHaveBeenCalled();
    });

    test("falls back to resolveExtraSwarms outside stakwork/dev (no guard match)", async () => {
      mockIsDevelopmentMode.mockReturnValue(false);
      const nonStakworkTask = makeFullTask({
        workspace: { ...makeFullTask().workspace, slug: "other-slug" },
      });
      mockedDb.task.findFirst = vi.fn().mockResolvedValue(nonStakworkTask) as never;
      mockResolveExtraSwarms.mockResolvedValueOnce([]);
      mockFetchSuccess();

      await executeWorkflowEditorRetry("task-1", "user-1");

      expect(mockResolveSubAgents).not.toHaveBeenCalled();
      expect(mockResolveExtraSwarms).toHaveBeenCalledWith(
        "Make the workflow faster",
        "user-1",
      );
    });

    test("subAgents absent from vars when resolveSubAgents returns empty on retry", async () => {
      mockedDb.task.findFirst = vi.fn().mockResolvedValue(makeFullTask()) as never;
      mockResolveSubAgents.mockResolvedValueOnce([]);
      mockFetchSuccess();

      await executeWorkflowEditorRetry("task-1", "user-1");

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const vars = body.workflow_params.set_var.attributes.vars;
      expect(Object.prototype.hasOwnProperty.call(vars, "subAgents")).toBe(false);
    });
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
    expect(successUpdate.data.haltRetryAttempted).toBeUndefined();
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
