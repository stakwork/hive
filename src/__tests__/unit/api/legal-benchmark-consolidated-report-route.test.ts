/**
 * Unit tests for POST /api/workspaces/[slug]/legal/benchmarks/consolidated-report
 *
 * Test cases:
 *  1. Returns 404 for non-openlaw slug
 *  2. Returns 400 for invalid taskSlug
 *  3. Returns 400 for empty runIds array
 *  4. Returns 400 when runIds exceeds 50
 *  5. Returns 400 when any runId is not a string
 *  6. Returns 429 when rate limit exceeded
 *  7. Returns 400 when runIds belong to different workspace (IDOR guard)
 *  8. Returns 400 when any run has mismatched taskSlug
 *  9. Returns 409 when a CONSOLIDATED run is already in-flight
 * 10. Returns 500 when STAKWORK_HARVEY_CONSOLIDATED_REPORT_WORKFLOW_ID not set
 * 11. Returns 502 when Stakwork dispatch fails (row cleaned up)
 * 12. Returns 201 with run_id on success; run_ids_json is canonically sorted
 * 13. run_token HMAC is present in webhook_url
 * 14. bundle_token HMAC is present in workflow vars
 */

// @vitest-environment node

import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Stable mock references (hoisted) ────────────────────────────────────────

const mockDbFindMany = vi.hoisted(() => vi.fn());
const mockDbFindFirst = vi.hoisted(() => vi.fn());
const mockDbCreate = vi.hoisted(() => vi.fn());
const mockDbUpdate = vi.hoisted(() => vi.fn());
const mockDbDeleteMany = vi.hoisted(() => vi.fn());
const mockDbTransaction = vi.hoisted(() => vi.fn());
const mockRateLimit = vi.hoisted(() => vi.fn());
const mockGetJarvisConfig = vi.hoisted(() => vi.fn());
const mockSwarmAccess = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    stakworkRun: {
      findMany: mockDbFindMany,
      findFirst: mockDbFindFirst,
      create: mockDbCreate,
      update: mockDbUpdate,
      deleteMany: mockDbDeleteMany,
    },
    $transaction: mockDbTransaction,
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockRateLimit,
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({ userId: "user-1" })),
  requireAuth: vi.fn(() => ({ id: "user-1" })),
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: mockSwarmAccess,
}));

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: mockGetJarvisConfig,
}));

vi.mock("@/config/env", () => ({
  optionalEnvVars: {
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    STAKWORK_API_KEY: "test-key",
  },
}));

vi.mock("@/lib/vercel/stakwork-token", () => ({
  getStakworkTokenReference: () => "HIVE_STAGING",
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

global.fetch = mockFetch;

// ─── Subject under test ───────────────────────────────────────────────────────

import { POST } from "@/app/api/workspaces/[slug]/legal/benchmarks/consolidated-report/route";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-consolidated-1";
const TASK_SLUG = "corporate/merger-reps";
const RUN_IDS = ["run-aaa-111", "run-bbb-222", "run-ccc-333"];

const MOCK_SWARM_ACCESS = {
  success: true,
  data: { workspaceId: WORKSPACE_ID, swarmName: "test-swarm", swarmUrl: "https://swarm.test" },
};

function makeRuns(taskSlug = TASK_SLUG) {
  return RUN_IDS.map((id) => ({
    id,
    result: JSON.stringify({ taskSlug }),
  }));
}

function makeRequest(body: unknown, slug = "openlaw") {
  return new NextRequest(`http://localhost/api/workspaces/${slug}/legal/benchmarks/consolidated-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(slug = "openlaw") {
  return { params: Promise.resolve({ slug }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSwarmAccess.mockResolvedValue(MOCK_SWARM_ACCESS);
  mockRateLimit.mockResolvedValue({ allowed: true });
  mockDbFindMany.mockResolvedValue(makeRuns());
  mockGetJarvisConfig.mockResolvedValue({ jarvisUrl: "https://jarvis.test", apiKey: "api-key" });

  // Default: no in-flight run
  mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      stakworkRun: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "consolidated-run-1" }),
      },
    };
    return fn(tx);
  });

  mockDbUpdate.mockResolvedValue({ id: "consolidated-run-1" });

  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data: { project_id: 9001 } }),
  });

  process.env.STAKWORK_HARVEY_CONSOLIDATED_REPORT_WORKFLOW_ID = "58345";
  process.env.INTERNAL_BUNDLE_API_SECRET = "test-bundle-secret";
  process.env.NEXTAUTH_SECRET = "test-nextauth-secret";
  process.env.NEXTAUTH_URL = "http://localhost:3000";
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/legal/benchmarks/consolidated-report", () => {
  test("1 — returns 404 for non-openlaw slug", async () => {
    const res = await POST(
      makeRequest({ taskSlug: TASK_SLUG, runIds: RUN_IDS }, "other-workspace"),
      makeParams("other-workspace"),
    );
    expect(res.status).toBe(404);
  });

  test("2 — returns 400 for invalid taskSlug", async () => {
    const res = await POST(
      makeRequest({ taskSlug: "../../etc/passwd", runIds: RUN_IDS }),
      makeParams(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/taskSlug/i);
  });

  test("3 — returns 400 for empty runIds array", async () => {
    const res = await POST(
      makeRequest({ taskSlug: TASK_SLUG, runIds: [] }),
      makeParams(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/runIds/i);
  });

  test("4 — returns 400 when runIds exceeds 50", async () => {
    const bigList = Array.from({ length: 51 }, (_, i) => `run-${i}`);
    const res = await POST(
      makeRequest({ taskSlug: TASK_SLUG, runIds: bigList }),
      makeParams(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/50/);
  });

  test("5 — returns 400 when any runId is not a string", async () => {
    const res = await POST(
      makeRequest({ taskSlug: TASK_SLUG, runIds: ["valid-id", 42, null] }),
      makeParams(),
    );
    expect(res.status).toBe(400);
  });

  test("6 — returns 429 when rate limit exceeded", async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });
    const res = await POST(
      makeRequest({ taskSlug: TASK_SLUG, runIds: RUN_IDS }),
      makeParams(),
    );
    expect(res.status).toBe(429);
  });

  test("7 — returns 400 when runIds belong to different workspace (IDOR)", async () => {
    // findMany returns fewer rows than requested — some runs don't belong to this workspace
    mockDbFindMany.mockResolvedValue(makeRuns().slice(0, 2));
    const res = await POST(
      makeRequest({ taskSlug: TASK_SLUG, runIds: RUN_IDS }),
      makeParams(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid|workspace/i);
  });

  test("8 — returns 400 when any run has mismatched taskSlug", async () => {
    mockDbFindMany.mockResolvedValue([
      ...makeRuns().slice(0, 2),
      { id: RUN_IDS[2], result: JSON.stringify({ taskSlug: "completely/different-task" }) },
    ]);
    const res = await POST(
      makeRequest({ taskSlug: TASK_SLUG, runIds: RUN_IDS }),
      makeParams(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/different task/i);
  });

  test("9 — returns 409 when a CONSOLIDATED run is already in-flight", async () => {
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        stakworkRun: {
          findFirst: vi.fn().mockResolvedValue({ id: "existing-run" }),
          create: vi.fn(),
        },
      };
      try {
        return await fn(tx);
      } catch (err) {
        throw err;
      }
    });
    const res = await POST(
      makeRequest({ taskSlug: TASK_SLUG, runIds: RUN_IDS }),
      makeParams(),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already in progress/i);
  });

  test("10 — returns 500 when STAKWORK_HARVEY_CONSOLIDATED_REPORT_WORKFLOW_ID not set", async () => {
    delete process.env.STAKWORK_HARVEY_CONSOLIDATED_REPORT_WORKFLOW_ID;
    const res = await POST(
      makeRequest({ taskSlug: TASK_SLUG, runIds: RUN_IDS }),
      makeParams(),
    );
    expect(res.status).toBe(500);
  });

  test("11 — returns 502 when Stakwork dispatch fails; row cleaned up", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });
    const res = await POST(
      makeRequest({ taskSlug: TASK_SLUG, runIds: RUN_IDS }),
      makeParams(),
    );
    expect(res.status).toBe(502);
    expect(mockDbDeleteMany).toHaveBeenCalled();
  });

  test("12 — returns 201 with run_id; run_ids_json is canonically sorted", async () => {
    let capturedVars: Record<string, unknown> = {};
    mockFetch.mockImplementation(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string);
      capturedVars = body.workflow_params.set_var.attributes.vars;
      return { ok: true, json: () => Promise.resolve({ data: { project_id: 9001 } }) };
    });

    // Pass runIds in non-sorted order
    const unsortedRunIds = ["run-ccc-333", "run-aaa-111", "run-bbb-222"];
    const res = await POST(
      makeRequest({ taskSlug: TASK_SLUG, runIds: unsortedRunIds }),
      makeParams(),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("run_id");

    // run_ids_json must be canonically sorted
    const parsedIds = JSON.parse(capturedVars.run_ids_json as string);
    expect(parsedIds).toEqual([...unsortedRunIds].sort());
  });

  test("13 — run_token HMAC is present in webhook_url", async () => {
    let capturedVars: Record<string, unknown> = {};
    mockFetch.mockImplementation(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string);
      capturedVars = body.workflow_params.set_var.attributes.vars;
      return { ok: true, json: () => Promise.resolve({ data: { project_id: 9001 } }) };
    });

    await POST(makeRequest({ taskSlug: TASK_SLUG, runIds: RUN_IDS }), makeParams());

    expect(typeof capturedVars.webhook_url).toBe("string");
    expect(capturedVars.webhook_url as string).toMatch(/run_token=[0-9a-f]{64}/);
  });

  test("14 — bundle_token HMAC is present in workflow vars", async () => {
    let capturedVars: Record<string, unknown> = {};
    mockFetch.mockImplementation(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string);
      capturedVars = body.workflow_params.set_var.attributes.vars;
      return { ok: true, json: () => Promise.resolve({ data: { project_id: 9001 } }) };
    });

    await POST(makeRequest({ taskSlug: TASK_SLUG, runIds: RUN_IDS }), makeParams());

    expect(typeof capturedVars.bundle_token).toBe("string");
    // Should be a 64-char hex HMAC-SHA256
    expect(capturedVars.bundle_token as string).toMatch(/^[0-9a-f]{64}$/);
  });
});
