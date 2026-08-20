/**
 * Unit tests for GET /api/workspaces/[slug]/legal/benchmarks/graph-scores
 *
 * Coverage:
 *  1. Non-openlaw slug → 404, no graph call
 *  2. Missing taskSlug → 400
 *  3. Rate limit exceeded → 429
 *  4. Rate limiter down → fails OPEN (request proceeds)
 *  5. Swarm access failure mapped
 *  6. USE_MOCKS branch (non-production only) returns deterministic outputs
 *  7. triggerRefs validated: malformed refs dropped, list capped
 *  8. Happy path: service result passed through
 *  9. Graph unreachable (ok:false) → 502
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetWorkspaceSwarmAccess = vi.hoisted(() => vi.fn());
const mockGetJarvisConfigForWorkspace = vi.hoisted(() => vi.fn());
const mockFetchTaskGraphOutputs = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

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
vi.mock("@/services/legal-benchmark-graph-scores", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchTaskGraphOutputs: mockFetchTaskGraphOutputs,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn(() => "1.2.3.4"),
}));

import { GET } from "@/app/api/workspaces/[slug]/legal/benchmarks/graph-scores/route";
import { GRAPH_SCORES_TRIGGER_CAP } from "@/services/legal-benchmark-graph-scores";

function makeRequest(slug: string, query = "") {
  return new NextRequest(
    `http://localhost/api/workspaces/${slug}/legal/benchmarks/graph-scores${query}`,
    { method: "GET" },
  );
}
const makeParams = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.USE_MOCKS;
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockGetWorkspaceSwarmAccess.mockResolvedValue({ success: true, data: { workspaceId: "ws-1" } });
  mockGetJarvisConfigForWorkspace.mockResolvedValue({ jarvisUrl: "https://j", apiKey: "k" });
  mockFetchTaskGraphOutputs.mockResolvedValue({
    ok: true,
    evalSetRefId: "evalset-1",
    outputs: [{ ref_id: "out-1", triggerRef: "trig-1", result: "fail", score: 0.5, attempt_number: 1, n_passed: 5, n_total: 10 }],
    partial: false,
  });
});

afterEach(() => {
  delete process.env.USE_MOCKS;
});

describe("GET /api/workspaces/[slug]/legal/benchmarks/graph-scores", () => {
  test("1. Non-openlaw slug → 404, no graph call", async () => {
    const res = await GET(makeRequest("other", "?taskSlug=t"), makeParams("other"));
    expect(res.status).toBe(404);
    expect(mockFetchTaskGraphOutputs).not.toHaveBeenCalled();
  });

  test("2. Missing taskSlug → 400", async () => {
    const res = await GET(makeRequest("openlaw"), makeParams("openlaw"));
    expect(res.status).toBe(400);
  });

  test("3. Rate limit exceeded → 429", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });
    const res = await GET(makeRequest("openlaw", "?taskSlug=t"), makeParams("openlaw"));
    expect(res.status).toBe(429);
  });

  test("4. Rate limiter down → fails open", async () => {
    mockCheckRateLimit.mockRejectedValue(new Error("redis down"));
    const res = await GET(makeRequest("openlaw", "?taskSlug=t"), makeParams("openlaw"));
    expect(res.status).toBe(200);
    expect(mockFetchTaskGraphOutputs).toHaveBeenCalled();
  });

  test("5. Swarm access failure mapped (ACCESS_DENIED → 403)", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({ success: false, error: { type: "ACCESS_DENIED" } });
    const res = await GET(makeRequest("openlaw", "?taskSlug=t"), makeParams("openlaw"));
    expect(res.status).toBe(403);
  });

  test("6. USE_MOCKS returns deterministic outputs without touching the graph", async () => {
    const origEnv = process.env.NODE_ENV;
    // @ts-expect-error — setting NODE_ENV for test
    process.env.NODE_ENV = "test";
    process.env.USE_MOCKS = "true";

    const res = await GET(
      makeRequest("openlaw", "?taskSlug=task-a&triggerRefs=trig-1"),
      makeParams("openlaw"),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockFetchTaskGraphOutputs).not.toHaveBeenCalled();
    // One echoed output per requested trigger + the projectId-suffix rerun output
    expect(body.data.outputs).toHaveLength(2);
    expect(body.data.outputs[0].triggerRef).toBe("trig-1");
    expect(body.data.outputs[1].id).toBe("task-a-mock-source--57419");

    // @ts-expect-error
    process.env.NODE_ENV = origEnv;
  });

  test("7. triggerRefs validated and capped", async () => {
    const refs = [
      "good-ref",
      "bad ref with spaces",
      "bad|pipe",
      ...Array.from({ length: GRAPH_SCORES_TRIGGER_CAP + 10 }, (_, i) => `bulk-${i}`),
    ].join(",");
    await GET(
      makeRequest("openlaw", `?taskSlug=t&triggerRefs=${encodeURIComponent(refs)}`),
      makeParams("openlaw"),
    );
    const passedRefs = mockFetchTaskGraphOutputs.mock.calls[0][2] as string[];
    expect(passedRefs).toContain("good-ref");
    expect(passedRefs).not.toContain("bad ref with spaces");
    expect(passedRefs).not.toContain("bad|pipe");
    expect(passedRefs.length).toBeLessThanOrEqual(GRAPH_SCORES_TRIGGER_CAP);
  });

  test("8. Happy path passes the service result through", async () => {
    const res = await GET(makeRequest("openlaw", "?taskSlug=t"), makeParams("openlaw"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.evalSetRefId).toBe("evalset-1");
    expect(body.data.outputs).toHaveLength(1);
    expect(body.data.partial).toBe(false);
  });

  test("9. Graph unreachable with nothing gathered → 502", async () => {
    mockFetchTaskGraphOutputs.mockResolvedValue({ ok: false, evalSetRefId: null, outputs: [], partial: true });
    const res = await GET(makeRequest("openlaw", "?taskSlug=t"), makeParams("openlaw"));
    expect(res.status).toBe(502);
  });
});
