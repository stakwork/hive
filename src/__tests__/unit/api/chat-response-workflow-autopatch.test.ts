// @vitest-environment node
/**
 * Unit tests for /api/chat/response — WorkflowTask auto-patch logic.
 *
 * When the route receives a WORKFLOW artifact with a numeric workflowId
 * for a workflow_editor task, it must upsert the WorkflowTask row.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db");

vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue({}),
    triggerBatch: vi.fn().mockResolvedValue({}),
  },
  getTaskChannelName: vi.fn((id: string) => `private-task-${id}`),
  getFeatureChannelName: vi.fn((id: string) => `private-feature-${id}`),
  getWorkspaceChannelName: vi.fn((id: string) => `private-workspace-${id}`),
  PUSHER_EVENTS: {
    NEW_MESSAGE: "new-message",
    FEATURE_UPDATED: "feature-updated",
    NOTIFICATION: "notification",
  },
}));

vi.mock("@/lib/screenshot-upload", () => ({
  processScreenshotUpload: vi.fn(),
  processRecordingUpload: vi.fn(),
}));

vi.mock("@/lib/utils/plan-xml", () => ({
  parsePlanXml: vi.fn().mockReturnValue({}),
}));

vi.mock("@/services/notifications", () => ({
  createAndSendNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    decrypt: vi.fn((v: string) => v),
    encrypt: vi.fn((v: string) => v),
  },
}));

// ─── Subject ──────────────────────────────────────────────────────────────────

import { POST } from "@/app/api/chat/response/route";
import { db } from "@/lib/db";
import { ArtifactType } from "@/lib/chat";

const mockedDb = vi.mocked(db);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/chat/response", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": "test-api-token",
    },
    body: JSON.stringify(body),
  });
}

function makeWorkflowArtifact(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    type: ArtifactType.WORKFLOW,
    content: {
      workflowId: 42,
      workflowName: "My Workflow",
      workflowRefId: "ref-42",
      workflowVersionId: null,
      ...overrides,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    messageId: "msg-1",
    icon: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.API_TOKEN = "test-api-token";
  // Suppress noisy log output
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/chat/response — WorkflowTask auto-patch", () => {
  test("upserts WorkflowTask when WORKFLOW artifact has numeric workflowId and task is workflow_editor mode", async () => {
    const taskId = "task-wfe-1";

    mockedDb.task.findFirst = vi.fn().mockResolvedValue({
      id: taskId,
      workspaceId: "ws-1",
      mode: "workflow_editor",
      assigneeId: null,
      createdById: "user-1",
      title: "My WFE Task",
    }) as never;

    const artifact = makeWorkflowArtifact();

    mockedDb.chatMessage.create = vi.fn().mockResolvedValue({
      id: "msg-1",
      taskId,
      artifacts: [artifact],
      attachments: [],
      task: { id: taskId, title: "My WFE Task" },
    }) as never;

    mockedDb.workflowTask = {
      upsert: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    } as never;

    // Suppress workflow-version graph fetch (no workflowVersionId on artifact)
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;

    const req = makeRequest({
      taskId,
      message: "Workflow updated",
      artifacts: [
        {
          type: ArtifactType.WORKFLOW,
          content: {
            workflowId: 42,
            workflowName: "My Workflow",
            workflowRefId: "ref-42",
          },
        },
      ],
    });

    await POST(req);

    expect(mockedDb.workflowTask.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId },
        create: expect.objectContaining({ taskId, workflowId: 42 }),
        update: expect.objectContaining({ workflowId: 42 }),
      }),
    );
  });

  test("does NOT upsert WorkflowTask when task mode is not workflow_editor", async () => {
    const taskId = "task-live-1";

    mockedDb.task.findFirst = vi.fn().mockResolvedValue({
      id: taskId,
      workspaceId: "ws-1",
      mode: "live",
      assigneeId: null,
      createdById: "user-1",
      title: "Live Task",
    }) as never;

    mockedDb.chatMessage.create = vi.fn().mockResolvedValue({
      id: "msg-2",
      taskId,
      artifacts: [makeWorkflowArtifact()],
      attachments: [],
      task: { id: taskId, title: "Live Task" },
    }) as never;

    mockedDb.workflowTask = {
      upsert: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    } as never;

    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;

    const req = makeRequest({
      taskId,
      message: "Some message",
      artifacts: [
        {
          type: ArtifactType.WORKFLOW,
          content: { workflowId: 42 },
        },
      ],
    });

    await POST(req);

    expect(mockedDb.workflowTask.upsert).not.toHaveBeenCalled();
  });

  test("does NOT upsert WorkflowTask when workflowId is not a number", async () => {
    const taskId = "task-wfe-2";

    mockedDb.task.findFirst = vi.fn().mockResolvedValue({
      id: taskId,
      workspaceId: "ws-1",
      mode: "workflow_editor",
      assigneeId: null,
      createdById: "user-1",
      title: "WFE Task",
    }) as never;

    mockedDb.chatMessage.create = vi.fn().mockResolvedValue({
      id: "msg-3",
      taskId,
      artifacts: [makeWorkflowArtifact({ workflowId: "new" })],
      attachments: [],
      task: { id: taskId, title: "WFE Task" },
    }) as never;

    mockedDb.workflowTask = {
      upsert: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    } as never;

    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;

    const req = makeRequest({
      taskId,
      message: "Some message",
      artifacts: [
        {
          type: ArtifactType.WORKFLOW,
          content: { workflowId: "new" },
        },
      ],
    });

    await POST(req);

    expect(mockedDb.workflowTask.upsert).not.toHaveBeenCalled();
  });

  test("snapshots the artifact's version from Stakwork's version API (data.workflow), not the graph", async () => {
    const taskId = "task-wfe-version";

    mockedDb.task.findFirst = vi.fn().mockResolvedValue({
      id: taskId,
      workspaceId: "ws-1",
      mode: "workflow_editor",
      assigneeId: null,
      createdById: "user-1",
      title: "WFE Version Task",
    }) as never;

    const artifact = makeWorkflowArtifact({ workflowVersionId: "187946" });

    mockedDb.chatMessage.create = vi.fn().mockResolvedValue({
      id: "msg-version",
      taskId,
      artifacts: [artifact],
      attachments: [],
      task: { id: taskId, title: "WFE Version Task" },
    }) as never;

    mockedDb.workflowTask = {
      upsert: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({ workflowId: 42 }),
    } as never;

    // No earlier WORKFLOW artifacts in this task → nothing to diff against yet.
    mockedDb.artifact.findMany = vi.fn().mockResolvedValue([]) as never;
    mockedDb.artifact.update = vi.fn().mockResolvedValue({}) as never;

    // `data.workflow` is the compact definition we snapshot; `data.spec` is the
    // render payload and must be ignored (note transitions is a map there).
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          workflow_version_id: 187946,
          spec: { transitions: { set_var: { template: "<div/>" } }, connections: [] },
          workflow: {
            transitions: [{ name: "SetVar", id: "set_var", attributes: { vars: {} } }],
            connections: [{ id: "start-set_var", source: "start", target: "set_var" }],
            version: 2,
          },
        },
      }),
    }) as unknown as typeof fetch;

    const req = makeRequest({
      taskId,
      message: "Workflow updated",
      artifacts: [
        {
          type: ArtifactType.WORKFLOW,
          content: {
            workflowId: 42,
            workflowName: "My Workflow",
            workflowRefId: "ref-42",
            workflowVersionId: "187946",
          },
        },
      ],
    });

    await POST(req);

    // Hit the version endpoint — no graph call.
    const calledUrl = String(vi.mocked(global.fetch).mock.calls[0][0]);
    expect(calledUrl).toContain("/workflows/42");
    expect(calledUrl).toContain("workflow_version_id=187946");
    expect(calledUrl).not.toContain("/api/graph/");

    expect(mockedDb.artifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "artifact-1" },
        data: expect.objectContaining({
          content: expect.objectContaining({
            versionSnapshot: expect.objectContaining({ workflowVersionId: "187946" }),
            baselineSnapshot: null,
          }),
        }),
      }),
    );

    const stored = vi.mocked(mockedDb.artifact.update).mock.calls[0][0].data.content as {
      workflowJson: string;
      versionSnapshot: { value: string };
    };

    // The editor view and the diff share one canonicalised value.
    expect(stored.workflowJson).toBe(stored.versionSnapshot.value);
    // Array-shaped transitions prove data.workflow was used, not data.spec.
    expect(stored.versionSnapshot.value).toContain('"transitions": [');
    expect(stored.versionSnapshot.value).not.toContain("template");
    // `version` is metadata — the diff is labelled with workflow version ids.
    expect(stored.versionSnapshot.value).not.toContain('"version"');
  });

  test("returns 401 when API token is missing", async () => {
    const req = new NextRequest("http://localhost/api/chat/response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1" }),
    });

    const response = await POST(req);

    expect(response.status).toBe(401);
  });
});
