/**
 * Unit tests for GET /api/workspaces/[slug]/legal/benchmarks/proposed-fixes
 *
 * Test cases:
 *  1. Non-openlaw slug → 404
 *  2. getWorkspaceSwarmAccess WORKSPACE_NOT_FOUND → 404
 *  3. getWorkspaceSwarmAccess ACCESS_DENIED → 403
 *  4. getWorkspaceSwarmAccess SWARM_NOT_CONFIGURED → 400
 *  5. getWorkspaceSwarmAccess SWARM_NOT_ACTIVE → 400
 *  6. getWorkspaceSwarmAccess SWARM_API_KEY_MISSING → 400
 *  7. getWorkspaceSwarmAccess SWARM_NAME_MISSING → 400
 *  8. Missing runId query param → 400
 *  9. runId belonging to another workspace (IDOR) → 404, no graph call
 * 10. Unknown runId → 404, no graph call
 * 11. LEGAL_BENCHMARK_SCORER runId resolves taskSlug via sibling runner
 * 12. Unresolvable taskSlug (scorer with no sibling) → { fixes: [] }, no graph call
 * 13. Unresolvable taskSlug (runner with empty taskSlug, no sibling) → { fixes: [] }
 * 14. searchNodesByAttributes called with includeProperties: true
 * 15. Projection whitelisting — extra node properties not leaked
 * 16. Graph search failure → { fixes: [] }
 * 17. Nodes sorted: rerun_run_id present surfaces first
 * 18. USE_MOCKS path: reachable in non-production when USE_MOCKS=true
 * 19. USE_MOCKS path: NOT reachable in production even when USE_MOCKS=true
 * 20. USE_MOCKS still behind slug check
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Stable mock references (hoisted) ────────────────────────────────────────

const mockDbStakworkRunFindFirst = vi.hoisted(() => vi.fn());
const mockGetWorkspaceSwarmAccess = vi.hoisted(() => vi.fn());
const mockGetJarvisConfigForWorkspace = vi.hoisted(() => vi.fn());
const mockSearchNodesByAttributes = vi.hoisted(() => vi.fn());

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    stakworkRun: {
      findFirst: mockDbStakworkRunFindFirst,
    },
  },
}));

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({ userId: "user-1" })),
  requireAuth: vi.fn(() => ({ id: "user-1" })),
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: mockGetWorkspaceSwarmAccess,
}));

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: mockGetJarvisConfigForWorkspace,
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  searchNodesByAttributes: mockSearchNodesByAttributes,
  addNode: vi.fn(),
  addEdge: vi.fn(),
}));

// ─── Import subject under test ────────────────────────────────────────────────

import { GET } from "@/app/api/workspaces/[slug]/legal/benchmarks/proposed-fixes/route";
import { StakworkRunType } from "@prisma/client";

// ─── Shared fixture data ──────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-openlaw";
const RUNNER_RUN_ID = "runner-run-1";
const SCORER_RUN_ID = "scorer-run-1";

const MOCK_SWARM_ACCESS = {
  success: true,
  data: {
    workspaceId: WORKSPACE_ID,
    swarmName: "openlaw-swarm",
    swarmUrl: "https://swarm.example.com",
    swarmApiKey: "decrypted-key",
    swarmStatus: "ACTIVE",
    poolName: "pool",
    swarmSecretAlias: "openlaw-alias",
  },
};

const MOCK_JARVIS_CONFIG = {
  jarvisUrl: "https://jarvis.example.com",
  apiKey: "jarvis-key",
};

const TASK_SLUG = "contracts/ndas/draft-nda";

function makeRunnerRun(taskSlug = TASK_SLUG, siblingRunId?: string) {
  return {
    id: RUNNER_RUN_ID,
    workspaceId: WORKSPACE_ID,
    type: StakworkRunType.LEGAL_BENCHMARK_RUNNER,
    result: JSON.stringify({ taskSlug, taskTitle: "Draft NDA", ...(siblingRunId ? { siblingRunId } : {}) }),
  };
}

function makeScorerRun(siblingRunId?: string) {
  return {
    id: SCORER_RUN_ID,
    workspaceId: WORKSPACE_ID,
    type: StakworkRunType.LEGAL_BENCHMARK_SCORER,
    result: siblingRunId ? JSON.stringify({ siblingRunId }) : null,
  };
}

function makeProposedFixNode(overrides: Record<string, unknown> = {}) {
  return {
    ref_id: "fix-node-1",
    node_type: "ProposedFix",
    properties: {
      criterion_id: "crit-1",
      criterion_title: "Citation Accuracy",
      prompt_name: "citation_verifier",
      prompt_id: "p-1",
      prompt_version_id: "v1.0",
      new_prompt_version_id: "v1.1",
      failing_value: "bad value",
      passing_value: "good value",
      delta: "Added citation format",
      reasoning: "Needed full citation",
      status: "pending",
      rerun_status: "improved",
      before_score: "50",
      after_score: "54",
      score_delta: "+4",
      rerun_run_id: "rerun-1",
      extra_secret_field: "should-not-be-returned",
      ...overrides,
    },
  };
}

function makeRequest(slug: string, runId?: string) {
  const url = runId
    ? `http://localhost/api/workspaces/${slug}/legal/benchmarks/proposed-fixes?runId=${runId}`
    : `http://localhost/api/workspaces/${slug}/legal/benchmarks/proposed-fixes`;
  return new NextRequest(url, { method: "GET" });
}

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default happy-path mocks
  mockGetWorkspaceSwarmAccess.mockResolvedValue(MOCK_SWARM_ACCESS);
  mockDbStakworkRunFindFirst.mockResolvedValue(makeRunnerRun());
  mockGetJarvisConfigForWorkspace.mockResolvedValue(MOCK_JARVIS_CONFIG);
  mockSearchNodesByAttributes.mockResolvedValue({
    ok: true,
    nodes: [makeProposedFixNode()],
  });

  // Ensure USE_MOCKS is off by default
  delete process.env.USE_MOCKS;
});

afterEach(() => {
  delete process.env.USE_MOCKS;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/legal/benchmarks/proposed-fixes", () => {
  // ── 1. Openlaw gate ──────────────────────────────────────────────────────

  test("1. Non-openlaw slug → 404", async () => {
    const req = makeRequest("other-workspace", RUNNER_RUN_ID);
    const res = await GET(req, makeParams("other-workspace"));
    expect(res.status).toBe(404);
    expect(mockGetWorkspaceSwarmAccess).not.toHaveBeenCalled();
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();
  });

  // ── SwarmAccessError branches ─────────────────────────────────────────────

  test("2. WORKSPACE_NOT_FOUND → 404", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "WORKSPACE_NOT_FOUND" },
    });
    const res = await GET(makeRequest("openlaw", RUNNER_RUN_ID), makeParams("openlaw"));
    expect(res.status).toBe(404);
  });

  test("3. ACCESS_DENIED → 403", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "ACCESS_DENIED" },
    });
    const res = await GET(makeRequest("openlaw", RUNNER_RUN_ID), makeParams("openlaw"));
    expect(res.status).toBe(403);
  });

  test("4. SWARM_NOT_CONFIGURED → 400", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "SWARM_NOT_CONFIGURED" },
    });
    const res = await GET(makeRequest("openlaw", RUNNER_RUN_ID), makeParams("openlaw"));
    expect(res.status).toBe(400);
  });

  test("5. SWARM_NOT_ACTIVE → 400", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "SWARM_NOT_ACTIVE", status: "STOPPED" },
    });
    const res = await GET(makeRequest("openlaw", RUNNER_RUN_ID), makeParams("openlaw"));
    expect(res.status).toBe(400);
  });

  test("6. SWARM_API_KEY_MISSING → 400", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "SWARM_API_KEY_MISSING" },
    });
    const res = await GET(makeRequest("openlaw", RUNNER_RUN_ID), makeParams("openlaw"));
    expect(res.status).toBe(400);
  });

  test("7. SWARM_NAME_MISSING → 400", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "SWARM_NAME_MISSING" },
    });
    const res = await GET(makeRequest("openlaw", RUNNER_RUN_ID), makeParams("openlaw"));
    expect(res.status).toBe(400);
  });

  // ── Missing runId ─────────────────────────────────────────────────────────

  test("8. Missing runId query param → 400", async () => {
    const res = await GET(makeRequest("openlaw"), makeParams("openlaw"));
    expect(res.status).toBe(400);
    expect(mockDbStakworkRunFindFirst).not.toHaveBeenCalled();
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();
  });

  // ── IDOR guard ────────────────────────────────────────────────────────────

  test("9. runId belonging to another workspace → 404, no graph call", async () => {
    // db returns null (run not in this workspace)
    mockDbStakworkRunFindFirst.mockResolvedValue(null);
    const res = await GET(makeRequest("openlaw", "foreign-run"), makeParams("openlaw"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Run not found");
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();
    expect(mockGetJarvisConfigForWorkspace).not.toHaveBeenCalled();
  });

  test("10. Unknown runId → 404, no graph call", async () => {
    mockDbStakworkRunFindFirst.mockResolvedValue(null);
    const res = await GET(makeRequest("openlaw", "nonexistent-run"), makeParams("openlaw"));
    expect(res.status).toBe(404);
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();
  });

  // ── SCORER → RUNNER taskSlug resolution ──────────────────────────────────

  test("11. SCORER runId resolves taskSlug via sibling runner", async () => {
    const scorerRun = makeScorerRun(RUNNER_RUN_ID);
    const runnerRun = makeRunnerRun(TASK_SLUG);

    // First call: resolve SCORER run; second call: resolve sibling RUNNER
    mockDbStakworkRunFindFirst
      .mockResolvedValueOnce(scorerRun)
      .mockResolvedValueOnce(runnerRun);

    const res = await GET(makeRequest("openlaw", SCORER_RUN_ID), makeParams("openlaw"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.fixes).toHaveLength(1);

    // Confirm graph was queried with the correct task_slug from the runner
    expect(mockSearchNodesByAttributes).toHaveBeenCalledWith(
      MOCK_JARVIS_CONFIG,
      expect.objectContaining({
        filters: [{ attribute: "task_slug", value: TASK_SLUG, comparator: "=" }],
        includeProperties: true,
      }),
    );
  });

  // ── Fail-closed on missing taskSlug ──────────────────────────────────────

  test("12. Scorer with no siblingRunId → { fixes: [] }, no graph call", async () => {
    mockDbStakworkRunFindFirst.mockResolvedValue(makeScorerRun()); // no siblingRunId
    const res = await GET(makeRequest("openlaw", SCORER_RUN_ID), makeParams("openlaw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fixes).toEqual([]);
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();
  });

  test("13. Runner with empty taskSlug and no sibling → { fixes: [] }, no graph call", async () => {
    mockDbStakworkRunFindFirst.mockResolvedValue(makeRunnerRun(""));
    const res = await GET(makeRequest("openlaw", RUNNER_RUN_ID), makeParams("openlaw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fixes).toEqual([]);
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();
  });

  // ── includeProperties: true ───────────────────────────────────────────────

  test("14. searchNodesByAttributes called with includeProperties: true", async () => {
    const res = await GET(makeRequest("openlaw", RUNNER_RUN_ID), makeParams("openlaw"));
    expect(res.status).toBe(200);
    expect(mockSearchNodesByAttributes).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ includeProperties: true }),
    );
  });

  // ── Projection whitelisting ───────────────────────────────────────────────

  test("15. Extra node properties are stripped — only 17 whitelisted keys returned", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: true,
      nodes: [makeProposedFixNode({ extra_secret_field: "leak-me", another_extra: 42 })],
    });
    const res = await GET(makeRequest("openlaw", RUNNER_RUN_ID), makeParams("openlaw"));
    const body = await res.json();
    const fix = body.fixes[0];

    const ALLOWED_KEYS = new Set([
      "ref_id",
      "criterion_id",
      "criterion_title",
      "prompt_name",
      "prompt_id",
      "prompt_version_id",
      "new_prompt_version_id",
      "failing_value",
      "passing_value",
      "delta",
      "reasoning",
      "status",
      "rerun_status",
      "before_score",
      "after_score",
      "score_delta",
      "rerun_run_id",
    ]);

    for (const key of Object.keys(fix)) {
      expect(ALLOWED_KEYS.has(key)).toBe(true);
    }
    expect(fix.extra_secret_field).toBeUndefined();
    expect(fix.another_extra).toBeUndefined();
  });

  // ── Missing node properties are tolerated ────────────────────────────────

  test("15b. Missing node properties returned as null (no throw)", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: true,
      nodes: [{ ref_id: "fix-node-sparse", node_type: "ProposedFix", properties: {} }],
    });
    const res = await GET(makeRequest("openlaw", RUNNER_RUN_ID), makeParams("openlaw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fixes).toHaveLength(1);
    expect(body.fixes[0].ref_id).toBe("fix-node-sparse");
    expect(body.fixes[0].criterion_id).toBeNull();
    expect(body.fixes[0].rerun_run_id).toBeNull();
  });

  // ── Graph search failure ──────────────────────────────────────────────────

  test("16. Graph search returns ok:false → { fixes: [] }", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: false, nodes: [], error: "timeout" });
    const res = await GET(makeRequest("openlaw", RUNNER_RUN_ID), makeParams("openlaw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fixes).toEqual([]);
  });

  // ── Sorting ───────────────────────────────────────────────────────────────

  test("17. Nodes with rerun_run_id surface before those without", async () => {
    const nodeWithoutRerun = {
      ref_id: "no-rerun",
      node_type: "ProposedFix",
      properties: { criterion_id: "c1", rerun_run_id: null },
    };
    const nodeWithRerun = {
      ref_id: "with-rerun",
      node_type: "ProposedFix",
      properties: { criterion_id: "c2", rerun_run_id: "rerun-123" },
    };
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: true,
      nodes: [nodeWithoutRerun, nodeWithRerun], // intentionally wrong order
    });

    const res = await GET(makeRequest("openlaw", RUNNER_RUN_ID), makeParams("openlaw"));
    const body = await res.json();
    expect(body.fixes[0].ref_id).toBe("with-rerun");
    expect(body.fixes[1].ref_id).toBe("no-rerun");
  });

  // ── USE_MOCKS branch ──────────────────────────────────────────────────────

  test("18. USE_MOCKS=true in non-production returns mock data after slug+run checks", async () => {
    const origEnv = process.env.NODE_ENV;
    // @ts-expect-error — setting NODE_ENV for test
    process.env.NODE_ENV = "test";
    process.env.USE_MOCKS = "true";

    const res = await GET(makeRequest("openlaw", RUNNER_RUN_ID), makeParams("openlaw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fixes).toHaveLength(2);
    // One pending, one improved
    const statuses = body.fixes.map((f: { rerun_status: string }) => f.rerun_status);
    expect(statuses).toContain("pending");
    expect(statuses).toContain("improved");
    // Graph should not have been called
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();

    // @ts-expect-error
    process.env.NODE_ENV = origEnv;
    delete process.env.USE_MOCKS;
  });

  test("19. USE_MOCKS=true in production does NOT return mock data", async () => {
    const origEnv = process.env.NODE_ENV;
    // @ts-expect-error
    process.env.NODE_ENV = "production";
    process.env.USE_MOCKS = "true";

    const res = await GET(makeRequest("openlaw", RUNNER_RUN_ID), makeParams("openlaw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Should return real (mocked graph) data, not the hardcoded mock fixtures
    expect(mockSearchNodesByAttributes).toHaveBeenCalled();
    // Real path returns 1 node from our mock graph, not the 2 hardcoded fixtures
    expect(body.fixes).toHaveLength(1);

    // @ts-expect-error
    process.env.NODE_ENV = origEnv;
    delete process.env.USE_MOCKS;
  });

  test("20. USE_MOCKS branch is still behind slug check", async () => {
    const origEnv = process.env.NODE_ENV;
    // @ts-expect-error
    process.env.NODE_ENV = "test";
    process.env.USE_MOCKS = "true";

    const res = await GET(makeRequest("other-workspace", RUNNER_RUN_ID), makeParams("other-workspace"));
    expect(res.status).toBe(404);
    // Mock data should not be returned for non-openlaw
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();

    // @ts-expect-error
    process.env.NODE_ENV = origEnv;
    delete process.env.USE_MOCKS;
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  test("Happy path: returns whitelisted fixes for a runner run", async () => {
    const res = await GET(makeRequest("openlaw", RUNNER_RUN_ID), makeParams("openlaw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fixes).toHaveLength(1);

    const fix = body.fixes[0];
    expect(fix.ref_id).toBe("fix-node-1");
    expect(fix.criterion_id).toBe("crit-1");
    expect(fix.criterion_title).toBe("Citation Accuracy");
    expect(fix.rerun_status).toBe("improved");
    expect(fix.before_score).toBe("50");
    expect(fix.after_score).toBe("54");
    expect(fix.score_delta).toBe("+4");
  });
});
