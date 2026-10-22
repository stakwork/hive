/**
 * Unit tests for /api/orgs/[githubLogin]/strut/apps/pin — the app card's
 * "Pin as a tab in <workspace>" (strut `PUT /apps/:name/pin`).
 *
 * Coverage:
 *   - 401 without a session; 400 for a request naming no app well;
 *   - GET: the pin read off strut's `GET /apps`, the SWARM's workspace by
 *     name, and whether the caller may pin (its admin); 404 for an app the
 *     swarm does not have;
 *   - POST: 403 for a non-admin before strut is called; the name encoded
 *     whole, `{ pinned }` sent with the decrypted key; strut's 4xx and its
 *     message passed through; the key never in a response.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

const { mockDecrypt } = vi.hoisted(() => ({ mockDecrypt: vi.fn((_f: string, v: string) => `dec(${v})`) }));

vi.mock("@/lib/db", () => ({ db: { swarm: { findUnique: vi.fn() } } }));
vi.mock("@/lib/auth/org-access", () => ({ resolveAuthorizedOrgId: vi.fn() }));
vi.mock("@/services/workspace", () => ({ validateWorkspaceAccess: vi.fn() }));
vi.mock("@/lib/encryption", () => ({ EncryptionService: { getInstance: () => ({ decryptField: mockDecrypt }) } }));
vi.mock("@/services/bifrost/strut-delegation", () => ({
  strutLabBaseUrl: (u: string) => `${u.replace("/api", ":3355")}/lab`,
}));

const { db } = await import("@/lib/db");
const { resolveAuthorizedOrgId } = await import("@/lib/auth/org-access");
const { validateWorkspaceAccess } = await import("@/services/workspace");
const { GET, POST } = await import("@/app/api/orgs/[githubLogin]/strut/apps/pin/route");

const mockSwarmFind = db.swarm.findUnique as Mock;
const mockResolveOrg = resolveAuthorizedOrgId as Mock;
const mockAccess = validateWorkspaceAccess as Mock;
const mockFetch = vi.fn();

const params = { params: Promise.resolve({ githubLogin: "stakwork" }) };
const LAB = "https://oh.sphinx.chat:3355/lab";

function authed(req: NextRequest, on = true): NextRequest {
  if (on) {
    req.headers.set(MIDDLEWARE_HEADERS.USER_ID, "user-1");
    req.headers.set(MIDDLEWARE_HEADERS.USER_EMAIL, "t@e.com");
    req.headers.set(MIDDLEWARE_HEADERS.USER_NAME, "T");
    req.headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
  }
  return req;
}
const get = (query: Record<string, string>, on = true) =>
  authed(new NextRequest(`http://localhost/api/orgs/stakwork/strut/apps/pin?${new URLSearchParams(query)}`), on);
const post = (body: unknown, on = true) =>
  authed(new NextRequest("http://localhost/api/orgs/stakwork/strut/apps/pin", { method: "POST", body: JSON.stringify(body) }), on);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  mockResolveOrg.mockResolvedValue("org-1");
  mockSwarmFind.mockResolvedValue({
    swarmUrl: "https://oh.sphinx.chat/api",
    swarmApiKey: "enc-key",
    workspace: { id: "ws-oh", slug: "openhealth", name: "Open Health", sourceControlOrgId: "org-1", deleted: false },
  });
  mockAccess.mockResolvedValue({ hasAccess: true, canRead: true, canWrite: true, canAdmin: true });
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === `${LAB}/apps`) return json({ apps: [{ name: "acme/bench", title: "Bench", pinned: true }, { name: "other", title: "Other" }] });
    if (url === `${LAB}/apps/${encodeURIComponent("acme/bench")}/pin` && init?.method === "PUT") {
      return json({ ok: true, name: "acme/bench", pinned: JSON.parse(init.body as string).pinned });
    }
    return json({ error: 'App "nope" not found' }, 404);
  });
});

describe("GET /api/orgs/[githubLogin]/strut/apps/pin", () => {
  it("401 without a session, 400 without an app", async () => {
    expect((await GET(get({ swarmId: "s", app: "acme/bench" }, false), params)).status).toBe(401);
    expect((await GET(get({ swarmId: "s" }), params)).status).toBe(400);
  });

  it("reads the pin off strut, names the swarm's workspace, says whether the caller may pin", async () => {
    const res = await GET(get({ swarmId: "swarm-oh", app: "acme/bench" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pinned: true, workspace: { slug: "openhealth", name: "Open Health" }, canPin: true });
    mockAccess.mockResolvedValue({ hasAccess: true, canRead: true, canWrite: false, canAdmin: false });
    const other = await GET(get({ swarmId: "swarm-oh", app: "other" }), params);
    expect(await other.json()).toMatchObject({ pinned: false, canPin: false });
  });

  it("404 for an app the swarm does not have", async () => {
    expect((await GET(get({ swarmId: "swarm-oh", app: "nope" }), params)).status).toBe(404);
  });
});

describe("POST /api/orgs/[githubLogin]/strut/apps/pin", () => {
  it("401 without a session, 400 without a boolean", async () => {
    expect((await POST(post({ swarmId: "swarm-oh", app: "acme/bench", pinned: true }, false), params)).status).toBe(401);
    expect((await POST(post({ swarmId: "swarm-oh", app: "acme/bench", pinned: "yes" }), params)).status).toBe(400);
  });

  it("403 for a non-admin of the swarm's workspace, before strut is called", async () => {
    mockAccess.mockResolvedValue({ hasAccess: true, canRead: true, canWrite: true, canAdmin: false });
    const res = await POST(post({ swarmId: "swarm-oh", app: "acme/bench", pinned: true }), params);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("Open Health");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("pins through strut with the decrypted key, the name encoded whole", async () => {
    const res = await POST(post({ swarmId: "swarm-oh", app: "acme/bench", pinned: false }), params);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ pinned: false, workspace: { slug: "openhealth", name: "Open Health" } });
    expect(text).not.toContain("enc-key");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${LAB}/apps/acme%2Fbench/pin`);
    expect(init).toMatchObject({ method: "PUT", body: JSON.stringify({ pinned: false }) });
    expect((init as RequestInit).headers).toMatchObject({ "x-api-token": "dec(enc-key)" });
  });

  it("passes strut's 404 and its message through", async () => {
    const res = await POST(post({ swarmId: "swarm-oh", app: "nope", pinned: true }), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'App "nope" not found' });
  });

  it("a swarm that does not answer is a 502", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    expect((await POST(post({ swarmId: "swarm-oh", app: "acme/bench", pinned: true }), params)).status).toBe(502);
  });
});
