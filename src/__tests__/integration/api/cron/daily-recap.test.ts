import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Integration tests for GET /api/cron/daily-recap endpoint
 *
 * Tests verify:
 * - Authentication via CRON_SECRET (401 when missing/invalid)
 * - Feature flag gating (DAILY_RECAP_CRON_ENABLED)
 * - Response shape when cron is disabled
 * - Response shape when cron is enabled and runs successfully
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockExecuteScheduledDailyRecapRuns } = vi.hoisted(() => ({
  mockExecuteScheduledDailyRecapRuns: vi.fn(),
}));

vi.mock("@/services/daily-recap-cron", () => ({
  executeScheduledDailyRecapRuns: mockExecuteScheduledDailyRecapRuns,
}));

import { GET } from "@/app/api/cron/daily-recap/route";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new NextRequest("http://localhost:3000/api/cron/daily-recap", { headers });
}

function createAuthenticatedRequest(): NextRequest {
  return createRequest("Bearer test-cron-secret");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/cron/daily-recap", () => {
  let originalCronSecret: string | undefined;
  let originalEnabled: string | undefined;

  beforeEach(() => {
    originalCronSecret = process.env.CRON_SECRET;
    originalEnabled = process.env.DAILY_RECAP_CRON_ENABLED;

    process.env.CRON_SECRET = "test-cron-secret";

    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalCronSecret;
    process.env.DAILY_RECAP_CRON_ENABLED = originalEnabled;
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 when Authorization header is missing", async () => {
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when Authorization header has wrong secret", async () => {
    const res = await GET(createRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  // ── Disabled flag ─────────────────────────────────────────────────────────

  it("returns 200 with disabled message when DAILY_RECAP_CRON_ENABLED is not 'true'", async () => {
    process.env.DAILY_RECAP_CRON_ENABLED = "false";

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/disabled/i);
    expect(body.usersProcessed).toBe(0);
    expect(body.dispatched).toBe(0);
    expect(mockExecuteScheduledDailyRecapRuns).not.toHaveBeenCalled();
  });

  it("returns 200 with disabled message when DAILY_RECAP_CRON_ENABLED is unset", async () => {
    delete process.env.DAILY_RECAP_CRON_ENABLED;

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockExecuteScheduledDailyRecapRuns).not.toHaveBeenCalled();
  });

  // ── Enabled ───────────────────────────────────────────────────────────────

  it("calls executeScheduledDailyRecapRuns and returns summary JSON when enabled", async () => {
    process.env.DAILY_RECAP_CRON_ENABLED = "true";
    mockExecuteScheduledDailyRecapRuns.mockResolvedValue({
      usersProcessed: 5,
      dispatched: 4,
      skipped: 1,
      errors: [],
    });

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      usersProcessed: 5,
      dispatched: 4,
      skipped: 1,
      errorCount: 0,
      errors: [],
    });
    expect(typeof body.timestamp).toBe("string");
    expect(mockExecuteScheduledDailyRecapRuns).toHaveBeenCalledOnce();
  });

  it("returns success=false when errors are present", async () => {
    process.env.DAILY_RECAP_CRON_ENABLED = "true";
    mockExecuteScheduledDailyRecapRuns.mockResolvedValue({
      usersProcessed: 3,
      dispatched: 2,
      skipped: 0,
      errors: [{ userId: "user-1", error: "network failure" }],
    });

    const res = await GET(createAuthenticatedRequest());
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.errorCount).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatchObject({ userId: "user-1", error: "network failure" });
  });

  it("returns 500 when executeScheduledDailyRecapRuns throws", async () => {
    process.env.DAILY_RECAP_CRON_ENABLED = "true";
    mockExecuteScheduledDailyRecapRuns.mockRejectedValue(new Error("unexpected crash"));

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Internal server error");
  });
});
