import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Integration tests for GET /api/cron/daily-recap endpoint
 *
 * Tests verify:
 * - Authentication via CRON_SECRET (401 when missing/invalid)
 * - Config guard (STAKWORK_DAILY_RECAP_WORKFLOW_ID presence)
 * - Response shape when workflow ID is absent
 * - Response shape when cron is enabled and runs successfully
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockExecuteScheduledActivityRecapRuns } = vi.hoisted(() => ({
  mockExecuteScheduledActivityRecapRuns: vi.fn(),
}));

vi.mock("@/services/daily-recap-cron", () => ({
  executeScheduledActivityRecapRuns: mockExecuteScheduledActivityRecapRuns,
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
  let originalWorkflowId: string | undefined;

  beforeEach(() => {
    originalCronSecret = process.env.CRON_SECRET;
    originalWorkflowId = process.env.STAKWORK_DAILY_RECAP_WORKFLOW_ID;

    process.env.CRON_SECRET = "test-cron-secret";

    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalCronSecret;
    process.env.STAKWORK_DAILY_RECAP_WORKFLOW_ID = originalWorkflowId;
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

  // ── Config guard ──────────────────────────────────────────────────────────

  it("returns 200 with not-configured message when STAKWORK_DAILY_RECAP_WORKFLOW_ID is unset", async () => {
    delete process.env.STAKWORK_DAILY_RECAP_WORKFLOW_ID;

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/not configured/i);
    expect(mockExecuteScheduledActivityRecapRuns).not.toHaveBeenCalled();
  });

  // ── Enabled ───────────────────────────────────────────────────────────────

  it("calls executeScheduledActivityRecapRuns and returns summary JSON when workflow ID is set", async () => {
    process.env.STAKWORK_DAILY_RECAP_WORKFLOW_ID = "12345";
    mockExecuteScheduledActivityRecapRuns.mockResolvedValue({
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
    expect(mockExecuteScheduledActivityRecapRuns).toHaveBeenCalledOnce();
  });

  it("returns success=false when errors are present", async () => {
    process.env.STAKWORK_DAILY_RECAP_WORKFLOW_ID = "12345";
    mockExecuteScheduledActivityRecapRuns.mockResolvedValue({
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

  it("returns 500 when executeScheduledActivityRecapRuns throws", async () => {
    process.env.STAKWORK_DAILY_RECAP_WORKFLOW_ID = "12345";
    mockExecuteScheduledActivityRecapRuns.mockRejectedValue(new Error("unexpected crash"));

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Internal server error");
  });
});
