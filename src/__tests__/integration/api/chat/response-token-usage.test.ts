/**
 * Integration tests: token usage fields in POST /api/chat/response
 *
 * Covers:
 * - usage object fields are stored on the ChatMessage row when provided
 * - existing callers without a usage field are unaffected
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/chat/response/route";
import { db } from "@/lib/db";
import { createPostRequest } from "@/__tests__/support/helpers/request-builders";

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn() },
  getTaskChannelName: (id: string) => `task-${id}`,
  getFeatureChannelName: (id: string) => `feature-${id}`,
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  PUSHER_EVENTS: {
    TASK_TITLE_UPDATE: "task-title-update",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
    NEW_MESSAGE: "new-message",
    FEATURE_UPDATED: "feature-updated",
  },
}));

vi.mock("@/services/s3", () => ({
  getS3Service: () => ({ putObject: vi.fn() }),
}));

vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return { ...mod, after: (fn: () => void) => fn() };
});

function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

describe("POST /api/chat/response — token usage storage", () => {
  let taskId: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    const userId = uid("user");
    const workspaceId = uid("ws");
    taskId = uid("task");

    await db.$transaction(async (tx) => {
      await tx.user.create({
        data: { id: userId, email: `${userId}@test.com`, name: "Test" },
      });
      await tx.workspace.create({
        data: {
          id: workspaceId,
          name: "Test WS",
          slug: uid("slug"),
          ownerId: userId,
        },
      });
      await tx.task.create({
        data: {
          id: taskId,
          title: "Test Task",
          workspaceId,
          createdById: userId,
          updatedById: userId,
          status: "TODO",
          workflowStatus: "PENDING",
        },
      });
    });

    process.env.API_TOKEN = "test-token";
  });

  it("stores usage fields when provided in the request body", async () => {
    const req = createPostRequest("/api/chat/response", {
      taskId,
      message: "Hello",
      usage: {
        inputTokens: 250,
        outputTokens: 80,
        cacheReadTokens: 100,
        cacheWriteTokens: 20,
      },
    });
    req.headers.set("x-api-token", "test-token");

    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    const messageId: string = body.data.id;

    const stored = await db.chatMessage.findUnique({ where: { id: messageId } });
    expect(stored).not.toBeNull();
    expect(stored!.inputTokens).toBe(250);
    expect(stored!.outputTokens).toBe(80);
    expect(stored!.cacheReadTokens).toBe(100);
    expect(stored!.cacheWriteTokens).toBe(20);
  });

  it("leaves token columns null when no usage is provided", async () => {
    const req = createPostRequest("/api/chat/response", {
      taskId,
      message: "Hello",
    });
    req.headers.set("x-api-token", "test-token");

    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    const stored = await db.chatMessage.findUnique({ where: { id: body.data.id } });
    expect(stored!.inputTokens).toBeNull();
    expect(stored!.outputTokens).toBeNull();
    expect(stored!.cacheReadTokens).toBeNull();
    expect(stored!.cacheWriteTokens).toBeNull();
  });

  it("stores only the present usage fields (partial usage)", async () => {
    const req = createPostRequest("/api/chat/response", {
      taskId,
      message: "Hello",
      usage: { inputTokens: 500, outputTokens: 120 },
    });
    req.headers.set("x-api-token", "test-token");

    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    const stored = await db.chatMessage.findUnique({ where: { id: body.data.id } });
    expect(stored!.inputTokens).toBe(500);
    expect(stored!.outputTokens).toBe(120);
    expect(stored!.cacheReadTokens).toBeNull();
    expect(stored!.cacheWriteTokens).toBeNull();
  });
});
