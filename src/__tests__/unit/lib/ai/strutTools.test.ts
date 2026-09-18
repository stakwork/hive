/**
 * Unit tests for buildStrutTools.
 *
 * Coverage:
 *   - Authorization: no swarm access / wrong org → error, strut never called.
 *   - Dispatch (canvas): row created as strut_chat, callback URL carries the row
 *     id + a token whose SHA-256 is what is stored, chat id + turn saved.
 *   - Continue: chatId sent, earlier PENDING rows for the chat superseded.
 *   - 409 → `busy`, row retired. Non-2xx → error, row retired. Unreachable → error.
 *   - An older strut (no `callback: true` in the 202) is reported, row retired.
 *   - No canvas conversation → dispatched without a callback, no row.
 *   - check_strut_chat / list_strut_chats shape the lab's responses.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

const {
  mockSwarmAccess,
  mockResolveConversation,
  mockWorkspaceFindUnique,
  mockAgentRunCreate,
  mockAgentRunUpdate,
  mockAgentRunUpdateMany,
} = vi.hoisted(() => ({
  mockSwarmAccess: vi.fn(),
  mockResolveConversation: vi.fn(),
  mockWorkspaceFindUnique: vi.fn(),
  mockAgentRunCreate: vi.fn(),
  mockAgentRunUpdate: vi.fn(),
  mockAgentRunUpdateMany: vi.fn(),
}));

vi.mock("@/lib/helpers/swarm-access", () => ({ getWorkspaceSwarmAccess: mockSwarmAccess }));
vi.mock("@/services/org-canvas-conversation", () => ({ resolveOrgConversationRowId: mockResolveConversation }));
vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findUnique: mockWorkspaceFindUnique },
    agentRun: { create: mockAgentRunCreate, update: mockAgentRunUpdate, updateMany: mockAgentRunUpdateMany },
  },
}));

import { buildStrutTools, lastAssistantText } from "@/lib/ai/strutTools";
import type { CapabilityContext } from "@/lib/ai/capabilities";

const mockFetch = vi.fn();

function makeCtx(overrides: Partial<CapabilityContext> = {}): CapabilityContext {
  return {
    orgId: "org-1",
    userId: "user-1",
    currentCanvasConversationId: "conv-1",
    publicBaseUrl: "https://hive.example.com",
    ...overrides,
  } as CapabilityContext;
}

function execute<T>(name: string, input: T, ctx = makeCtx()) {
  const t = buildStrutTools(ctx)[name] as unknown as { execute: (i: T) => Promise<Record<string, unknown>> };
  return t.execute(input);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("buildStrutTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    mockSwarmAccess.mockResolvedValue({
      success: true,
      data: { workspaceId: "ws-id", swarmUrl: "https://swarm1.sphinx.chat/api", swarmApiKey: "swarm-key" },
    });
    mockWorkspaceFindUnique.mockResolvedValue({ sourceControlOrgId: "org-1" });
    mockResolveConversation.mockResolvedValue("conv-1");
    mockAgentRunCreate.mockResolvedValue({ id: "run-1" });
    mockAgentRunUpdate.mockResolvedValue({});
    mockAgentRunUpdateMany.mockResolvedValue({ count: 0 });
  });
  afterEach(() => vi.unstubAllGlobals());

  const dispatch = (input: { chatId?: string } = {}, ctx?: CapabilityContext) =>
    execute("dispatch_strut", { workspace: "acme", title: "Build clipper", prompt: "build it", ...input }, ctx);

  test("no workspace access → error before any credential or strut call", async () => {
    mockSwarmAccess.mockResolvedValue({ success: false, error: { type: "ACCESS_DENIED" } });
    const out = await dispatch();
    expect(out.status).toBe("error");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockAgentRunCreate).not.toHaveBeenCalled();
  });

  test("a workspace outside the active org is refused", async () => {
    mockWorkspaceFindUnique.mockResolvedValue({ sourceControlOrgId: "other-org" });
    const out = await dispatch();
    expect(out).toMatchObject({ status: "error", error: expect.stringContaining("active org") });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("dispatch: strut_chat row, tokenized callback URL, chat id + turn saved", async () => {
    mockFetch.mockResolvedValue(json(202, { chatId: "chat-9", turn: 0, callback: true }));
    const out = await dispatch();

    expect(out).toMatchObject({ status: "dispatched", chatId: "chat-9" });
    const created = mockAgentRunCreate.mock.calls[0][0].data;
    expect(created).toMatchObject({
      agentKind: "strut_chat",
      conversationId: "conv-1",
      orgId: "org-1",
      userId: "user-1",
      workspaceId: "ws-id",
      workspaceSlug: "acme",
      title: "Build clipper",
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://swarm1.sphinx.chat:3355/lab/chat");
    expect(init.headers["x-api-token"]).toBe("swarm-key");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ message: "build it", title: "Build clipper" });
    expect(body.chatId).toBeUndefined();

    const cb = new URL(body.callback.url);
    expect(cb.origin + cb.pathname).toBe("https://hive.example.com/api/agent-runs/webhook/strut");
    expect(cb.searchParams.get("id")).toBe("run-1");
    const token = cb.searchParams.get("token")!;
    expect(crypto.createHash("sha256").update(token).digest("hex")).toBe(created.tokenHash);

    expect(mockAgentRunUpdate).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { sessionId: "chat-9", requestId: "0" },
    });
  });

  test("continue: sends chatId and supersedes that chat's earlier PENDING rows", async () => {
    mockFetch.mockResolvedValue(json(202, { chatId: "chat-9", turn: 3, callback: true }));
    const out = await dispatch({ chatId: "chat-9" });

    expect(out.status).toBe("dispatched");
    expect(mockAgentRunCreate.mock.calls[0][0].data.sessionId).toBe("chat-9");
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({ chatId: "chat-9", message: "build it" });
    expect(mockAgentRunUpdateMany).toHaveBeenCalledWith({
      where: {
        agentKind: "strut_chat",
        workspaceId: "ws-id",
        sessionId: "chat-9",
        status: "PENDING",
        id: { not: "run-1" },
      },
      data: { status: "FAILED", error: "superseded" },
    });
  });

  test("409 → busy (not an error), and the row is retired", async () => {
    mockFetch.mockResolvedValue(json(409, { error: "turn in progress" }));
    const out = await dispatch({ chatId: "chat-9" });
    expect(out).toMatchObject({ status: "busy", chatId: "chat-9" });
    expect(mockAgentRunUpdateMany).toHaveBeenCalledWith({
      where: { id: "run-1", status: "PENDING" },
      data: { status: "FAILED", error: "chat_busy" },
    });
  });

  test("an unknown chat / strut error → error, row retired", async () => {
    mockFetch.mockResolvedValue(json(404, { error: 'Chat "nope" not found' }));
    const out = await dispatch({ chatId: "nope" });
    expect(out).toMatchObject({ status: "error", error: expect.stringContaining("not found") });
    expect(mockAgentRunUpdateMany.mock.calls[0][0].data).toEqual({ status: "FAILED", error: "strut_http_404" });
  });

  test("strut unreachable → error, row retired", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const out = await dispatch();
    expect(out.status).toBe("error");
    expect(mockAgentRunUpdateMany.mock.calls[0][0].data).toEqual({ status: "FAILED", error: "initiation_failed" });
  });

  test("an older strut that ignores `callback` is reported, with the chat id", async () => {
    mockFetch.mockResolvedValue(json(202, { chatId: "chat-9", turn: 0 }));
    const out = await dispatch();
    expect(out).toMatchObject({ status: "dispatched_without_callback", chatId: "chat-9" });
    expect(mockAgentRunUpdateMany.mock.calls[0][0].data).toEqual({
      status: "FAILED",
      error: "strut_callbacks_unsupported",
    });
  });

  test("no canvas conversation → dispatched without a callback, no row", async () => {
    mockFetch.mockResolvedValue(json(202, { chatId: "chat-9", turn: 0 }));
    const out = await dispatch({}, makeCtx({ currentCanvasConversationId: undefined }));
    expect(out.status).toBe("dispatched_without_callback");
    expect(mockAgentRunCreate).not.toHaveBeenCalled();
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).callback).toBeUndefined();
  });

  test("a conversation the caller does not own gets no callback row", async () => {
    mockResolveConversation.mockResolvedValue(null);
    mockFetch.mockResolvedValue(json(202, { chatId: "chat-9", turn: 0 }));
    await dispatch();
    expect(mockAgentRunCreate).not.toHaveBeenCalled();
  });

  test("check_strut_chat returns status + the latest reply", async () => {
    mockFetch.mockResolvedValue(
      json(200, {
        meta: {
          title: "Build clipper",
          status: "done",
          currentTurn: 2,
          updatedAt: "2026-09-18T00:00:00Z",
          callback: { origin: "https://hive.example.com" },
        },
        messages: [
          { role: "user", content: "build it" },
          { role: "assistant", content: [{ type: "text", text: "Done — clipper v2 passes." }] },
        ],
      }),
    );
    const out = await execute("check_strut_chat", { workspace: "acme", chatId: "chat 9" });
    expect(mockFetch.mock.calls[0][0]).toBe("https://swarm1.sphinx.chat:3355/lab/chat/chat%209");
    expect(out).toEqual({
      chatId: "chat 9",
      title: "Build clipper",
      chatStatus: "done",
      turn: 2,
      updatedAt: "2026-09-18T00:00:00Z",
      latestReply: "Done — clipper v2 passes.",
    });
  });

  test("list_strut_chats maps the lab's sessions", async () => {
    mockFetch.mockResolvedValue(json(200, [{ id: "chat-9", title: "Build clipper", status: "live", updatedAt: "t" }]));
    const out = await execute("list_strut_chats", { workspace: "acme" });
    expect(out).toEqual({ chats: [{ chatId: "chat-9", title: "Build clipper", chatStatus: "live", updatedAt: "t" }] });
  });

  test("lastAssistantText skips tool-only assistant messages", () => {
    expect(
      lastAssistantText([
        { role: "assistant", content: [{ type: "text", text: "answer" }] },
        { role: "assistant", content: [{ type: "tool-call", toolName: "x" }] },
      ]),
    ).toBe("answer");
    expect(lastAssistantText([{ role: "user", content: "hi" }])).toBeNull();
    expect(lastAssistantText(null)).toBeNull();
  });
});
