/**
 * Unit tests for the legal benchmark recursion API routes.
 *
 * GET  /api/workspaces/[slug]/legal/benchmarks/recursion   — graph-backed list
 * POST /api/workspaces/[slug]/legal/benchmarks/recursion   — still 410 (deprecated)
 * PATCH /api/workspaces/[slug]/legal/benchmarks/recursion/[refId] — graph-backed toggle
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockGetMiddlewareContext = vi.hoisted(() => vi.fn(() => ({ userId: "user-1" })));
const mockRequireAuth = vi.hoisted(() => vi.fn(() => ({ id: "user-1" })));
const mockGetWorkspaceSwarmAccess = vi.hoisted(() => vi.fn());
const mockGetJarvisConfigForWorkspace = vi.hoisted(() => vi.fn());
const mockKgGetNode = vi.hoisted(() => vi.fn());
const mockListRecursionEvalSets = vi.hoisted(() => vi.fn());
const mockSetEvalSetRecursion = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockGetClientIp = vi.hoisted(() => vi.fn(() => "127.0.0.1"));

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: mockGetMiddlewareContext,
  requireAuth: mockRequireAuth,
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: mockGetWorkspaceSwarmAccess,
}));

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: mockGetJarvisConfigForWorkspace,
}));

vi.mock("@/lib/ai/kg-adapter", () => ({
  kgGetNode: mockKgGetNode,
}));

vi.mock("@/services/legal-benchmark-recursion", () => ({
  listRecursionEvalSets: mockListRecursionEvalSets,
  setEvalSetRecursion: mockSetEvalSetRecursion,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));

vi.mock("@/lib/utils/swarm", () => ({
  getJarvisUrl: (swarmName: string) => `https://${swarmName}.jarvis.example.com`,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  GET,
  POST,
} from "@/app/api/workspaces/[slug]/legal/benchmarks/recursion/route";
import { PATCH } from "@/app/api/workspaces/[slug]/legal/benchmarks/recursion/[refId]/route";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_SWARM_ACCESS = {
  success: true,
  data: {
    workspaceId: "ws-openlaw",
    swarmName: "openlaw-swarm",
    swarmApiKey: "swarm-key",
    swarmUrl: "https://swarm.example.com",
    swarmStatus: "ACTIVE",
  },
};

const MOCK_JARVIS_CONFIG = {
  jarvisUrl: "https://openlaw-swarm.jarvis.example.com",
  apiKey: "jarvis-key",
};

const MOCK_EVAL_SET_NODE = {
  ref_id: "ref-evalset-1",
  node_type: "EvalSet",
  name: "Draft a contract",
  properties: { id: "practice-area/draft-contract", name: "Draft a contract" },
};

const MOCK_RECURSION_LIST = [
  { ref_id: "ref-evalset-1", id: "practice-area/draft-contract", name: "Draft a contract" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGetRequest(slug = "openlaw") {
  return new NextRequest(
    `http://localhost/api/workspaces/${slug}/legal/benchmarks/recursion`,
    { method: "GET" },
  );
}

function makePostRequest(slug = "openlaw") {
  return new NextRequest(
    `http://localhost/api/workspaces/${slug}/legal/benchmarks/recursion`,
    { method: "POST" },
  );
}

function makePatchRequest(refId = "ref-evalset-1", body?: unknown, slug = "openlaw") {
  return new NextRequest(
    `http://localhost/api/workspaces/${slug}/legal/benchmarks/recursion/${refId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
  );
}

function makeParams(slug = "openlaw") {
  return { params: Promise.resolve({ slug }) };
}

function makePatchParams(slug = "openlaw", refId = "ref-evalset-1") {
  return { params: Promise.resolve({ slug, refId }) };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/workspaces/[slug]/legal/benchmarks/recursion
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/legal/benchmarks/recursion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorkspaceSwarmAccess.mockResolvedValue(MOCK_SWARM_ACCESS);
    mockListRecursionEvalSets.mockResolvedValue({ ok: true, nodes: MOCK_RECURSION_LIST });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
  });

  test("returns 401 for unauthenticated request", async () => {
    mockRequireAuth.mockReturnValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await GET(makeGetRequest(), makeParams());
    expect(res.status).toBe(401);
  });

  test("returns 404 for non-openlaw slug", async () => {
    const res = await GET(makeGetRequest("other-workspace"), makeParams("other-workspace"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  test("returns 404 for any non-openlaw slug (stakwork)", async () => {
    const res = await GET(makeGetRequest("stakwork"), makeParams("stakwork"));
    expect(res.status).toBe(404);
  });

  test("returns 200 with list of EvalSets on success", async () => {
    const res = await GET(makeGetRequest(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(MOCK_RECURSION_LIST);
  });

  test("returns 200 with empty array when no EvalSets have recursion=true", async () => {
    mockListRecursionEvalSets.mockResolvedValue({ ok: true, nodes: [] });

    const res = await GET(makeGetRequest(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  test("returns 502 when graph query fails", async () => {
    mockListRecursionEvalSets.mockResolvedValue({ ok: false, error: "Jarvis unreachable" });

    const res = await GET(makeGetRequest(), makeParams());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/recursion eval sets/i);
  });

  test("returns swarm access error when swarm not configured", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "SWARM_NOT_CONFIGURED" },
    });

    const res = await GET(makeGetRequest(), makeParams());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Swarm not configured");
  });

  test("returns 403 when access denied", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "ACCESS_DENIED" },
    });

    const res = await GET(makeGetRequest(), makeParams());
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/workspaces/[slug]/legal/benchmarks/recursion — still 410
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/legal/benchmarks/recursion", () => {
  test("POST returns 410 (feature deprecated)", async () => {
    const res = await POST(makePostRequest());
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("Feature deprecated");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/workspaces/[slug]/legal/benchmarks/recursion/[refId]
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/workspaces/[slug]/legal/benchmarks/recursion/[refId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorkspaceSwarmAccess.mockResolvedValue(MOCK_SWARM_ACCESS);
    mockGetJarvisConfigForWorkspace.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockKgGetNode.mockResolvedValue(MOCK_EVAL_SET_NODE);
    mockSetEvalSetRecursion.mockResolvedValue({ ok: true });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
  });

  test("returns 401 for unauthenticated request", async () => {
    mockRequireAuth.mockReturnValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await PATCH(makePatchRequest(), makePatchParams());
    expect(res.status).toBe(401);
  });

  test("returns 404 for non-openlaw slug", async () => {
    const res = await PATCH(
      makePatchRequest("ref-1", { enabled: true }, "other-workspace"),
      makePatchParams("other-workspace"),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  test("returns 400 when enabled is missing from body", async () => {
    const res = await PATCH(
      makePatchRequest("ref-1", {}),
      makePatchParams(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/boolean/i);
  });

  test("returns 400 when enabled is a string (not boolean)", async () => {
    const res = await PATCH(
      makePatchRequest("ref-1", { enabled: "true" }),
      makePatchParams(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/boolean/i);
  });

  test("returns 400 when enabled is a number", async () => {
    const res = await PATCH(
      makePatchRequest("ref-1", { enabled: 1 }),
      makePatchParams(),
    );
    expect(res.status).toBe(400);
  });

  test("returns 429 when rate limit exceeded", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 42 });

    const res = await PATCH(
      makePatchRequest("ref-1", { enabled: true }),
      makePatchParams(),
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.retryAfter).toBe(42);
  });

  test("returns 404 when kgGetNode returns null (node not found)", async () => {
    mockKgGetNode.mockResolvedValue(null);

    const res = await PATCH(
      makePatchRequest("ref-missing", { enabled: true }),
      makePatchParams("openlaw", "ref-missing"),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  test("returns 404 when node exists but is not an EvalSet (IDOR guard)", async () => {
    mockKgGetNode.mockResolvedValue({
      ref_id: "ref-other",
      node_type: "ProposedFix",
      name: "some other node",
    });

    const res = await PATCH(
      makePatchRequest("ref-other", { enabled: true }),
      makePatchParams("openlaw", "ref-other"),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  test("returns 200 with success: true on enable", async () => {
    const res = await PATCH(
      makePatchRequest("ref-evalset-1", { enabled: true }),
      makePatchParams(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.enabled).toBe(true);
  });

  test("returns 200 with success: true on disable", async () => {
    const res = await PATCH(
      makePatchRequest("ref-evalset-1", { enabled: false }),
      makePatchParams(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.enabled).toBe(false);
  });

  test("calls setEvalSetRecursion with correct refId and enabled=true", async () => {
    await PATCH(
      makePatchRequest("ref-evalset-1", { enabled: true }),
      makePatchParams(),
    );
    expect(mockSetEvalSetRecursion).toHaveBeenCalledWith(
      MOCK_JARVIS_CONFIG,
      "ref-evalset-1",
      true,
    );
  });

  test("calls setEvalSetRecursion with correct refId and enabled=false", async () => {
    await PATCH(
      makePatchRequest("ref-evalset-1", { enabled: false }),
      makePatchParams(),
    );
    expect(mockSetEvalSetRecursion).toHaveBeenCalledWith(
      MOCK_JARVIS_CONFIG,
      "ref-evalset-1",
      false,
    );
  });

  test("returns 502 when graph write fails", async () => {
    mockSetEvalSetRecursion.mockResolvedValue({ ok: false, error: "Graph write failed" });

    const res = await PATCH(
      makePatchRequest("ref-evalset-1", { enabled: true }),
      makePatchParams(),
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test("returns 400 when jarvis config is missing", async () => {
    mockGetJarvisConfigForWorkspace.mockResolvedValue(null);

    const res = await PATCH(
      makePatchRequest("ref-evalset-1", { enabled: true }),
      makePatchParams(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not configured/i);
  });

  test("returns swarm access error when swarm not active", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "SWARM_NOT_ACTIVE" },
    });

    const res = await PATCH(
      makePatchRequest("ref-evalset-1", { enabled: true }),
      makePatchParams(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Swarm not active");
  });

  test("uses workspaceId from swarm access (not raw param) for jarvis config", async () => {
    await PATCH(
      makePatchRequest("ref-evalset-1", { enabled: true }),
      makePatchParams(),
    );

    // workspaceId must come from swarmResult.data, not a raw request param
    expect(mockGetJarvisConfigForWorkspace).toHaveBeenCalledWith("ws-openlaw");
  });
});
