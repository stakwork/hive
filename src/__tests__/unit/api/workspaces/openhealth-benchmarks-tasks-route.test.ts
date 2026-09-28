import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockResolveOpenHealthStrut = vi.hoisted(() => vi.fn());
const mockResolveCachedTaskList = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockEnsureStrutDelegation = vi.hoisted(() => vi.fn());
const mockStrutFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/openhealth-benchmarks/strut-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/openhealth-benchmarks/strut-client")>();
  return {
    ...actual,
    resolveOpenHealthStrut: mockResolveOpenHealthStrut,
  };
});

vi.mock("@/lib/openhealth-benchmarks/task-cache", () => ({
  resolveCachedTaskList: mockResolveCachedTaskList,
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

function makeRequest(
  slug: string,
  query = "",
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) {
  return new NextRequest(
    `http://localhost/api/workspaces/${slug}/openhealth/benchmarks/tasks${query}`,
    init as ConstructorParameters<typeof NextRequest>[1],
  );
}

function setupHappyPath() {
  mockResolveOpenHealthStrut.mockResolvedValue({ ok: true, target: TARGET, userId: USER_ID });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockResolveCachedTaskList.mockResolvedValue({
    tasks: [],
    rawTasks: [],
    sourceRunId: null,
    fetchedAt: new Date().toISOString(),
    refreshing: false,
  });
  mockEnsureStrutDelegation.mockResolvedValue({ status: "fresh" });
  mockStrutFetch.mockResolvedValue({ ok: true, json: async () => ({ runId: "1700000000001" }) });
}

describe("GET /api/workspaces/[slug]/openhealth/benchmarks/tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  test("delegates the slug/access/strut gate entirely to resolveOpenHealthStrut", async () => {
    mockResolveOpenHealthStrut.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Not found" }), { status: 404 }),
    });
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("openlaw");
    const res = await GET(req, { params: Promise.resolve({ slug: "openlaw" }) });
    expect(res.status).toBe(404);
  });

  test("fails closed with 503 when the rate limiter throws, before resolving the cache", async () => {
    mockCheckRateLimit.mockRejectedValue(new Error("redis down"));
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("hive");
    const res = await GET(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(503);
    expect(mockResolveCachedTaskList).not.toHaveBeenCalled();
  });

  test("rejects a missing split with 400 — no default, per the split-scoped cache contract", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("hive");
    const res = await GET(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(400);
    expect(mockResolveCachedTaskList).not.toHaveBeenCalled();
  });

  test("accepts split=public explicitly", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("hive", "?split=public");
    const res = await GET(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(200);
    expect(mockResolveCachedTaskList).toHaveBeenCalledWith(TARGET, "public");
  });

  test("rejects split=train with 400", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("hive", "?split=train");
    const res = await GET(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(400);
    expect(mockResolveCachedTaskList).not.toHaveBeenCalled();
  });

  test("returns tasks/sourceRunId/fetchedAt/refreshing from the cache resolver", async () => {
    mockResolveCachedTaskList.mockResolvedValue({
      tasks: [{ gtId: "gt-1", split: "public", difficulty: "easy" }],
      rawTasks: [{ gtId: "gt-1", split: "public", difficulty: "easy" }],
      sourceRunId: "1700000000000",
      fetchedAt: "2026-01-01T00:00:00.000Z",
      refreshing: true,
    });
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("hive", "?split=heldout");
    const res = await GET(req, { params: Promise.resolve({ slug: "hive" }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.tasks).toEqual([{ gtId: "gt-1", split: "public", difficulty: "easy" }]);
    expect(body.sourceRunId).toBe("1700000000000");
    expect(body.refreshing).toBe(true);
    expect(mockResolveCachedTaskList).toHaveBeenCalledWith(TARGET, "heldout");
  });
});

describe("POST /api/workspaces/[slug]/openhealth/benchmarks/tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  function postRequest(slug: string, body: unknown) {
    return makeRequest(slug, "", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  test("rejects a gold-shaped key with 400", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = postRequest("hive", { split: "public", gold: "leak" });
    const res = await POST(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(400);
    expect(mockStrutFetch).not.toHaveBeenCalled();
  });

  test("rejects an invalid split with 400", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = postRequest("hive", { split: "train" });
    const res = await POST(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(400);
  });

  test("returns 503 when delegation is not fresh/pushed, dispatching nothing", async () => {
    mockEnsureStrutDelegation.mockResolvedValue({ status: "failed" });
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = postRequest("hive", { split: "public" });
    const res = await POST(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(503);
    expect(mockStrutFetch).not.toHaveBeenCalled();
  });

  test("happy path dispatches { input: { split } } with no difficulty and returns 202", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = postRequest("hive", { split: "public" });
    const res = await POST(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(202);
    const [, , opts] = mockStrutFetch.mock.calls[0];
    expect(opts.body).toEqual({ input: { split: "public" } });
  });
});
