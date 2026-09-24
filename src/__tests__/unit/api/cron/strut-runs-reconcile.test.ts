/**
 * Unit tests for `GET /api/cron/strut-runs-reconcile`.
 *
 * Coverage:
 *   - vercel.json carries a 10-minute entry for the route
 *   - Missing / wrong Authorization header → 401
 *   - STRUT_RUNS_RECONCILE_CRON_ENABLED=false → 200 disabled, reconcile not run
 *   - Enabled (the default) → the reconcile stats are reported
 *   - Reconcile throw → 500
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";

vi.mock("@/services/strut-runs", () => ({ reconcileStrutRuns: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

function makeRequest(authHeader?: string): NextRequest {
  return new NextRequest("http://localhost/api/cron/strut-runs-reconcile", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe("strut-runs-reconcile cron — vercel.json", () => {
  it("is scheduled every 10 minutes", () => {
    const vercelConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"));
    const cron = vercelConfig.crons.find(
      (c: { path: string; schedule: string }) => c.path === "/api/cron/strut-runs-reconcile",
    );
    expect(cron).toBeDefined();
    expect(cron.schedule).toBe("*/10 * * * *");
  });
});

describe("GET /api/cron/strut-runs-reconcile", () => {
  let GET: (req: NextRequest) => Promise<Response>;
  let reconcileStrutRuns: ReturnType<typeof vi.fn>;
  const originalSecret = process.env.CRON_SECRET;
  const originalEnabled = process.env.STRUT_RUNS_RECONCILE_CRON_ENABLED;

  beforeEach(async () => {
    vi.resetModules();
    process.env.CRON_SECRET = "test-secret";
    delete process.env.STRUT_RUNS_RECONCILE_CRON_ENABLED;
    const mod = await import("@/app/api/cron/strut-runs-reconcile/route");
    GET = mod.GET;
    const svc = await import("@/services/strut-runs");
    reconcileStrutRuns = vi.mocked(svc.reconcileStrutRuns) as unknown as ReturnType<typeof vi.fn>;
    reconcileStrutRuns.mockResolvedValue({ swept: 2, settled: 1, lost: 1, running: 0, unavailable: 0, retry: 0 });
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
    if (originalEnabled === undefined) delete process.env.STRUT_RUNS_RECONCILE_CRON_ENABLED;
    else process.env.STRUT_RUNS_RECONCILE_CRON_ENABLED = originalEnabled;
  });

  it("returns 401 without the cron secret", async () => {
    expect((await GET(makeRequest())).status).toBe(401);
    expect((await GET(makeRequest("Bearer wrong"))).status).toBe(401);
    expect(reconcileStrutRuns).not.toHaveBeenCalled();
  });

  it("is a no-op when STRUT_RUNS_RECONCILE_CRON_ENABLED=false", async () => {
    process.env.STRUT_RUNS_RECONCILE_CRON_ENABLED = "false";
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, message: expect.stringContaining("disabled") });
    expect(reconcileStrutRuns).not.toHaveBeenCalled();
  });

  it("runs the reconcile by default and reports its stats", async () => {
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, stats: { swept: 2, settled: 1, lost: 1 } });
    expect(reconcileStrutRuns).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when the reconcile throws", async () => {
    reconcileStrutRuns.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false, error: "db down" });
  });
});
