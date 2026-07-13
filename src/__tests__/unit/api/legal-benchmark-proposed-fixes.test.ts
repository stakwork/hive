import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockGetMiddlewareContext = vi.hoisted(() => vi.fn());
const mockGetWorkspaceSwarmAccess = vi.hoisted(() => vi.fn());
const mockDbStakworkRunFindFirst = vi.hoisted(() => vi.fn());
const mockParseBenchmarkRunResult = vi.hoisted(() => vi.fn());
const mockSearchNodesByAttributes = vi.hoisted(() => vi.fn());
const mockGetJarvisConfigForWorkspace = vi.hoisted(() => vi.fn());

vi.mock("@/lib/middleware/utils", () => ({
  requireAuth: mockRequireAuth,
  getMiddlewareContext: mockGetMiddlewareContext,
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: mockGetWorkspaceSwarmAccess,
}));

vi.mock("@/lib/db", () => ({
  db: {
    stakworkRun: {
      findFirst: mockDbStakworkRunFindFirst,
    },
  },
}));

vi.mock("@/types/legal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/types/legal")>();
  return {
    ...actual,
    parseBenchmarkRunResult: mockParseBenchmarkRunResult,
  };
});

vi.mock("@/services/swarm/api/nodes", () => ({
  searchNodesByAttributes: mockSearchNodesByAttributes,
}));

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: mockGetJarvisConfigForWorkspace,
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

const { GET } = await import(
  "@/app/api/workspaces/[slug]/legal/benchmarks/proposed-fixes/route"
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MOCK_USER = { id: "user-1" };
const MOCK_WORKSPACE_ID = "workspace-abc";
const MOCK_TASK_SLUG = "antitrust/task-1";

const MOCK_SWARM_ACCESS = {
  success: true as const,
  data: {
    workspaceId: MOCK_WORKSPACE_ID,
    swarmName: "my-swarm",
    swarmUrl: "http://swarm",
    swarmApiKey: "decrypted-key",
    swarmStatus: "active",
    poolName: "pool-1",
    swarmSecretAlias: "alias-1",
  },
};

const MOCK_RUNNER_RUN = {
  id: "run-1",
  workspaceId: MOCK_WORKSPACE_ID,
  type: "LEGAL_BENCHMARK_RUNNER",
  result: JSON.stringify({ taskSlug: MOCK_TASK_SLUG }),
};

const MOCK_JARVIS_CONFIG = { jarvisUrl: "http://jarvis", apiKey: "key" };

const MOCK_NODE = {
  ref_id: "node-1",
  node_id: "node-1",
  properties: {
    criterion_id: "crit-1",
    criterion_title: "Accuracy",
    prompt_name: "citation_v2",
    prompt_id: "pid-1",
    prompt_version_id: "v1.0",
    new_prompt_version_id: "v1.1",
    failing_value: "wrong",
    passing_value: "correct",
    delta: "added format rules",
    reasoning: "old prompt was vague",
    status: "proposed",
    rerun_status: "improved",
    before_score: "50",
    after_score: "54",
    score_delta: "+4",
    rerun_run_id: "rerun-1",
  },
};

function makeRequest(slug: string, runId?: string) {
  const url = runId
    ? `http://localhost/api/workspaces/${slug}/legal/benchmarks/proposed-fixes?runId=${runId}`
    : `http://localhost/api/workspaces/${slug}/legal/benchmarks/proposed-fixes`;
  return new NextRequest(url);
}

async function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/legal/benchmarks/proposed-fixes", () => {
  let originalUseMocks: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // Disable mock branch by default so real code paths are exercised in each test
    originalUseMocks = process.env.USE_MOCKS;
    process.env.USE_MOCKS = "false";

    mockGetMiddlewareContext.mockReturnValue({});
    mockRequireAuth.mockReturnValue(MOCK_USER);
    mockGetWorkspaceSwarmAccess.mockResolvedValue(MOCK_SWARM_ACCESS);
    mockDbStakworkRunFindFirst.mockResolvedValue(MOCK_RUNNER_RUN);
    mockParseBenchmarkRunResult.mockReturnValue({ taskSlug: MOCK_TASK_SLUG });
    mockGetJarvisConfigForWorkspace.mockResolvedValue(MOCK_JARVIS_CONFIG);
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [MOCK_NODE] });
  });

  afterEach(() => {
    process.env.USE_MOCKS = originalUseMocks;
  });

  // ─── Auth ────────────────────────────────────────────────────────────────

  test("returns auth response when requireAuth fails", async () => {
    const { NextResponse } = await import("next/server");
    const authError = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockRequireAuth.mockReturnValue(authError);

    const res = await GET(makeRequest("openlaw", "run-1"), await makeParams("openlaw"));
    expect(res.status).toBe(401);
  });

  // ─── Slug gate ───────────────────────────────────────────────────────────

  test("returns 404 for non-openlaw workspace", async () => {
    const res = await GET(makeRequest("other-slug", "run-1"), await makeParams("other-slug"));
    expect(res.status).toBe(404);
    // Graph must NOT be called
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();
  });

  test("returns 400 when runId is missing", async () => {
    const res = await GET(makeRequest("openlaw"), await makeParams("openlaw"));
    expect(res.status).toBe(400);
  });

  // ─── SwarmAccess error branches ──────────────────────────────────────────

  test.each([
    ["WORKSPACE_NOT_FOUND", 404],
    ["ACCESS_DENIED", 403],
    ["SWARM_NOT_ACTIVE", 400],
    ["SWARM_NAME_MISSING", 400],
    ["SWARM_API_KEY_MISSING", 400],
    ["SWARM_NOT_CONFIGURED", 400],
  ])("maps SwarmAccessError %s → %i", async (errorType, expectedStatus) => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: errorType },
    });

    const res = await GET(makeRequest("openlaw", "run-1"), await makeParams("openlaw"));
    expect(res.status).toBe(expectedStatus);
  });

  // ─── IDOR guard ──────────────────────────────────────────────────────────

  test("returns 404 when run not found (cross-workspace / unknown runId)", async () => {
    mockDbStakworkRunFindFirst.mockResolvedValue(null);

    const res = await GET(makeRequest("openlaw", "run-unknown"), await makeParams("openlaw"));
    expect(res.status).toBe(404);
    // Graph must NOT be called
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();
  });

  test("queries DB with workspaceId-scoped filter (IDOR guard)", async () => {
    const res = await GET(makeRequest("openlaw", "run-1"), await makeParams("openlaw"));
    expect(res.status).toBe(200);
    expect(mockDbStakworkRunFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: MOCK_WORKSPACE_ID }),
      }),
    );
  });

  // ─── taskSlug derivation ─────────────────────────────────────────────────

  test("returns { fixes: [] } (fail-closed) when taskSlug is missing and no sibling", async () => {
    mockParseBenchmarkRunResult.mockReturnValue({ taskSlug: null, siblingRunId: null });

    const res = await GET(makeRequest("openlaw", "run-1"), await makeParams("openlaw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fixes).toEqual([]);
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();
  });

  test("resolves taskSlug via sibling runner when SCORER run has siblingRunId", async () => {
    // First findFirst returns SCORER run with siblingRunId
    const scorerRun = {
      id: "scorer-run",
      workspaceId: MOCK_WORKSPACE_ID,
      type: "LEGAL_BENCHMARK_SCORER",
      result: JSON.stringify({ siblingRunId: "runner-sibling" }),
    };
    mockDbStakworkRunFindFirst
      .mockResolvedValueOnce(scorerRun)
      .mockResolvedValueOnce({
        id: "runner-sibling",
        workspaceId: MOCK_WORKSPACE_ID,
        type: "LEGAL_BENCHMARK_RUNNER",
        result: JSON.stringify({ taskSlug: MOCK_TASK_SLUG }),
      });

    // parseBenchmarkRunResult: first call returns no taskSlug but has siblingRunId
    mockParseBenchmarkRunResult
      .mockReturnValueOnce({ taskSlug: null, siblingRunId: "runner-sibling" })
      .mockReturnValueOnce({ taskSlug: MOCK_TASK_SLUG });

    const res = await GET(makeRequest("openlaw", "scorer-run"), await makeParams("openlaw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fixes).toHaveLength(1);
    expect(mockSearchNodesByAttributes).toHaveBeenCalledWith(
      MOCK_JARVIS_CONFIG,
      expect.objectContaining({
        filters: expect.arrayContaining([
          expect.objectContaining({ attribute: "task_slug", value: MOCK_TASK_SLUG }),
        ]),
      }),
    );
  });

  test("fail-closed when sibling runner also has no taskSlug", async () => {
    mockDbStakworkRunFindFirst.mockResolvedValueOnce({
      id: "scorer-run",
      workspaceId: MOCK_WORKSPACE_ID,
      type: "LEGAL_BENCHMARK_SCORER",
      result: JSON.stringify({ siblingRunId: "runner-sibling" }),
    }).mockResolvedValueOnce({
      id: "runner-sibling",
      workspaceId: MOCK_WORKSPACE_ID,
      type: "LEGAL_BENCHMARK_RUNNER",
      result: JSON.stringify({}),
    });

    mockParseBenchmarkRunResult
      .mockReturnValueOnce({ taskSlug: null, siblingRunId: "runner-sibling" })
      .mockReturnValueOnce({ taskSlug: null });

    const res = await GET(makeRequest("openlaw", "scorer-run"), await makeParams("openlaw"));
    const body = await res.json();
    expect(body.fixes).toEqual([]);
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();
  });

  // ─── includeProperties ───────────────────────────────────────────────────

  test("calls searchNodesByAttributes with includeProperties: true", async () => {
    const res = await GET(makeRequest("openlaw", "run-1"), await makeParams("openlaw"));
    expect(res.status).toBe(200);
    expect(mockSearchNodesByAttributes).toHaveBeenCalledWith(
      MOCK_JARVIS_CONFIG,
      expect.objectContaining({ includeProperties: true }),
    );
  });

  // ─── Projection whitelisting ─────────────────────────────────────────────

  test("returns only whitelisted 16 keys — no raw node properties leaked", async () => {
    const nodeWithExtraFields = {
      ref_id: "node-1",
      node_id: "node-1",
      properties: {
        ...MOCK_NODE.properties,
        // Extra fields that must NOT appear in output
        internal_secret: "should-not-appear",
        graph_metadata: { nested: true },
      },
    };
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [nodeWithExtraFields] });

    const res = await GET(makeRequest("openlaw", "run-1"), await makeParams("openlaw"));
    const body = await res.json();
    const fix = body.fixes[0];

    expect(fix.internal_secret).toBeUndefined();
    expect(fix.graph_metadata).toBeUndefined();

    // All expected whitelisted fields present
    expect(fix.ref_id).toBe("node-1");
    expect(fix.criterion_id).toBe("crit-1");
    expect(fix.criterion_title).toBe("Accuracy");
    expect(fix.prompt_name).toBe("citation_v2");
    expect(fix.rerun_status).toBe("improved");
    expect(fix.score_delta).toBe("+4");
  });

  test("tolerates missing node properties without throwing", async () => {
    // Node with empty properties
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: true,
      nodes: [{ ref_id: "min-node", properties: {} }],
    });

    const res = await GET(makeRequest("openlaw", "run-1"), await makeParams("openlaw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fixes).toHaveLength(1);
    expect(body.fixes[0].ref_id).toBe("min-node");
    // All optional fields should be undefined (not present or null-ish)
    expect(body.fixes[0].criterion_id).toBeUndefined();
  });

  // ─── Graceful degradation ────────────────────────────────────────────────

  test("returns { fixes: [] } when Jarvis config is unavailable", async () => {
    mockGetJarvisConfigForWorkspace.mockResolvedValue(null);

    const res = await GET(makeRequest("openlaw", "run-1"), await makeParams("openlaw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fixes).toEqual([]);
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();
  });

  test("returns { fixes: [] } when graph search fails", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: false,
      nodes: [],
      error: "timeout",
    });

    const res = await GET(makeRequest("openlaw", "run-1"), await makeParams("openlaw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fixes).toEqual([]);
  });

  // ─── Mock branch gating ──────────────────────────────────────────────────

  test("mock branch is NOT reached in production even with USE_MOCKS=true", async () => {
    vi.stubEnv("USE_MOCKS", "true");
    vi.stubEnv("NODE_ENV", "production");

    const res = await GET(makeRequest("openlaw", "run-1"), await makeParams("openlaw"));
    // Should call real graph, not return mock data
    expect(mockSearchNodesByAttributes).toHaveBeenCalled();

    vi.unstubAllEnvs();
    // Restore test default (mock branch disabled)
    process.env.USE_MOCKS = "false";
  });

  test("mock branch still gated by slug check even in non-production", async () => {
    vi.stubEnv("USE_MOCKS", "true");
    vi.stubEnv("NODE_ENV", "test");

    // Non-openlaw slug should still 404 even in mock mode
    const res = await GET(makeRequest("other-slug", "run-1"), await makeParams("other-slug"));
    expect(res.status).toBe(404);

    vi.unstubAllEnvs();
    process.env.USE_MOCKS = "false";
  });

  test("mock branch returns 2 sample fixes in non-production with USE_MOCKS=true", async () => {
    vi.stubEnv("USE_MOCKS", "true");
    vi.stubEnv("NODE_ENV", "development");

    const res = await GET(makeRequest("openlaw", "run-1"), await makeParams("openlaw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fixes).toHaveLength(2);
    expect(body.fixes[0].rerun_status).toBe("pending");
    expect(body.fixes[1].rerun_status).toBe("improved");
    expect(body.fixes[1].before_score).toBe("50");
    expect(body.fixes[1].after_score).toBe("54");
    // Graph should NOT be called in mock mode
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
    process.env.USE_MOCKS = "false";
  });

  // ─── Happy path ──────────────────────────────────────────────────────────

  test("returns projected fixes on success", async () => {
    const res = await GET(makeRequest("openlaw", "run-1"), await makeParams("openlaw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fixes).toHaveLength(1);
    expect(body.fixes[0]).toMatchObject({
      ref_id: "node-1",
      criterion_id: "crit-1",
      rerun_status: "improved",
      score_delta: "+4",
    });
  });

  test("returns empty fixes array when no nodes found", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });

    const res = await GET(makeRequest("openlaw", "run-1"), await makeParams("openlaw"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fixes).toEqual([]);
  });
});
