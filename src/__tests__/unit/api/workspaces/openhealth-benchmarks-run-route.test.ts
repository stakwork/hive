/**
 * Unit tests for POST /api/workspaces/[slug]/openhealth/benchmarks/run
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockGetMiddlewareContext = vi.hoisted(() => vi.fn());
const mockValidateWorkspaceAccess = vi.hoisted(() => vi.fn());
const mockGetWorkspaceSwarmAccess = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockResolveStrutActor = vi.hoisted(() => vi.fn());
const mockEnsureStrutDelegation = vi.hoisted(() => vi.fn());
const mockDbTransaction = vi.hoisted(() => vi.fn());
const mockDbStakworkRunUpdate = vi.hoisted(() => vi.fn());
const mockDbStakworkRunDeleteMany = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: mockGetMiddlewareContext,
  requireAuth: mockRequireAuth,
}));

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: mockValidateWorkspaceAccess,
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: mockGetWorkspaceSwarmAccess,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock("@/services/bifrost/strut-delegation", () => ({
  STRUT_ACTOR_HEADER: "x-strut-actor",
  resolveStrutActor: mockResolveStrutActor,
  ensureStrutDelegation: mockEnsureStrutDelegation,
}));

vi.mock("@/lib/db", () => ({
  db: {
    stakworkRun: {
      update: mockDbStakworkRunUpdate,
      deleteMany: mockDbStakworkRunDeleteMany,
    },
    $transaction: mockDbTransaction,
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.stubGlobal("fetch", mockFetch);

const USER_ID = "user-1";
const WORKSPACE_ID = "ws-openhealth";
const RUN_ID = "run-abc";

function makeRequest(slug: string, body: unknown) {
  return new NextRequest(`http://localhost/api/workspaces/${slug}/openhealth/benchmarks/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  task: "patient_diagnosis",
  split: "public",
  gtId: "gt-1",
  patientId: "p-1",
};

function setupHappyPath(opts?: { activeRuns?: unknown[] }) {
  mockGetMiddlewareContext.mockReturnValue({});
  mockRequireAuth.mockReturnValue({ id: USER_ID });
  mockValidateWorkspaceAccess.mockResolvedValue({ canWrite: true, hasAccess: true });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockGetWorkspaceSwarmAccess.mockResolvedValue({
    success: true,
    data: { workspaceId: WORKSPACE_ID, swarmUrl: "https://swarm.example.com/api", swarmApiKey: "swarm-key" },
  });
  mockResolveStrutActor.mockResolvedValue("actor-1");
  mockEnsureStrutDelegation.mockResolvedValue({ status: "fresh" });

  mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    const tx = {
      stakworkRun: {
        findMany: vi.fn().mockResolvedValue(opts?.activeRuns ?? []),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({ id: RUN_ID }),
      },
    };
    return fn(tx);
  });
  mockDbStakworkRunUpdate.mockResolvedValue({});
  mockDbStakworkRunDeleteMany.mockResolvedValue({ count: 1 });

  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ callback: true, runId: "lab-run-1" }),
  });

  process.env.OPENHEALTH_STRUT_WORKFLOW_NAME = "openhealth-run";
  process.env.NEXTAUTH_URL = "https://hive.example.com";
  process.env.NEXTAUTH_SECRET = "a".repeat(32);
}

describe("POST /api/workspaces/[slug]/openhealth/benchmarks/run — slug gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  test("returns 404 for a non-openhealth slug BEFORE any access check", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("openlaw", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "openlaw" }) });
    expect(res.status).toBe(404);
    expect(mockValidateWorkspaceAccess).not.toHaveBeenCalled();
  });

  test("returns 404 (not 403) when the caller cannot write", async () => {
    mockValidateWorkspaceAccess.mockResolvedValue({ canWrite: false, hasAccess: true });
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("openhealth", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "openhealth" }) });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/workspaces/[slug]/openhealth/benchmarks/run — rate limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  test("fails closed with 503 when the limiter throws, before any DB write", async () => {
    mockCheckRateLimit.mockRejectedValue(new Error("redis down"));
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("openhealth", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "openhealth" }) });
    expect(res.status).toBe(503);
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });
});

describe("POST /api/workspaces/[slug]/openhealth/benchmarks/run — body validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  test.each([
    ["ground_truth"],
    ["groundTruth"],
    ["gold"],
    ["problemList"],
  ])("rejects a gold-shaped key (%s) with 400, even if the rest is valid", async (key) => {
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("openhealth", { ...VALID_BODY, [key]: "leak" });
    const res = await POST(req, { params: Promise.resolve({ slug: "openhealth" }) });
    expect(res.status).toBe(400);
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });

  test("rejects split=train with 400", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("openhealth", { ...VALID_BODY, split: "train" });
    const res = await POST(req, { params: Promise.resolve({ slug: "openhealth" }) });
    expect(res.status).toBe(400);
  });

  test("rejects an unknown task with 400", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("openhealth", { ...VALID_BODY, task: "unknown_task" });
    const res = await POST(req, { params: Promise.resolve({ slug: "openhealth" }) });
    expect(res.status).toBe(400);
  });

  test("requires gtId and patientId", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req1 = makeRequest("openhealth", { ...VALID_BODY, gtId: undefined });
    const res1 = await POST(req1, { params: Promise.resolve({ slug: "openhealth" }) });
    expect(res1.status).toBe(400);

    const req2 = makeRequest("openhealth", { ...VALID_BODY, patientId: "" });
    const res2 = await POST(req2, { params: Promise.resolve({ slug: "openhealth" }) });
    expect(res2.status).toBe(400);
  });
});

describe("POST /api/workspaces/[slug]/openhealth/benchmarks/run — single-active-run guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns 409 when a fresh active run exists for the same task+gtId", async () => {
    setupHappyPath({
      activeRuns: [
        {
          id: "existing-run",
          result: JSON.stringify({ task: "patient_diagnosis", gtId: "gt-1" }),
          updatedAt: new Date(),
        },
      ],
    });
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("openhealth", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "openhealth" }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("ACTIVE_RUN_EXISTS");
  });

  test("does not block a different task+gtId even if it sorts first", async () => {
    setupHappyPath({
      activeRuns: [
        {
          id: "existing-run",
          result: JSON.stringify({ task: "patient_diagnosis", gtId: "gt-OTHER" }),
          updatedAt: new Date(),
        },
      ],
    });
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("openhealth", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "openhealth" }) });
    expect(res.status).toBe(201);
  });
});

describe("POST /api/workspaces/[slug]/openhealth/benchmarks/run — dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  test("happy path: creates a row and dispatches with { input, callback } body only", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("openhealth", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "openhealth" }) });
    expect(res.status).toBe(201);

    const [, fetchOpts] = mockFetch.mock.calls[0];
    const sentBody = JSON.parse(fetchOpts.body as string);
    expect(sentBody).toHaveProperty("input");
    expect(sentBody).toHaveProperty("callback");
    expect(sentBody.callback).toHaveProperty("url");
    expect(sentBody.input).not.toHaveProperty("webhookUrl");
    expect(sentBody).not.toHaveProperty("gold");
    expect(sentBody.input).not.toHaveProperty("ground_truth");
  });

  test("a non-OK lab response deletes the pending row", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("openhealth", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "openhealth" }) });
    expect(res.status).toBe(502);
    expect(mockDbStakworkRunDeleteMany).toHaveBeenCalledWith({ where: { id: RUN_ID } });
  });

  test("an accepted launch with callback !== true marks FAILED and does NOT delete", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ callback: false, runId: "lab-run-1" }),
    });
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("openhealth", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "openhealth" }) });
    expect(res.status).toBe(502);
    expect(mockDbStakworkRunDeleteMany).not.toHaveBeenCalled();
    const updateCall = mockDbStakworkRunUpdate.mock.calls.find(
      (c) => c[0].data?.status === "FAILED",
    );
    expect(updateCall).toBeDefined();
  });

  test("a missing runId on an accepted launch also marks FAILED and does not delete", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ callback: true }),
    });
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("openhealth", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "openhealth" }) });
    expect(res.status).toBe(502);
    expect(mockDbStakworkRunDeleteMany).not.toHaveBeenCalled();
  });

  test("returns 503 when strut delegation is unavailable, creating no row", async () => {
    mockEnsureStrutDelegation.mockResolvedValue({ status: "failed" });
    const { POST } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/run/route");
    const req = makeRequest("openhealth", VALID_BODY);
    const res = await POST(req, { params: Promise.resolve({ slug: "openhealth" }) });
    expect(res.status).toBe(503);
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });
});
