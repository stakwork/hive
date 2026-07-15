/**
 * Unit tests for `GET /api/cron/legal-recursion`.
 *
 * Coverage:
 *   - Missing / wrong Authorization header → 401
 *   - Valid auth → calls executeScheduledLegalBenchmarkRecursion and surfaces its return value
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock the service before any route import.
vi.mock("@/services/legal-recursion-cron", () => ({
  executeScheduledLegalBenchmarkRecursion: vi.fn(),
}));

function makeRequest(authHeader?: string): NextRequest {
  return new NextRequest("http://localhost/api/cron/legal-recursion", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe("GET /api/cron/legal-recursion — auth guard", () => {
  let GET: (req: NextRequest) => Promise<Response>;
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(async () => {
    vi.resetModules();
    process.env.CRON_SECRET = "test-secret";
    const mod = await import("@/app/api/cron/legal-recursion/route");
    GET = mod.GET;

    const { executeScheduledLegalBenchmarkRecursion } = await import(
      "@/services/legal-recursion-cron"
    );
    vi.mocked(executeScheduledLegalBenchmarkRecursion).mockResolvedValue({
      success: true,
      entriesProcessed: 0,
      dispatched: 0,
      skipped: 0,
      deactivated: 0,
      errors: [],
      timestamp: new Date(),
    });
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when Authorization header has wrong secret", async () => {
    const res = await GET(makeRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 for a malformed Authorization header (no Bearer prefix)", async () => {
    const res = await GET(makeRequest("test-secret"));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/cron/legal-recursion — successful dispatch", () => {
  let GET: (req: NextRequest) => Promise<Response>;
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
    const mod = await import("@/app/api/cron/legal-recursion/route");
    GET = mod.GET;
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  it("calls executeScheduledLegalBenchmarkRecursion and surfaces its return value", async () => {
    const { executeScheduledLegalBenchmarkRecursion } = await import(
      "@/services/legal-recursion-cron"
    );
    vi.mocked(executeScheduledLegalBenchmarkRecursion).mockResolvedValue({
      success: true,
      entriesProcessed: 3,
      dispatched: 2,
      skipped: 1,
      deactivated: 0,
      errors: [],
      timestamp: new Date("2026-01-01T00:00:00.000Z"),
    });

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(executeScheduledLegalBenchmarkRecursion).toHaveBeenCalledOnce();
    expect(body.success).toBe(true);
    expect(body.entriesProcessed).toBe(3);
    expect(body.dispatched).toBe(2);
    expect(body.skipped).toBe(1);
    expect(body.errorCount).toBe(0);
  });

  it("does NOT check LEGAL_RECURSION_CRON_ENABLED env var (removed)", async () => {
    // Ensure the env var is absent — the route should still proceed
    delete process.env.LEGAL_RECURSION_CRON_ENABLED;

    const { executeScheduledLegalBenchmarkRecursion } = await import(
      "@/services/legal-recursion-cron"
    );
    vi.mocked(executeScheduledLegalBenchmarkRecursion).mockResolvedValue({
      success: true,
      entriesProcessed: 0,
      dispatched: 0,
      skipped: 0,
      deactivated: 0,
      errors: [],
      timestamp: new Date(),
    });

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(executeScheduledLegalBenchmarkRecursion).toHaveBeenCalledOnce();
  });
});
