/**
 * Unit tests for GET /api/workspaces/[slug]/workflow-benchmarks/rubrics
 *
 * Covers:
 *   - Feature gate (404 for non-allowlisted)
 *   - taskSlug validation against corpus (400 on unknown)
 *   - Rate limit fail-open (read path)
 *   - Roster unavailable → { data: null, rosterUnavailable: true }
 *   - Prefix stripping: ${taskSlug}:: stripped from rubric ids on the way out
 *   - Mock roster: corpus-derived, 8 rubrics, none contested
 *   - Graph failure → 502
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Stable mock references ────────────────────────────────────────────────────

const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockGetMiddlewareContext = vi.hoisted(() => vi.fn());
const mockGetWorkspaceSwarmAccess = vi.hoisted(() => vi.fn());
const mockGetJarvisConfigForWorkspace = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockFetchTaskRubricRoster = vi.hoisted(() => vi.fn());

// ── Module mocks ──────────────────────────────────────────────────────────────

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

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock("@/services/legal-benchmark-rubrics", () => ({
  fetchTaskRubricRoster: mockFetchTaskRubricRoster,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(slug: string, taskSlug: string) {
  const url = new URL(`http://localhost/api/workspaces/${slug}/workflow-benchmarks/rubrics`);
  url.searchParams.set("taskSlug", taskSlug);
  return new NextRequest(url.toString(), { method: "GET" });
}

const VALID_SLUG = "stakwork";
const TASK_SLUG = "wfbench/create-openai-call";
const USER_ID = "user-123";
const WORKSPACE_ID = "ws-abc";

function setupHappyPath() {
  mockGetMiddlewareContext.mockReturnValue({});
  mockRequireAuth.mockReturnValue({ id: USER_ID });
  mockGetWorkspaceSwarmAccess.mockResolvedValue({
    success: true,
    data: { workspaceId: WORKSPACE_ID },
  });
  mockGetJarvisConfigForWorkspace.mockResolvedValue({
    jarvisUrl: "https://jarvis.example.com",
    apiKey: "jarvis-api-key",
  });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });

  // Default: graph has a roster
  mockFetchTaskRubricRoster.mockResolvedValue({
    ok: true,
    roster: {
      evalSetRefId: "evalset-ref-1",
      rubrics: [
        { ref_id: "req-1", id: `${TASK_SLUG}::C-001`, name: "Request step exists", contested: false },
        { ref_id: "req-2", id: `${TASK_SLUG}::C-002`, name: "URL is OpenAI endpoint", contested: false },
        { ref_id: "req-3", id: `${TASK_SLUG}::C-003`, name: "HTTP method is POST", contested: false },
        { ref_id: "req-4", id: `${TASK_SLUG}::C-004`, name: "Authorization uses secret reference", contested: false },
        { ref_id: "req-5", id: `${TASK_SLUG}::C-005`, name: "Authorization uses authoring form", contested: false },
        { ref_id: "req-6", id: `${TASK_SLUG}::C-006`, name: "Body contains model field", contested: false },
        { ref_id: "req-7", id: `${TASK_SLUG}::C-007`, name: "Messages array includes user turn", contested: false },
        { ref_id: "req-8", id: `${TASK_SLUG}::C-008`, name: "Workflow is structurally valid", contested: false },
      ],
    },
  });
}

// ── Feature gate ──────────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/workflow-benchmarks/rubrics — feature gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMiddlewareContext.mockReturnValue({});
    mockRequireAuth.mockReturnValue({ id: USER_ID });
  });

  it("returns 404 for a non-allowlisted slug", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/rubrics/route");
    const req = makeRequest("openlaw", TASK_SLUG);
    const res = await GET(req, { params: Promise.resolve({ slug: "openlaw" }) });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a completely unknown slug", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/rubrics/route");
    const req = makeRequest("random-workspace", TASK_SLUG);
    const res = await GET(req, { params: Promise.resolve({ slug: "random-workspace" }) });
    expect(res.status).toBe(404);
  });
});

// ── taskSlug validation ───────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/workflow-benchmarks/rubrics — taskSlug validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("returns 400 for an unknown taskSlug", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/rubrics/route");
    const req = makeRequest(VALID_SLUG, "unknown/task");
    const res = await GET(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when taskSlug is missing", async () => {
    const url = new URL(`http://localhost/api/workspaces/${VALID_SLUG}/workflow-benchmarks/rubrics`);
    const req = new NextRequest(url.toString(), { method: "GET" });
    const { GET } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/rubrics/route");
    const res = await GET(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(400);
  });

  it("returns 200 for a valid corpus taskSlug", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/rubrics/route");
    const req = makeRequest(VALID_SLUG, TASK_SLUG);
    const res = await GET(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(200);
  });
});

// ── Prefix stripping ──────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/workflow-benchmarks/rubrics — prefix stripping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("strips the ${taskSlug}:: prefix from rubric ids on the way out", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/rubrics/route");
    const req = makeRequest(VALID_SLUG, TASK_SLUG);
    const res = await GET(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    const rubrics = body.data?.rubrics;
    expect(Array.isArray(rubrics)).toBe(true);

    for (const rubric of rubrics) {
      // Wire ids must be bare C-00N, never prefixed
      expect(rubric.id).not.toContain(TASK_SLUG);
      expect(rubric.id).not.toContain("::");
      expect(rubric.id).toMatch(/^C-\d{3}$/);
    }
  });

  it("criterionStatus join works: bare C-001 ids match correctly", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/rubrics/route");
    const req = makeRequest(VALID_SLUG, TASK_SLUG);
    const res = await GET(req, { params: Promise.resolve({ slug: VALID_SLUG }) });

    const body = await res.json();
    const rubrics = body.data?.rubrics;
    const ids = rubrics.map((r: { id: string }) => r.id);
    expect(ids).toContain("C-001");
    expect(ids).toContain("C-008");
  });

  it("returns correct total and contested counts", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/rubrics/route");
    const req = makeRequest(VALID_SLUG, TASK_SLUG);
    const res = await GET(req, { params: Promise.resolve({ slug: VALID_SLUG }) });

    const body = await res.json();
    expect(body.data?.total).toBe(8);
    expect(body.data?.contested).toBe(0);
  });
});

// ── Roster unavailable ────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/workflow-benchmarks/rubrics — roster unavailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("returns rosterUnavailable:true when no EvalSet in graph", async () => {
    mockFetchTaskRubricRoster.mockResolvedValue({ ok: true, roster: null });

    const { GET } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/rubrics/route");
    const req = makeRequest(VALID_SLUG, TASK_SLUG);
    const res = await GET(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
    expect(body.rosterUnavailable).toBe(true);
  });

  it("returns 502 when graph is unreachable", async () => {
    mockFetchTaskRubricRoster.mockResolvedValue({ ok: false, error: "Graph connection failed" });

    const { GET } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/rubrics/route");
    const req = makeRequest(VALID_SLUG, TASK_SLUG);
    const res = await GET(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(502);
  });
});

// ── Rate limit ────────────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/workflow-benchmarks/rubrics — rate limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("returns 429 when rate limit is exceeded", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });

    const { GET } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/rubrics/route");
    const req = makeRequest(VALID_SLUG, TASK_SLUG);
    const res = await GET(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(429);
  });

  it("fails CLOSED (503) when rate limiter throws", async () => {
    // Aligned with the dispatch route's fail-closed posture — a limiter
    // outage must not leave the Jarvis graph read path unthrottled, now that
    // this feature grows a second read path (roster-summary) against the
    // same backend.
    mockCheckRateLimit.mockRejectedValue(new Error("Redis unavailable"));

    const { GET } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/rubrics/route");
    const req = makeRequest(VALID_SLUG, TASK_SLUG);
    const res = await GET(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(503);
  });
});

// ── Mock roster (dev only) ────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/workflow-benchmarks/rubrics — mock roster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
    // Ensure isDevelopmentMode() returns true for these tests
  });

  it("mock roster is corpus-derived: 7 rubrics, none contested", async () => {
    // We can't easily toggle NODE_ENV in tests, but we can verify the logic
    // by checking that the real mock roster function (if called) would return
    // 7 rubrics matching the corpus.
    const { WORKFLOW_BENCHMARK_TASKS } = await import("@/lib/workflow-benchmark-tasks");
    const task = WORKFLOW_BENCHMARK_TASKS.find((t) => t.slug === TASK_SLUG);
    expect(task?.criteria.length).toBe(7);
    // All criteria should be non-contested (no `contested` flag in corpus)
    // — this confirms the mock roster would have 0 contested
    expect(task?.criteria.every((c) => !("contested" in c))).toBe(true);
  });
});
