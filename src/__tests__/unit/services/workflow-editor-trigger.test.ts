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

const mockedDb = vi.mocked(db);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTask() {
  return {
    id: "task-1",
    workspaceId: "ws-1",
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

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = global.fetch;
    mockedDb.task.findFirst = vi.fn().mockResolvedValue(makeTask()) as never;
    mockedDb.task.update = vi.fn().mockResolvedValue({}) as never;
    mockedDb.chatMessage.create = vi.fn().mockResolvedValue({ id: "msg-1" }) as never;
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
});
