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

  test("populates artifact workflowJson from graph node using properties.body", async () => {
    const taskId = "task-wfe-body";

    process.env.STAKWORK_JARVIS_URL = "http://jarvis.test";
    process.env.STAKWORK_GRAPH_API_KEY = "test-graph-key";

    mockedDb.task.findFirst = vi.fn().mockResolvedValue({
      id: taskId,
      workspaceId: "ws-1",
      mode: "workflow_editor",
      assigneeId: null,
      createdById: "user-1",
      title: "WFE Body Task",
    }) as never;

    const workflowBody = '{"transitions":[{"id":"t1"}]}';
    const artifact = makeWorkflowArtifact({ workflowVersionId: "ver-001" });

    mockedDb.chatMessage.create = vi.fn().mockResolvedValue({
      id: "msg-body",
      taskId,
      artifacts: [artifact],
      attachments: [],
      task: { id: taskId, title: "WFE Body Task" },
    }) as never;

    mockedDb.workflowTask = {
      upsert: vi.fn().mockResolvedValue({}),
    } as never;

    mockedDb.artifact.findMany = vi.fn().mockResolvedValue([]) as never;
    mockedDb.artifact.update = vi.fn().mockResolvedValue({}) as never;

    // Graph API returns node with properties.body instead of properties.workflow_json
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        nodes: [
          {
            ref_id: "ref-ver-001",
            properties: {
              workflow_version_id: "ver-001",
              body: workflowBody,
            },
          },
        ],
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
            workflowVersionId: "ver-001",
          },
        },
      ],
    });

    await POST(req);

    expect(mockedDb.artifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.objectContaining({
            workflowJson: workflowBody,
          }),
        }),
      }),
    );
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
