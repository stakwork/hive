/**
 * Unit tests for the strut half of POST /api/ask/abort (the Stop button).
 *
 *   - PENDING strut runs of the conversation are cancelled on strut (from
 *     their rows) after the IDOR check and before the swarm abort loop;
 *   - their active-run entries (keyed by the StrutRun id) are skipped in the
 *     swarm `/repo/agent/abort` loop — there is no request behind them;
 *   - the count reports both; a strut failure never blocks the swarm aborts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

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

import { POST } from "@/app/api/ask/abort/route";

const mockFetch = vi.fn();

function post() {
  return POST(
    new NextRequest("http://localhost/api/ask/abort", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: "conv-1", orgId: "org-1", turnId: "turn-1" }),
    }),
  );
}

describe("POST /api/ask/abort — strut runs", () => {
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
  });

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
  });

  it("with only a strut run pending, reports it and never touches the swarm abort", async () => {
    mockCancelPending.mockResolvedValue({ rows: [{ id: "strut-row-1", kind: "code_change_propose" }], cancelled: 1 });
    mockRequestAbort.mockResolvedValue([]);
    const res = await post();
    expect(await res.json()).toEqual({ ok: true, aborted: 1 });
    expect(mockPendingIntent).toHaveBeenCalledWith("conv-row-1", "turn-1");
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
