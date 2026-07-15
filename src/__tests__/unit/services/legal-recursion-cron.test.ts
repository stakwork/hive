import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// ── Stable hoisted mock references ──────────────────────────────────────────

const mockDispatchLegalBenchmarkRecursionRun = vi.hoisted(() => vi.fn());

const mockDbWorkspaceFindUnique = vi.hoisted(() => vi.fn());
const mockDbLegalBenchmarkRecursionFindMany = vi.hoisted(() => vi.fn());
const mockDbLegalBenchmarkRecursionUpdate = vi.hoisted(() => vi.fn());
const mockDbStakworkRunFindMany = vi.hoisted(() => vi.fn());
const mockDbStakworkRunFindUnique = vi.hoisted(() => vi.fn());

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/services/legal-benchmark-eval", () => ({
  dispatchLegalBenchmarkRecursionRun: mockDispatchLegalBenchmarkRecursionRun,
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findUnique: mockDbWorkspaceFindUnique,
    },
    legalBenchmarkRecursion: {
      findMany: mockDbLegalBenchmarkRecursionFindMany,
      update: mockDbLegalBenchmarkRecursionUpdate,
    },
    stakworkRun: {
      findMany: mockDbStakworkRunFindMany,
      findUnique: mockDbStakworkRunFindUnique,
    },
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { executeScheduledLegalBenchmarkRecursion } from "@/services/legal-recursion-cron";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const OPENLAW_WORKSPACE = {
  id: "ws-openlaw-1",
};

const makeEntry = (overrides: Partial<{
  id: string;
  taskSlug: string;
  runId: string;
  lastRunId: string | null;
  status: string;
}> = {}) => ({
  id: "recursion-entry-1",
  taskSlug: "contracts/review-nda",
  runId: "source-run-id-1",
  lastRunId: null,
  status: "ACTIVE",
  workspaceId: OPENLAW_WORKSPACE.id,
  lastScore: null,
  lastRunAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeRunResult = (overrides: Partial<{
  all_pass: boolean;
  n_passed: number;
  n_total: number;
  criteria_results: Array<{ criterion_id: string; verdict: string }>;
}> = {}) => ({
  all_pass: false,
  n_passed: 0,
  n_total: 2,
  criteria_results: [
    { criterion_id: "c1", verdict: "fail" },
    { criterion_id: "c2", verdict: "fail" },
  ],
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("legal-recursion-cron vercel.json configuration", () => {
  it("should have legal-recursion cron job configured in vercel.json", () => {
    const vercelPath = path.join(process.cwd(), "vercel.json");
    expect(fs.existsSync(vercelPath)).toBe(true);

    const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    expect(vercelConfig.crons).toBeDefined();
    expect(Array.isArray(vercelConfig.crons)).toBe(true);

    const legalRecursionCron = vercelConfig.crons.find(
      (cron) => cron.path === "/api/cron/legal-recursion",
    );
    expect(legalRecursionCron).toBeDefined();
    expect(legalRecursionCron!.schedule).toBeDefined();
    expect(typeof legalRecursionCron!.schedule).toBe("string");
  });

  it("should have a valid 5-part cron schedule format", () => {
    const vercelPath = path.join(process.cwd(), "vercel.json");
    const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };

    const legalRecursionCron = vercelConfig.crons.find(
      (cron) => cron.path === "/api/cron/legal-recursion",
    );

    const scheduleParts = legalRecursionCron!.schedule.split(" ");
    expect(scheduleParts).toHaveLength(5);
  });

  it("should have schedule set to every 6 hours", () => {
    const vercelPath = path.join(process.cwd(), "vercel.json");
    const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };

    const legalRecursionCron = vercelConfig.crons.find(
      (cron) => cron.path === "/api/cron/legal-recursion",
    );

    expect(legalRecursionCron!.schedule).toBe("0 */6 * * *");
  });
});

describe("executeScheduledLegalBenchmarkRecursion", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default happy-path workspace setup (no swarm needed anymore)
    mockDbWorkspaceFindUnique.mockResolvedValue(OPENLAW_WORKSPACE);

    // No in-flight recursion runs by default
    mockDbStakworkRunFindMany.mockResolvedValue([]);

    // No active entries by default
    mockDbLegalBenchmarkRecursionFindMany.mockResolvedValue([]);

    mockDbLegalBenchmarkRecursionUpdate.mockResolvedValue({});
    mockDbStakworkRunFindUnique.mockResolvedValue(null);
    mockDispatchLegalBenchmarkRecursionRun.mockResolvedValue({ recursionRunId: "recursion-run-new" });
  });

  // ── Workspace guard tests ───────────────────────────────────────────────────

  it("returns failure if openlaw workspace not found", async () => {
    mockDbWorkspaceFindUnique.mockResolvedValue(null);

    const result = await executeScheduledLegalBenchmarkRecursion();

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain("openlaw workspace not found");
    expect(mockDispatchLegalBenchmarkRecursionRun).not.toHaveBeenCalled();
  });

  it("returns empty result when no active entries", async () => {
    const result = await executeScheduledLegalBenchmarkRecursion();

    expect(result.success).toBe(true);
    expect(result.entriesProcessed).toBe(0);
    expect(result.dispatched).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.deactivated).toBe(0);
  });

  // ── (a) In-flight guard ─────────────────────────────────────────────────────

  it("(a) skips dispatch when a LEGAL_BENCHMARK_RECURSION run is in-flight for the same entry", async () => {
    const entry = makeEntry({ id: "recursion-entry-1", runId: "source-run-id-1" });
    mockDbLegalBenchmarkRecursionFindMany.mockResolvedValue([entry]);

    // In-flight recursion run whose result.recursionId matches entry.id
    mockDbStakworkRunFindMany.mockResolvedValue([
      {
        result: JSON.stringify({ recursionId: "recursion-entry-1" }),
      },
    ]);

    const result = await executeScheduledLegalBenchmarkRecursion();

    expect(result.skipped).toBe(1);
    expect(result.dispatched).toBe(0);
    expect(mockDispatchLegalBenchmarkRecursionRun).not.toHaveBeenCalled();
    expect(mockDbLegalBenchmarkRecursionUpdate).not.toHaveBeenCalled();
  });

  it("(a) does NOT skip when in-flight recursion run is for a different entry", async () => {
    const entry = makeEntry({ id: "recursion-entry-1", runId: "source-run-id-1" });
    mockDbLegalBenchmarkRecursionFindMany.mockResolvedValue([entry]);

    // In-flight run is for a DIFFERENT entry
    mockDbStakworkRunFindMany.mockResolvedValue([
      {
        result: JSON.stringify({ recursionId: "completely-different-entry-id" }),
      },
    ]);

    // Run has failing criteria → should dispatch
    const runResult = makeRunResult();
    mockDbStakworkRunFindUnique.mockResolvedValue({
      result: JSON.stringify(runResult),
    });

    const result = await executeScheduledLegalBenchmarkRecursion();

    expect(result.skipped).toBe(0);
    expect(mockDispatchLegalBenchmarkRecursionRun).toHaveBeenCalledOnce();
  });

  it("(a) does NOT skip when in-flight run has malformed result JSON", async () => {
    const entry = makeEntry({ id: "recursion-entry-1", runId: "source-run-id-1" });
    mockDbLegalBenchmarkRecursionFindMany.mockResolvedValue([entry]);

    // Malformed result — cannot parse recursionId, should not skip
    mockDbStakworkRunFindMany.mockResolvedValue([
      { result: "not-valid-json" },
    ]);

    const runResult = makeRunResult();
    mockDbStakworkRunFindUnique.mockResolvedValue({
      result: JSON.stringify(runResult),
    });

    const result = await executeScheduledLegalBenchmarkRecursion();

    expect(result.skipped).toBe(0);
    expect(mockDispatchLegalBenchmarkRecursionRun).toHaveBeenCalledOnce();
  });

  // ── (b) All-pass → INACTIVE ────────────────────────────────────────────────

  it("(b) sets status INACTIVE when all_pass is true", async () => {
    const entry = makeEntry({ runId: "source-run-id-1" });
    mockDbLegalBenchmarkRecursionFindMany.mockResolvedValue([entry]);

    const runResult = makeRunResult({
      all_pass: true,
      n_passed: 2,
      n_total: 2,
      criteria_results: [
        { criterion_id: "c1", verdict: "pass" },
        { criterion_id: "c2", verdict: "pass" },
      ],
    });
    mockDbStakworkRunFindUnique.mockResolvedValue({
      result: JSON.stringify(runResult),
    });

    const result = await executeScheduledLegalBenchmarkRecursion();

    expect(result.deactivated).toBe(1);
    expect(result.dispatched).toBe(0);
    expect(mockDispatchLegalBenchmarkRecursionRun).not.toHaveBeenCalled();
    expect(mockDbLegalBenchmarkRecursionUpdate).toHaveBeenCalledWith({
      where: { id: entry.id },
      data: {
        status: "INACTIVE",
        lastScore: "2/2",
      },
    });
  });

  it("(b) sets status INACTIVE when failingCount is 0 (all pass, all_pass not set)", async () => {
    const entry = makeEntry({ runId: "source-run-id-1" });
    mockDbLegalBenchmarkRecursionFindMany.mockResolvedValue([entry]);

    const runResult = makeRunResult({
      all_pass: false, // explicitly false, but all criteria pass
      n_passed: 3,
      n_total: 3,
      criteria_results: [
        { criterion_id: "c1", verdict: "pass" },
        { criterion_id: "c2", verdict: "PASS" }, // case-insensitive
        { criterion_id: "c3", verdict: "Pass" },
      ],
    });
    mockDbStakworkRunFindUnique.mockResolvedValue({
      result: JSON.stringify(runResult),
    });

    const result = await executeScheduledLegalBenchmarkRecursion();

    expect(result.deactivated).toBe(1);
    expect(mockDispatchLegalBenchmarkRecursionRun).not.toHaveBeenCalled();
  });

  it("(b) derives lastScore from result BEFORE dispatch — lastScore reflects pre-dispatch state", async () => {
    const entry = makeEntry({ runId: "source-run-id-1" });
    mockDbLegalBenchmarkRecursionFindMany.mockResolvedValue([entry]);

    const runResult = makeRunResult({ all_pass: true, n_passed: 5, n_total: 5 });
    mockDbStakworkRunFindUnique.mockResolvedValue({
      result: JSON.stringify(runResult),
    });

    await executeScheduledLegalBenchmarkRecursion();

    expect(mockDbLegalBenchmarkRecursionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastScore: "5/5" }),
      }),
    );
  });

  // ── (c) Failing → dispatch ─────────────────────────────────────────────────

  it("(c) dispatches recursion run and updates entry when criteria are failing", async () => {
    const entry = makeEntry({ id: "recursion-entry-1", runId: "source-run-id-1" });
    mockDbLegalBenchmarkRecursionFindMany.mockResolvedValue([entry]);

    const runResult = makeRunResult({
      all_pass: false,
      n_passed: 1,
      n_total: 3,
      criteria_results: [
        { criterion_id: "c1", verdict: "pass" },
        { criterion_id: "c2", verdict: "fail" },
        { criterion_id: "c3", verdict: "fail" },
      ],
    });
    mockDbStakworkRunFindUnique.mockResolvedValue({
      result: JSON.stringify(runResult),
    });
    mockDispatchLegalBenchmarkRecursionRun.mockResolvedValue({
      recursionRunId: "recursion-run-new",
    });

    const result = await executeScheduledLegalBenchmarkRecursion();

    expect(result.dispatched).toBe(1);
    expect(result.deactivated).toBe(0);

    // Assert dispatchLegalBenchmarkRecursionRun is called with the correct args
    expect(mockDispatchLegalBenchmarkRecursionRun).toHaveBeenCalledWith({
      runId: "source-run-id-1",
      taskSlug: entry.taskSlug,
      workspaceId: OPENLAW_WORKSPACE.id,
      recursionId: entry.id,
    });

    expect(mockDbLegalBenchmarkRecursionUpdate).toHaveBeenCalledWith({
      where: { id: entry.id },
      data: {
        lastRunId: "recursion-run-new",
        lastRunAt: expect.any(Date),
        lastScore: "1/3",
      },
    });
  });

  it("(c) uses lastRunId (not runId) as the target run when lastRunId is set", async () => {
    const entry = makeEntry({
      runId: "original-run-id",
      lastRunId: "last-recursion-run-id",
    });
    mockDbLegalBenchmarkRecursionFindMany.mockResolvedValue([entry]);

    const runResult = makeRunResult({ n_passed: 0, n_total: 2 });
    mockDbStakworkRunFindUnique.mockResolvedValue({
      result: JSON.stringify(runResult),
    });

    await executeScheduledLegalBenchmarkRecursion();

    expect(mockDispatchLegalBenchmarkRecursionRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "last-recursion-run-id" }),
    );
    // IDOR: stakworkRun.findUnique must have been called with workspaceId constraint
    expect(mockDbStakworkRunFindUnique).toHaveBeenCalledWith({
      where: { id: "last-recursion-run-id", workspaceId: OPENLAW_WORKSPACE.id },
    });
  });

  it("(c) lastScore derived from pre-dispatch result, not from the new PENDING run", async () => {
    const entry = makeEntry({ runId: "source-run-id-1" });
    mockDbLegalBenchmarkRecursionFindMany.mockResolvedValue([entry]);

    const runResult = makeRunResult({ n_passed: 3, n_total: 5 });
    mockDbStakworkRunFindUnique.mockResolvedValue({
      result: JSON.stringify(runResult),
    });

    mockDispatchLegalBenchmarkRecursionRun.mockResolvedValue({
      recursionRunId: "brand-new-recursion-run",
    });

    await executeScheduledLegalBenchmarkRecursion();

    // lastScore must reflect the pre-dispatch run state (3/5), not the new run's state
    expect(mockDbLegalBenchmarkRecursionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastScore: "3/5" }),
      }),
    );
  });

  // ── Confirms dispatchLegalBenchmarkEvalRun is NEVER called ─────────────────

  it("(c) calls dispatchLegalBenchmarkRecursionRun — NEVER dispatchLegalBenchmarkEvalRun", async () => {
    const entry = makeEntry({ runId: "source-run-id-1" });
    mockDbLegalBenchmarkRecursionFindMany.mockResolvedValue([entry]);

    const runResult = makeRunResult();
    mockDbStakworkRunFindUnique.mockResolvedValue({
      result: JSON.stringify(runResult),
    });

    await executeScheduledLegalBenchmarkRecursion();

    expect(mockDispatchLegalBenchmarkRecursionRun).toHaveBeenCalledOnce();
    // Confirm the old eval dispatch is not present in the module mock
    // (it is not exported from the mock at all)
  });

  // ── (d) Per-entry error isolation ──────────────────────────────────────────

  it("(d) isolates per-entry errors — loop continues after a failing entry", async () => {
    const entry1 = makeEntry({ id: "entry-1", taskSlug: "contracts/review-nda", runId: "run-1" });
    const entry2 = makeEntry({ id: "entry-2", taskSlug: "litigation/brief-draft", runId: "run-2" });
    mockDbLegalBenchmarkRecursionFindMany.mockResolvedValue([entry1, entry2]);

    const runResult = makeRunResult({ n_passed: 0, n_total: 2 });
    mockDbStakworkRunFindUnique.mockResolvedValue({
      result: JSON.stringify(runResult),
    });

    // First entry throws; second should still dispatch
    mockDispatchLegalBenchmarkRecursionRun
      .mockRejectedValueOnce(new Error("Network failure for entry 1"))
      .mockResolvedValueOnce({ recursionRunId: "recursion-run-for-entry-2" });

    const result = await executeScheduledLegalBenchmarkRecursion();

    expect(result.entriesProcessed).toBe(2);
    expect(result.dispatched).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("contracts/review-nda");
    expect(result.errors[0]).toContain("Network failure for entry 1");
    // success is false when any entry errors
    expect(result.success).toBe(false);

    // Second entry was still dispatched
    expect(mockDispatchLegalBenchmarkRecursionRun).toHaveBeenCalledTimes(2);
    expect(mockDbLegalBenchmarkRecursionUpdate).toHaveBeenCalledOnce();
    expect(mockDbLegalBenchmarkRecursionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "entry-2" } }),
    );
  });

  it("(d) only logs err.message — not JSON.stringify(err) or full error object", async () => {
    const entry = makeEntry({ taskSlug: "contracts/review-nda", runId: "run-1" });
    mockDbLegalBenchmarkRecursionFindMany.mockResolvedValue([entry]);

    const runResult = makeRunResult();
    mockDbStakworkRunFindUnique.mockResolvedValue({
      result: JSON.stringify(runResult),
    });

    // Error with sensitive fields attached (must not appear in logs)
    const sensitiveError = Object.assign(
      new Error("dispatch failed"),
      {
        hive_api_token: "SECRET_API_TOKEN_12345",
        apiKey: "SECRET_STAKWORK_KEY",
      },
    );
    mockDispatchLegalBenchmarkRecursionRun.mockRejectedValue(sensitiveError);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await executeScheduledLegalBenchmarkRecursion();

    // Verify console.error was called for the entry
    const errorCalls = consoleSpy.mock.calls;
    const entryErrorCall = errorCalls.find(
      (args) => typeof args[0] === "string" && args[0].includes("contracts/review-nda"),
    );
    expect(entryErrorCall).toBeDefined();

    const loggedMessage = entryErrorCall![0] as string;

    // Should contain only the message
    expect(loggedMessage).toContain("dispatch failed");

    // Must NOT contain sensitive fields
    expect(loggedMessage).not.toContain("SECRET_API_TOKEN_12345");
    expect(loggedMessage).not.toContain("SECRET_STAKWORK_KEY");

    // Must NOT be a JSON.stringify of the error
    expect(loggedMessage).not.toContain('"hive_api_token"');
    expect(loggedMessage).not.toContain('"apiKey"');

    consoleSpy.mockRestore();
  });

  it("(d) handles non-Error thrown values gracefully", async () => {
    const entry = makeEntry({ runId: "run-1" });
    mockDbLegalBenchmarkRecursionFindMany.mockResolvedValue([entry]);

    const runResult = makeRunResult();
    mockDbStakworkRunFindUnique.mockResolvedValue({
      result: JSON.stringify(runResult),
    });

    // Throw a string (not an Error)
    mockDispatchLegalBenchmarkRecursionRun.mockRejectedValue("plain string error");

    const result = await executeScheduledLegalBenchmarkRecursion();

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("plain string error");
  });

  // ── IDOR guard ──────────────────────────────────────────────────────────────

  it("includes workspaceId constraint on every StakworkRun lookup (IDOR guard)", async () => {
    const entry = makeEntry({ runId: "source-run-id-1" });
    mockDbLegalBenchmarkRecursionFindMany.mockResolvedValue([entry]);

    const runResult = makeRunResult({ all_pass: true, n_passed: 2, n_total: 2 });
    mockDbStakworkRunFindUnique.mockResolvedValue({
      result: JSON.stringify(runResult),
    });

    await executeScheduledLegalBenchmarkRecursion();

    expect(mockDbStakworkRunFindUnique).toHaveBeenCalledWith({
      where: {
        id: "source-run-id-1",
        workspaceId: OPENLAW_WORKSPACE.id,
      },
    });
  });

  // ── Result shape ────────────────────────────────────────────────────────────

  it("returns a valid RecursionCronResult shape with timestamp", async () => {
    const result = await executeScheduledLegalBenchmarkRecursion();

    expect(result).toMatchObject({
      success: expect.any(Boolean),
      entriesProcessed: expect.any(Number),
      dispatched: expect.any(Number),
      skipped: expect.any(Number),
      deactivated: expect.any(Number),
      errors: expect.any(Array),
      timestamp: expect.any(Date),
    });
  });
});
