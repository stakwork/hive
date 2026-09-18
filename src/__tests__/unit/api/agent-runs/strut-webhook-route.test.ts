/**
 * Unit tests for POST /api/agent-runs/webhook/strut
 *
 * Coverage:
 *   - Auth: missing id / token, unknown row, a non-strut row, wrong token, rate limit.
 *   - A spent row (settled / superseded) is a 200 no-op — strut must not retry.
 *   - Malformed payloads and a chat id that does not match the row → 400.
 *   - Unsettled turn: fanned out, row stays PENDING (token still good), no wake.
 *   - Settled turn: fanned out, row claimed DELIVERED_WEBHOOK, wake scheduled once.
 *   - Settled error turn → FAILED. A lost claim schedules no wake.
 *   - Fan-out failure → 500 and nothing claimed (strut retries).
 *   - Delivery target comes from the row, never the payload.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

const { mockFindUnique, mockUpdateMany, mockRateLimit, mockFanOut, mockWake, afterCallbacks } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockRateLimit: vi.fn(),
  mockFanOut: vi.fn(),
  mockWake: vi.fn(),
  afterCallbacks: [] as Array<() => Promise<void>>,
}));

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => void afterCallbacks.push(fn),
}));
vi.mock("@/lib/db", () => ({ db: { agentRun: { findUnique: mockFindUnique, updateMany: mockUpdateMany } } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockRateLimit, getClientIp: () => "1.2.3.4" }));
vi.mock("@/lib/encryption", () => ({ timingSafeEqual: (a: string, b: string) => a === b }));
vi.mock("@/services/canvas-agent-run-fanout", () => ({
  hardenContent: (raw: unknown) => (raw == null ? null : String(raw).length > 100 ? null : String(raw)),
}));
vi.mock("@/services/canvas-strut-fanout", () => ({
  fanOutStrutToCanvas: mockFanOut,
  strutRowId: (p: { runId: string; turn: number; event: string }) => `strut-${p.runId}-${p.turn}-${p.event}`,
}));
vi.mock("@/lib/ai/strutTools", () => ({ STRUT_AGENT_KIND: "strut_chat" }));
vi.mock("@/services/canvas-strut-autoturn", () => ({ invokeCanvasAgentOnStrutSettled: mockWake }));

import { POST } from "@/app/api/agent-runs/webhook/strut/route";

const TOKEN = "raw-token";
const HASH = crypto.createHash("sha256").update(TOKEN).digest("hex");

const row = (over: Record<string, unknown> = {}) => ({
  id: "run-1",
  tokenHash: HASH,
  conversationId: "conv-1",
  orgId: "org-1",
  userId: "user-1",
  title: "Build clipper",
  status: "PENDING",
  agentKind: "strut_chat",
  workspaceSlug: "acme",
  sessionId: "chat-9",
  ...over,
});

const body = (over: Record<string, unknown> = {}) => ({
  event: "turn.end",
  chatId: "chat-9",
  turn: 0,
  status: "done",
  trigger: "human",
  text: "Published clipper v1.",
  settled: true,
  parked: false,
  ...over,
});

function post(payload: unknown, query = `id=run-1&token=${TOKEN}`) {
  return POST(
    new NextRequest(`https://hive.example.com/api/agent-runs/webhook/strut?${query}`, {
      method: "POST",
      headers: { host: "hive.example.com", "content-type": "application/json" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );
}

describe("POST /api/agent-runs/webhook/strut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterCallbacks.length = 0;
    mockRateLimit.mockResolvedValue({ allowed: true });
    mockFindUnique.mockResolvedValue(row());
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFanOut.mockResolvedValue("appended");
  });

  test("rejects missing id / token, unknown and non-strut rows, and a wrong token", async () => {
    expect((await post(body(), "token=x")).status).toBe(400);
    expect((await post(body(), "id=run-1")).status).toBe(401);
    mockFindUnique.mockResolvedValueOnce(null);
    expect((await post(body())).status).toBe(404);
    mockFindUnique.mockResolvedValueOnce(row({ agentKind: "workflow_explorer" }));
    expect((await post(body())).status).toBe(404);
    expect((await post(body(), "id=run-1&token=wrong")).status).toBe(401);
    expect(mockFanOut).not.toHaveBeenCalled();
  });

  test("rate limited before any lookup", async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });
    const res = await post(body());
    expect(res.status).toBe(429);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  test("a spent row is a 200 no-op", async () => {
    mockFindUnique.mockResolvedValue(row({ status: "FAILED" }));
    const res = await post(body());
    expect(res.status).toBe(200);
    expect(mockFanOut).not.toHaveBeenCalled();
  });

  test("malformed payloads and a foreign chat id are 400s", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post(body({ event: "nope" }))).status).toBe(400);
    expect((await post(body({ turn: -1 }))).status).toBe(400);
    expect((await post(body({ chatId: undefined }))).status).toBe(400);
    expect((await post(body({ chatId: "other-chat" }))).status).toBe(400);
    expect(mockFanOut).not.toHaveBeenCalled();
  });

  test("an unsettled turn is shown, leaves the row PENDING, and wakes nobody", async () => {
    const res = await post(body({ settled: false, conversationId: "attacker-conv" }));
    expect(res.status).toBe(200);
    expect(mockFanOut).toHaveBeenCalledWith(
      { conversationId: "conv-1", orgId: "org-1", userId: "user-1" },
      expect.objectContaining({ runId: "run-1", chatId: "chat-9", turn: 0, settled: false, workspaceSlug: "acme" }),
    );
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });

  test("a post that beats the dispatch's chat-id write records the chat id", async () => {
    mockFindUnique.mockResolvedValue(row({ sessionId: null }));
    await post(body({ settled: false }));
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "run-1", sessionId: null },
      data: { sessionId: "chat-9" },
    });
  });

  test("a settled turn claims the row and schedules the wake", async () => {
    const res = await post(body());
    expect(res.status).toBe(200);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "run-1", tokenHash: HASH, status: "PENDING" },
      data: { status: "DELIVERED_WEBHOOK", sessionId: "chat-9", result: "Published clipper v1." },
    });
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(mockWake).toHaveBeenCalledWith({
      conversationId: "conv-1",
      wakeId: "strut-run-1-0-turn.end",
      workspaceSlug: "acme",
      chatId: "chat-9",
      title: "Build clipper",
      failed: false,
      publicBaseUrl: expect.stringContaining("hive.example.com"),
    });
  });

  test("a settled error turn is FAILED; an oversized reply is demoted to an error", async () => {
    await post(body({ status: "error", text: undefined, error: { message: "no key" } }));
    expect(mockUpdateMany.mock.calls[0][0].data).toMatchObject({ status: "FAILED", error: "no key" });

    mockUpdateMany.mockClear();
    await post(body({ text: "x".repeat(500) }));
    expect(mockFanOut.mock.calls[1][1]).toMatchObject({ status: "error", text: null });
    expect(mockUpdateMany.mock.calls[0][0].data.status).toBe("FAILED");
  });

  test("a lost claim schedules no wake", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    expect((await post(body())).status).toBe(200);
    expect(afterCallbacks).toHaveLength(0);
  });

  test("a failed fan-out is a 500 and claims nothing", async () => {
    mockFanOut.mockResolvedValue("failed");
    expect((await post(body())).status).toBe(500);
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(0);
  });
});
