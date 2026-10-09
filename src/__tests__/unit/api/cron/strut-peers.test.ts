/**
 * Unit tests for `GET /api/cron/strut-peers`.
 *
 * Coverage:
 *   - vercel.json carries a daily entry for the route, after the delegations cron
 *   - Missing / wrong Authorization header → 401
 *   - STRUT_PEERS_CRON_ENABLED unset → 200 disabled, reconciler not run
 *   - Enabled → the reconcile result is reported; `?org=` scopes it
 *   - Reconciler throw → 500
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";

vi.mock("@/services/strut-peers", () => ({
  runStrutPeersReconcile: vi.fn(),
}));

function makeRequest(authHeader?: string, query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/cron/strut-peers${query}`, {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe("strut-peers cron — vercel.json", () => {
  it("is scheduled daily, after the delegations it fans out", () => {
    const vercelConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"));
    const schedule = (p: string) =>
      vercelConfig.crons.find((c: { path: string; schedule: string }) => c.path === p)?.schedule as string;
    const [minute, hour, dom, month, dow] = schedule("/api/cron/strut-peers").split(" ");
    expect(minute).toMatch(/^\d+$/);
    expect(hour).toMatch(/^\d+$/);
    expect([dom, month, dow]).toEqual(["*", "*", "*"]);
    const [dMinute, dHour] = schedule("/api/cron/strut-delegations").split(" ").map(Number);
    expect(Number(hour) * 60 + Number(minute)).toBeGreaterThan(dHour * 60 + dMinute);
  });
});

describe("GET /api/cron/strut-peers", () => {
  let GET: (req: NextRequest) => Promise<Response>;
  let runStrutPeersReconcile: ReturnType<typeof vi.fn>;
  const originalSecret = process.env.CRON_SECRET;
  const originalEnabled = process.env.STRUT_PEERS_CRON_ENABLED;

  beforeEach(async () => {
    vi.resetModules();
    process.env.CRON_SECRET = "test-secret";
    process.env.STRUT_PEERS_CRON_ENABLED = "true";
    const mod = await import("@/app/api/cron/strut-peers/route");
    GET = mod.GET;
    const svc = await import("@/services/strut-peers");
    runStrutPeersReconcile = vi.mocked(svc.runStrutPeersReconcile);
    runStrutPeersReconcile.mockResolvedValue({
      success: true,
      orgsProcessed: 2,
      peersPushed: 5,
      peersUnsupported: 1,
      delegationsPushed: 3,
      errors: [],
      timestamp: new Date("2026-10-10T03:50:00.000Z"),
    });
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
    if (originalEnabled === undefined) delete process.env.STRUT_PEERS_CRON_ENABLED;
    else process.env.STRUT_PEERS_CRON_ENABLED = originalEnabled;
  });

  it("returns 401 without the cron secret", async () => {
    expect((await GET(makeRequest())).status).toBe(401);
    expect((await GET(makeRequest("Bearer wrong"))).status).toBe(401);
    expect(runStrutPeersReconcile).not.toHaveBeenCalled();
  });

  it("is a no-op unless STRUT_PEERS_CRON_ENABLED=true", async () => {
    delete process.env.STRUT_PEERS_CRON_ENABLED;
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, message: expect.stringContaining("disabled") });
    expect(runStrutPeersReconcile).not.toHaveBeenCalled();
  });

  it("runs the reconciler and reports its counts", async () => {
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      orgsProcessed: 2,
      peersPushed: 5,
      peersUnsupported: 1,
      delegationsPushed: 3,
      errorCount: 0,
      errors: [],
      timestamp: "2026-10-10T03:50:00.000Z",
    });
    expect(runStrutPeersReconcile).toHaveBeenCalledWith({ org: undefined });
  });

  it("passes ?org= through as a scope, and reports errors with success=false", async () => {
    runStrutPeersReconcile.mockResolvedValue({
      success: false,
      orgsProcessed: 1,
      peersPushed: 0,
      peersUnsupported: 0,
      delegationsPushed: 0,
      errors: [{ org: "acme", peer: "acme-web", error: "ECONNREFUSED" }],
      timestamp: new Date(),
    });
    const body = await (await GET(makeRequest("Bearer test-secret", "?org=acme"))).json();
    expect(runStrutPeersReconcile).toHaveBeenCalledWith({ org: "acme" });
    expect(body).toMatchObject({ success: false, errorCount: 1, errors: [{ peer: "acme-web" }] });
  });

  it("returns 500 when the reconciler throws", async () => {
    runStrutPeersReconcile.mockRejectedValue(new Error("db down"));
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });
});
