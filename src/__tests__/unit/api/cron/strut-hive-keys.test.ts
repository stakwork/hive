import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";

vi.mock("@/services/strut-hive-key", () => ({
  runStrutHiveKeyReconcile: vi.fn(),
}));

function makeRequest(authHeader?: string, query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/cron/strut-hive-keys${query}`, {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe("strut-hive-keys cron — vercel.json", () => {
  it("is scheduled daily", () => {
    const vercelConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"));
    const cron = vercelConfig.crons.find(
      (c: { path: string; schedule: string }) => c.path === "/api/cron/strut-hive-keys",
    );
    expect(cron).toBeDefined();
    const [, , dom, month, dow] = cron.schedule.split(" ");
    expect([dom, month, dow]).toEqual(["*", "*", "*"]);
  });
});

describe("GET /api/cron/strut-hive-keys", () => {
  let GET: (req: NextRequest) => Promise<Response>;
  let run: ReturnType<typeof vi.fn>;
  const originalSecret = process.env.CRON_SECRET;
  const originalEnabled = process.env.STRUT_HIVE_KEYS_CRON_ENABLED;
  const originalNextAuthUrl = process.env.NEXTAUTH_URL;

  beforeEach(async () => {
    vi.resetModules();
    process.env.CRON_SECRET = "test-secret";
    process.env.STRUT_HIVE_KEYS_CRON_ENABLED = "true";
    process.env.NEXTAUTH_URL = "https://hive.example.com";
    GET = (await import("@/app/api/cron/strut-hive-keys/route")).GET;
    run = vi.mocked((await import("@/services/strut-hive-key")).runStrutHiveKeyReconcile);
    run.mockResolvedValue({
      success: true,
      swarmsProcessed: 2,
      swarmsSkipped: 1,
      rotated: 1,
      revoked: 0,
      errors: [],
      timestamp: new Date("2026-09-24T03:35:00Z"),
    });
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
    process.env.STRUT_HIVE_KEYS_CRON_ENABLED = originalEnabled;
    process.env.NEXTAUTH_URL = originalNextAuthUrl;
  });

  it("401s without the cron secret", async () => {
    expect((await GET(makeRequest())).status).toBe(401);
    expect((await GET(makeRequest("Bearer wrong"))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("does nothing unless enabled", async () => {
    process.env.STRUT_HIVE_KEYS_CRON_ENABLED = "";
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect((await res.json()).message).toContain("disabled");
    expect(run).not.toHaveBeenCalled();
  });

  it("runs with the canonical HIVE_URL and reports the result", async () => {
    const res = await GET(makeRequest("Bearer test-secret", "?workspace=ws-1"));
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith({ publicBaseUrl: "https://hive.example.com", workspaceSlug: "ws-1" });
    const body = await res.json();
    expect(body).toMatchObject({ success: true, swarmsProcessed: 2, rotated: 1, errorCount: 0 });
  });

  it("500s when the reconciler throws", async () => {
    run.mockRejectedValue(new Error("db down"));
    expect((await GET(makeRequest("Bearer test-secret"))).status).toBe(500);
  });
});
