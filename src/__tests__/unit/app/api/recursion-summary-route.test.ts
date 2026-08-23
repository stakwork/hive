/**
 * Unit tests for GET /api/workspaces/[slug]/legal/benchmarks/recursion/summary
 *
 * Coverage:
 *   - Auth guard (401 without auth)
 *   - Openlaw gate (403 for non-openlaw slug)
 *   - Rate limit fires before getWorkspaceSwarmAccess (verify call order)
 *   - Rate limit key includes userId
 *   - 503 + Retry-After: 60 on Redis error (fail-closed — not 200)
 *   - workspaceId forwarded to listRecursionEvalSets
 *   - USE_MOCKS fixture response
 *   - enrollmentPartial and summaryPartial independently propagated
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockGetMiddlewareContext = vi.hoisted(() => vi.fn());
const mockGetWorkspaceSwarmAccess = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockGetClientIp = vi.hoisted(() => vi.fn());
const mockGetJarvisUrl = vi.hoisted(() => vi.fn());
const mockListRecursionEvalSets = vi.hoisted(() => vi.fn());
const mockFetchRecursionTaskSummary = vi.hoisted(() => vi.fn());

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: mockGetMiddlewareContext,
  requireAuth: mockRequireAuth,
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: mockGetWorkspaceSwarmAccess,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));

vi.mock("@/lib/utils/swarm", () => ({
  getJarvisUrl: mockGetJarvisUrl,
}));

vi.mock("@/services/legal-benchmark-recursion", () => ({
  listRecursionEvalSets: mockListRecursionEvalSets,
}));

vi.mock("@/services/legal-benchmark-recursion-summary", () => ({
  fetchRecursionTaskSummary: mockFetchRecursionTaskSummary,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Import after mocks ────────────────────────────────────────────────────

import { GET } from "@/app/api/workspaces/[slug]/legal/benchmarks/recursion/summary/route";
import { NextResponse } from "next/server";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeRequest(url = "https://hive.example.com/api/workspaces/openlaw/legal/benchmarks/recursion/summary") {
  return new NextRequest(url);
}

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

const VALID_USER = { id: "user-123" };
const SWARM_DATA = {
  swarmName: "my-swarm",
  swarmApiKey: "swarm-api-key-secret",
  workspaceId: "workspace-abc",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  // Ensure USE_MOCKS is off for all tests unless explicitly overridden.
  vi.stubEnv("USE_MOCKS", "false");
  vi.stubEnv("NODE_ENV", "test");

  // Default happy-path mocks
  mockGetMiddlewareContext.mockReturnValue({});
  mockRequireAuth.mockReturnValue(VALID_USER);
  mockGetClientIp.mockReturnValue("1.2.3.4");
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockGetWorkspaceSwarmAccess.mockResolvedValue({
    success: true,
    data: SWARM_DATA,
  });
  mockGetJarvisUrl.mockReturnValue("https://jarvis.example.com");
  mockListRecursionEvalSets.mockResolvedValue({
    ok: true,
    nodes: [],
    partial: false,
  });
  mockFetchRecursionTaskSummary.mockResolvedValue([]);
});

describe("GET /api/workspaces/[slug]/legal/benchmarks/recursion/summary", () => {
  // ── Auth guard ──────────────────────────────────────────────────────────

  it("returns 401 when requireAuth fails (no session)", async () => {
    mockRequireAuth.mockReturnValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await GET(makeRequest(), makeParams("openlaw"));

    expect(res.status).toBe(401);
  });

  // ── Openlaw gate ────────────────────────────────────────────────────────

  it("returns 403 for non-openlaw slug", async () => {
    const res = await GET(makeRequest(), makeParams("other-workspace"));

    expect(res.status).toBe(403);
    // getWorkspaceSwarmAccess must NOT have been called — IDOR gate fires before
    expect(mockGetWorkspaceSwarmAccess).not.toHaveBeenCalled();
  });

  // ── Rate limit: fires BEFORE getWorkspaceSwarmAccess ───────────────────

  it("calls checkRateLimit before getWorkspaceSwarmAccess", async () => {
    const callOrder: string[] = [];
    mockCheckRateLimit.mockImplementation(async () => {
      callOrder.push("rateLimit");
      return { allowed: true };
    });
    mockGetWorkspaceSwarmAccess.mockImplementation(async () => {
      callOrder.push("swarmAccess");
      return { success: true, data: SWARM_DATA };
    });

    await GET(makeRequest(), makeParams("openlaw"));

    const rlIdx = callOrder.indexOf("rateLimit");
    const swarmIdx = callOrder.indexOf("swarmAccess");
    expect(rlIdx).toBeGreaterThanOrEqual(0);
    expect(swarmIdx).toBeGreaterThan(rlIdx);
  });

  it("rate limit key includes userId", async () => {
    await GET(makeRequest(), makeParams("openlaw"));

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.stringContaining(VALID_USER.id),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("returns 429 when rate limit is exceeded", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 45 });

    const res = await GET(makeRequest(), makeParams("openlaw"));

    expect(res.status).toBe(429);
  });

  // ── Fail-closed on Redis error ──────────────────────────────────────────

  it("returns 503 + Retry-After: 60 when rate limit throws (Redis error)", async () => {
    mockCheckRateLimit.mockRejectedValue(new Error("Redis connection refused"));

    const res = await GET(makeRequest(), makeParams("openlaw"));

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    // getWorkspaceSwarmAccess must NOT have been called (fail-closed)
    expect(mockGetWorkspaceSwarmAccess).not.toHaveBeenCalled();
  });

  it("does NOT return 200 when Redis errors (fail-closed, not fail-open)", async () => {
    mockCheckRateLimit.mockRejectedValue(new Error("Redis timeout"));

    const res = await GET(makeRequest(), makeParams("openlaw"));

    expect(res.status).not.toBe(200);
    expect(res.status).toBe(503);
  });

  // ── workspaceId forwarded ───────────────────────────────────────────────

  it("forwards workspaceId from swarm access to listRecursionEvalSets", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: true,
      data: { ...SWARM_DATA, workspaceId: "specific-workspace-id" },
    });

    await GET(makeRequest(), makeParams("openlaw"));

    expect(mockListRecursionEvalSets).toHaveBeenCalledWith(
      expect.anything(),
      "specific-workspace-id",
    );
  });

  // ── Partial flags ───────────────────────────────────────────────────────

  it("includes enrollmentPartial: true when listRecursionEvalSets returns partial", async () => {
    mockListRecursionEvalSets.mockResolvedValue({
      ok: true,
      nodes: [],
      partial: true,
    });

    const res = await GET(makeRequest(), makeParams("openlaw"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.enrollmentPartial).toBe(true);
    expect(body.summaryPartial).toBeUndefined(); // no tasks → no summary failures
  });

  it("includes summaryPartial: true when some tasks return isDefault: true", async () => {
    const summaryData = [
      {
        taskSlug: "task-ok",
        refId: "ref-ok",
        name: "OK Task",
        reason: "active",
        recursion: true,
        rubricCount: 5,
        contestedCount: 0,
        latestRun: null,
        fixChainDepth: 0,
        isDefault: false,
      },
      {
        taskSlug: "task-fail",
        refId: "ref-fail",
        name: "Failed Task",
        reason: "active",
        recursion: true,
        rubricCount: 0,
        contestedCount: 0,
        latestRun: null,
        fixChainDepth: 0,
        isDefault: true, // degraded
      },
    ];
    mockListRecursionEvalSets.mockResolvedValue({
      ok: true,
      nodes: [{ ref_id: "ref-ok", id: "task-ok", name: "OK Task" }, { ref_id: "ref-fail", id: "task-fail", name: "Failed Task" }],
    });
    mockFetchRecursionTaskSummary.mockResolvedValue(summaryData);

    const res = await GET(makeRequest(), makeParams("openlaw"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.summaryPartial).toBe(true);
    expect(body.enrollmentPartial).toBeUndefined();
  });

  it("enrollmentPartial and summaryPartial can both be present independently", async () => {
    mockListRecursionEvalSets.mockResolvedValue({
      ok: true,
      nodes: [{ ref_id: "ref-1", id: "task-1", name: "Task 1" }],
      partial: true, // enrollment partial
    });
    mockFetchRecursionTaskSummary.mockResolvedValue([
      {
        taskSlug: "task-1",
        refId: "ref-1",
        name: "Task 1",
        reason: "active",
        recursion: true,
        rubricCount: 0,
        contestedCount: 0,
        latestRun: null,
        fixChainDepth: 0,
        isDefault: true, // summary partial
      },
    ]);

    const res = await GET(makeRequest(), makeParams("openlaw"));
    const body = await res.json();

    expect(body.enrollmentPartial).toBe(true);
    expect(body.summaryPartial).toBe(true);
  });

  it("omits enrollmentPartial when enrollment is complete", async () => {
    mockListRecursionEvalSets.mockResolvedValue({
      ok: true,
      nodes: [],
      partial: false,
    });

    const res = await GET(makeRequest(), makeParams("openlaw"));
    const body = await res.json();

    expect(body.enrollmentPartial).toBeUndefined();
  });

  it("omits summaryPartial when all tasks succeeded", async () => {
    mockListRecursionEvalSets.mockResolvedValue({
      ok: true,
      nodes: [{ ref_id: "ref-1", id: "task-1", name: "Task 1" }],
    });
    mockFetchRecursionTaskSummary.mockResolvedValue([
      {
        taskSlug: "task-1",
        refId: "ref-1",
        name: "Task 1",
        reason: "active",
        recursion: true,
        rubricCount: 5,
        contestedCount: 0,
        latestRun: null,
        fixChainDepth: 2,
        isDefault: false, // success
      },
    ]);

    const res = await GET(makeRequest(), makeParams("openlaw"));
    const body = await res.json();

    expect(body.summaryPartial).toBeUndefined();
  });

  // ── USE_MOCKS fixture ────────────────────────────────────────────────────

  it("returns mock fixture when USE_MOCKS=true in non-production", async () => {
    vi.stubEnv("USE_MOCKS", "true");
    vi.stubEnv("NODE_ENV", "test");

    const res = await GET(makeRequest(), makeParams("openlaw"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    // fetchRecursionTaskSummary must NOT be called for mock mode
    expect(mockFetchRecursionTaskSummary).not.toHaveBeenCalled();
  });

  it("does NOT serve mock fixture in production even when USE_MOCKS=true", async () => {
    vi.stubEnv("USE_MOCKS", "true");
    vi.stubEnv("NODE_ENV", "production");

    await GET(makeRequest(), makeParams("openlaw"));

    // Should call real implementation
    expect(mockListRecursionEvalSets).toHaveBeenCalled();
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  it("returns 200 with data on happy path", async () => {
    mockListRecursionEvalSets.mockResolvedValue({
      ok: true,
      nodes: [{ ref_id: "ref-1", id: "task-1", name: "Task 1", reason: "active", recursion: true }],
    });
    mockFetchRecursionTaskSummary.mockResolvedValue([
      {
        taskSlug: "task-1",
        refId: "ref-1",
        name: "Task 1",
        reason: "active",
        recursion: true,
        rubricCount: 10,
        contestedCount: 1,
        latestRun: { n_passed: 7, n_total: 9, runAt: "1700000000" },
        fixChainDepth: 3,
        isDefault: false,
      },
    ]);

    const res = await GET(makeRequest(), makeParams("openlaw"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].taskSlug).toBe("task-1");
    expect(body.data[0].rubricCount).toBe(10);
  });

  // ── listRecursionEvalSets failure ────────────────────────────────────────

  it("returns 502 when listRecursionEvalSets fails", async () => {
    mockListRecursionEvalSets.mockResolvedValue({
      ok: false,
      error: "Graph query failed",
    });

    const res = await GET(makeRequest(), makeParams("openlaw"));

    expect(res.status).toBe(502);
  });

  // ── Swarm access error ───────────────────────────────────────────────────

  it("returns 404 when workspace not found", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "WORKSPACE_NOT_FOUND" },
    });

    const res = await GET(makeRequest(), makeParams("openlaw"));

    expect(res.status).toBe(404);
  });
});
