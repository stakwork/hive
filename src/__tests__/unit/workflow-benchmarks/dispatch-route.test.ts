/**
 * Unit tests for POST /api/workspaces/[slug]/workflow-benchmarks/run
 *
 * Covers:
 *   - Feature gate (isBenchmarkWorkspaceAllowed)
 *   - Authorization (canWrite required; 404 not 403)
 *   - Rate limit (fail-closed: 503 on limiter error)
 *   - Body validation (only taskSlug; unknown slug → 400)
 *   - Single-active-run guard (409 on fresh active; mark-stale + proceed on stale),
 *     via a BOUNDED findMany scan (newest-first, capped) — not findFirst, because
 *     taskSlug lives inside serialized `result` JSON and a single-row findFirst
 *     cannot express "the other task's row sorts first"
 *   - Single-active-run scoped by taskSlug (different taskSlug doesn't block, even
 *     when it sorts ahead of same-task rows)
 *   - Malformed active-run rows: block within the staleness window, ignored past
 *     it, and are NEVER written to (their owning taskSlug is unknown)
 *   - Dispatch payload: BENCHMARK_RUNNER type; no credentials; baseline conditional;
 *     workflow_input_json / rerun_expected_output conditional (both tasks now
 *     declare workflow_input; only generate-capital-city has expected_output)
 *   - Dispatch-boundary log carries inputKeys / hasExpectedOutput
 *   - Env: missing workflow ID → 503
 *   - HMAC secret hardening: missing/short NEXTAUTH_SECRET → 503, never a token
 *     signed with an empty/weak key
 *   - Webhook URL + reportUrl never leaked in response
 *   - rosterUpsert non-fatal
 *
 * NOTE: judge-side (LLM) scoring behavior for any criterion is NOT verifiable
 * in this repo — these tests assert dispatch-route mechanics only.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";
import {
  WORKFLOW_BENCHMARK_TASKS,
  WORKFLOW_INPUT_VAR,
  RERUN_EXPECTED_OUTPUT_VAR,
} from "@/lib/workflow-benchmark-tasks";

/** A secret long enough to pass the dispatch route's MIN_RUN_TOKEN_SECRET_LENGTH gate. */
const VALID_TEST_SECRET = "a".repeat(32);

// ── Stable mock references ────────────────────────────────────────────────────

const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockGetMiddlewareContext = vi.hoisted(() => vi.fn());
const mockValidateWorkspaceAccess = vi.hoisted(() => vi.fn());
const mockGetWorkspaceSwarmAccess = vi.hoisted(() => vi.fn());
const mockGetJarvisConfigForWorkspace = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockEnsureWorkflowBenchmarkEvalNodes = vi.hoisted(() => vi.fn());
const mockDbStakworkRunFindFirst = vi.hoisted(() => vi.fn());
const mockDbStakworkRunCreate = vi.hoisted(() => vi.fn());
const mockDbStakworkRunUpdate = vi.hoisted(() => vi.fn());
const mockDbStakworkRunFindUnique = vi.hoisted(() => vi.fn());
const mockDbStakworkRunDelete = vi.hoisted(() => vi.fn());
const mockDbTransaction = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

// ── Module mocks ──────────────────────────────────────────────────────────────

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

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: mockGetJarvisConfigForWorkspace,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock("@/lib/workflow-benchmarks/eval-nodes", () => ({
  ensureWorkflowBenchmarkEvalNodes: mockEnsureWorkflowBenchmarkEvalNodes,
}));

vi.mock("@/lib/db", () => ({
  db: {
    stakworkRun: {
      findFirst: mockDbStakworkRunFindFirst,
      create: mockDbStakworkRunCreate,
      update: mockDbStakworkRunUpdate,
      findUnique: mockDbStakworkRunFindUnique,
      delete: mockDbStakworkRunDelete,
    },
    $transaction: mockDbTransaction,
  },
}));

vi.mock("@/config/env", () => ({
  optionalEnvVars: {
    STAKWORK_BASE_URL: "https://jobs.stakwork.com/api/v1",
    STAKWORK_API_KEY: "test-api-key",
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock global fetch
vi.stubGlobal("fetch", mockFetch);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(slug: string, body: unknown) {
  const url = `http://localhost/api/workspaces/${slug}/workflow-benchmarks/run`;
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_SLUG = "stakwork";
const TASK_SLUG = "wfbench/create-openai-call";
const USER_ID = "user-123";
const WORKSPACE_ID = "ws-abc";
const RUN_ID = "run-xyz";

function setupHappyPath(opts?: { activeRuns?: unknown[] }) {
  mockGetMiddlewareContext.mockReturnValue({});
  mockRequireAuth.mockReturnValue({ id: USER_ID });
  mockValidateWorkspaceAccess.mockResolvedValue({
    canWrite: true,
    hasAccess: true,
    workspace: { id: WORKSPACE_ID, slug: VALID_SLUG },
  });
  mockGetWorkspaceSwarmAccess.mockResolvedValue({
    success: true,
    data: { workspaceId: WORKSPACE_ID, swarmUrl: "https://swarm.example.com" },
  });
  mockGetJarvisConfigForWorkspace.mockResolvedValue({
    jarvisUrl: "https://jarvis.example.com",
    apiKey: "jarvis-api-key",
  });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockEnsureWorkflowBenchmarkEvalNodes.mockResolvedValue({ evalSetRef: "ref-1", requirementRefs: [] });

  // Transaction: no active runs by default. The route scans via a BOUNDED
  // findMany (newest-first) — not findFirst — because taskSlug lives inside
  // serialized `result` JSON and a single-row findFirst cannot express
  // "the other task's row sorts first".
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

  mockDbStakworkRunFindUnique.mockResolvedValue({ result: JSON.stringify({ taskSlug: TASK_SLUG }) });
  mockDbStakworkRunUpdate.mockResolvedValue({});

  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { project_id: 9999 } }),
  });

  process.env.STAKWORK_WORKFLOW_BENCHMARK_WORKFLOW_ID = "12345";
  process.env.NEXTAUTH_URL = "https://hive.example.com";
  process.env.NEXTAUTH_SECRET = VALID_TEST_SECRET;
}

// ── Feature gate tests ────────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/workflow-benchmarks/run — feature gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMiddlewareContext.mockReturnValue({});
    mockRequireAuth.mockReturnValue({ id: USER_ID });
  });

  it("returns 404 for a non-allowlisted slug", async () => {
    // "openlaw" is not in STAK_TOOLKIT_SLUGS and not dev-mock
    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest("openlaw", { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: "openlaw" }) });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a completely unknown slug", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest("random-workspace", { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: "random-workspace" }) });
    expect(res.status).toBe(404);
  });

  it("allows stakwork slug (in STAK_TOOLKIT_SLUGS)", async () => {
    setupHappyPath();
    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest("stakwork", { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: "stakwork" }) });
    // Should not return 404 from the gate — may return 201 or another code
    expect(res.status).not.toBe(404);
  });
});

// ── Authorization tests ───────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/workflow-benchmarks/run — authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("returns 401 when user is not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mockRequireAuth.mockReturnValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 (not 403) when user lacks canWrite", async () => {
    mockValidateWorkspaceAccess.mockResolvedValue({
      canWrite: false,
      hasAccess: true,
      workspace: { id: WORKSPACE_ID, slug: VALID_SLUG },
    });

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    // Must be 404, NOT 403 — no leaking workspace existence to non-members
    expect(res.status).toBe(404);
  });

  it("returns 404 (not 403) when workspace is not found", async () => {
    mockValidateWorkspaceAccess.mockResolvedValue({
      canWrite: false,
      hasAccess: false,
    });

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(404);
  });

  it("returns 404 when swarm access fails", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "WORKSPACE_NOT_FOUND" },
    });

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(404);
  });
});

// ── Rate limit tests ──────────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/workflow-benchmarks/run — rate limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("returns 429 when rate limit is exceeded", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(429);
  });

  it("returns 503 (not a pass-through) when the rate limiter throws", async () => {
    mockCheckRateLimit.mockRejectedValue(new Error("Redis connection failed"));

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(503);
  });
});

// ── Body validation tests ─────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/workflow-benchmarks/run — body validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("returns 400 for an unknown taskSlug", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: "unknown/task" });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when taskSlug is missing", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, {});
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(400);
  });

  it("ignores client-supplied instructions (server-side corpus used instead)", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, {
      taskSlug: TASK_SLUG,
      instructions: "INJECTED INSTRUCTIONS",
      criteria: [{ id: "evil", title: "evil", match_criteria: "evil" }],
    });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(201);

    // The dispatched payload must use corpus data, not client-supplied values
    const lastFetchCall = mockFetch.mock.calls.find(
      (c: unknown[]) => (c[0] as string)?.includes("projects"),
    );
    if (lastFetchCall) {
      const body = JSON.parse(lastFetchCall[1].body as string);
      const vars = body.workflow_params?.set_var?.attributes?.vars;
      expect(vars?.instructions).not.toBe("INJECTED INSTRUCTIONS");
    }
  });
});

// ── Env var check ─────────────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/workflow-benchmarks/run — env vars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("returns 503 (not 500) when STAKWORK_WORKFLOW_BENCHMARK_WORKFLOW_ID is not set", async () => {
    delete process.env.STAKWORK_WORKFLOW_BENCHMARK_WORKFLOW_ID;

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("STAKWORK_WORKFLOW_BENCHMARK_WORKFLOW_ID");

    process.env.STAKWORK_WORKFLOW_BENCHMARK_WORKFLOW_ID = "12345";
  });
});

// ── Payload invariants ────────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/workflow-benchmarks/run — dispatch payload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("dispatches a BENCHMARK_RUNNER type run (not LEGAL_BENCHMARK_RUNNER)", async () => {
    let createdType: string | undefined;
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        stakworkRun: {
          findMany: vi.fn().mockResolvedValue([]),
          update: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockImplementation(({ data }: { data: { type: string } }) => {
            createdType = data.type;
            return { id: RUN_ID };
          }),
        },
      };
      return fn(tx);
    });

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });

    expect(createdType).toBe(StakworkRunType.BENCHMARK_RUNNER);
    expect(createdType).not.toBe(StakworkRunType.LEGAL_BENCHMARK_RUNNER);
  });

  it("vars object contains no decrypted credentials", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });

    const lastFetchCall = mockFetch.mock.calls.find(
      (c: unknown[]) => (c[0] as string)?.includes("projects"),
    );
    expect(lastFetchCall).toBeDefined();
    const body = JSON.parse(lastFetchCall![1].body as string);
    const vars = body.workflow_params?.set_var?.attributes?.vars ?? {};

    // Must not contain any credential key
    const credentialKeys = [
      "swarm_secret_alias",
      "secret",
      "apiKey",
      "apikey",
      "tokenReference",
      "model",
      "judge_model",
    ];
    for (const key of credentialKeys) {
      expect(Object.prototype.hasOwnProperty.call(vars, key)).toBe(false);
    }
  });

  it("seed task vars do NOT contain baseline keys", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });

    const lastFetchCall = mockFetch.mock.calls.find(
      (c: unknown[]) => (c[0] as string)?.includes("projects"),
    );
    expect(lastFetchCall).toBeDefined();
    const body = JSON.parse(lastFetchCall![1].body as string);
    const vars = body.workflow_params?.set_var?.attributes?.vars ?? {};

    // The seed task has no baseline — neither key may appear, even as null
    expect(Object.prototype.hasOwnProperty.call(vars, "baseline_workflow_id")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(vars, "baseline_workflow_version_id")).toBe(false);
  });

  it("seed task vars contain workflow_input_json (a string, {prompt}) but NO rerun_expected_output (no expected_output declared)", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });

    const lastFetchCall = mockFetch.mock.calls.find(
      (c: unknown[]) => (c[0] as string)?.includes("projects"),
    );
    expect(lastFetchCall).toBeDefined();
    const body = JSON.parse(lastFetchCall![1].body as string);
    const vars = body.workflow_params?.set_var?.attributes?.vars ?? {};

    expect(typeof vars[WORKFLOW_INPUT_VAR]).toBe("string");
    expect(Object.keys(JSON.parse(vars[WORKFLOW_INPUT_VAR]))).toEqual(["prompt"]);

    // An absent field must emit NO key at all — never null/empty.
    expect(Object.prototype.hasOwnProperty.call(vars, RERUN_EXPECTED_OUTPUT_VAR)).toBe(false);
  });

  it("generate-capital-city vars contain workflow_input_json (parses back to the source object) and a RAW (non-JSON-encoded) rerun_expected_output", async () => {
    const capitalCityTask = WORKFLOW_BENCHMARK_TASKS.find(
      (t) => t.slug === "wfbench/generate-capital-city",
    );
    expect(capitalCityTask).toBeDefined();
    expect(capitalCityTask!.workflow_input).toEqual({ country: "Wales" });

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: "wfbench/generate-capital-city" });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(201);

    const lastFetchCall = mockFetch.mock.calls.find(
      (c: unknown[]) => (c[0] as string)?.includes("projects"),
    );
    expect(lastFetchCall).toBeDefined();
    const body = JSON.parse(lastFetchCall![1].body as string);
    const vars = body.workflow_params?.set_var?.attributes?.vars ?? {};

    expect(typeof vars[WORKFLOW_INPUT_VAR]).toBe("string");
    expect(JSON.parse(vars[WORKFLOW_INPUT_VAR])).toEqual({ country: "Wales" });

    // RAW string — never JSON.stringify'd. A double-encoded value would be
    // the string `"Cardiff"` (with literal quote characters), not `Cardiff`.
    expect(vars[RERUN_EXPECTED_OUTPUT_VAR]).toBe("Cardiff");
    expect(vars[RERUN_EXPECTED_OUTPUT_VAR]).not.toBe('"Cardiff"');
  });

  it("vars always present, for EVERY corpus task: task_slug, task_title, instructions, criteria, run_id, webhook_url, graph_base_url", async () => {
    for (const task of WORKFLOW_BENCHMARK_TASKS) {
      mockFetch.mockClear();
      const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
      const req = makeRequest(VALID_SLUG, { taskSlug: task.slug });
      const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
      expect(res.status).toBe(201);

      const lastFetchCall = mockFetch.mock.calls.find(
        (c: unknown[]) => (c[0] as string)?.includes("projects"),
      );
      expect(lastFetchCall).toBeDefined();
      const body = JSON.parse(lastFetchCall![1].body as string);
      const vars = body.workflow_params?.set_var?.attributes?.vars ?? {};

      expect(vars.task_slug).toBe(task.slug);
      expect(typeof vars.task_title).toBe("string");
      expect(typeof vars.instructions).toBe("string");
      expect(typeof vars.criteria).toBe("string");
      expect(typeof vars.run_id).toBe("string");
      expect(typeof vars.webhook_url).toBe("string");
      expect(typeof vars.graph_base_url).toBe("string");
    }
  });

  it("response body contains run_id but NOT webhookUrl or reportUrl", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.run_id).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(body, "webhookUrl")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, "reportUrl")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, "webhook_url")).toBe(false);
  });
});

describe("POST /api/workspaces/[slug]/workflow-benchmarks/run — hive-namespaced roster observability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("persists rosterUpsertOutcome and criteriaFingerprint under a `hive` key in the final result write", async () => {
    let finalUpdateData: Record<string, unknown> | undefined;
    mockDbStakworkRunUpdate.mockImplementation((args: { data: Record<string, unknown> }) => {
      if (args.data && Object.prototype.hasOwnProperty.call(args.data, "status")) {
        finalUpdateData = args.data;
      }
      return {};
    });

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(201);

    expect(finalUpdateData).toBeDefined();
    const result = JSON.parse(finalUpdateData!.result as string) as Record<string, unknown>;
    expect(result.hive).toBeDefined();
    const hive = result.hive as Record<string, unknown>;
    expect(hive.rosterUpsertOutcome).toBe("ok");
    expect(typeof hive.criteriaFingerprint).toBe("string");
  });

  it("a runner-supplied bare `rosterUpsertOutcome` field on the run row cannot clobber the hive-namespaced one", async () => {
    // Simulate a pre-existing result blob (e.g. from a prior partial write)
    // carrying a bare top-level field of the same name as a Correction 6 sanity check.
    mockDbStakworkRunFindUnique.mockResolvedValue({
      result: JSON.stringify({ taskSlug: TASK_SLUG, rosterUpsertOutcome: "should-not-leak-here" }),
    });

    let finalUpdateData: Record<string, unknown> | undefined;
    mockDbStakworkRunUpdate.mockImplementation((args: { data: Record<string, unknown> }) => {
      if (args.data && Object.prototype.hasOwnProperty.call(args.data, "status")) {
        finalUpdateData = args.data;
      }
      return {};
    });

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });

    const result = JSON.parse(finalUpdateData!.result as string) as Record<string, unknown>;
    // The namespaced value must be the route's own computed outcome, not the
    // pre-existing bare field.
    expect((result.hive as Record<string, unknown>).rosterUpsertOutcome).toBe("ok");
  });
});

// ── Dispatch-boundary log fields ──────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/workflow-benchmarks/run — dispatch log fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("logs inputKeys=['prompt'] and hasExpectedOutput=false for the seed task", async () => {
    const { logger } = await import("@/lib/logger");
    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });

    const infoCalls = (logger.info as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const dispatchCall = infoCalls.find((c) => String(c[0]).includes("dispatching task="));
    expect(dispatchCall).toBeDefined();
    const metadata = dispatchCall![2] as Record<string, unknown>;
    expect(metadata.inputKeys).toEqual(["prompt"]);
    expect(metadata.hasExpectedOutput).toBe(false);
  });

  it("logs inputKeys=['country'] and hasExpectedOutput=true for generate-capital-city", async () => {
    const { logger } = await import("@/lib/logger");
    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: "wfbench/generate-capital-city" });
    await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });

    const infoCalls = (logger.info as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const dispatchCall = infoCalls.find((c) => String(c[0]).includes("dispatching task="));
    expect(dispatchCall).toBeDefined();
    const metadata = dispatchCall![2] as Record<string, unknown>;
    expect(metadata.inputKeys).toEqual(["country"]);
    expect(metadata.hasExpectedOutput).toBe(true);
  });
});

// ── HMAC secret hardening ─────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/workflow-benchmarks/run — run_token secret hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("returns 503 when NEXTAUTH_SECRET is unset", async () => {
    delete process.env.NEXTAUTH_SECRET;

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(503);

    process.env.NEXTAUTH_SECRET = VALID_TEST_SECRET;
  });

  it("returns 503 when NEXTAUTH_SECRET is shorter than the minimum length", async () => {
    process.env.NEXTAUTH_SECRET = "too-short";

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(503);

    process.env.NEXTAUTH_SECRET = VALID_TEST_SECRET;
  });

  it("does not create a run row when the secret is missing (never signs with an empty key)", async () => {
    delete process.env.NEXTAUTH_SECRET;

    let createCalled = false;
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        stakworkRun: {
          findMany: vi.fn().mockResolvedValue([]),
          update: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockImplementation(() => {
            createCalled = true;
            return { id: RUN_ID };
          }),
        },
      };
      return fn(tx);
    });

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });

    expect(createCalled).toBe(false);

    process.env.NEXTAUTH_SECRET = VALID_TEST_SECRET;
  });
});

// ── Single-active-run guard ───────────────────────────────────────────────────
//
// The guard scans via a BOUNDED findMany (newest-first, capped at
// ACTIVE_RUN_SCAN_LIMIT) rather than findFirst, because taskSlug lives inside
// serialized `result` JSON and cannot be filtered in SQL. A single-row
// findFirst mock cannot express "the other task's row sorts first" — the
// actual defect this rewrite fixes — so every case here uses findMany.

describe("POST /api/workspaces/[slug]/workflow-benchmarks/run — active run guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("returns 409 when an active run for the same taskSlug already exists", async () => {
    const now = new Date();
    const freshRun = {
      id: "existing-run",
      result: JSON.stringify({ taskSlug: TASK_SLUG }),
      updatedAt: now, // fresh — not stale
    };

    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        stakworkRun: {
          findMany: vi.fn().mockResolvedValue([freshRun]),
          update: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockResolvedValue({ id: RUN_ID }),
        },
      };
      return fn(tx);
    });

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(409);
  });

  it("does NOT block when an active run exists for a DIFFERENT taskSlug, even when it sorts FIRST (newest)", async () => {
    // The other-task row is placed first in the returned array — a
    // single-row findFirst mock structurally cannot express this ordering,
    // which is exactly the defect the findMany rewrite fixes: a naive
    // "take the first row" guard would wrongly treat this as a non-match
    // and fall through correctly here, but would wrongly treat a
    // same-task row sorting second as invisible in the old implementation.
    const otherTaskRun = {
      id: "other-run",
      result: JSON.stringify({ taskSlug: "wfbench/other-task" }), // different slug
      updatedAt: new Date(),
    };

    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        stakworkRun: {
          findMany: vi.fn().mockResolvedValue([otherTaskRun]),
          update: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockResolvedValue({ id: RUN_ID }),
        },
      };
      return fn(tx);
    });

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    // Should proceed (201) not block (409)
    expect(res.status).toBe(201);
  });

  it("blocks on a same-task active run even when a different-task row sorts ahead of it", async () => {
    const otherTaskRun = {
      id: "other-run",
      result: JSON.stringify({ taskSlug: "wfbench/other-task" }),
      updatedAt: new Date(),
    };
    const sameTaskRun = {
      id: "same-task-run",
      result: JSON.stringify({ taskSlug: TASK_SLUG }),
      updatedAt: new Date(Date.now() - 1000), // slightly older, still fresh
    };

    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        stakworkRun: {
          // other-task row sorts first (newer) — a findFirst-based guard
          // would have returned only this row and missed the collision.
          findMany: vi.fn().mockResolvedValue([otherTaskRun, sameTaskRun]),
          update: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockResolvedValue({ id: RUN_ID }),
        },
      };
      return fn(tx);
    });

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(409);
  });

  it("marks a stale run FAILED and proceeds to create a new one", async () => {
    const staleDate = new Date(Date.now() - 31 * 60 * 1000); // 31 minutes ago
    const staleRun = {
      id: "stale-run",
      result: JSON.stringify({ taskSlug: TASK_SLUG }),
      updatedAt: staleDate,
    };

    let stalledRunMarkedFailed = false;
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        stakworkRun: {
          findMany: vi.fn().mockResolvedValue([staleRun]),
          update: vi.fn().mockImplementation(() => {
            stalledRunMarkedFailed = true;
            return {};
          }),
          create: vi.fn().mockResolvedValue({ id: RUN_ID }),
        },
      };
      return fn(tx);
    });

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });

    expect(stalledRunMarkedFailed).toBe(true);
    expect(res.status).toBe(201);
  });

  it("a malformed active run row (unparseable result JSON) BLOCKS within the staleness window", async () => {
    const malformedRun = {
      id: "malformed-run",
      result: "{not valid json",
      updatedAt: new Date(), // fresh
    };

    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        stakworkRun: {
          findMany: vi.fn().mockResolvedValue([malformedRun]),
          update: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockResolvedValue({ id: RUN_ID }),
        },
      };
      return fn(tx);
    });

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(409);
  });

  it("a malformed active run row past the staleness window is IGNORED (does not block)", async () => {
    const staleMalformedRun = {
      id: "malformed-stale-run",
      result: "{not valid json",
      updatedAt: new Date(Date.now() - 31 * 60 * 1000), // 31 minutes ago — stale
    };

    const updateSpy = vi.fn().mockResolvedValue({});
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        stakworkRun: {
          findMany: vi.fn().mockResolvedValue([staleMalformedRun]),
          update: updateSpy,
          create: vi.fn().mockResolvedValue({ id: RUN_ID }),
        },
      };
      return fn(tx);
    });

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(201);
  });

  it("a malformed active run row is NEVER written to (not stale-marked), even past staleness", async () => {
    const staleMalformedRun = {
      id: "malformed-stale-run",
      result: "{not valid json",
      updatedAt: new Date(Date.now() - 31 * 60 * 1000),
    };

    const updateCalls: unknown[] = [];
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        stakworkRun: {
          findMany: vi.fn().mockResolvedValue([staleMalformedRun]),
          update: vi.fn().mockImplementation((args: unknown) => {
            updateCalls.push(args);
            return {};
          }),
          create: vi.fn().mockResolvedValue({ id: RUN_ID }),
        },
      };
      return fn(tx);
    });

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });

    // The malformed row's id must never appear as an update target within
    // the transaction — its owning taskSlug is unknown, so writing to it
    // could let a dispatch for task A mutate task B's run row.
    const wroteToMalformedRow = updateCalls.some(
      (call) => (call as { where?: { id?: string } })?.where?.id === "malformed-stale-run",
    );
    expect(wroteToMalformedRow).toBe(false);
  });
});

// ── Stakwork dispatch failure ─────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/workflow-benchmarks/run — dispatch failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("returns 502 and cleans up the run row on Stakwork dispatch failure", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    let deletedId: string | undefined;
    mockDbStakworkRunDelete.mockImplementation(({ where }: { where: { id: string } }) => {
      deletedId = where.id;
      return {};
    });

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(502);
    expect(deletedId).toBe(RUN_ID);
  });
});

// ── runner toggle: strut ──────────────────────────────────────────────────────
// ADDITIVE: an absent `runner` is stakwork (every test above). `runner: "strut"`
// sends the same task to the workspace swarm's strut lab (stakgraph :3355,
// `wfbench-run`) instead of creating a Stakwork project.

describe("POST /api/workspaces/[slug]/workflow-benchmarks/run — runner=strut", () => {
  const SWARM_KEY = "swarm-api-key";
  const STRUT_RUN_ID = "1788554443025";

  function setupStrut() {
    setupHappyPath();
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: true,
      data: {
        workspaceId: WORKSPACE_ID,
        swarmUrl: "https://swarm.example.com/api",
        swarmApiKey: SWARM_KEY,
        swarmName: "swarm",
      },
    });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ runId: STRUT_RUN_ID }) });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupStrut();
  });

  it("rejects an unknown runner with 400 before any DB write", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG, runner: "stakworkk" });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(400);
    expect(mockDbTransaction).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("dispatches to the swarm's strut lab with the swarm API key, never to Stakwork", async () => {
    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG, runner: "strut" });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ run_id: RUN_ID, runner: "strut" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://swarm.example.com:3355/lab/workflows/wfbench-run/run");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-token"]).toBe(SWARM_KEY);
    expect(JSON.stringify(init)).not.toContain("jobs.stakwork.com");

    const body = JSON.parse(init.body as string);
    const input = body.input;
    expect(input.task_slug).toBe(TASK_SLUG);
    expect(typeof input.task_title).toBe("string");
    expect(typeof input.instructions).toBe("string");
    expect(Array.isArray(input.criteria)).toBe(true);
    expect(input.criteria.length).toBeGreaterThan(0);
    expect(input.workflow_input_json).toEqual({ prompt: expect.any(String) });
    expect(input.webhook_url).toContain(`run_id=${RUN_ID}`);
    expect(input.webhook_url).toContain("run_token=");
    // No credentials ride along.
    expect(JSON.stringify(body)).not.toContain(SWARM_KEY);
    expect(JSON.stringify(body)).not.toContain("jarvis-api-key");
  });

  it("does not require STAKWORK_WORKFLOW_BENCHMARK_WORKFLOW_ID for a strut run", async () => {
    delete process.env.STAKWORK_WORKFLOW_BENCHMARK_WORKFLOW_ID;
    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG, runner: "strut" });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(201);
  });

  it("stores runner + strut run id/url on the row and leaves projectId null", async () => {
    let createdResult: Record<string, unknown> = {};
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        stakworkRun: {
          findMany: vi.fn().mockResolvedValue([]),
          update: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockImplementation(({ data }: { data: { result: string } }) => {
            createdResult = JSON.parse(data.result);
            return { id: RUN_ID };
          }),
        },
      };
      return fn(tx);
    });
    let updateData: { projectId?: number | null; result?: string } | undefined;
    mockDbStakworkRunUpdate.mockImplementation(({ data }: { data: typeof updateData }) => {
      if (data && "result" in data) updateData = data;
      return {};
    });

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG, runner: "strut" });
    await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });

    // The initial row already says strut (visible mid-flight in the history).
    expect(createdResult.runner).toBe("strut");
    expect(updateData).toBeDefined();
    expect(updateData!.projectId).toBeNull();
    const merged = JSON.parse(updateData!.result!);
    expect(merged.runner).toBe("strut");
    expect(merged.strutRunId).toBe(STRUT_RUN_ID);
    expect(merged.strutRunUrl).toBe(
      `https://swarm.example.com:3355/lab/?wf=wfbench-run&run=${STRUT_RUN_ID}`,
    );
    expect(merged.projectId).toBeUndefined();
  });

  it("a stakwork run (no runner) writes no runner marker — existing rows unchanged", async () => {
    setupHappyPath();
    let createdResult: Record<string, unknown> = {};
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        stakworkRun: {
          findMany: vi.fn().mockResolvedValue([]),
          update: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockImplementation(({ data }: { data: { result: string } }) => {
            createdResult = JSON.parse(data.result);
            return { id: RUN_ID };
          }),
        },
      };
      return fn(tx);
    });
    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ run_id: RUN_ID, runner: "stakwork" });
    expect("runner" in createdResult).toBe(false);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("/projects");
  });

  it("returns 503 when the swarm has no API key, before any DB write", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: true,
      data: { workspaceId: WORKSPACE_ID, swarmUrl: "https://swarm.example.com/api" },
    });
    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG, runner: "strut" });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(503);
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });

  it("returns 502 and cleans up the run row on strut dispatch failure", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    let deletedId: string | undefined;
    mockDbStakworkRunDelete.mockImplementation(({ where }: { where: { id: string } }) => {
      deletedId = where.id;
      return {};
    });
    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG, runner: "strut" });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(res.status).toBe(502);
    expect(deletedId).toBe(RUN_ID);
  });
});

// ── Roster upsert non-fatal ───────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/workflow-benchmarks/run — roster upsert non-fatal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  it("proceeds with 201 even when ensureWorkflowBenchmarkEvalNodes throws", async () => {
    mockEnsureWorkflowBenchmarkEvalNodes.mockRejectedValue(new Error("Graph unavailable"));

    const { POST } = await import("@/app/api/workspaces/[slug]/workflow-benchmarks/run/route");
    const req = makeRequest(VALID_SLUG, { taskSlug: TASK_SLUG });
    const res = await POST(req, { params: Promise.resolve({ slug: VALID_SLUG }) });
    // Non-fatal: the run should still succeed
    expect(res.status).toBe(201);
  });
});
