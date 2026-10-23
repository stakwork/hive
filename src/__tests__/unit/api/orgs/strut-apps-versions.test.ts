/**
 * Unit tests for /api/orgs/[githubLogin]/strut/apps/versions — an app card's
 * version picker and its "Make vN live" (strut `GET /apps/:name/versions`,
 * `PUT /apps/:name/active`).
 *
 * Coverage:
 *   - 401 without a session; 400 for a request naming no app or version well;
 *   - GET: the live version and every version newest first, read off
 *     strut's record, and whether the caller may change the live one (an
 *     admin of the swarm's workspace); 404 for an app the swarm lacks;
 *   - POST: 403 for a non-admin before strut is called; the name encoded
 *     whole, `{ version }` sent with the decrypted key; strut's 4xx and its
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
const { GET, POST } = await import("@/app/api/orgs/[githubLogin]/strut/apps/versions/route");

const mockSwarmFind = db.swarm.findUnique as Mock;
const mockResolveOrg = resolveAuthorizedOrgId as Mock;
const mockAccess = validateWorkspaceAccess as Mock;
const mockFetch = vi.fn();

const params = { params: Promise.resolve({ githubLogin: "stakwork" }) };
const LAB = "https://oh.sphinx.chat:3355/lab";
const BENCH = encodeURIComponent("acme/bench");

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
  authed(new NextRequest(`http://localhost/api/orgs/stakwork/strut/apps/versions?${new URLSearchParams(query)}`), on);
const post = (body: unknown, on = true) =>
  authed(new NextRequest("http://localhost/api/orgs/stakwork/strut/apps/versions", { method: "POST", body: JSON.stringify(body) }), on);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Strut's record, as `GET /apps/:name/versions` serves it: versions keyed by label, in no promised order. */
const record = {
  name: "acme/bench",
  active: "v10",
  versions: {
    v2: { createdAt: "2026-10-22T21:30:00.000Z", hash: "b", manifest: {} },
    v10: { createdAt: "2026-10-23T04:39:14.000Z", hash: "j", manifest: {} },
    v1: { createdAt: "2026-10-22T21:23:42.000Z", hash: "a", manifest: {} },
    latest: { createdAt: "x" },
  },
};

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
    if (url === `${LAB}/apps/${BENCH}/versions`) return json(record);
    if (url === `${LAB}/apps/${BENCH}/active` && init?.method === "PUT") {
      const { version } = JSON.parse(init.body as string) as { version: string };
      return version === "v9" ? json({ error: 'Version "v9" not found for app "acme/bench"' }, 404) : json({ ok: true, name: "acme/bench", active: version });
    }
    return json({ error: 'App "nope" not found' }, 404);
  });
});

describe("GET /api/orgs/[githubLogin]/strut/apps/versions", () => {
  it("401 without a session, 400 without an app", async () => {
    expect((await GET(get({ swarmId: "s", app: "acme/bench" }, false), params)).status).toBe(401);
    expect((await GET(get({ swarmId: "s" }), params)).status).toBe(400);
  });

  it("reads the live version and every version newest first, and whether the caller may change the live one", async () => {
    const res = await GET(get({ swarmId: "swarm-oh", app: "acme/bench" }), params);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      live: "v10",
      versions: [
        { version: "v10", createdAt: "2026-10-23T04:39:14.000Z" },
        { version: "v2", createdAt: "2026-10-22T21:30:00.000Z" },
        { version: "v1", createdAt: "2026-10-22T21:23:42.000Z" },
      ],
      canSetLive: true,
    });
    expect(text).not.toContain("enc-key");
    expect((mockFetch.mock.calls[0][1] as RequestInit).headers).toMatchObject({ "x-api-token": "dec(enc-key)" });
    mockAccess.mockResolvedValue({ hasAccess: true, canRead: true, canWrite: true, canAdmin: false });
    expect(await (await GET(get({ swarmId: "swarm-oh", app: "acme/bench" }), params)).json()).toMatchObject({ canSetLive: false });
  });

  it("404 for an app the swarm does not have", async () => {
    expect((await GET(get({ swarmId: "swarm-oh", app: "nope" }), params)).status).toBe(404);
  });
});

describe("POST /api/orgs/[githubLogin]/strut/apps/versions", () => {
  it("401 without a session, 400 without a version label", async () => {
    expect((await POST(post({ swarmId: "swarm-oh", app: "acme/bench", version: "v2" }, false), params)).status).toBe(401);
    expect((await POST(post({ swarmId: "swarm-oh", app: "acme/bench", version: "latest" }), params)).status).toBe(400);
    expect((await POST(post({ swarmId: "swarm-oh", app: "../x", version: "v2" }), params)).status).toBe(400);
  });

  it("403 for a non-admin of the swarm's workspace, before strut is called", async () => {
    mockAccess.mockResolvedValue({ hasAccess: true, canRead: true, canWrite: true, canAdmin: false });
    const res = await POST(post({ swarmId: "swarm-oh", app: "acme/bench", version: "v2" }), params);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("Open Health");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("makes the version live through strut with the decrypted key, the name encoded whole", async () => {
    const res = await POST(post({ swarmId: "swarm-oh", app: "acme/bench", version: "v2" }), params);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ live: "v2" });
    expect(text).not.toContain("enc-key");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${LAB}/apps/${BENCH}/active`);
    expect(init).toMatchObject({ method: "PUT", body: JSON.stringify({ version: "v2" }) });
    expect((init as RequestInit).headers).toMatchObject({ "x-api-token": "dec(enc-key)" });
  });

  it("passes strut's 404 and its message through", async () => {
    const res = await POST(post({ swarmId: "swarm-oh", app: "acme/bench", version: "v9" }), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Version "v9" not found for app "acme/bench"' });
  });

  it("a swarm that does not answer is a 502", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    expect((await POST(post({ swarmId: "swarm-oh", app: "acme/bench", version: "v2" }), params)).status).toBe(502);
  });
});
