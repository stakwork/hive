import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Integration tests for GET /api/cron/prompt-usage-sync endpoint
 *
 * Tests verify:
 * - Authentication via CRON_SECRET (401 when missing/invalid)
 * - PROMPT_USAGE_SYNC_CRON_ENABLED flag short-circuits with disabled message
 * - Happy-path run returns expected metrics
 * - Unhandled errors return 500
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockExecuteScheduledPromptUsageSync } = vi.hoisted(() => ({
  mockExecuteScheduledPromptUsageSync: vi.fn(),
}));

vi.mock("@/services/prompts/prompt-usage-sync", () => ({
  executeScheduledPromptUsageSync: mockExecuteScheduledPromptUsageSync,
}));

import { GET } from "@/app/api/cron/prompt-usage-sync/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function createRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new NextRequest("http://localhost:3000/api/cron/prompt-usage-sync", { headers });
}

function createAuthenticatedRequest(): NextRequest {
  return createRequest("Bearer test-cron-secret");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/cron/prompt-usage-sync", () => {
  let originalCronSecret: string | undefined;
  let originalEnabled: string | undefined;

  beforeEach(() => {
    originalCronSecret = process.env.CRON_SECRET;
    originalEnabled = process.env.PROMPT_USAGE_SYNC_CRON_ENABLED;

    process.env.CRON_SECRET = "test-cron-secret";

    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalCronSecret;
    process.env.PROMPT_USAGE_SYNC_CRON_ENABLED = originalEnabled;
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

  it("returns 200 disabled message when PROMPT_USAGE_SYNC_CRON_ENABLED is not 'true'", async () => {
    process.env.PROMPT_USAGE_SYNC_CRON_ENABLED = "false";

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/disabled/i);
    expect(mockExecuteScheduledPromptUsageSync).not.toHaveBeenCalled();
  });

  it("returns 200 disabled message when PROMPT_USAGE_SYNC_CRON_ENABLED is unset", async () => {
    delete process.env.PROMPT_USAGE_SYNC_CRON_ENABLED;

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/disabled/i);
    expect(mockExecuteScheduledPromptUsageSync).not.toHaveBeenCalled();
  });

  it("does no DB writes when disabled", async () => {
    process.env.PROMPT_USAGE_SYNC_CRON_ENABLED = "false";

    await GET(createAuthenticatedRequest());

    expect(mockExecuteScheduledPromptUsageSync).not.toHaveBeenCalled();
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it("calls executeScheduledPromptUsageSync and returns summary JSON when enabled", async () => {
    process.env.PROMPT_USAGE_SYNC_CRON_ENABLED = "true";
    mockExecuteScheduledPromptUsageSync.mockResolvedValue({
      success: true,
      workspacesProcessed: 3,
      usagesUpserted: 42,
      usagesPruned: 5,
      errors: [],
      timestamp: new Date("2024-01-01T00:00:00Z"),
    });

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      workspacesProcessed: 3,
      usagesUpserted: 42,
      usagesPruned: 5,
      errorCount: 0,
      errors: [],
    });
    expect(typeof body.timestamp).toBe("string");
    expect(mockExecuteScheduledPromptUsageSync).toHaveBeenCalledOnce();
  });

  it("returns success=false and error details when errors are present", async () => {
    process.env.PROMPT_USAGE_SYNC_CRON_ENABLED = "true";
    mockExecuteScheduledPromptUsageSync.mockResolvedValue({
      success: false,
      workspacesProcessed: 2,
      usagesUpserted: 10,
      usagesPruned: 0,
      errors: [{ workspaceSlug: "ws-1", error: "network failure" }],
      timestamp: new Date(),
    });

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.errorCount).toBe(1);
    expect(body.errors[0]).toMatchObject({ workspaceSlug: "ws-1", error: "network failure" });
  });

  // ── Multi-page Stakwork response (mocked at service layer) ────────────────

  it("returns correct upsert+prune counts from a multi-page sync", async () => {
    process.env.PROMPT_USAGE_SYNC_CRON_ENABLED = "true";
    mockExecuteScheduledPromptUsageSync.mockResolvedValue({
      success: true,
      workspacesProcessed: 1,
      usagesUpserted: 45, // simulates 3 pages of 20/20/5
      usagesPruned: 3,
      errors: [],
      timestamp: new Date(),
    });

    const res = await GET(createAuthenticatedRequest());
    const body = await res.json();

    expect(body.usagesUpserted).toBe(45);
    expect(body.usagesPruned).toBe(3);
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it("returns 500 when executeScheduledPromptUsageSync throws", async () => {
    process.env.PROMPT_USAGE_SYNC_CRON_ENABLED = "true";
    mockExecuteScheduledPromptUsageSync.mockRejectedValue(new Error("unexpected crash"));

    const res = await GET(createAuthenticatedRequest());
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Internal server error");
  });
});
