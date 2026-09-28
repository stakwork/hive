import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockResolveOpenHealthStrut = vi.hoisted(() => vi.fn());
const mockFindCachedTaskRow = vi.hoisted(() => vi.fn());
const mockListWorkflowRuns = vi.hoisted(() => vi.fn());
const mockFetchRunDetailForWorkflow = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockEnsureStrutDelegation = vi.hoisted(() => vi.fn());
const mockStrutFetch = vi.hoisted(() => vi.fn());
const mockWithLock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/openhealth-benchmarks/strut-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/openhealth-benchmarks/strut-client")>();
  return {
    ...actual,
    resolveOpenHealthStrut: mockResolveOpenHealthStrut,
    listWorkflowRuns: mockListWorkflowRuns,
    fetchRunDetailForWorkflow: mockFetchRunDetailForWorkflow,
  };
});

vi.mock("@/lib/openhealth-benchmarks/task-cache", () => ({
  findCachedTaskRow: mockFindCachedTaskRow,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock("@/services/bifrost/strut-delegation", () => ({
  STRUT_ACTOR_HEADER: "x-strut-actor",
  ensureStrutDelegation: mockEnsureStrutDelegation,
}));

vi.mock("@/lib/strut/fetch", () => ({
  strutFetch: mockStrutFetch,
}));

vi.mock("@/lib/locks/redis-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/locks/redis-lock")>();
  return {
    ...actual,
    withLock: mockWithLock,
  };
});

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const TARGET = {
  swarmId: "swarm-1",
  workspaceId: "ws-hive",
  workspaceSlug: "hive",
  orgId: "org-1",
  swarmUrl: "https://swarm.example.com/api",
  mcpBase: "https://swarm.example.com:3355",
  labBase: "https://swarm.example.com:3355/lab",
  swarmApiKey: "swarm-key",
  actor: "actor-1",
};

const USER_ID = "user-1";

function makeRequest(slug: string, body: unknown) {
  return new NextRequest(`http://localhost/api/workspaces/${slug}/openhealth/benchmarks/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { gtId: "gt-1" };

function setupHappyPath() {
  mockResolveOpenHealthStrut.mockResolvedValue({ ok: true, target: TARGET, userId: USER_ID });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockFindCachedTaskRow.mockResolvedValue({ row: { gtId: "gt-1", split: "public", difficulty: "easy" }, nativeGtId: "gt-1", split: "public" });
  mockEnsureStrutDelegation.mockResolvedValue({ status: "fresh" });
  mockListWorkflowRuns.mockResolvedValue({ ok: true, runs: [] });
  mockFetchRunDetailForWorkflow.mockResolvedValue(null);
  mockStrutFetch.mockResolvedValue({ ok: true, json: async () => ({ runId: "1700000000001" }) });
  // withLock just calls fn() directly by default — real behaviour minus redis
  mockWithLock.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => fn());
}

describe("POST /api/workspaces/[slug]/openhealth/benchmarks/run — gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  test("delegates the slug/access/strut gate entirely to resolveOpenHealthStrut — a 404 there short-circuits everything", async () => {
    mockResolveOpenHealthStrut.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Not found" }), { status: 404 }),
    });
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("openlaw", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "openlaw" }) });
    expect(res.status).toBe(404);
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  test("fails closed with 503 when the rate limiter throws, before touching the cache or strut", async () => {
    mockCheckRateLimit.mockRejectedValue(new Error("redis down"));
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("hive", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(503);
    expect(mockFindCachedTaskRow).not.toHaveBeenCalled();
  });

  test("returns 429 when the rate limit is exceeded", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("hive", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(429);
  });
});

describe("POST /api/workspaces/[slug]/openhealth/benchmarks/run — body validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  test.each(["ground_truth", "groundTruth", "gold", "problemList"])(
    "rejects a gold-shaped key (%s) with 400",
    async (key) => {
      const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
      const req = makeRequest("hive", { ...VALID_BODY, [key]: "leak" });
      const res = await POST(req, { params: Promise.resolve({ slug: "hive" }) });
      expect(res.status).toBe(400);
      expect(mockFindCachedTaskRow).not.toHaveBeenCalled();
    },
  );

  test("rejects an extra body key beyond gtId with 400", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("hive", { gtId: "gt-1", extra: "field" });
    const res = await POST(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(400);
  });

  test("rejects a path-like or overly long gtId with 400", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    for (const badGtId of ["../etc/passwd", "gt/1", "a".repeat(65), ""]) {
      const req = makeRequest("hive", { gtId: badGtId });
      const res = await POST(req, { params: Promise.resolve({ slug: "hive" }) });
      expect(res.status).toBe(400);
    }
    expect(mockFindCachedTaskRow).not.toHaveBeenCalled();
  });

  test("rejects a gtId not present in a cached public/heldout list with 400", async () => {
    mockFindCachedTaskRow.mockResolvedValue(null);
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("hive", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(400);
    expect(mockEnsureStrutDelegation).not.toHaveBeenCalled();
  });
});

describe("POST /api/workspaces/[slug]/openhealth/benchmarks/run — delegation & duplicate guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  test("returns 503 when delegation is not fresh/pushed, dispatching nothing", async () => {
    mockEnsureStrutDelegation.mockResolvedValue({ status: "failed" });
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("hive", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(503);
    expect(mockStrutFetch).not.toHaveBeenCalled();
  });

  test("returns 409 on lock contention", async () => {
    const { LockAcquireTimeoutError } = await import("@/lib/locks/redis-lock");
    mockWithLock.mockRejectedValue(new LockAcquireTimeoutError("openhealth:run:gt-1", 8000));
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("hive", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(409);
  });

  test("returns 503 when the live-runs list call fails, never dispatching", async () => {
    mockListWorkflowRuns.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Strut unavailable" }), { status: 503 }),
    });
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("hive", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(503);
    expect(mockStrutFetch).not.toHaveBeenCalled();
  });

  test.each(["running", "pausing", "paused", "cancelling", undefined])(
    "returns 409 when a live run (%s) resolves to the same gtId",
    async (status) => {
      mockListWorkflowRuns.mockResolvedValue({
        ok: true,
        runs: [{ runId: "1699999999999", workflow: "openhealth-run", status, input: undefined }],
      });
      mockFetchRunDetailForWorkflow.mockResolvedValue({
        runId: "1699999999999",
        workflow: "openhealth-run",
        status,
        input: { gtId: "gt-1" },
      });
      const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
      const req = makeRequest("hive", VALID_BODY);
      const res = await POST(req, { params: Promise.resolve({ slug: "hive" }) });
      expect(res.status).toBe(409);
      expect(mockStrutFetch).not.toHaveBeenCalled();
    },
  );

  test("returns 503 when a per-run detail fetch fails during the duplicate check", async () => {
    mockListWorkflowRuns.mockResolvedValue({
      ok: true,
      runs: [{ runId: "1699999999999", workflow: "openhealth-run", status: "running" }],
    });
    mockFetchRunDetailForWorkflow.mockResolvedValue(null);
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("hive", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(503);
    expect(mockStrutFetch).not.toHaveBeenCalled();
  });

  test("a live run for a DIFFERENT gtId does not block dispatch", async () => {
    mockListWorkflowRuns.mockResolvedValue({
      ok: true,
      runs: [{ runId: "1699999999999", workflow: "openhealth-run", status: "running", input: { gtId: "gt-OTHER" } }],
    });
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("hive", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(202);
  });
});

describe("POST /api/workspaces/[slug]/openhealth/benchmarks/run — dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  test("happy path dispatches { input: { gtId, workdir } } with NO callback, and returns 202", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("hive", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(202);

    const [, , opts] = mockStrutFetch.mock.calls[0];
    expect(opts.body).toEqual({ input: { gtId: "gt-1", workdir: "gt-gt-1" } });
    expect(opts.body).not.toHaveProperty("callback");
  });

  test("dispatches using the native gtId type from the cached task row (not the string form)", async () => {
    mockFindCachedTaskRow.mockResolvedValue({ row: { gtId: "7013", split: "public" }, nativeGtId: 7013, split: "public" });
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("hive", { gtId: "7013" });
    await POST(req, { params: Promise.resolve({ slug: "hive" }) });
    const [, , opts] = mockStrutFetch.mock.calls[0];
    expect(opts.body.input.gtId).toBe(7013);
  });

  test("a non-OK dispatch response returns 502", async () => {
    mockStrutFetch.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("hive", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(502);
  });
});
