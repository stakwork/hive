/**
 * Unit tests for POST /api/learnings/concepts/proposals/bulk.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { WorkspaceRole } from "@/lib/auth/roles";
import { patternToRegex } from "@/lib/middleware/utils";

vi.mock("@/config/env", () => ({
  config: {
    USE_MOCKS: false,
    MOCK_BASE: "http://localhost:3000",
  },
}));

vi.mock("@/lib/auth/workspace-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/workspace-access")>(
    "@/lib/auth/workspace-access",
  );
  return { ...actual, resolveWorkspaceAccess: vi.fn() };
});

vi.mock("@/app/api/learnings/utils", async () => {
  const actual = await vi.importActual<typeof import("@/app/api/learnings/utils")>(
    "@/app/api/learnings/utils",
  );
  return { ...actual, getSwarmConfig: vi.fn() };
});

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { getSwarmConfig } from "@/app/api/learnings/utils";
import { POST as bulkPost } from "@/app/api/learnings/concepts/proposals/bulk/route";
import { logger } from "@/lib/logger";

const mockResolve = vi.mocked(resolveWorkspaceAccess);
const mockSwarmConfig = vi.mocked(getSwarmConfig);

function memberAccess(role: WorkspaceRole = WorkspaceRole.DEVELOPER) {
  return {
    kind: "member" as const,
    userId: "user-123",
    workspaceId: "ws-abc",
    slug: "test-ws",
    role,
  };
}

const goodSwarm = {
  baseSwarmUrl: "https://swarm.example.com:3355",
  decryptedSwarmApiKey: "secret-key",
} as const;

function makeReq(body?: Record<string, unknown>, workspace = "test-ws") {
  return new NextRequest(
    `http://localhost/api/learnings/concepts/proposals/bulk?workspace=${workspace}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
}

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function stubOwnedAndDecisions(
  ownedIds: string[],
  decisions: Array<{ status: number; body: unknown }>,
) {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  fetchSpy.mockResolvedValueOnce(
    jsonResponse(200, {
      proposals: ownedIds.map((id) => ({ id })),
      count: ownedIds.length,
    }),
  );
  for (const decision of decisions) {
    fetchSpy.mockResolvedValueOnce(jsonResponse(decision.status, decision.body));
  }
  return fetchSpy;
}

describe("POST /api/learnings/concepts/proposals/bulk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockResolvedValue(memberAccess());
    mockSwarmConfig.mockResolvedValue(goodSwarm);
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not match the public GET /api/learnings/concepts/* middleware policy", () => {
    const regex = patternToRegex("/api/learnings/concepts/*");
    expect(regex.test("/api/learnings/concepts/proposals/bulk")).toBe(false);
    expect(regex.test("/api/learnings/concepts/proposals")).toBe(true);
  });

  it("returns 400 when workspace param is missing", async () => {
    const req = new NextRequest("http://localhost/api/learnings/concepts/proposals/bulk", {
      method: "POST",
      body: JSON.stringify({ action: "accept", ids: ["p1"] }),
    });
    const res = await bulkPost(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 for public-viewer", async () => {
    mockResolve.mockResolvedValue({
      kind: "public-viewer",
      userId: null,
      workspaceId: "ws-abc",
      slug: "test-ws",
      role: WorkspaceRole.VIEWER,
    });
    const res = await bulkPost(makeReq({ action: "accept", ids: ["p1"] }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for VIEWER role", async () => {
    mockResolve.mockResolvedValue(memberAccess(WorkspaceRole.VIEWER));
    const res = await bulkPost(makeReq({ action: "accept", ids: ["p1"] }));
    expect(res.status).toBe(403);
  });

  it("returns 403 for STAKEHOLDER role", async () => {
    mockResolve.mockResolvedValue(memberAccess(WorkspaceRole.STAKEHOLDER));
    const res = await bulkPost(makeReq({ action: "accept", ids: ["p1"] }));
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid action", async () => {
    const res = await bulkPost(makeReq({ action: "approve", ids: ["p1"] }));
    expect(res.status).toBe(400);
    expect(mockSwarmConfig).not.toHaveBeenCalled();
  });

  it("returns 400 for empty ids", async () => {
    const res = await bulkPost(makeReq({ action: "accept", ids: [] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when ids is not an array", async () => {
    const res = await bulkPost(makeReq({ action: "accept", ids: "p1" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-string ids", async () => {
    const res = await bulkPost(makeReq({ action: "accept", ids: [1] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for charset-violating ids", async () => {
    const res = await bulkPost(makeReq({ action: "accept", ids: ["has space"] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for path-traversal ids", async () => {
    const res = await bulkPost(makeReq({ action: "accept", ids: ["../../admin"] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for ids containing a .. sequence", async () => {
    const res = await bulkPost(makeReq({ action: "accept", ids: ["foo..bar"] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for over-cap batches", async () => {
    const ids = Array.from({ length: 26 }, (_, i) => `proposal-${i}`);
    const res = await bulkPost(makeReq({ action: "accept", ids }));
    expect(res.status).toBe(400);
  });

  it("de-duplicates ids before the cap check", async () => {
    const ids = Array.from({ length: 26 }, () => "proposal-create-1");
    stubOwnedAndDecisions(["proposal-create-1"], [
      { status: 200, body: { status: "success", proposal: { id: "proposal-create-1" } } },
    ]);
    const res = await bulkPost(makeReq({ action: "accept", ids }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
  });

  it("returns 429 when rate-limited", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 12 });
    const res = await bulkPost(makeReq({ action: "accept", ids: ["p1"] }));
    expect(res.status).toBe(429);
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "user-123:ws-abc:proposals-bulk",
      10,
      60,
    );
  });

  it("drops ids absent from the workspace proposal set as not_found and never forwards them", async () => {
    const fetchSpy = stubOwnedAndDecisions(["proposal-create-1"], [
      { status: 200, body: { status: "success", proposal: { id: "proposal-create-1" } } },
    ]);
    const res = await bulkPost(
      makeReq({ action: "accept", ids: ["proposal-create-1", "other-ws-id"] }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([
      { id: "proposal-create-1", ok: true },
      {
        id: "other-ws-id",
        ok: false,
        code: "not_found",
        message: "No longer available",
      },
    ]);
    const forwarded = fetchSpy.mock.calls.filter(
      (call) => typeof call[0] === "string" && String(call[0]).includes("/accept"),
    );
    expect(forwarded).toHaveLength(1);
    expect(String(forwarded[0][0])).toContain("proposal-create-1");
    expect(String(forwarded[0][0])).not.toContain("other-ws-id");
  });

  it("returns the same not_found code for unknown and out-of-workspace ids", async () => {
    stubOwnedAndDecisions(["owned-1"], []);
    const res = await bulkPost(
      makeReq({ action: "accept", ids: ["unknown-id", "other-workspace-id"] }),
    );
    const body = await res.json();
    expect(body.results.map((r: { code: string }) => r.code)).toEqual([
      "not_found",
      "not_found",
    ]);
  });

  it("maps mixed upstream outcomes without failing the batch", async () => {
    stubOwnedAndDecisions(
      ["ok-1", "stale-1", "decided-1"],
      [
        { status: 200, body: { status: "success", proposal: { id: "ok-1" } } },
        {
          status: 409,
          body: { error: "docs drifted", code: "stale_base", conceptId: "c1" },
        },
        { status: 409, body: { error: "already accepted", status: "accepted" } },
      ],
    );
    const res = await bulkPost(
      makeReq({
        action: "accept",
        ids: ["ok-1", "stale-1", "decided-1", "missing-1"],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([
      { id: "ok-1", ok: true },
      {
        id: "stale-1",
        ok: false,
        code: "stale_base",
        message: "Needs re-review",
      },
      {
        id: "decided-1",
        ok: false,
        code: "already_decided",
        message: "Already decided",
      },
      {
        id: "missing-1",
        ok: false,
        code: "not_found",
        message: "No longer available",
      },
    ]);
  });

  it("collapses upstream 5xx and non-JSON bodies to upstream_error without leaking strings", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, { proposals: [{ id: "p1" }, { id: "p2" }] }),
    );
    fetchSpy.mockResolvedValueOnce({
      status: 502,
      ok: false,
      json: () => Promise.reject(new Error("HTML gateway")),
    } as unknown as Response);
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(500, { error: "stack trace at swarm.internal:3355" }),
    );

    const res = await bulkPost(makeReq({ action: "accept", ids: ["p1", "p2"] }));
    const body = await res.json();
    expect(body.results.every((r: { code: string }) => r.code === "upstream_error")).toBe(
      true,
    );
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("swarm.internal");
    expect(serialized).not.toContain("HTML gateway");
    expect(serialized).not.toContain("stack trace");
  });

  it("copies createdConceptId from a successful create accept", async () => {
    stubOwnedAndDecisions(["proposal-create-1"], [
      {
        status: 200,
        body: {
          status: "success",
          proposal: {
            id: "proposal-create-1",
            createdConceptId: "stakwork/hive/encryption-service",
          },
        },
      },
    ]);
    const res = await bulkPost(makeReq({ action: "accept", ids: ["proposal-create-1"] }));
    const body = await res.json();
    expect(body.results[0]).toEqual({
      id: "proposal-create-1",
      ok: true,
      createdConceptId: "stakwork/hive/encryption-service",
    });
  });

  it("discards extra body fields including decidedBy and force", async () => {
    const fetchSpy = stubOwnedAndDecisions(["p1"], [
      { status: 200, body: { status: "success", proposal: { id: "p1" } } },
    ]);
    await bulkPost(
      makeReq({
        action: "accept",
        ids: ["p1"],
        decidedBy: "attacker",
        force: true,
        reason: "client reason",
      }),
    );
    const decisionCall = fetchSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && String(call[0]).includes("/accept"),
    );
    const sent = JSON.parse((decisionCall?.[1] as RequestInit).body as string);
    expect(sent.decidedBy).toBe("user-123");
    expect(sent.force).toBeUndefined();
    expect(sent.reason).toBeUndefined();
  });

  it("sends a fixed server-side reason on bulk reject", async () => {
    const fetchSpy = stubOwnedAndDecisions(["p1"], [
      { status: 200, body: { status: "success", proposal: { id: "p1" } } },
    ]);
    await bulkPost(makeReq({ action: "reject", ids: ["p1"], reason: "client" }));
    const decisionCall = fetchSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && String(call[0]).includes("/reject"),
    );
    const sent = JSON.parse((decisionCall?.[1] as RequestInit).body as string);
    expect(sent.reason).toBe("Bulk rejected");
    expect(sent.decidedBy).toBe("user-123");
  });

  it("returns not_attempted for remaining ids once the soft deadline is reached", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, { proposals: [{ id: "p1" }, { id: "p2" }] }),
    );
    fetchSpy.mockImplementation(async (url) => {
      if (String(url).includes("/accept")) {
        now += 270_000;
        return jsonResponse(200, { status: "success", proposal: { id: "p1" } });
      }
      return jsonResponse(200, { proposals: [] });
    });

    const res = await bulkPost(makeReq({ action: "accept", ids: ["p1", "p2"] }));
    const body = await res.json();
    expect(body.results[0].ok).toBe(true);
    expect(body.results[1]).toMatchObject({
      id: "p2",
      ok: false,
      code: "not_attempted",
    });
    const acceptCalls = fetchSpy.mock.calls.filter(
      (call) => typeof call[0] === "string" && String(call[0]).includes("/accept"),
    );
    expect(acceptCalls).toHaveLength(1);
  });

  it("applies decisions sequentially in submitted order", async () => {
    const order: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(async (url) => {
      const href = String(url);
      if (href.endsWith("/gitree/proposals")) {
        return jsonResponse(200, {
          proposals: [{ id: "proposal-delete-1" }, { id: "proposal-merge-1" }],
        });
      }
      if (href.includes("proposal-delete-1")) {
        order.push("proposal-delete-1");
        return jsonResponse(200, {
          status: "success",
          proposal: { id: "proposal-delete-1" },
        });
      }
      if (href.includes("proposal-merge-1")) {
        order.push("proposal-merge-1");
        return jsonResponse(200, {
          status: "success",
          proposal: { id: "proposal-merge-1" },
        });
      }
      return jsonResponse(404, { error: "not found" });
    });

    const res = await bulkPost(
      makeReq({
        action: "accept",
        ids: ["proposal-delete-1", "proposal-merge-1"],
      }),
    );
    expect(res.status).toBe(200);
    expect(order).toEqual(["proposal-delete-1", "proposal-merge-1"]);
  });

  it("logs batch boundary literals only and one line per failed id", async () => {
    stubOwnedAndDecisions(["ok-1"], [
      { status: 200, body: { status: "success", proposal: { id: "ok-1" } } },
    ]);
    await bulkPost(makeReq({ action: "accept", ids: ["ok-1", "missing-1"] }));

    expect(logger.info).toHaveBeenCalledWith(
      "Proposal bulk decision completed",
      "proposals-bulk",
      expect.objectContaining({
        action: "accept",
        idCount: 2,
        successCount: 1,
        failureCount: 1,
        workspaceId: "ws-abc",
      }),
    );
    const infoMeta = vi.mocked(logger.info).mock.calls[0][2] as Record<string, unknown>;
    expect(JSON.stringify(infoMeta)).not.toContain("secret-key");
    expect(JSON.stringify(infoMeta)).not.toContain("swarm.example");

    expect(logger.error).toHaveBeenCalledWith(
      "Proposal bulk decision failed for id",
      "proposals-bulk",
      expect.objectContaining({
        id: "missing-1",
        action: "accept",
        code: "not_found",
      }),
    );
  });

  it("URL-encodes ids inside the helper", async () => {
    const fetchSpy = stubOwnedAndDecisions(["p.with.dots"], [
      { status: 200, body: { status: "success", proposal: { id: "p.with.dots" } } },
    ]);
    await bulkPost(makeReq({ action: "accept", ids: ["p.with.dots"] }));
    const decisionCall = fetchSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && String(call[0]).includes("/accept"),
    );
    expect(String(decisionCall?.[0])).toContain("p.with.dots");
  });
});
