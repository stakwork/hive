/**
 * Unit tests for src/services/prompts/prompt-daily-runs-sync.ts
 *
 * Covers:
 * 1. Multi-page pagination stops correctly using total/size
 * 2. Resolves hive_version_id to the correct promptId + versionId
 * 3. Skips and logs rows with an unresolved hive_version_id (no DB write)
 * 4. Upsert is idempotent (running twice does not duplicate rows)
 * 5. Stakwork fetch failure results in a logged no-op (does not throw)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockFetch,
  mockDbPromptVersionFindUnique,
  mockDbPromptDailyRunUpsert,
} = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockDbPromptVersionFindUnique: vi.fn(),
  mockDbPromptDailyRunUpsert: vi.fn(),
}));

vi.stubGlobal("fetch", mockFetch);

vi.mock("@/lib/db", () => ({
  db: {
    promptVersion: {
      findUnique: mockDbPromptVersionFindUnique,
    },
    promptDailyRun: {
      upsert: mockDbPromptDailyRunUpsert,
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-api-key",
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
  },
}));

vi.mock("@/services/prompts/prompt-sync", () => ({
  stakworkHeaders: () => ({
    Authorization: "Token token=test-api-key",
    "Content-Type": "application/json",
  }),
}));

import { syncPromptDailyRuns } from "@/services/prompts/prompt-daily-runs-sync";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<{
  id: number;
  prompt_id: number;
  prompt_version_id: number;
  workflow_id: number;
  customer_id: number;
  run_date: string;
  run_count: number;
  hive_version_id: string;
}> = {}) {
  return {
    id: 1,
    prompt_id: 10,
    prompt_version_id: 100,
    workflow_id: 5,
    customer_id: 42,
    run_date: "2026-07-03",
    run_count: 7,
    hive_version_id: "version-cuid-abc",
    created_at: "2026-07-04T00:00:00Z",
    updated_at: "2026-07-04T00:00:00Z",
    ...overrides,
  };
}

function makeStakworkResponse(rows: ReturnType<typeof makeRow>[], total?: number) {
  return {
    success: true,
    data: {
      total: total ?? rows.length,
      size: rows.length,
      prompt_daily_runs: rows,
    },
  };
}

function mockOkResponse(body: object) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function mockErrorResponse(status: number) {
  return Promise.resolve(new Response("", { status }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("syncPromptDailyRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbPromptDailyRunUpsert.mockResolvedValue({});
  });

  // ── Pagination ──────────────────────────────────────────────────────────────

  it("fetches a single page when total equals size", async () => {
    const rows = [makeRow({ hive_version_id: "v1" }), makeRow({ id: 2, hive_version_id: "v2" })];
    mockFetch.mockReturnValueOnce(mockOkResponse(makeStakworkResponse(rows)));

    mockDbPromptVersionFindUnique.mockImplementation(({ where }) =>
      Promise.resolve({ id: where.id, promptId: "prompt-1" }),
    );

    const result = await syncPromptDailyRuns(new Date("2026-07-03T00:00:00Z"));

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(result.pulled).toBe(2);
    expect(result.upserted).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("paginates across multiple pages until accumulated >= total", async () => {
    const page1Rows = [makeRow({ id: 1, hive_version_id: "v1" })];
    const page2Rows = [makeRow({ id: 2, hive_version_id: "v2" })];

    // First page reports total=2, size=1; second page total=2, size=1
    mockFetch
      .mockReturnValueOnce(
        mockOkResponse({
          success: true,
          data: { total: 2, size: 1, prompt_daily_runs: page1Rows },
        }),
      )
      .mockReturnValueOnce(
        mockOkResponse({
          success: true,
          data: { total: 2, size: 1, prompt_daily_runs: page2Rows },
        }),
      );

    mockDbPromptVersionFindUnique.mockImplementation(({ where }) =>
      Promise.resolve({ id: where.id, promptId: "prompt-1" }),
    );

    const result = await syncPromptDailyRuns(new Date("2026-07-03T00:00:00Z"));

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.pulled).toBe(2);
    expect(result.upserted).toBe(2);
  });

  it("stops pagination when size === 0 even if accumulated < total", async () => {
    mockFetch
      .mockReturnValueOnce(
        mockOkResponse({
          success: true,
          data: { total: 5, size: 1, prompt_daily_runs: [makeRow({ hive_version_id: "v1" })] },
        }),
      )
      .mockReturnValueOnce(
        // Empty page signals end of data
        mockOkResponse({
          success: true,
          data: { total: 5, size: 0, prompt_daily_runs: [] },
        }),
      );

    mockDbPromptVersionFindUnique.mockResolvedValue({ id: "v1", promptId: "prompt-1" });

    const result = await syncPromptDailyRuns(new Date("2026-07-03T00:00:00Z"));

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.pulled).toBe(1);
  });

  // ── Resolution ──────────────────────────────────────────────────────────────

  it("resolves hive_version_id to the correct promptId and versionId on upsert", async () => {
    const row = makeRow({ hive_version_id: "version-xyz", prompt_id: 99, prompt_version_id: 999 });
    mockFetch.mockReturnValueOnce(mockOkResponse(makeStakworkResponse([row])));

    mockDbPromptVersionFindUnique.mockResolvedValueOnce({
      id: "version-xyz",
      promptId: "prompt-abc",
    });

    await syncPromptDailyRuns(new Date("2026-07-03T00:00:00Z"));

    expect(mockDbPromptVersionFindUnique).toHaveBeenCalledWith({
      where: { id: "version-xyz" },
      select: { id: true, promptId: true },
    });

    expect(mockDbPromptDailyRunUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          promptId_versionId_runDate: {
            promptId: "prompt-abc",
            versionId: "version-xyz",
            runDate: new Date("2026-07-03"),
          },
        },
        create: expect.objectContaining({
          promptId: "prompt-abc",
          versionId: "version-xyz",
          stakworkPromptId: 99,
          stakworkVersionId: 999,
          workflowId: 5,
          customerId: 42,
          runCount: 7,
          hiveVersionId: "version-xyz",
        }),
        update: expect.objectContaining({
          stakworkPromptId: 99,
          stakworkVersionId: 999,
          runCount: 7,
          hiveVersionId: "version-xyz",
        }),
      }),
    );
  });

  // ── Skipping unresolvable rows ───────────────────────────────────────────────

  it("skips rows with unresolved hive_version_id without writing to DB", async () => {
    const row = makeRow({ hive_version_id: "unknown-version" });
    mockFetch.mockReturnValueOnce(mockOkResponse(makeStakworkResponse([row])));

    // No matching PromptVersion
    mockDbPromptVersionFindUnique.mockResolvedValueOnce(null);

    const result = await syncPromptDailyRuns(new Date("2026-07-03T00:00:00Z"));

    expect(mockDbPromptDailyRunUpsert).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.upserted).toBe(0);
  });

  it("skips only unresolvable rows and upserts resolvable ones in a mixed batch", async () => {
    const rows = [
      makeRow({ id: 1, hive_version_id: "good-version" }),
      makeRow({ id: 2, hive_version_id: "bad-version" }),
      makeRow({ id: 3, hive_version_id: "good-version-2" }),
    ];
    mockFetch.mockReturnValueOnce(mockOkResponse(makeStakworkResponse(rows)));

    mockDbPromptVersionFindUnique
      .mockResolvedValueOnce({ id: "good-version", promptId: "p1" })
      .mockResolvedValueOnce(null) // bad-version not found
      .mockResolvedValueOnce({ id: "good-version-2", promptId: "p1" });

    const result = await syncPromptDailyRuns(new Date("2026-07-03T00:00:00Z"));

    expect(mockDbPromptDailyRunUpsert).toHaveBeenCalledTimes(2);
    expect(result.skipped).toBe(1);
    expect(result.upserted).toBe(2);
  });

  // ── Idempotency ─────────────────────────────────────────────────────────────

  it("calls upsert (not create) so running twice is idempotent", async () => {
    const row = makeRow({ hive_version_id: "v1" });
    const response = makeStakworkResponse([row]);

    mockFetch
      .mockReturnValueOnce(mockOkResponse(response))
      .mockReturnValueOnce(mockOkResponse(response));

    mockDbPromptVersionFindUnique.mockResolvedValue({ id: "v1", promptId: "p1" });

    // First run
    await syncPromptDailyRuns(new Date("2026-07-03T00:00:00Z"));
    // Second run (simulates re-processing same day)
    await syncPromptDailyRuns(new Date("2026-07-03T00:00:00Z"));

    // upsert called twice — the DB handles deduplication
    expect(mockDbPromptDailyRunUpsert).toHaveBeenCalledTimes(2);
    // Each call uses the same unique key, so no duplicate rows are created
    const [call1, call2] = mockDbPromptDailyRunUpsert.mock.calls;
    expect(call1[0].where).toEqual(call2[0].where);
  });

  // ── Stakwork failure ─────────────────────────────────────────────────────────

  it("returns a result summary and does NOT throw when Stakwork returns a non-2xx status", async () => {
    mockFetch.mockReturnValueOnce(mockErrorResponse(503));

    const result = await syncPromptDailyRuns(new Date("2026-07-03T00:00:00Z"));

    expect(mockDbPromptDailyRunUpsert).not.toHaveBeenCalled();
    expect(result.errors).toBeGreaterThan(0);
    expect(result.pulled).toBe(0);
    // Must not throw
  });

  it("returns a result summary and does NOT throw when fetch throws a network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await syncPromptDailyRuns(new Date("2026-07-03T00:00:00Z"));

    expect(mockDbPromptDailyRunUpsert).not.toHaveBeenCalled();
    expect(result.errors).toBeGreaterThan(0);
  });

  it("returns a result summary with correct targetDate", async () => {
    mockFetch.mockReturnValueOnce(
      mockOkResponse({ success: true, data: { total: 0, size: 0, prompt_daily_runs: [] } }),
    );

    const result = await syncPromptDailyRuns(new Date("2026-07-03T00:00:00Z"));

    expect(result.targetDate).toBe("2026-07-03");
  });

  it("defaults to yesterday UTC when no targetDate is provided", async () => {
    // Fix "now" to 2026-07-04 so yesterday resolves to 2026-07-03
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T06:00:00.000Z"));

    mockFetch.mockReturnValueOnce(
      mockOkResponse({ success: true, data: { total: 0, size: 0, prompt_daily_runs: [] } }),
    );

    const result = await syncPromptDailyRuns();

    // Yesterday of 2026-07-04 is 2026-07-03
    expect(result.targetDate).toBe("2026-07-03");

    vi.useRealTimers();
  });
});
