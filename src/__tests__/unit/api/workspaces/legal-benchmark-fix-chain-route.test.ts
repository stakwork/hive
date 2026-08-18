/**
 * Unit tests for the fix-chain route.
 *
 * GET /api/workspaces/[slug]/legal/benchmarks/fix-chain?evalSetRefId=...
 *
 * Covers:
 * - 401 when unauthenticated
 * - 404 for non-openlaw workspace slug
 * - 400 when evalSetRefId is missing
 * - 403/404 when evalSetRefId doesn't belong to this workspace (IDOR)
 * - 429 when rate limit exceeded
 * - 200 with correct { nodes, edges, partial } shape on success
 * - Auth sequence order: auth → workspace access → IDOR → rate limit → walkFixChain
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockGetMiddlewareContext = vi.hoisted(() => vi.fn(() => ({ userId: "user-1" })));
const mockRequireAuth = vi.hoisted(() => vi.fn(() => ({ id: "user-1" })));
const mockGetWorkspaceSwarmAccess = vi.hoisted(() => vi.fn());
const mockKgGetNode = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockGetClientIp = vi.hoisted(() => vi.fn(() => "127.0.0.1"));
const mockWalkFixChain = vi.hoisted(() => vi.fn());

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: mockGetMiddlewareContext,
  requireAuth: mockRequireAuth,
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: mockGetWorkspaceSwarmAccess,
}));

vi.mock("@/lib/ai/kg-adapter", () => ({
  kgGetNode: mockKgGetNode,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));

vi.mock("@/lib/harvey-lab/fix-chain-walker", () => ({
  walkFixChain: mockWalkFixChain,
}));

vi.mock("@/services/legal-benchmark-recursion", () => ({
  isEvalSetLabel: (label: string | null | undefined) =>
    (label ?? "").toLowerCase() === "evalset",
  EVALSET_NODE_LABELS: ["EvalSet", "Evalset"],
}));

vi.mock("@/lib/utils/swarm", () => ({
  getJarvisUrl: (swarmName: string) => `https://${swarmName}.jarvis.example.com`,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { GET } from "@/app/api/workspaces/[slug]/legal/benchmarks/fix-chain/route";
import {
  CONCEPT_ONLY_EVALSET_ID,
  CONCEPT_ONLY_REQ_TRIGGER_ID,
  EVAL_SET_ID,
} from "@/app/api/mock/jarvis/graph/recursion-fixture";

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
} as const;

const MOCK_EVAL_SET_NODE = {
  ref_id: "ref-evalset-1",
  node_type: "EvalSet",
  name: "Draft a contract",
  properties: { id: "practice-area/draft-contract", name: "Draft a contract" },
};

const MOCK_FIX_CHAIN_RESULT = {
  nodes: [
    { ref_id: "trigger-1", node_type: "EvalTrigger", date_added_to_graph: "1720000000", properties: {} },
    { ref_id: "output-1", node_type: "EvalTriggerOutput", date_added_to_graph: "1720000001", properties: { n_passed: 5, n_total: 10 } },
  ],
  edges: [
    { source: "trigger-1", target: "output-1", edge_type: "HAS_OUTPUT", ref_id: "edge-1" },
  ],
  partial: false,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGetRequest(slug = "openlaw", evalSetRefId?: string) {
  const url = evalSetRefId
    ? `http://localhost/api/workspaces/${slug}/legal/benchmarks/fix-chain?evalSetRefId=${encodeURIComponent(evalSetRefId)}`
    : `http://localhost/api/workspaces/${slug}/legal/benchmarks/fix-chain`;
  return new NextRequest(url, { method: "GET" });
}

function makeParams(slug = "openlaw") {
  return { params: Promise.resolve({ slug }) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/legal/benchmarks/fix-chain", () => {
  const originalUseMocks = process.env.USE_MOCKS;

  beforeEach(() => {
    // Ensure USE_MOCKS is off so the real walkFixChain path is exercised
    // (the mock walkFixChain fn is set up below instead)
    process.env.USE_MOCKS = "false";
    // Clear all spy call counts between tests
    vi.clearAllMocks();
    mockGetMiddlewareContext.mockReturnValue({ userId: "user-1" });
    mockRequireAuth.mockReturnValue({ id: "user-1" });
    mockGetWorkspaceSwarmAccess.mockResolvedValue(MOCK_SWARM_ACCESS);
    mockKgGetNode.mockResolvedValue(MOCK_EVAL_SET_NODE);
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockWalkFixChain.mockResolvedValue(MOCK_FIX_CHAIN_RESULT);
  });

  afterEach(() => {
    process.env.USE_MOCKS = originalUseMocks;
  });

  // ── Auth ────────────────────────────────────────────────────────────────────

  test("returns 401 when unauthenticated", async () => {
    mockRequireAuth.mockReturnValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await GET(makeGetRequest(), makeParams());
    expect(res.status).toBe(401);
    // Should stop before workspace/IDOR checks
    expect(mockGetWorkspaceSwarmAccess).not.toHaveBeenCalled();
    expect(mockKgGetNode).not.toHaveBeenCalled();
    expect(mockWalkFixChain).not.toHaveBeenCalled();
  });

  // ── Workspace gate ──────────────────────────────────────────────────────────

  test("returns 404 for non-openlaw slug", async () => {
    const res = await GET(
      makeGetRequest("stakwork", "some-ref"),
      makeParams("stakwork"),
    );
    expect(res.status).toBe(404);
    expect(mockGetWorkspaceSwarmAccess).not.toHaveBeenCalled();
  });

  test("returns 404 for any non-openlaw slug (not just stakwork)", async () => {
    const res = await GET(
      makeGetRequest("my-workspace", "some-ref"),
      makeParams("my-workspace"),
    );
    expect(res.status).toBe(404);
  });

  // ── Query param validation ──────────────────────────────────────────────────

  test("returns 400 when evalSetRefId is missing", async () => {
    const res = await GET(makeGetRequest("openlaw"), makeParams());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("evalSetRefId");
    // Should not proceed to workspace check
    expect(mockGetWorkspaceSwarmAccess).not.toHaveBeenCalled();
  });

  test("returns 400 when evalSetRefId is empty string", async () => {
    const res = await GET(makeGetRequest("openlaw", ""), makeParams());
    expect(res.status).toBe(400);
  });

  // ── Workspace swarm access ──────────────────────────────────────────────────

  test("returns 404 when workspace not found", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "WORKSPACE_NOT_FOUND" },
    });
    const res = await GET(makeGetRequest("openlaw", "ref-1"), makeParams());
    expect(res.status).toBe(404);
    // Should not proceed to IDOR check
    expect(mockKgGetNode).not.toHaveBeenCalled();
  });

  test("returns 403 when access denied", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "ACCESS_DENIED" },
    });
    const res = await GET(makeGetRequest("openlaw", "ref-1"), makeParams());
    expect(res.status).toBe(403);
    expect(mockKgGetNode).not.toHaveBeenCalled();
  });

  // ── IDOR guard ──────────────────────────────────────────────────────────────

  test("returns 404 when evalSetRefId node is not found (IDOR)", async () => {
    mockKgGetNode.mockResolvedValue(null);
    const res = await GET(makeGetRequest("openlaw", "foreign-ref"), makeParams());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("EvalSet not found");
    // Rate limit should NOT have been checked yet
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockWalkFixChain).not.toHaveBeenCalled();
  });

  test("returns 404 when node exists but is not an EvalSet (IDOR — wrong type)", async () => {
    mockKgGetNode.mockResolvedValue({
      ref_id: "foreign-ref",
      node_type: "Task",
      name: "Some task",
      properties: {},
    });
    const res = await GET(makeGetRequest("openlaw", "foreign-ref"), makeParams());
    expect(res.status).toBe(404);
    expect(mockWalkFixChain).not.toHaveBeenCalled();
  });

  test("accepts EvalSet node with casing variant 'Evalset' (case-insensitive IDOR check)", async () => {
    mockKgGetNode.mockResolvedValue({
      ref_id: "ref-evalset-1",
      node_type: "Evalset", // lowercase s — common Jarvis casing defect
      name: "Draft a contract",
      properties: {},
    });
    const res = await GET(makeGetRequest("openlaw", "ref-evalset-1"), makeParams());
    // Should pass IDOR check and proceed to rate limit + walkFixChain
    expect(res.status).toBe(200);
  });

  // ── Rate limit ──────────────────────────────────────────────────────────────

  test("returns 429 when rate limit exceeded", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 42 });
    const res = await GET(makeGetRequest("openlaw", "ref-evalset-1"), makeParams());
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.retryAfter).toBe(42);
    expect(mockWalkFixChain).not.toHaveBeenCalled();
  });

  test("rate limit is checked AFTER IDOR guard, not before", async () => {
    // Node not found → IDOR 404 should fire before rate-limit check
    mockKgGetNode.mockResolvedValue(null);
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 10 });

    const res = await GET(makeGetRequest("openlaw", "missing-ref"), makeParams());
    // Should be 404 (IDOR), not 429 (rate limit)
    expect(res.status).toBe(404);
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  // ── Success path ─────────────────────────────────────────────────────────────

  test("returns 200 with correct { nodes, edges, partial } shape on success", async () => {
    const res = await GET(makeGetRequest("openlaw", "ref-evalset-1"), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      nodes: expect.any(Array),
      edges: expect.any(Array),
      partial: false,
    });
    expect(body.data.nodes).toHaveLength(2);
    expect(body.data.edges).toHaveLength(1);
  });

  test("calls walkFixChain with both trigger edge types and requirement-hosted triggers", async () => {
    // Concept-driven recursion writes a fresh EvalTrigger (HAS_TRIGGER) instead
    // of a ProposedFix, and hive's own run route hangs its trigger off the
    // EvalRequirement — a baseline-only first hop loads neither.
    await GET(makeGetRequest("openlaw", "ref-evalset-1"), makeParams());
    expect(mockWalkFixChain).toHaveBeenCalledWith(
      expect.stringContaining("openlaw-swarm"),
      "swarm-key",
      "ref-evalset-1",
      {
        triggerEdgeTypes: ["HAS_BASELINE_TRIGGER", "HAS_TRIGGER"],
        includeRequirementTriggers: true,
      },
    );
  });

  test("includes partial:true in response when walkFixChain returns partial", async () => {
    mockWalkFixChain.mockResolvedValue({
      ...MOCK_FIX_CHAIN_RESULT,
      partial: true,
      failedBranches: ["branch-ref-1"],
    });
    const res = await GET(makeGetRequest("openlaw", "ref-evalset-1"), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.partial).toBe(true);
    expect(body.data.failedBranches).toContain("branch-ref-1");
  });

  test("does not include failedBranches in response when empty", async () => {
    mockWalkFixChain.mockResolvedValue({ ...MOCK_FIX_CHAIN_RESULT, partial: false });
    const res = await GET(makeGetRequest("openlaw", "ref-evalset-1"), makeParams());
    const body = await res.json();
    expect(body.data.failedBranches).toBeUndefined();
  });

  // ── Auth sequence order ────────────────────────────────────────────────────

  test("enforces auth → workspace access → IDOR check → rate limit order", async () => {
    const callOrder: string[] = [];
    mockRequireAuth.mockImplementation(() => {
      callOrder.push("requireAuth");
      return { id: "user-1" };
    });
    mockGetWorkspaceSwarmAccess.mockImplementation(async () => {
      callOrder.push("getWorkspaceSwarmAccess");
      return MOCK_SWARM_ACCESS;
    });
    mockKgGetNode.mockImplementation(async () => {
      callOrder.push("kgGetNode");
      return MOCK_EVAL_SET_NODE;
    });
    mockCheckRateLimit.mockImplementation(async () => {
      callOrder.push("checkRateLimit");
      return { allowed: true };
    });
    mockWalkFixChain.mockImplementation(async () => {
      callOrder.push("walkFixChain");
      return MOCK_FIX_CHAIN_RESULT;
    });

    await GET(makeGetRequest("openlaw", "ref-evalset-1"), makeParams());

    expect(callOrder).toEqual([
      "requireAuth",
      "getWorkspaceSwarmAccess",
      "kgGetNode",
      "checkRateLimit",
      "walkFixChain",
    ]);
  });
});

// ── USE_MOCKS scenario switch ─────────────────────────────────────────────────

describe("GET fix-chain — USE_MOCKS scenario switch", () => {
  const originalUseMocks = process.env.USE_MOCKS;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.USE_MOCKS = "true";
    mockGetMiddlewareContext.mockReturnValue({ userId: "user-1" });
    mockRequireAuth.mockReturnValue({ id: "user-1" });
    mockGetWorkspaceSwarmAccess.mockResolvedValue(MOCK_SWARM_ACCESS);
    mockKgGetNode.mockResolvedValue(MOCK_EVAL_SET_NODE);
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockWalkFixChain.mockResolvedValue(MOCK_FIX_CHAIN_RESULT);
  });

  afterEach(() => {
    process.env.USE_MOCKS = originalUseMocks;
  });

  test("returns the concept-only fixture for CONCEPT_ONLY_EVALSET_ID", async () => {
    const res = await GET(
      makeGetRequest("openlaw", CONCEPT_ONLY_EVALSET_ID),
      makeParams(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    const refIds = body.data.nodes.map((n: { ref_id: string }) => n.ref_id);
    expect(refIds).toContain(CONCEPT_ONLY_EVALSET_ID);
    expect(refIds).toContain(CONCEPT_ONLY_REQ_TRIGGER_ID);
    // Concept-driven recursion writes no ProposedFix at all
    expect(
      body.data.nodes.some(
        (n: { node_type?: string }) => (n.node_type ?? "").toLowerCase() === "proposedfix",
      ),
    ).toBe(false);
    expect(mockWalkFixChain).not.toHaveBeenCalled();
  });

  test("returns the default fixture for every unrecognised ref_id", async () => {
    const res = await GET(makeGetRequest("openlaw", "ref-evalset-1"), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();

    const refIds = body.data.nodes.map((n: { ref_id: string }) => n.ref_id);
    expect(refIds).toContain(EVAL_SET_ID);
    expect(refIds).not.toContain(CONCEPT_ONLY_EVALSET_ID);
    expect(mockWalkFixChain).not.toHaveBeenCalled();
  });

  test("still enforces auth, the openlaw gate, IDOR and the rate limit before the fixture", async () => {
    mockRequireAuth.mockReturnValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as unknown as { id: string },
    );
    const unauth = await GET(
      makeGetRequest("openlaw", CONCEPT_ONLY_EVALSET_ID),
      makeParams(),
    );
    expect(unauth.status).toBe(401);

    mockRequireAuth.mockReturnValue({ id: "user-1" });
    mockKgGetNode.mockResolvedValue(null);
    const idor = await GET(
      makeGetRequest("openlaw", CONCEPT_ONLY_EVALSET_ID),
      makeParams(),
    );
    expect(idor.status).toBe(404);

    mockKgGetNode.mockResolvedValue(MOCK_EVAL_SET_NODE);
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });
    const limited = await GET(
      makeGetRequest("openlaw", CONCEPT_ONLY_EVALSET_ID),
      makeParams(),
    );
    expect(limited.status).toBe(429);
  });
});
