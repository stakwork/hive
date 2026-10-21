/**
 * Unit tests for GET /api/orgs/[githubLogin]/strut/apps/document — a strut
 * app's document for the app frame (strut plans/apps.md §6, §7.2).
 *
 * Coverage:
 *   - 401 without a session; 400 for a query naming no app well (both
 *     shapes at once, a bad version, a path with `..`); 404 for an org the
 *     caller is not in; 403 for a swarm the caller cannot read;
 *   - a WORKSPACE app: the active version read off `/apps/<name>/versions`
 *     unless one is named, the files listed (the token minted), then
 *     `dist/index.html?t=<token>` — with the decrypted key, which never
 *     appears in the response;
 *   - a JOB's app: only for a job hive launched on that swarm; the listing
 *     narrowed to its directory (`?path=`), the document under it;
 *   - a strut with no secret mints no token: the document is read bare;
 *   - the bytes go back as an opaque download, never `text/html`.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

const { mockDecrypt } = vi.hoisted(() => ({ mockDecrypt: vi.fn((_f: string, v: string) => `dec(${v})`) }));

vi.mock("@/lib/db", () => ({
  db: {
    swarm: { findUnique: vi.fn() },
    strutRun: { findFirst: vi.fn() },
    workspace: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/auth/org-access", () => ({ resolveAuthorizedOrgId: vi.fn() }));
vi.mock("@/services/workspace", () => ({ validateWorkspaceAccess: vi.fn() }));
vi.mock("@/lib/encryption", () => ({ EncryptionService: { getInstance: () => ({ decryptField: mockDecrypt }) } }));
vi.mock("@/services/bifrost/strut-delegation", () => ({
  strutLabBaseUrl: (u: string) => `${u.replace("/api", ":3355")}/lab`,
}));

const { db } = await import("@/lib/db");
const { resolveAuthorizedOrgId } = await import("@/lib/auth/org-access");
const { validateWorkspaceAccess } = await import("@/services/workspace");
const { GET } = await import("@/app/api/orgs/[githubLogin]/strut/apps/document/route");

const mockSwarmFind = db.swarm.findUnique as Mock;
const mockRunFind = db.strutRun.findFirst as Mock;
const mockResolveOrg = resolveAuthorizedOrgId as Mock;
const mockAccess = validateWorkspaceAccess as Mock;
const mockFetch = vi.fn();

const params = { params: Promise.resolve({ githubLogin: "test-org" }) };
const LAB = "https://acme.sphinx.chat:3355/lab";
const JOB = "6f1c0d3e-1111-4222-8333-444455556666";
const DOC = '<!doctype html><html><head><meta name="strut-app-token" content="app:bench@v3.tok"></head><body><div id="root"></div></body></html>';

function request(query: Record<string, string>, authed = true): NextRequest {
  const req = new NextRequest(`http://localhost/api/orgs/test-org/strut/apps/document?${new URLSearchParams(query)}`);
  if (authed) {
    req.headers.set(MIDDLEWARE_HEADERS.USER_ID, "user-1");
    req.headers.set(MIDDLEWARE_HEADERS.USER_EMAIL, "t@e.com");
    req.headers.set(MIDDLEWARE_HEADERS.USER_NAME, "T");
    req.headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
  }
  return req;
}

const SWARM = {
  swarmUrl: "https://acme.sphinx.chat/api",
  swarmApiKey: "enc-key",
  workspace: { id: "ws-1", slug: "acme", sourceControlOrgId: "org-1", deleted: false },
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** Strut as it answers: by the path asked, and what each read carried. */
function strut(opts: { token?: string | null } = {}) {
  const token = opts.token === undefined ? "tok" : opts.token;
  mockFetch.mockImplementation(async (url: string) => {
    const path = url.slice(LAB.length);
    if (path === "/apps/bench/versions") return json({ name: "bench", active: "v3", versions: [] });
    if (path === "/apps/bench/v3/files" || path === "/apps/bench/v1/files") return json({ files: ["app.yaml", "dist/index.html"], ...(token ? { token } : {}) });
    if (path.startsWith(`/jobs/${JOB}/files?`)) return json({ job: JOB, path: "apps/tracker", files: ["dist/index.html"], ...(token ? { token } : {}) });
    if (path.includes("/dist/index.html")) return new Response(DOC, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "sandbox allow-scripts" } });
    return new Response(JSON.stringify({ error: "no" }), { status: 404 });
  });
}

const calls = () => mockFetch.mock.calls.map(([url, init]) => ({ path: (url as string).slice(LAB.length), headers: (init as RequestInit).headers as Record<string, string> }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  mockResolveOrg.mockResolvedValue("org-1");
  mockSwarmFind.mockResolvedValue(SWARM);
  mockAccess.mockResolvedValue({ hasAccess: true, canRead: true, canWrite: false, canAdmin: false });
  mockRunFind.mockResolvedValue({ id: "row-1" });
  strut();
});

describe("GET /api/orgs/[githubLogin]/strut/apps/document", () => {
  it("401 without a session", async () => {
    expect((await GET(request({ swarmId: "swarm-1", app: "bench" }, false), params)).status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("400 for a query that names no app well", async () => {
    const queries: Array<Record<string, string>> = [
      { swarmId: "swarm-1" },
      { swarmId: "swarm-1", app: "bench", job: JOB, path: "apps/tracker" },
      { swarmId: "swarm-1", app: "bench", version: "latest" },
      { swarmId: "swarm-1", app: "../secrets" },
      { swarmId: "swarm-1", job: JOB, path: "../../etc" },
      { swarmId: "swarm-1", job: JOB, path: "apps/tracker?t=x" },
      { swarmId: "swarm-1", job: JOB },
    ];
    for (const query of queries) {
      expect((await GET(request(query), params)).status, JSON.stringify(query)).toBe(400);
    }
    expect((await GET(request({ app: "bench" }), params)).status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("404 outside the org; 403 for a workspace the caller cannot read", async () => {
    mockResolveOrg.mockResolvedValueOnce(null);
    expect((await GET(request({ swarmId: "swarm-1", app: "bench" }), params)).status).toBe(404);
    mockAccess.mockResolvedValueOnce({ hasAccess: false, canRead: false, canWrite: false, canAdmin: false });
    expect((await GET(request({ swarmId: "swarm-1", app: "bench" }), params)).status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("a workspace app: its active version, the listing's token, then the document under it — the key never in the response", async () => {
    const res = await GET(request({ swarmId: "swarm-1", app: "bench" }), params);
    expect(res.status).toBe(200);
    expect(calls().map((c) => c.path)).toEqual(["/apps/bench/versions", "/apps/bench/v3/files", "/apps/bench/v3/files/dist/index.html?t=tok"]);
    for (const c of calls()) expect(c.headers["x-api-token"]).toBe("dec(enc-key)");

    const text = await res.text();
    expect(text).toBe(DOC);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const everything = `${text}\n${[...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n")}`;
    expect(everything).not.toContain("dec(enc-key)");
    expect(everything).not.toContain("enc-key");
  });

  it("a named version is read as named", async () => {
    await GET(request({ swarmId: "swarm-1", app: "bench", version: "v1" }), params);
    expect(calls().map((c) => c.path)).toEqual(["/apps/bench/v1/files", "/apps/bench/v1/files/dist/index.html?t=tok"]);
  });

  it("a job's app: only for a job hive launched there; the listing narrowed to its directory", async () => {
    const res = await GET(request({ swarmId: "swarm-1", job: JOB, path: "apps/tracker" }), params);
    expect(res.status).toBe(200);
    expect(mockRunFind).toHaveBeenCalledWith(expect.objectContaining({ where: { swarmId: "swarm-1", jobId: JOB } }));
    expect(calls().map((c) => c.path)).toEqual([
      `/jobs/${JOB}/files?path=apps%2Ftracker`,
      `/jobs/${JOB}/files/apps/tracker/dist/index.html?t=tok`,
    ]);
    expect(await res.text()).toBe(DOC);
  });

  it("404 for a job hive never launched on that swarm, before the swarm is asked", async () => {
    mockRunFind.mockResolvedValue(null);
    expect((await GET(request({ swarmId: "swarm-1", job: JOB, path: "apps/tracker" }), params)).status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("a strut with no secret mints no token: the document is read bare", async () => {
    strut({ token: null });
    await GET(request({ swarmId: "swarm-1", app: "bench", version: "v3" }), params);
    expect(calls().map((c) => c.path)).toEqual(["/apps/bench/v3/files", "/apps/bench/v3/files/dist/index.html"]);
  });

  it("an app strut does not have is a 404; an unbuilt one says so", async () => {
    mockFetch.mockResolvedValue(new Response("{}", { status: 404 }));
    expect((await GET(request({ swarmId: "swarm-1", app: "nope" }), params)).status).toBe(404);

    strut();
    const real = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (url: string, init: RequestInit) =>
      url.includes("/dist/index.html") ? new Response("{}", { status: 404 }) : real(url, init),
    );
    const res = await GET(request({ swarmId: "swarm-1", app: "bench" }), params);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not been built/);
  });

  it("a swarm that cannot be reached or answers 5xx is a 502", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    expect((await GET(request({ swarmId: "swarm-1", app: "bench" }), params)).status).toBe(502);
    mockFetch.mockResolvedValue(new Response("boom", { status: 500 }));
    expect((await GET(request({ swarmId: "swarm-1", app: "bench" }), params)).status).toBe(502);
  });
});
