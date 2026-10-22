/**
 * Unit tests for GET /api/workspaces/[slug]/strut/apps — the apps the
 * workspace's swarm has pinned as tabs (strut `PUT /apps/:name/pin`).
 *
 * Coverage:
 *   - 401 without a session; 404 for a workspace the caller cannot read,
 *     before the swarm is looked up;
 *   - a workspace with no swarm has no tabs, and strut is not called;
 *   - strut's `GET /apps` read with the decrypted key: only `pinned: true`
 *     entries, in strut's order, the title falling back to the name, a name
 *     hive would not put in a URL dropped; the key never in the response;
 *   - a swarm that does not answer is a 502.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

const { mockDecrypt } = vi.hoisted(() => ({ mockDecrypt: vi.fn((_f: string, v: string) => `dec(${v})`) }));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findUnique: vi.fn() },
    swarm: { findUnique: vi.fn() },
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
const { GET } = await import("@/app/api/workspaces/[slug]/strut/apps/route");

const mockWorkspaceFind = db.workspace.findUnique as Mock;
const mockSwarmFind = db.swarm.findUnique as Mock;
const mockResolveOrg = resolveAuthorizedOrgId as Mock;
const mockAccess = validateWorkspaceAccess as Mock;
const mockFetch = vi.fn();

const params = { params: Promise.resolve({ slug: "openhealth" }) };
const LAB = "https://oh.sphinx.chat:3355/lab";

function request(authed = true): NextRequest {
  const req = new NextRequest("http://localhost/api/workspaces/openhealth/strut/apps");
  if (authed) {
    req.headers.set(MIDDLEWARE_HEADERS.USER_ID, "user-1");
    req.headers.set(MIDDLEWARE_HEADERS.USER_EMAIL, "t@e.com");
    req.headers.set(MIDDLEWARE_HEADERS.USER_NAME, "T");
    req.headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
  }
  return req;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const APPS = [
  { name: "strut/views", activeVersion: "v2", title: "strut views", grants: {} },
  { name: "openhealth-benchmark", activeVersion: "v1", title: "OpenHealth Benchmark", grants: {}, pinned: true },
  { name: "acme/invoices", activeVersion: "v3", title: "  ", grants: {}, pinned: true },
  { name: "bad name", activeVersion: "v1", title: "Bad", grants: {}, pinned: true },
  { name: "half", activeVersion: "v1", title: "Half", grants: {}, pinned: "yes" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  mockAccess.mockResolvedValue({ hasAccess: true, canRead: true, canWrite: false, canAdmin: false });
  mockWorkspaceFind.mockResolvedValue({ swarm: { id: "swarm-oh" }, sourceControlOrg: { githubLogin: "stakwork" } });
  mockResolveOrg.mockResolvedValue("org-1");
  mockSwarmFind.mockResolvedValue({
    swarmUrl: "https://oh.sphinx.chat/api",
    swarmApiKey: "enc-key",
    workspace: { id: "ws-oh", slug: "openhealth", sourceControlOrgId: "org-1", deleted: false },
  });
  mockFetch.mockImplementation(async (url: string) => (url === `${LAB}/apps` ? json({ apps: APPS }) : json({ error: "no" }, 404)));
});

describe("GET /api/workspaces/[slug]/strut/apps", () => {
  it("401 without a session", async () => {
    expect((await GET(request(false), params)).status).toBe(401);
  });

  it("404 for a workspace the caller cannot read, before the swarm is looked up", async () => {
    mockAccess.mockResolvedValue({ hasAccess: true, canRead: false, canWrite: false, canAdmin: false });
    expect((await GET(request(), params)).status).toBe(404);
    expect(mockWorkspaceFind).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("a workspace with no swarm has no tabs", async () => {
    mockWorkspaceFind.mockResolvedValue({ swarm: null, sourceControlOrg: { githubLogin: "stakwork" } });
    const res = await GET(request(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ apps: [] });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("lists the pinned apps from the swarm's strut, with the decrypted key", async () => {
    const res = await GET(request(), params);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      githubLogin: "stakwork",
      swarmId: "swarm-oh",
      apps: [
        { name: "openhealth-benchmark", title: "OpenHealth Benchmark" },
        { name: "acme/invoices", title: "acme/invoices" },
      ],
    });
    expect(text).not.toContain("enc-key");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${LAB}/apps`);
    expect((init as RequestInit).headers).toMatchObject({ "x-api-token": "dec(enc-key)" });
  });

  it("a swarm that does not answer is a 502", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    expect((await GET(request(), params)).status).toBe(502);
  });
});
