import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/workspace-access", () => ({ resolveWorkspaceAccess: vi.fn() }));
vi.mock("@/lib/protect/access", () => ({ requireProtectMemberAccess: vi.fn(() => ({ role: "DEVELOPER" })) }));
vi.mock("@/lib/feature-flags", () => ({
  canAccessServerFeature: vi.fn(() => true),
  FEATURE_FLAGS: { CODEBASE_RECOMMENDATION: "x" },
}));
vi.mock("@/lib/system-map/infosec-door", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/system-map/infosec-door")>()),
  runCweCatalog: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { canAccessServerFeature } from "@/lib/feature-flags";
import { InfosecDoorError, runCweCatalog } from "@/lib/system-map/infosec-door";
import { GET as list } from "@/app/api/workspaces/[slug]/system-map/cwe-list/route";
import { GET as search } from "@/app/api/workspaces/[slug]/system-map/cwe-search/route";
import { GET as related } from "@/app/api/workspaces/[slug]/system-map/cwe-related/route";

const run = vi.mocked(runCweCatalog);
const params = { params: Promise.resolve({ slug: "ws" }) };
const req = (path: string) => new NextRequest(`http://localhost/api/workspaces/ws/system-map/${path}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(canAccessServerFeature).mockReturnValue(true);
});

describe("cwe routes", () => {
  it("cwe-list: ready → 200", async () => {
    run.mockResolvedValue({ status: "ready", view: { id: "CWE-1435", name: "T" }, members: [] });
    const res = await list(req("cwe-list?view=CWE-1435"), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready", view: { id: "CWE-1435", name: "T" }, members: [] });
  });

  it("cwe-list: bad view → 400, flag off → 404", async () => {
    expect((await list(req("cwe-list?view=nope"), params)).status).toBe(400);
    vi.mocked(canAccessServerFeature).mockReturnValue(false);
    expect((await list(req("cwe-list?view=CWE-1435"), params)).status).toBe(404);
  });

  it("cwe-list: busy → 503 with Retry-After", async () => {
    run.mockRejectedValue(new InfosecDoorError("The infosec catalogue is busy, try again in a minute", "busy"));
    const res = await list(req("cwe-list?view=CWE-1435"), params);
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.json()).toEqual({ status: "error", error: "The infosec catalogue is busy, try again in a minute" });
  });

  it("cwe-search: validates q, maps timeout → 504", async () => {
    expect((await search(req("cwe-search?q="), params)).status).toBe(400);
    expect((await search(req(`cwe-search?q=${"a".repeat(201)}`), params)).status).toBe(400);
    run.mockRejectedValue(new InfosecDoorError("slow", "timeout"));
    expect((await search(req("cwe-search?q=xss"), params)).status).toBe(504);
  });

  it("cwe-search: failure → 502, ready → 200", async () => {
    run.mockRejectedValueOnce(new InfosecDoorError("down", "unavailable"));
    expect((await search(req("cwe-search?q=xss"), params)).status).toBe(502);
    run.mockResolvedValueOnce({ status: "ready", results: [] });
    expect((await search(req("cwe-search?q=xss"), params)).status).toBe(200);
  });

  it("cwe-related: ready passes capec/cves; not found → 404", async () => {
    const cves = { total: 1, recent: [] };
    run.mockResolvedValueOnce({ status: "ready", templates: [], mitigations: [], detection: [], platforms: [], capec: [], cves });
    const ok = await related(req("cwe-related?refId=abc"), params);
    expect(ok.status).toBe(200);
    expect((await ok.json()).cves).toEqual(cves);
    run.mockResolvedValueOnce({ status: "error", error: "CWE not found: abc" });
    const missing = await related(req("cwe-related?refId=abc"), params);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ status: "error", error: "CWE not found: abc" });
    expect((await related(req("cwe-related?refId=bad%20id"), params)).status).toBe(400);
  });
});
