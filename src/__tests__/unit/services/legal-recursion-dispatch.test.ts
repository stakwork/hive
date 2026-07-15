/**
 * Unit tests for dispatchLegalBenchmarkRecursionRun.
 *
 * Uses vi.stubGlobal("fetch", ...) for Stakwork HTTP mock.
 * Mocks @/config/env so optionalEnvVars can be controlled per-test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockOptionalEnvVars = vi.hoisted(() => ({
  STAKWORK_HARVEY_RECURSION_WORKFLOW_ID: "57456",
  STAKWORK_BASE_URL: "https://jobs.stakwork.com/api/v1",
  STAKWORK_API_KEY: "stakwork-api-key",
  STAKWORK_HARVEY_EVAL_WORKFLOW_ID: "99999",
}));

vi.mock("@/config/env", () => ({
  optionalEnvVars: mockOptionalEnvVars,
  config: {},
  isBifrostEnabledForWorkspace: vi.fn().mockReturnValue(false),
  isBifrostEnabledForAgent: vi.fn().mockReturnValue(false),
}));

const mockDbStakworkRunCreate = vi.hoisted(() => vi.fn());
const mockDbStakworkRunUpdate = vi.hoisted(() => vi.fn());
const mockDbStakworkRunDeleteMany = vi.hoisted(() => vi.fn());
const mockDbStakworkRunFindUnique = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    stakworkRun: {
      create: mockDbStakworkRunCreate,
      update: mockDbStakworkRunUpdate,
      deleteMany: mockDbStakworkRunDeleteMany,
      findUnique: mockDbStakworkRunFindUnique,
    },
  },
}));

vi.mock("@/lib/vercel/stakwork-token", () => ({
  getStakworkTokenReference: () => "HIVE_STAGING",
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { dispatchLegalBenchmarkRecursionRun } from "@/services/legal-benchmark-eval";

// ── Helpers ───────────────────────────────────────────────────────────────────

const RECURSION_RUN_ID = "recursion-run-abc123";

function makeSuccessfulFetch(projectId = 99999) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data: { project_id: projectId } }),
  });
}

function makeFailedFetch(status = 500) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({ error: "Internal Server Error" }),
  });
}

const originalEnv = { ...process.env };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("dispatchLegalBenchmarkRecursionRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset optionalEnvVars to defaults
    mockOptionalEnvVars.STAKWORK_HARVEY_RECURSION_WORKFLOW_ID = "57456";
    mockOptionalEnvVars.STAKWORK_BASE_URL = "https://jobs.stakwork.com/api/v1";
    mockOptionalEnvVars.STAKWORK_API_KEY = "stakwork-api-key";

    // Set process.env
    process.env.API_TOKEN = "test-hive-api-token";
    process.env.NEXTAUTH_URL = "https://hive.example.com";
    process.env.NEXTAUTH_SECRET = "test-secret";

    // Default DB mocks
    mockDbStakworkRunCreate.mockResolvedValue({ id: RECURSION_RUN_ID });
    mockDbStakworkRunUpdate.mockResolvedValue({ id: RECURSION_RUN_ID });
    mockDbStakworkRunFindUnique.mockResolvedValue({
      result: JSON.stringify({ recursionId: "entry-1", sourceRunId: "run-1" }),
    });
    mockDbStakworkRunDeleteMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    // Restore process.env
    process.env.API_TOKEN = originalEnv.API_TOKEN;
    process.env.NEXTAUTH_URL = originalEnv.NEXTAUTH_URL;
    process.env.NEXTAUTH_SECRET = originalEnv.NEXTAUTH_SECRET;
    vi.unstubAllGlobals();
  });

  // ── Test 1: Correct payload ─────────────────────────────────────────────────

  it("builds payload with all 6 required vars and the correct workflow_id", async () => {
    const mockFetch = makeSuccessfulFetch(57456);
    vi.stubGlobal("fetch", mockFetch);

    await dispatchLegalBenchmarkRecursionRun({
      runId: "source-run-id-1",
      taskSlug: "contracts/review-nda",
      workspaceId: "ws-openlaw-1",
      recursionId: "entry-abc",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/projects"),
      expect.objectContaining({
        method: "POST",
        body: expect.any(String),
      }),
    );

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      workflow_id: number;
      workflow_params: {
        set_var: {
          attributes: {
            vars: Record<string, unknown>;
          };
        };
      };
    };

    expect(callBody.workflow_id).toBe(57456);

    const vars = callBody.workflow_params.set_var.attributes.vars;
    expect(vars.source_run_id).toBe("source-run-id-1");
    expect(vars.task_slug).toBe("contracts/review-nda");
    expect(vars.workspace_id).toBe("ws-openlaw-1");
    expect(vars.recursion_id).toBe("entry-abc");
    expect(vars.hive_base_url).toBe("https://hive.example.com");
    expect(vars.hive_api_token).toBe("test-hive-api-token");
  });

  it("returns { recursionRunId } matching the created StakworkRun row", async () => {
    vi.stubGlobal("fetch", makeSuccessfulFetch());

    const result = await dispatchLegalBenchmarkRecursionRun({
      runId: "source-run-id-1",
      taskSlug: "contracts/review-nda",
      workspaceId: "ws-openlaw-1",
      recursionId: "entry-abc",
    });

    expect(result).toEqual({ recursionRunId: RECURSION_RUN_ID });
  });

  // ── Test 2: Missing STAKWORK_HARVEY_RECURSION_WORKFLOW_ID ───────────────────

  it("throws RECURSION_WORKFLOW_NOT_CONFIGURED when env var is missing", async () => {
    (mockOptionalEnvVars as Record<string, unknown>).STAKWORK_HARVEY_RECURSION_WORKFLOW_ID = undefined;

    await expect(
      dispatchLegalBenchmarkRecursionRun({
        runId: "run-1",
        taskSlug: "contracts/review-nda",
        workspaceId: "ws-1",
        recursionId: "entry-1",
      }),
    ).rejects.toThrow("RECURSION_WORKFLOW_NOT_CONFIGURED");
  });

  it("throws RECURSION_WORKFLOW_NOT_CONFIGURED when env var is empty string", async () => {
    mockOptionalEnvVars.STAKWORK_HARVEY_RECURSION_WORKFLOW_ID = "";

    await expect(
      dispatchLegalBenchmarkRecursionRun({
        runId: "run-1",
        taskSlug: "contracts/review-nda",
        workspaceId: "ws-1",
        recursionId: "entry-1",
      }),
    ).rejects.toThrow("RECURSION_WORKFLOW_NOT_CONFIGURED");
  });

  // ── Test 3: Missing API_TOKEN ────────────────────────────────────────────────

  it("throws HIVE_API_TOKEN_NOT_CONFIGURED when API_TOKEN is missing", async () => {
    delete process.env.API_TOKEN;

    await expect(
      dispatchLegalBenchmarkRecursionRun({
        runId: "run-1",
        taskSlug: "contracts/review-nda",
        workspaceId: "ws-1",
        recursionId: "entry-1",
      }),
    ).rejects.toThrow("HIVE_API_TOKEN_NOT_CONFIGURED");
  });

  it("throws HIVE_API_TOKEN_NOT_CONFIGURED when API_TOKEN is empty string", async () => {
    process.env.API_TOKEN = "";

    await expect(
      dispatchLegalBenchmarkRecursionRun({
        runId: "run-1",
        taskSlug: "contracts/review-nda",
        workspaceId: "ws-1",
        recursionId: "entry-1",
      }),
    ).rejects.toThrow("HIVE_API_TOKEN_NOT_CONFIGURED");
  });

  // ── Test 4: Invalid taskSlug ────────────────────────────────────────────────

  it("throws INVALID_TASK_SLUG for path traversal attempt", async () => {
    await expect(
      dispatchLegalBenchmarkRecursionRun({
        runId: "run-1",
        taskSlug: "../../etc/passwd",
        workspaceId: "ws-1",
        recursionId: "entry-1",
      }),
    ).rejects.toThrow("INVALID_TASK_SLUG");
  });

  it("throws INVALID_TASK_SLUG for slug with spaces", async () => {
    await expect(
      dispatchLegalBenchmarkRecursionRun({
        runId: "run-1",
        taskSlug: "contracts review nda",
        workspaceId: "ws-1",
        recursionId: "entry-1",
      }),
    ).rejects.toThrow("INVALID_TASK_SLUG");
  });

  it("accepts valid slugs with letters, digits, hyphens, underscores, and slashes", async () => {
    vi.stubGlobal("fetch", makeSuccessfulFetch());

    const result = await dispatchLegalBenchmarkRecursionRun({
      runId: "run-1",
      taskSlug: "contracts/review-nda_v2/task01",
      workspaceId: "ws-1",
      recursionId: "entry-1",
    });

    expect(result.recursionRunId).toBe(RECURSION_RUN_ID);
  });

  // ── Rollback on failure ─────────────────────────────────────────────────────

  it("rolls back the StakworkRun row when Stakwork returns non-OK", async () => {
    vi.stubGlobal("fetch", makeFailedFetch(500));

    await expect(
      dispatchLegalBenchmarkRecursionRun({
        runId: "run-1",
        taskSlug: "contracts/review-nda",
        workspaceId: "ws-1",
        recursionId: "entry-1",
      }),
    ).rejects.toThrow();

    expect(mockDbStakworkRunDeleteMany).toHaveBeenCalledWith({
      where: { id: RECURSION_RUN_ID },
    });
  });

  it("rolls back the StakworkRun row when fetch throws (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network timeout")));

    await expect(
      dispatchLegalBenchmarkRecursionRun({
        runId: "run-1",
        taskSlug: "contracts/review-nda",
        workspaceId: "ws-1",
        recursionId: "entry-1",
      }),
    ).rejects.toThrow("Stakwork dispatch network error");

    expect(mockDbStakworkRunDeleteMany).toHaveBeenCalledWith({
      where: { id: RECURSION_RUN_ID },
    });
  });

  // ── Token leak guard ────────────────────────────────────────────────────────

  it("(token-leak guard) error handlers log only err.message — not the payload", async () => {
    vi.stubGlobal("fetch", makeFailedFetch(500));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await dispatchLegalBenchmarkRecursionRun({
        runId: "run-1",
        taskSlug: "contracts/review-nda",
        workspaceId: "ws-1",
        recursionId: "entry-1",
      });
    } catch {
      // Expected to throw
    }

    // Verify no log call contains the API token value
    for (const call of consoleSpy.mock.calls) {
      const logStr = JSON.stringify(call);
      expect(logStr).not.toContain("test-hive-api-token");
      expect(logStr).not.toContain("stakwork-api-key");
    }

    consoleSpy.mockRestore();
  });

  // ── StakworkRun row has correct type and result ─────────────────────────────

  it("creates StakworkRun row with LEGAL_BENCHMARK_RECURSION type and recursionId in result", async () => {
    vi.stubGlobal("fetch", makeSuccessfulFetch());

    await dispatchLegalBenchmarkRecursionRun({
      runId: "source-run-id-1",
      taskSlug: "contracts/review-nda",
      workspaceId: "ws-openlaw-1",
      recursionId: "entry-abc",
    });

    expect(mockDbStakworkRunCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "LEGAL_BENCHMARK_RECURSION",
          result: expect.stringContaining("entry-abc"),
        }),
      }),
    );

    const createCall = mockDbStakworkRunCreate.mock.calls[0][0] as {
      data: { result: string };
    };
    const resultData = JSON.parse(createCall.data.result) as Record<string, unknown>;
    expect(resultData.recursionId).toBe("entry-abc");
    expect(resultData.sourceRunId).toBe("source-run-id-1");
  });
});
