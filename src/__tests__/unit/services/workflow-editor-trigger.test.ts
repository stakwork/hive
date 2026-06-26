/**
 * Unit tests for triggerWorkflowEditorRun in src/services/workflow-editor.ts
 * Focuses on the status + workflowStatus update on success / failure.
 */

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
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    STAKWORK_API_KEY: "test-api-key",
    STAKWORK_WORKFLOW_EDITOR_WORKFLOW_ID: "42",
  },
}));

// ─── Subject ──────────────────────────────────────────────────────────────────

import { triggerWorkflowEditorRun } from "@/services/workflow-editor";
import { db } from "@/lib/db";
import { WorkflowStatus, TaskStatus } from "@prisma/client";
import { resolveExtraSwarms } from "@/services/roadmap/feature-chat";

const mockResolveExtraSwarms = vi.mocked(resolveExtraSwarms);

const mockedDb = vi.mocked(db);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTask() {
  return {
    id: "task-1",
    workspaceId: "ws-1",
    featureId: "feature-1",
    workspace: {
      slug: "stakwork",
      ownerId: "user-1",
      members: [{ userId: "user-1" }],
      swarm: {
        swarmUrl: "http://swarm/api",
        swarmSecretAlias: "secret",
        poolName: "pool-1",
        name: "swarm-1",
        id: "swarm-id-1",
      },
    },
  };
}

function mockFetchSuccess(projectId = 123) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { project_id: projectId } }),
  }) as unknown as typeof fetch;
}

function mockFetchNotOk() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    statusText: "Internal Server Error",
    json: async () => ({}),
  }) as unknown as typeof fetch;
}

function mockFetchSuccessFalse() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: false }),
  }) as unknown as typeof fetch;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("triggerWorkflowEditorRun", () => {
  let originalFetch: typeof global.fetch;

  function makeFeatureContext() {
    return {
      feature: { id: "feature-1", title: "Test Feature", brief: "A brief", userStories: ["Story A"], requirements: "Reqs", architecture: "Arch" },
      workspaceRepositories: [{ id: "repo-1", name: "hive", repositoryUrl: "https://github.com/org/hive", branch: "master" }],
      currentPhase: { name: "All Tasks", description: null, tickets: [{ id: "task-1", title: "Task One", description: null, status: "TODO", summary: null }] },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = global.fetch;
    mockedDb.task.findFirst = vi.fn().mockResolvedValue(makeTask()) as never;
    mockedDb.task.update = vi.fn().mockResolvedValue({}) as never;
    mockedDb.chatMessage.create = vi.fn().mockResolvedValue({ id: "msg-1" }) as never;
    mockedDb.stakworkRun = { create: vi.fn().mockResolvedValue({}) } as never;
    mockedDb.feature = { findFirst: vi.fn().mockResolvedValue(null) } as never;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("sets status: IN_PROGRESS on successful Stakwork call", async () => {
    mockFetchSuccess(456);

    const updateCalls: unknown[] = [];
    mockedDb.task.update = vi.fn().mockImplementation(async (args: unknown) => {
      updateCalls.push(args);
      return {};
    }) as never;

    await triggerWorkflowEditorRun({
      taskId: "task-1",
      userId: "user-1",
      message: "Edit the workflow",
      workflowTask: { workflowId: 99, workflowName: "My Workflow", workflowRefId: "ref-abc" },
    });

    expect(updateCalls).toHaveLength(1);
    const update = updateCalls[0] as { data: Record<string, unknown> };
    expect(update.data.status).toBe(TaskStatus.IN_PROGRESS);
    expect(update.data.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
    expect(update.data.haltRetryAttempted).toBe(false);
  });

  test("includes stakworkProjectId in the update on success", async () => {
    mockFetchSuccess(789);

    const updateCalls: unknown[] = [];
    mockedDb.task.update = vi.fn().mockImplementation(async (args: unknown) => {
      updateCalls.push(args);
      return {};
    }) as never;

    await triggerWorkflowEditorRun({
      taskId: "task-1",
      userId: "user-1",
      message: "Edit the workflow",
      workflowTask: { workflowId: 99, workflowName: "My Workflow", workflowRefId: "ref-abc" },
    });

    const update = updateCalls[0] as { data: Record<string, unknown> };
    expect(update.data.stakworkProjectId).toBe(789);
  });

  test("does NOT set status on failed Stakwork response (!ok)", async () => {
    mockFetchNotOk();

    await expect(
      triggerWorkflowEditorRun({
        taskId: "task-1",
        userId: "user-1",
        message: "Edit the workflow",
        workflowTask: { workflowId: 99, workflowName: "My Workflow", workflowRefId: "ref-abc" },
      }),
    ).rejects.toThrow();

    const updateCalls = (mockedDb.task.update as ReturnType<typeof vi.fn>).mock.calls;
    // Only the FAILED status update — no status field change
    expect(updateCalls).toHaveLength(1);
    const failUpdate = updateCalls[0][0] as { data: Record<string, unknown> };
    expect(failUpdate.data.workflowStatus).toBe(WorkflowStatus.FAILED);
    expect(failUpdate.data.status).toBeUndefined();
  });

  test("does NOT set status on success:false Stakwork response", async () => {
    mockFetchSuccessFalse();

    await expect(
      triggerWorkflowEditorRun({
        taskId: "task-1",
        userId: "user-1",
        message: "Edit the workflow",
        workflowTask: { workflowId: 99, workflowName: "My Workflow", workflowRefId: "ref-abc" },
      }),
    ).rejects.toThrow();

    const updateCalls = (mockedDb.task.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(updateCalls).toHaveLength(1);
    const failUpdate = updateCalls[0][0] as { data: Record<string, unknown> };
    expect(failUpdate.data.workflowStatus).toBe(WorkflowStatus.FAILED);
    expect(failUpdate.data.status).toBeUndefined();
  });

  test("throws when task is not found", async () => {
    mockedDb.task.findFirst = vi.fn().mockResolvedValue(null) as never;

    await expect(
      triggerWorkflowEditorRun({
        taskId: "missing-task",
        userId: "user-1",
        message: "Edit the workflow",
        workflowTask: { workflowId: 99, workflowName: "My Workflow", workflowRefId: "ref-abc" },
      }),
    ).rejects.toThrow("Task missing-task not found");
  });

  test("proceeds with null workflowId — signals new workflow creation", async () => {
    mockedDb.task.findFirst = vi.fn().mockResolvedValue(makeTask()) as never;
    mockFetchSuccess();

    await triggerWorkflowEditorRun({
      taskId: "task-1",
      userId: "user-1",
      message: "Edit the workflow",
      workflowTask: { workflowId: null, workflowName: null, workflowRefId: null },
    });

    // DB lookup was attempted (not short-circuited) and Stakwork was called
    expect(mockedDb.task.findFirst).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalled();
  });

  test("creates StakworkRun with WORKFLOW_EDITOR type when project_id is present", async () => {
    mockFetchSuccess(456);

    await triggerWorkflowEditorRun({
      taskId: "task-1",
      userId: "user-1",
      message: "Edit the workflow",
      workflowTask: { workflowId: 99, workflowName: "My Workflow", workflowRefId: "ref-abc" },
    });

    expect(mockedDb.stakworkRun.create).toHaveBeenCalledWith({
      data: {
        type: "WORKFLOW_EDITOR",
        taskId: "task-1",
        featureId: "feature-1",
        workspaceId: "ws-1",
        projectId: 456,
        status: WorkflowStatus.IN_PROGRESS,
        webhookUrl: "http://localhost:3000/api/stakwork/webhook?task_id=task-1",
      },
    });
  });

  describe("featureId forwarding", () => {
    test("includes featureId in vars when task has a featureId", async () => {
      mockFetchSuccess();

      await triggerWorkflowEditorRun({
        taskId: "task-1",
        userId: "user-1",
        message: "Edit the workflow",
        workflowTask: { workflowId: 99, workflowName: "My Workflow", workflowRefId: "ref-abc" },
      });

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const vars = body.workflow_params.set_var.attributes.vars;
      expect(vars.featureId).toBe("feature-1");
    });

    test("omits featureId from vars when task has no featureId", async () => {
      mockedDb.task.findFirst = vi.fn().mockResolvedValue({ ...makeTask(), featureId: null }) as never;
      mockFetchSuccess();

      await triggerWorkflowEditorRun({
        taskId: "task-1",
        userId: "user-1",
        message: "Edit the workflow",
        workflowTask: { workflowId: 99, workflowName: "My Workflow", workflowRefId: "ref-abc" },
      });

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const vars = body.workflow_params.set_var.attributes.vars;
      expect(Object.prototype.hasOwnProperty.call(vars, "featureId")).toBe(false);
    });
  });

  test("does NOT create StakworkRun when project_id is absent", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: {} }),
    }) as unknown as typeof fetch;

    await triggerWorkflowEditorRun({
      taskId: "task-1",
      userId: "user-1",
      message: "Edit the workflow",
      workflowTask: { workflowId: 99, workflowName: "My Workflow", workflowRefId: "ref-abc" },
    });

    expect(mockedDb.stakworkRun.create).not.toHaveBeenCalled();
  });

  describe("featureContext in vars", () => {
    test("includes featureContext in vars when task has featureId and feature is found", async () => {
      mockedDb.feature = { findFirst: vi.fn().mockResolvedValue({
        id: "feature-1",
        title: "Test Feature",
        brief: "A brief",
        requirements: "Reqs",
        architecture: "Arch",
        userStories: [{ title: "Story A" }],
        workspace: { repositories: [{ id: "repo-1", name: "hive", repositoryUrl: "https://github.com/org/hive", branch: "master" }] },
        phases: [{ tasks: [{ id: "t1", title: "Task One", description: null, status: "TODO", summary: null }] }],
      }) } as never;
      mockFetchSuccess();

      await triggerWorkflowEditorRun({
        taskId: "task-1",
        userId: "user-1",
        message: "Edit the workflow",
        workflowTask: { workflowId: 99, workflowName: "My Workflow", workflowRefId: "ref-abc" },
      });

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const vars = body.workflow_params.set_var.attributes.vars;
      expect(vars.featureContext).toBeDefined();
      expect(vars.featureContext.feature.id).toBe("feature-1");
      expect(vars.featureContext.currentPhase.name).toBe("All Tasks");
      expect(vars.featureContext.currentPhase.tickets).toHaveLength(1);
      expect(vars.featureContext.workspaceRepositories).toHaveLength(1);
    });

    test("omits featureContext from vars when task has no featureId", async () => {
      mockedDb.task.findFirst = vi.fn().mockResolvedValue({ ...makeTask(), featureId: null }) as never;
      mockFetchSuccess();

      await triggerWorkflowEditorRun({
        taskId: "task-1",
        userId: "user-1",
        message: "Edit the workflow",
        workflowTask: { workflowId: 99, workflowName: "My Workflow", workflowRefId: "ref-abc" },
      });

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const vars = body.workflow_params.set_var.attributes.vars;
      expect(Object.prototype.hasOwnProperty.call(vars, "featureContext")).toBe(false);
    });

    test("omits featureContext when feature lookup returns null (best-effort, non-blocking)", async () => {
      mockedDb.feature = { findFirst: vi.fn().mockResolvedValue(null) } as never;
      mockFetchSuccess();

      await triggerWorkflowEditorRun({
        taskId: "task-1",
        userId: "user-1",
        message: "Edit the workflow",
        workflowTask: { workflowId: 99, workflowName: "My Workflow", workflowRefId: "ref-abc" },
      });

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const vars = body.workflow_params.set_var.attributes.vars;
      expect(Object.prototype.hasOwnProperty.call(vars, "featureContext")).toBe(false);
    });

    test("omits featureContext when feature lookup throws (best-effort, non-blocking)", async () => {
      mockedDb.feature = { findFirst: vi.fn().mockRejectedValue(new Error("DB error")) } as never;
      mockFetchSuccess();

      await expect(
        triggerWorkflowEditorRun({
          taskId: "task-1",
          userId: "user-1",
          message: "Edit the workflow",
          workflowTask: { workflowId: 99, workflowName: "My Workflow", workflowRefId: "ref-abc" },
        }),
      ).resolves.toBeUndefined();

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const vars = body.workflow_params.set_var.attributes.vars;
      expect(Object.prototype.hasOwnProperty.call(vars, "featureContext")).toBe(false);
    });
  });

  describe("subAgents (resolveExtraSwarms) injection", () => {
    const mockSwarm = {
      name: "other-ws",
      url: "https://other.sphinx.chat/api",
      apiKey: "other-key",
      repoUrls: ["https://github.com/org/other"],
      toolsConfig: { learn_concepts: true },
    };

    test("attaches subAgents to vars when message contains resolvable @mentions", async () => {
      mockResolveExtraSwarms.mockResolvedValueOnce([mockSwarm]);
      mockFetchSuccess();

      await triggerWorkflowEditorRun({
        taskId: "task-1",
        userId: "user-1",
        message: "Edit workflow using @other-ws context",
        workflowTask: { workflowId: 99, workflowName: "My Workflow", workflowRefId: "ref-abc" },
      });

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const vars = body.workflow_params.set_var.attributes.vars;
      expect(vars.subAgents).toHaveLength(1);
      expect(vars.subAgents[0].name).toBe("other-ws");
    });

    test("subAgents absent from vars when no @mentions resolve", async () => {
      mockResolveExtraSwarms.mockResolvedValueOnce([]);
      mockFetchSuccess();

      await triggerWorkflowEditorRun({
        taskId: "task-1",
        userId: "user-1",
        message: "Edit the workflow without mentions",
        workflowTask: { workflowId: 99, workflowName: "My Workflow", workflowRefId: "ref-abc" },
      });

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const vars = body.workflow_params.set_var.attributes.vars;
      expect(Object.prototype.hasOwnProperty.call(vars, "subAgents")).toBe(false);
    });

    test("resolveExtraSwarms is called with the message and userId", async () => {
      mockResolveExtraSwarms.mockResolvedValueOnce([]);
      mockFetchSuccess();

      await triggerWorkflowEditorRun({
        taskId: "task-1",
        userId: "user-1",
        message: "@other-ws do something",
        workflowTask: { workflowId: 99, workflowName: "My Workflow", workflowRefId: "ref-abc" },
      });

      expect(mockResolveExtraSwarms).toHaveBeenCalledWith("@other-ws do something", "user-1");
    });
  });

  describe("autoMergePr var injection", () => {
    test("injects autoMergePr: true when task.autoMerge is true", async () => {
      mockedDb.task.findFirst = vi.fn().mockResolvedValue({ ...makeTask(), autoMerge: true }) as never;
      mockFetchSuccess();

      await triggerWorkflowEditorRun({
        taskId: "task-1",
        userId: "user-1",
        message: "Edit the workflow",
        workflowTask: { workflowId: 99, workflowName: "My Workflow", workflowRefId: "ref-abc" },
      });

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const vars = body.workflow_params.set_var.attributes.vars;
      expect(vars.autoMergePr).toBe(true);
    });

    test("injects autoMergePr: false when task.autoMerge is false", async () => {
      mockedDb.task.findFirst = vi.fn().mockResolvedValue({ ...makeTask(), autoMerge: false }) as never;
      mockFetchSuccess();

      await triggerWorkflowEditorRun({
        taskId: "task-1",
        userId: "user-1",
        message: "Edit the workflow",
        workflowTask: { workflowId: 99, workflowName: "My Workflow", workflowRefId: "ref-abc" },
      });

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      const vars = body.workflow_params.set_var.attributes.vars;
      expect(vars.autoMergePr).toBe(false);
    });
  });
});
