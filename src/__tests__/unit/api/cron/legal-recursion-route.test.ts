/**
 * Unit tests for GET /api/cron/legal-recursion
 *
 * Verifies:
 *  - 401 on missing or invalid bearer token
 *  - 200 with summary JSON on valid CRON_SECRET bearer token
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockExecute = vi.hoisted(() => vi.fn());

vi.mock("@/services/legal-recursion-cron", () => ({
  executeScheduledLegalBenchmarkRecursion: mockExecute,
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { GET } from "@/app/api/cron/legal-recursion/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(authHeader?: string): NextRequest {
  return new NextRequest("http://localhost/api/cron/legal-recursion", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

const MOCK_RESULT = {
  success: true,
  entriesProcessed: 3,
  dispatched: 1,
  skipped: 2,
  deactivated: 0,
  attemptCapped: 0,
  plateauCapped: 0,
  errors: [],
  timestamp: new Date("2024-01-01T00:00:00Z"),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/cron/legal-recursion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
    mockExecute.mockResolvedValue(MOCK_RESULT);
  });

  it("returns 401 with no auth header", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("returns 401 with wrong bearer token", async () => {
    const res = await GET(makeRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("returns 401 with malformed auth header (no Bearer prefix)", async () => {
    const res = await GET(makeRequest("test-cron-secret"));
    expect(res.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("returns 200 with summary JSON on valid CRON_SECRET", async () => {
    const res = await GET(makeRequest("Bearer test-cron-secret"));
    expect(res.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledOnce();

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.entriesProcessed).toBe(3);
    expect(body.dispatched).toBe(1);
    expect(body.skipped).toBe(2);
    expect(body.deactivated).toBe(0);
    expect(body.attemptCapped).toBe(0);
    expect(body.plateauCapped).toBe(0);
    expect(body.errorCount).toBe(0);
    expect(body.errors).toEqual([]);
    expect(body.timestamp).toBe("2024-01-01T00:00:00.000Z");
  });

  it("returns 500 if executor throws unexpectedly", async () => {
    mockExecute.mockRejectedValue(new Error("boom"));
    const res = await GET(makeRequest("Bearer test-cron-secret"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Internal server error");
  });

  it("returns 200 with error details when executor reports errors", async () => {
    mockExecute.mockResolvedValue({
      ...MOCK_RESULT,
      success: false,
      errors: ["EvalSet abc: dispatch failed"],
    });

    const res = await GET(makeRequest("Bearer test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.errorCount).toBe(1);
    expect(body.errors).toEqual(["EvalSet abc: dispatch failed"]);
  });

  it("includes attemptCapped and plateauCapped in JSON response", async () => {
    mockExecute.mockResolvedValue({
      ...MOCK_RESULT,
      attemptCapped: 2,
      plateauCapped: 1,
    });

    const res = await GET(makeRequest("Bearer test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attemptCapped).toBe(2);
    expect(body.plateauCapped).toBe(1);
  });
});
