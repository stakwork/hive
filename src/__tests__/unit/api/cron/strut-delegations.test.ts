/**
 * Unit tests for `GET /api/cron/strut-delegations`.
 *
 * Coverage:
 *   - vercel.json carries a daily entry for the route
 *   - Missing / wrong Authorization header → 401
 *   - STRUT_DELEGATIONS_CRON_ENABLED unset → 200 disabled, reconciler not run
 *   - Enabled → the reconcile result is reported
 *   - Reconciler throw → 500
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";

vi.mock("@/services/strut-delegations-cron", () => ({
  runStrutDelegationReconcile: vi.fn(),
}));

function makeRequest(authHeader?: string, query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/cron/strut-delegations${query}`, {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe("strut-delegations cron — vercel.json", () => {
  it("is scheduled daily", () => {
    const vercelConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"));
    const cron = vercelConfig.crons.find(
      (c: { path: string; schedule: string }) => c.path === "/api/cron/strut-delegations",
    );
    expect(cron).toBeDefined();
    const [minute, hour, dom, month, dow] = cron.schedule.split(" ");
    expect(cron.schedule.split(" ")).toHaveLength(5);
    expect(minute).toMatch(/^\d+$/);
    expect(hour).toMatch(/^\d+$/);
    expect([dom, month, dow]).toEqual(["*", "*", "*"]);
  });
});

describe("GET /api/cron/strut-delegations", () => {
  let GET: (req: NextRequest) => Promise<Response>;
  let runStrutDelegationReconcile: ReturnType<typeof vi.fn>;
  const originalSecret = process.env.CRON_SECRET;
  const originalEnabled = process.env.STRUT_DELEGATIONS_CRON_ENABLED;

  beforeEach(async () => {
    vi.resetModules();
    process.env.CRON_SECRET = "test-secret";
    process.env.STRUT_DELEGATIONS_CRON_ENABLED = "true";
    const mod = await import("@/app/api/cron/strut-delegations/route");
    GET = mod.GET;
    const svc = await import("@/services/strut-delegations-cron");
    runStrutDelegationReconcile = vi.mocked(svc.runStrutDelegationReconcile);
    runStrutDelegationReconcile.mockResolvedValue({
      success: true,
      workspacesProcessed: 2,
      workspacesSkipped: 1,
      pushed: 3,
      deleted: 1,
      errors: [],
      timestamp: new Date("2026-09-22T03:20:00.000Z"),
    });
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
    if (originalEnabled === undefined) delete process.env.STRUT_DELEGATIONS_CRON_ENABLED;
    else process.env.STRUT_DELEGATIONS_CRON_ENABLED = originalEnabled;
  });

  it("returns 401 without the cron secret", async () => {
    expect((await GET(makeRequest())).status).toBe(401);
    expect((await GET(makeRequest("Bearer wrong"))).status).toBe(401);
    expect(runStrutDelegationReconcile).not.toHaveBeenCalled();
  });

  it("is a no-op unless STRUT_DELEGATIONS_CRON_ENABLED=true", async () => {
    delete process.env.STRUT_DELEGATIONS_CRON_ENABLED;
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, message: expect.stringContaining("disabled") });
    expect(runStrutDelegationReconcile).not.toHaveBeenCalled();
  });

  it("runs the reconciler and reports its counts", async () => {
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      workspacesProcessed: 2,
      workspacesSkipped: 1,
      pushed: 3,
      deleted: 1,
      errorCount: 0,
      errors: [],
      timestamp: "2026-09-22T03:20:00.000Z",
    });
    expect(runStrutDelegationReconcile).toHaveBeenCalledWith({ workspaceSlug: undefined });
  });

  it("passes ?workspace= through as a scope", async () => {
    await GET(makeRequest("Bearer test-secret", "?workspace=acme"));
    expect(runStrutDelegationReconcile).toHaveBeenCalledWith({ workspaceSlug: "acme" });
  });

  it("reports per-actor errors with success=false", async () => {
    runStrutDelegationReconcile.mockResolvedValue({
      success: false,
      workspacesProcessed: 1,
      workspacesSkipped: 0,
      pushed: 0,
      deleted: 0,
      errors: [{ workspaceSlug: "acme", actor: "alice-u1", error: "PUT returned 400" }],
      timestamp: new Date(),
    });
    const body = await (await GET(makeRequest("Bearer test-secret"))).json();
    expect(body.success).toBe(false);
    expect(body.errorCount).toBe(1);
    expect(body.errors[0]).toMatchObject({ actor: "alice-u1" });
  });

  it("returns 500 when the reconciler throws", async () => {
    runStrutDelegationReconcile.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });
});
