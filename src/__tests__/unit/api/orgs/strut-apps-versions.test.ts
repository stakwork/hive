/**
 * Unit tests for /api/orgs/[githubLogin]/strut/apps/versions — an app card's
 * version picker, its "Make vN live" and holding the app (strut
 * `GET /apps/:name/versions`, `PUT /apps/:name/active`; strut
 * `plans/app-releases.md`).
 *
 * Coverage:
 *   - 401 without a session; 400 for a request naming no app, or not
 *     exactly one of a version (`vN`, `latest`) and a release (`rN`);
 *   - GET: the live version and every version newest first, read off
 *     strut's record, and whether the caller may change the live one (an
 *     admin of the swarm's workspace); the live release, every release with
 *     its lock's labels, and what moved since; a strut without releases
 *     (no `live`) is not holdable; 404 for an app the swarm lacks;
 *   - POST: 403 for a non-admin before strut is called; the name encoded
 *     whole, a promote, a rollback and following latest sent as they came
 *     with the decrypted key and the member as the actor; strut's 404 / 409
 *     and their message passed through; the key never in a response.
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
  resolveStrutActor: vi.fn(async (userId: string) => `evan-${userId}`),
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

/** The same app HELD at r2 (v2), with v10 a draft, as a strut with releases serves it. */
const heldRecord = {
  ...record,
  active: "v2",
  live: "r2",
  releases: [
    { id: "r1", version: "v1", createdAt: "2026-10-22T21:24:00.000Z", lock: { workflows: { "openhealth-run": { version: "v12", hash: "h12" } }, steps: {} } },
    {
      id: "r2",
      version: "v2",
      createdAt: "2026-10-22T21:31:00.000Z",
      by: "evan-user-1",
      lock: { workflows: { "openhealth-run": { version: "v14", hash: "h14" } }, steps: { "acme/score": { version: "v3", hash: "s3" } }, floating: ['subflow step "pick" chooses its workflow at run time'] },
    },
    { id: "bogus", version: "v2", lock: {} },
  ],
  behind: [
    { kind: "workflow", name: "openhealth-run", locked: "v14", current: "v17" },
    { kind: "step", name: "acme/score", locked: "v3", current: null },
  ],
};

/** Strut's `PUT /apps/:name/active`, as its handler answers each body. */
function putActive(body: { version?: string; release?: string }): Response {
  if (body.version === "v9") return json({ error: 'Version "v9" not found for app "acme/bench"' }, 404);
  if (body.release === "r7") return json({ error: 'Release "r7" not found for app "acme/bench"' }, 404);
  if (body.release === "r1") return json({ error: 'release r1 locks workflow "openhealth-old", which no longer exists' }, 409);
  if (body.version === "latest") return json({ ok: true, name: "acme/bench", active: "v10", live: "latest" });
  if (body.release) return json({ ok: true, name: "acme/bench", active: "v2", live: body.release });
  return json({ ok: true, name: "acme/bench", active: body.version, live: "r3", release: { id: "r3", version: body.version, lock: { workflows: {}, steps: {} } } });
}

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
    if (url === `${LAB}/apps/${BENCH}/active` && init?.method === "PUT") return putActive(JSON.parse(init.body as string));
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
      holdable: false,
      release: null,
      releases: [],
      behind: [],
      canSetLive: true,
    });
    expect(text).not.toContain("enc-key");
    expect((mockFetch.mock.calls[0][1] as RequestInit).headers).toMatchObject({ "x-api-token": "dec(enc-key)" });
    mockAccess.mockResolvedValue({ hasAccess: true, canRead: true, canWrite: true, canAdmin: false });
    expect(await (await GET(get({ swarmId: "swarm-oh", app: "acme/bench" }), params)).json()).toMatchObject({ canSetLive: false });
  });

  it("a held app: the live release, every release oldest first with its lock's labels, and what moved since", async () => {
    mockFetch.mockImplementation(async () => json(heldRecord));
    const body = await (await GET(get({ swarmId: "swarm-oh", app: "acme/bench" }), params)).json();
    expect(body).toMatchObject({ live: "v2", holdable: true, release: "r2", canSetLive: true });
    expect(body.releases).toEqual([
      { id: "r1", version: "v1", createdAt: "2026-10-22T21:24:00.000Z", lock: { workflows: { "openhealth-run": "v12" }, steps: {}, floating: [] } },
      {
        id: "r2",
        version: "v2",
        createdAt: "2026-10-22T21:31:00.000Z",
        by: "evan-user-1",
        lock: { workflows: { "openhealth-run": "v14" }, steps: { "acme/score": "v3" }, floating: ['subflow step "pick" chooses its workflow at run time'] },
      },
    ]);
    expect(body.behind).toEqual(heldRecord.behind);
  });

  it("an app following latest on a strut with releases: holdable, no live release", async () => {
    mockFetch.mockImplementation(async () => json({ ...record, live: "latest", releases: [heldRecord.releases[0]], behind: [] }));
    const body = await (await GET(get({ swarmId: "swarm-oh", app: "acme/bench" }), params)).json();
    expect(body).toMatchObject({ live: "v10", holdable: true, release: null, behind: [] });
    expect(body.releases.map((r: { id: string }) => r.id)).toEqual(["r1"]);
  });

  it("404 for an app the swarm does not have", async () => {
    expect((await GET(get({ swarmId: "swarm-oh", app: "nope" }), params)).status).toBe(404);
  });
});

describe("POST /api/orgs/[githubLogin]/strut/apps/versions", () => {
  it("401 without a session, 400 without exactly one of a version and a release", async () => {
    expect((await POST(post({ swarmId: "swarm-oh", app: "acme/bench", version: "v2" }, false), params)).status).toBe(401);
    expect((await POST(post({ swarmId: "swarm-oh", app: "acme/bench" }), params)).status).toBe(400);
    expect((await POST(post({ swarmId: "swarm-oh", app: "acme/bench", version: "newest" }), params)).status).toBe(400);
    expect((await POST(post({ swarmId: "swarm-oh", app: "acme/bench", release: "v2" }), params)).status).toBe(400);
    expect((await POST(post({ swarmId: "swarm-oh", app: "acme/bench", version: "v2", release: "r1" }), params)).status).toBe(400);
    expect((await POST(post({ swarmId: "swarm-oh", app: "../x", version: "v2" }), params)).status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("403 for a non-admin of the swarm's workspace, before strut is called", async () => {
    mockAccess.mockResolvedValue({ hasAccess: true, canRead: true, canWrite: true, canAdmin: false });
    for (const target of [{ version: "v2" }, { release: "r2" }, { version: "latest" }]) {
      const res = await POST(post({ swarmId: "swarm-oh", app: "acme/bench", ...target }), params);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain("Open Health");
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("promotes a version through strut with the decrypted key and the member as the actor, the name encoded whole", async () => {
    const res = await POST(post({ swarmId: "swarm-oh", app: "acme/bench", version: "v2" }), params);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ live: "v2", release: "r3" });
    expect(text).not.toContain("enc-key");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${LAB}/apps/${BENCH}/active`);
    expect(init).toMatchObject({ method: "PUT", body: JSON.stringify({ version: "v2" }) });
    expect((init as RequestInit).headers).toMatchObject({ "x-api-token": "dec(enc-key)", "x-strut-actor": "evan-user-1" });
  });

  it("rolls back to a release, and follows latest again", async () => {
    const back = await POST(post({ swarmId: "swarm-oh", app: "acme/bench", release: "r2" }), params);
    expect(await back.json()).toEqual({ live: "v2", release: "r2" });
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: "PUT", body: JSON.stringify({ release: "r2" }) });

    const follow = await POST(post({ swarmId: "swarm-oh", app: "acme/bench", version: "latest" }), params);
    expect(await follow.json()).toEqual({ live: "v10", release: null });
    expect(mockFetch.mock.calls[1][1]).toMatchObject({ method: "PUT", body: JSON.stringify({ version: "latest" }) });
  });

  it("a strut without releases answers no live release", async () => {
    mockFetch.mockImplementation(async () => json({ ok: true, name: "acme/bench", active: "v2" }));
    expect(await (await POST(post({ swarmId: "swarm-oh", app: "acme/bench", version: "v2" }), params)).json()).toEqual({ live: "v2", release: null });
  });

  it("passes strut's 404 and 409 and their message through", async () => {
    const missing = await POST(post({ swarmId: "swarm-oh", app: "acme/bench", version: "v9" }), params);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Version "v9" not found for app "acme/bench"' });
    expect((await POST(post({ swarmId: "swarm-oh", app: "acme/bench", release: "r7" }), params)).status).toBe(404);
    const refused = await POST(post({ swarmId: "swarm-oh", app: "acme/bench", release: "r1" }), params);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toContain("openhealth-old");
  });

  it("a swarm that does not answer is a 502", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    expect((await POST(post({ swarmId: "swarm-oh", app: "acme/bench", version: "v2" }), params)).status).toBe(502);
  });
});
