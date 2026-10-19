/**
 * Unit tests for the strut proposal routes —
 *   GET  /api/orgs/[githubLogin]/strut/proposals/[id]?run=
 *   POST /api/orgs/[githubLogin]/strut/proposals/[id]/decide
 * — the card's read and decision, through the service (mocked here; its
 * own test covers what it sends strut).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

const { mockResolveTurn, mockRead, mockDecide, mockAppendResult } = vi.hoisted(() => ({
  mockResolveTurn: vi.fn(),
  mockRead: vi.fn(),
  mockDecide: vi.fn(),
  mockAppendResult: vi.fn(),
}));

vi.mock("@/services/strut-proposals", () => {
  class StrutProposalError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    StrutProposalError,
    resolveProposalTurn: mockResolveTurn,
    readStrutProposal: mockRead,
    decideStrutProposal: mockDecide,
    appendProposalResultRow: mockAppendResult,
  };
});

const { GET } = await import("@/app/api/orgs/[githubLogin]/strut/proposals/[id]/route");
const { POST } = await import("@/app/api/orgs/[githubLogin]/strut/proposals/[id]/decide/route");
const { StrutProposalError } = await import("@/services/strut-proposals");

const ORG = "acme-org";
const params = { params: Promise.resolve({ githubLogin: ORG, id: "p1" }) };
const TURN = {
  id: "row-1",
  workspaceId: "ws-1",
  swarmId: "swarm-1",
  userId: "user-1",
  workflow: "orchestrator",
  strutRunId: "179",
  conversationId: "conv-1",
  workspaceSlug: "acme",
};
const RECORD = {
  id: "p1",
  step: "graph/create-node",
  input: { node_type: "Concept", node_data: { name: "Retries" } },
  title: "Create a node.",
  status: "pending",
  createdAt: "",
  by: { workflow: "orchestrator", runId: "179" },
  workspaceSlug: "acme",
};

function request(url: string, init: { method?: string; body?: unknown } = {}, authed = true): NextRequest {
  const req = new NextRequest(`http://hive.test${url}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", host: "hive.test" },
    ...(init.body !== undefined ? { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) } : {}),
  });
  if (authed) {
    req.headers.set(MIDDLEWARE_HEADERS.USER_ID, "user-2");
    req.headers.set(MIDDLEWARE_HEADERS.USER_EMAIL, "t@e.com");
    req.headers.set(MIDDLEWARE_HEADERS.USER_NAME, "T");
    req.headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
  }
  return req;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveTurn.mockResolvedValue(TURN);
  mockRead.mockResolvedValue(RECORD);
  mockDecide.mockResolvedValue({ status: 200, proposal: { ...RECORD, status: "applied" } });
  mockAppendResult.mockResolvedValue(undefined);
});

describe("GET …/strut/proposals/[id]", () => {
  it("401 without a session; 400 without a run", async () => {
    expect((await GET(request(`/api/orgs/${ORG}/strut/proposals/p1?run=row-1`, {}, false), params)).status).toBe(401);
    expect((await GET(request(`/api/orgs/${ORG}/strut/proposals/p1`), params)).status).toBe(400);
  });

  it("reads the record scoped by the turn, for this caller", async () => {
    const res = await GET(request(`/api/orgs/${ORG}/strut/proposals/p1?run=row-1`), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ proposal: RECORD });
    expect(mockResolveTurn).toHaveBeenCalledWith({ githubLogin: ORG, userId: "user-2", runId: "row-1" });
    expect(mockRead).toHaveBeenCalledWith(TURN, "p1");
  });

  it("404 when the turn is not the caller's to read, or the record is not this run's; the service's status otherwise", async () => {
    mockResolveTurn.mockRejectedValueOnce(new StrutProposalError(404, "Not found"));
    expect((await GET(request(`/api/orgs/${ORG}/strut/proposals/p1?run=row-1`), params)).status).toBe(404);
    mockRead.mockResolvedValueOnce(null);
    expect((await GET(request(`/api/orgs/${ORG}/strut/proposals/p1?run=row-1`), params)).status).toBe(404);
    mockRead.mockRejectedValueOnce(new StrutProposalError(502, "Could not reach strut"));
    const res = await GET(request(`/api/orgs/${ORG}/strut/proposals/p1?run=row-1`), params);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Could not reach strut" });
  });
});

describe("POST …/strut/proposals/[id]/decide", () => {
  const url = `/api/orgs/${ORG}/strut/proposals/p1/decide`;

  it("401 without a session; 400 for a body not in shape", async () => {
    expect(
      (await POST(request(url, { method: "POST", body: { runId: "row-1", action: "accept" } }, false), params)).status,
    ).toBe(401);
    expect(
      (await POST(request(url, { method: "POST", body: { runId: "row-1", action: "maybe" } }), params)).status,
    ).toBe(400);
    expect((await POST(request(url, { method: "POST", body: { action: "accept" } }), params)).status).toBe(400);
    expect((await POST(request(url, { method: "POST", body: "not json" }), params)).status).toBe(400);
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it("forwards the decision as the clicking user, writes the result row, answers the record", async () => {
    const res = await POST(
      request(url, { method: "POST", body: { runId: "row-1", action: "reject", reason: "  Wrong parent. " } }),
      params,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ proposal: { ...RECORD, status: "applied" } });
    expect(mockResolveTurn).toHaveBeenCalledWith({ githubLogin: ORG, userId: "user-2", runId: "row-1" });
    expect(mockDecide).toHaveBeenCalledWith(TURN, "p1", { action: "reject", reason: "Wrong parent." }, "user-2");
    expect(mockAppendResult).toHaveBeenCalledWith(TURN, { ...RECORD, status: "applied" });
  });

  it("409 hands back strut's record without a result row; 400 / 404 carry the reason", async () => {
    mockDecide.mockResolvedValueOnce({
      status: 409,
      error: "already decided",
      proposal: { ...RECORD, status: "rejected" },
    });
    const res = await POST(request(url, { method: "POST", body: { runId: "row-1", action: "accept" } }), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already decided", proposal: { ...RECORD, status: "rejected" } });
    expect(mockAppendResult).not.toHaveBeenCalled();

    mockDecide.mockResolvedValueOnce({ status: 400, error: "does not fit" });
    expect(
      (
        await POST(
          request(url, { method: "POST", body: { runId: "row-1", action: "accept", input: { x: 1 } } }),
          params,
        )
      ).status,
    ).toBe(400);
    mockDecide.mockResolvedValueOnce({ status: 404, error: "Not found" });
    expect(
      (await POST(request(url, { method: "POST", body: { runId: "row-1", action: "accept" } }), params)).status,
    ).toBe(404);
  });
});
