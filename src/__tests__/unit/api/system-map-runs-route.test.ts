import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/auth/workspace-access", () => ({ resolveWorkspaceAccess: vi.fn() }));
vi.mock("@/lib/protect/access", () => ({ requireProtectMemberAccess: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({
  canAccessServerFeature: vi.fn(() => true),
  FEATURE_FLAGS: { CODEBASE_RECOMMENDATION: "x" },
}));
vi.mock("@/lib/system-map/security-audit-classes", async () => {
  const { fallbackSecurityAuditClasses } = await import("@/lib/system-map/security-audit");
  return { getSecurityAuditClasses: vi.fn(async () => fallbackSecurityAuditClasses()) };
});
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/utils", () => ({ getBaseUrl: () => "https://hive.test" }));
vi.mock("@/services/strut-runs", () => ({
  StrutDispatchError: class extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/services/strut-runs/system-map", async () => {
  const actual = await vi.importActual<typeof import("@/services/strut-runs/system-map")>(
    "@/services/strut-runs/system-map",
  );
  return { ...actual, hasPendingSystemMapRun: vi.fn(), launchSystemMapRun: vi.fn(), listSystemMapRuns: vi.fn() };
});

import { requireProtectMemberAccess } from "@/lib/protect/access";
import { checkRateLimit } from "@/lib/rate-limit";
import { hasPendingSystemMapRun, launchSystemMapRun } from "@/services/strut-runs/system-map";
import { POST } from "@/app/api/workspaces/[slug]/system-map/runs/route";

const params = { params: Promise.resolve({ slug: "ws" }) };
const post = (body: unknown) =>
  new NextRequest("http://localhost/api/workspaces/ws/system-map/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const member = (role: string) => ({ workspaceId: "w1", slug: "ws", userId: "u1", role });
const audit = { workflow: "security_audit", repos: ["acme/api", "acme/web"] };

describe("system-map runs POST: security_audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireProtectMemberAccess).mockReturnValue(member("DEVELOPER") as never);
    vi.mocked(hasPendingSystemMapRun).mockResolvedValue(false);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
    vi.mocked(launchSystemMapRun).mockResolvedValue({ runId: "r1", strutRunId: "s1", strutUrl: null } as never);
  });

  it("launches with the parsed audit input (dry run by default) and returns 202", async () => {
    const res = await POST(post({ ...audit, classes: ["Injection"], maxAgentCalls: 120 }), params);
    expect(res.status).toBe(202);
    expect(launchSystemMapRun).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "security_audit",
        audit: { repos: ["acme/api", "acme/web"], classes: ["Injection"], apply: false, maxAgentCalls: 120 },
      }),
    );
  });

  it("passes apply through", async () => {
    await POST(post({ ...audit, apply: true }), params);
    expect(launchSystemMapRun).toHaveBeenCalledWith(
      expect.objectContaining({ audit: { repos: audit.repos, apply: true } }),
    );
  });

  it.each([
    ["missing repos", { workflow: "security_audit" }],
    ["bad repo", { ...audit, repos: ["nope"] }],
    ["unknown class", { ...audit, classes: ["Nope"] }],
    ["bad maxAgentCalls", { ...audit, maxAgentCalls: 5000 }],
    ["non-boolean apply", { ...audit, apply: "yes" }],
    ["repos on another workflow", { workflow: "cwe_check", repos: ["acme/api"] }],
  ])("400 on %s", async (_n, body) => {
    expect((await POST(post(body), params)).status).toBe(400);
    expect(launchSystemMapRun).not.toHaveBeenCalled();
  });

  it("403 below developer", async () => {
    vi.mocked(requireProtectMemberAccess).mockReturnValue(member("VIEWER") as never);
    expect((await POST(post(audit), params)).status).toBe(403);
  });

  it("passes access denials", async () => {
    vi.mocked(requireProtectMemberAccess).mockReturnValue(NextResponse.json({ error: "no" }, { status: 403 }) as never);
    expect((await POST(post(audit), params)).status).toBe(403);
  });

  it("409 when a run is in flight", async () => {
    vi.mocked(hasPendingSystemMapRun).mockResolvedValue(true);
    expect((await POST(post(audit), params)).status).toBe(409);
    expect(launchSystemMapRun).not.toHaveBeenCalled();
  });

  it("429 when rate limited", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfter: 30 } as never);
    const res = await POST(post(audit), params);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });
});
