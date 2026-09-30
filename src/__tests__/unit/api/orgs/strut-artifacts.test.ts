/**
 * Unit tests for GET /api/orgs/[githubLogin]/strut/artifacts — the reader
 * for a `graph` artifact ref (strut `plans/jobs.md`; `services/strut-runs/job-turn.ts`
 * writes the refs).
 *
 * Coverage:
 *   - 401 without a session; 400 for a key outside strut's two link
 *     shapes or with `..`; 404 for an org the caller is not in; 403 for a
 *     swarm outside the org or a workspace the caller cannot read; 404
 *     for a key naming a job / run hive never launched on that swarm;
 *   - the happy path: `GET {lab}<key>` with the DECRYPTED swarm key,
 *     the body streamed back with strut's content-type, CSP and nosniff
 *     kept and `cache-control: private, no-store`; a strut 404 → 404;
 *     a strut 5xx / unreachable → 502.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

const { mockDecrypt } = vi.hoisted(() => ({ mockDecrypt: vi.fn((_f: string, v: string) => `dec(${v})`) }));

vi.mock("@/lib/db", () => ({
  db: {
    swarm: { findUnique: vi.fn() },
    strutRun: { findFirst: vi.fn() },
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
const { GET } = await import("@/app/api/orgs/[githubLogin]/strut/artifacts/route");

const mockSwarmFind = db.swarm.findUnique as Mock;
const mockRunFind = db.strutRun.findFirst as Mock;
const mockResolveOrg = resolveAuthorizedOrgId as Mock;
const mockAccess = validateWorkspaceAccess as Mock;
const mockFetch = vi.fn();

const JOB = "6f1c0d3e-1111-4222-8333-444455556666";
const KEY = `/jobs/${JOB}/files/plan.md`;
const params = { params: Promise.resolve({ githubLogin: "test-org" }) };

function request(query: Record<string, string>, authed = true): NextRequest {
  const req = new NextRequest(`http://localhost/api/orgs/test-org/strut/artifacts?${new URLSearchParams(query)}`);
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  mockResolveOrg.mockResolvedValue("org-1");
  mockSwarmFind.mockResolvedValue(SWARM);
  mockAccess.mockResolvedValue({ hasAccess: true, canRead: true, canWrite: false, canAdmin: false });
  mockRunFind.mockResolvedValue({ id: "row-1" });
  mockFetch.mockImplementation(
    async () =>
      new Response("# Plan\n", {
        status: 200,
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-security-policy": "sandbox",
          "x-content-type-options": "nosniff",
          "content-length": "7",
          "set-cookie": "not-for-the-browser=1",
        },
      }),
  );
});

describe("GET /api/orgs/[githubLogin]/strut/artifacts", () => {
  it("401 without a session", async () => {
    const res = await GET(request({ swarmId: "swarm-1", key: KEY }, false), params);
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("400 for a key outside strut's link shapes, or with `..`, or missing", async () => {
    for (const key of ["/secrets", "/jobs/x/plan.md", `/jobs/${JOB}/files/../../secrets.json`, "/artifacts/1/../x", "https://evil.test/", "", "/jobs//files/a"]) {
      const res = await GET(request({ swarmId: "swarm-1", key }), params);
      expect(res.status, key).toBe(400);
    }
    expect((await GET(request({ key: KEY }), params)).status).toBe(400);
    expect(mockSwarmFind).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("404 when the caller is not in the org", async () => {
    mockResolveOrg.mockResolvedValue(null);
    const res = await GET(request({ swarmId: "swarm-1", key: KEY }), params);
    expect(res.status).toBe(404);
    expect(mockSwarmFind).not.toHaveBeenCalled();
  });

  it("403 for a swarm outside the org, a deleted workspace, or one the caller cannot read", async () => {
    mockSwarmFind.mockResolvedValue({ ...SWARM, workspace: { ...SWARM.workspace, sourceControlOrgId: "org-2" } });
    expect((await GET(request({ swarmId: "swarm-1", key: KEY }), params)).status).toBe(403);
    mockSwarmFind.mockResolvedValue({ ...SWARM, workspace: { ...SWARM.workspace, deleted: true } });
    expect((await GET(request({ swarmId: "swarm-1", key: KEY }), params)).status).toBe(403);
    mockSwarmFind.mockResolvedValue(null);
    expect((await GET(request({ swarmId: "swarm-x", key: KEY }), params)).status).toBe(403);
    mockSwarmFind.mockResolvedValue(SWARM);
    mockAccess.mockResolvedValue({ hasAccess: false, canRead: false, canWrite: false, canAdmin: false });
    expect((await GET(request({ swarmId: "swarm-1", key: KEY }), params)).status).toBe(403);
    expect(mockDecrypt).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("404 for a job or run hive never launched on that swarm — before the key is decrypted", async () => {
    mockRunFind.mockResolvedValue(null);
    expect((await GET(request({ swarmId: "swarm-1", key: KEY }), params)).status).toBe(404);
    expect(mockRunFind).toHaveBeenCalledWith({ where: { swarmId: "swarm-1", jobId: JOB }, select: { id: true } });
    expect((await GET(request({ swarmId: "swarm-1", key: "/artifacts/1790000000000/shot.png" }), params)).status).toBe(404);
    expect(mockRunFind).toHaveBeenLastCalledWith({ where: { swarmId: "swarm-1", strutRunId: "1790000000000" }, select: { id: true } });
    expect(mockDecrypt).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("serves the bytes from the swarm with strut's headers kept, no-store, never the swarm key", async () => {
    const res = await GET(request({ swarmId: "swarm-1", key: KEY }), params);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("# Plan\n");
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("set-cookie")).toBeNull();

    expect(mockDecrypt).toHaveBeenCalledWith("swarmApiKey", "enc-key");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`https://acme.sphinx.chat:3355/lab${KEY}`);
    expect(init.headers["x-api-token"]).toBe("dec(enc-key)");
    expect(mockAccess).toHaveBeenCalledWith("acme", "user-1");
  });

  it("a page keeps strut's sandbox even when the swarm forgot nosniff", async () => {
    mockFetch.mockImplementation(
      async () => new Response("<h1>hi</h1>", { status: 200, headers: { "content-type": "text/html", "content-security-policy": "sandbox" } }),
    );
    const res = await GET(request({ swarmId: "swarm-1", key: `/jobs/${JOB}/files/index.html` }), params);
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("strut 404 → 404; strut 5xx or unreachable → 502", async () => {
    mockFetch.mockImplementation(async () => new Response("not found", { status: 404 }));
    expect((await GET(request({ swarmId: "swarm-1", key: KEY }), params)).status).toBe(404);
    mockFetch.mockImplementation(async () => new Response("boom", { status: 500 }));
    expect((await GET(request({ swarmId: "swarm-1", key: KEY }), params)).status).toBe(502);
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    expect((await GET(request({ swarmId: "swarm-1", key: KEY }), params)).status).toBe(502);
  });
});
