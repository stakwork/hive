/**
 * Unit tests for POST /api/ask/abort.
 *
 * Without a `turnId` (the header "Stop investigation" button) — the strut
 * half of the conversation-wide path:
 *   - PENDING strut runs of the conversation are cancelled on strut (from
 *     their rows) after the IDOR check and before the swarm abort loop;
 *   - their active-run entries (keyed by the StrutRun id) are skipped in the
 *     swarm `/repo/agent/abort` loop — there is no request behind them;
 *   - the count reports both; a strut failure never blocks the swarm aborts.
 *
 * With a `turnId` (the composer's Stop button) — never the conversation path:
 *   - a non-UUID `turnId` is rejected (400) before rate-limit/org checks;
 *   - the Redis signal is the whole abort; Redis unavailable → 503;
 *   - the owner's Stop also cancels the turn's own PENDING strut runs;
 *   - a non-owner / unregistered turn gets the same 202, nothing touched.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { TurnAbortUnavailable } from "@/services/canvas-turn-abort";

const {
  mockRequireAuth,
  mockValidateOrg,
  mockResolveRow,
  mockRateLimit,
  mockRequestAbort,
  mockAllAborted,
  mockPendingIntent,
  mockSwarmAccess,
  mockCancelPending,
  mockRequestTurnAbort,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockValidateOrg: vi.fn(),
  mockResolveRow: vi.fn(),
  mockRateLimit: vi.fn(),
  mockRequestAbort: vi.fn(),
  mockAllAborted: vi.fn(),
  mockPendingIntent: vi.fn(),
  mockSwarmAccess: vi.fn(),
  mockCancelPending: vi.fn(),
  mockRequestTurnAbort: vi.fn(),
}));

vi.mock("@/lib/middleware/utils", () => ({ getMiddlewareContext: () => ({}), requireAuth: mockRequireAuth }));
vi.mock("@/services/workspace", () => ({ validateUserBelongsToOrg: mockValidateOrg }));
vi.mock("@/services/org-canvas-conversation", () => ({ resolveOrgConversationRowId: mockResolveRow }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockRateLimit }));
vi.mock("@/services/canvas-active-runs", () => ({
  requestAbortForAllRuns: mockRequestAbort,
  areAllRunsAlreadyAborted: mockAllAborted,
  setPendingAbortIntent: mockPendingIntent,
}));
vi.mock("@/lib/helpers/swarm-access", () => ({ getSwarmAccessByWorkspaceId: mockSwarmAccess }));
vi.mock("@/services/strut-runs", () => ({ cancelPendingStrutRunsForConversation: mockCancelPending }));
// Keep the real `isValidTurnId` / `TurnAbortUnavailable`; only the
// Redis-backed `requestTurnAbort` is mocked.
vi.mock("@/services/canvas-turn-abort", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/canvas-turn-abort")>();
  return { ...actual, requestTurnAbort: mockRequestTurnAbort };
});

import { POST } from "@/app/api/ask/abort/route";

const TURN_ID = "123e4567-e89b-42d3-a456-426614174000";
const mockFetch = vi.fn();

function post(body: Record<string, string> = { conversationId: "conv-1", orgId: "org-1" }) {
  return POST(
    new NextRequest("http://localhost/api/ask/abort", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockResolvedValue({ ok: true, status: 200 });
  mockRequireAuth.mockReturnValue({ id: "user-1" });
  mockValidateOrg.mockResolvedValue(true);
  mockResolveRow.mockResolvedValue("conv-row-1");
  mockRateLimit.mockResolvedValue({ allowed: true });
  mockAllAborted.mockResolvedValue(false);
  mockSwarmAccess.mockResolvedValue({ success: true, data: { swarmUrl: "https://swarm:3355", swarmApiKey: "k" } });
  mockCancelPending.mockResolvedValue({ rows: [], cancelled: 0 });
  mockRequestTurnAbort.mockResolvedValue({ owner: { rowId: "conv-row-1", startedAt: "2024-01-01T00:00:00.000Z" } });
});

describe("POST /api/ask/abort — conversation-wide strut runs (no turnId)", () => {
  it("cancels pending strut runs after the IDOR check and skips their active-run entries", async () => {
    mockCancelPending.mockResolvedValue({ rows: [{ id: "strut-row-1", kind: "code_change_propose" }], cancelled: 1 });
    mockRequestAbort.mockResolvedValue([
      { requestId: "strut-row-1", workspaceId: "ws-1", startedAt: new Date().toISOString() },
      { requestId: "req-swarm", workspaceId: "ws-1", startedAt: new Date().toISOString() },
    ]);

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, aborted: 2 });
    expect(mockCancelPending).toHaveBeenCalledWith("conv-row-1");
    expect(mockCancelPending.mock.invocationCallOrder[0]).toBeGreaterThan(mockResolveRow.mock.invocationCallOrder[0]);
    // Only the swarm request gets a /repo/agent/abort.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ request_id: "req-swarm" });
    expect(mockRequestTurnAbort).not.toHaveBeenCalled();
  });

  it("with only a strut run pending, reports it and never touches the swarm abort", async () => {
    mockCancelPending.mockResolvedValue({ rows: [{ id: "strut-row-1", kind: "code_change_propose" }], cancelled: 1 });
    mockRequestAbort.mockResolvedValue([]);
    const res = await post();
    expect(await res.json()).toEqual({ ok: true, aborted: 1 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does nothing for a caller outside the org or conversation", async () => {
    mockValidateOrg.mockResolvedValue(false);
    expect((await post()).status).toBe(404);
    mockValidateOrg.mockResolvedValue(true);
    mockResolveRow.mockResolvedValue(null);
    expect((await post()).status).toBe(404);
    expect(mockCancelPending).not.toHaveBeenCalled();
  });

  it("a strut failure never blocks the swarm aborts", async () => {
    mockCancelPending.mockRejectedValue(new Error("strut down"));
    mockRequestAbort.mockResolvedValue([{ requestId: "req-swarm", workspaceId: "ws-1", startedAt: new Date().toISOString() }]);
    const res = await post();
    expect(await res.json()).toEqual({ ok: true, aborted: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/ask/abort — one turn (turnId)", () => {
  it("signals the turn and cancels only its own pending strut runs", async () => {
    mockCancelPending.mockResolvedValue({ rows: [{ id: "strut-row-1", kind: "code_change_propose" }], cancelled: 1 });

    const res = await post({ orgId: "org-1", turnId: TURN_ID });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, conversationId: "conv-row-1" });
    expect(mockRequestTurnAbort).toHaveBeenCalledWith({ turnId: TURN_ID, userId: "user-1", orgId: "org-1" });
    expect(mockCancelPending).toHaveBeenCalledWith("conv-row-1", {
      userId: "user-1",
      since: new Date("2024-01-01T00:00:00.000Z"),
    });
    // The turn's own instance stops its repo_agent runs; the conversation path is never taken.
    expect(mockRequestAbort).not.toHaveBeenCalled();
    expect(mockPendingIntent).not.toHaveBeenCalled();
    expect(mockResolveRow).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("gets the same 202 with nothing cancelled for a non-owner or unregistered turn", async () => {
    mockRequestTurnAbort.mockResolvedValue({ owner: null });

    const res = await post({ conversationId: "conv-1", orgId: "org-1", turnId: TURN_ID });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true });
    expect(mockCancelPending).not.toHaveBeenCalled();
    expect(mockRequestAbort).not.toHaveBeenCalled();
  });

  it("checks org membership before touching Redis", async () => {
    mockValidateOrg.mockResolvedValue(false);

    expect((await post({ orgId: "org-1", turnId: TURN_ID })).status).toBe(404);
    expect(mockRequestTurnAbort).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID turnId before rate-limit or org checks", async () => {
    const res = await post({ conversationId: "conv-1", orgId: "org-1", turnId: "turn-1" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid turnId" });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockValidateOrg).not.toHaveBeenCalled();
    expect(mockRequestTurnAbort).not.toHaveBeenCalled();
  });

  it("returns 503 and cancels nothing when Redis is unavailable", async () => {
    mockRequestTurnAbort.mockRejectedValue(new TurnAbortUnavailable("requestTurnAbort:write"));

    const res = await post({ orgId: "org-1", turnId: TURN_ID });

    expect(res.status).toBe(503);
    expect(mockCancelPending).not.toHaveBeenCalled();
  });

  it("a strut-cancel failure still answers 202", async () => {
    mockCancelPending.mockRejectedValue(new Error("strut down"));

    const res = await post({ orgId: "org-1", turnId: TURN_ID });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, conversationId: "conv-row-1" });
  });
});
