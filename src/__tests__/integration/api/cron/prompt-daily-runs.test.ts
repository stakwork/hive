/**
 * Integration tests for GET /api/cron/prompt-daily-runs
 *
 * Tests verify:
 * - 401 when Authorization header is missing or wrong
 * - 200 with correct CRON_SECRET bearer token
 * - Response includes the sync summary fields
 * - 500 when syncPromptDailyRuns throws unexpectedly
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockSyncPromptDailyRuns } = vi.hoisted(() => ({
  mockSyncPromptDailyRuns: vi.fn(),
}));

vi.mock("@/services/prompts/prompt-daily-runs-sync", () => ({
  syncPromptDailyRuns: mockSyncPromptDailyRuns,
}));

import { GET } from "@/app/api/cron/prompt-daily-runs/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function createRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new NextRequest("http://localhost:3000/api/cron/prompt-daily-runs", { headers });
}

function createAuthenticatedRequest(): NextRequest {
  return createRequest("Bearer test-cron-secret");
}

const defaultSyncResult = {
  targetDate: "2026-07-03",
  pulled: 10,
  upserted: 9,
  skipped: 1,
  errors: 0,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/cron/prompt-daily-runs", () => {
  let originalCronSecret: string | undefined;

  beforeEach(() => {
    originalCronSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-cron-secret";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalCronSecret;
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 when Authorization header is missing", async () => {
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(mockSyncPromptDailyRuns).not.toHaveBeenCalled();
  });

  it("returns 401 when Authorization header has wrong secret", async () => {
    const res = await GET(createRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(mockSyncPromptDailyRuns).not.toHaveBeenCalled();
  });

  it("returns 401 when Authorization header has no bearer prefix", async () => {
    const res = await GET(createRequest("test-cron-secret"));
    expect(res.status).toBe(401);
    expect(mockSyncPromptDailyRuns).not.toHaveBeenCalled();
  });

  // ── Success ───────────────────────────────────────────────────────────────

  it("returns 200 with sync summary when CRON_SECRET is correct", async () => {
    mockSyncPromptDailyRuns.mockResolvedValueOnce(defaultSyncResult);

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      targetDate: "2026-07-03",
      pulled: 10,
      upserted: 9,
      skipped: 1,
      errors: 0,
    });
    expect(typeof body.timestamp).toBe("string");
    expect(mockSyncPromptDailyRuns).toHaveBeenCalledOnce();
  });

  it("returns success=false when sync reports errors > 0", async () => {
    mockSyncPromptDailyRuns.mockResolvedValueOnce({
      ...defaultSyncResult,
      errors: 2,
    });

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.errors).toBe(2);
  });

  it("calls syncPromptDailyRuns without arguments (uses default yesterday date)", async () => {
    mockSyncPromptDailyRuns.mockResolvedValueOnce(defaultSyncResult);

    await GET(createAuthenticatedRequest());

    expect(mockSyncPromptDailyRuns).toHaveBeenCalledWith();
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it("returns 500 when syncPromptDailyRuns throws an unexpected error", async () => {
    mockSyncPromptDailyRuns.mockRejectedValueOnce(new Error("unexpected crash"));

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Internal server error");
    expect(typeof body.timestamp).toBe("string");
  });
});
