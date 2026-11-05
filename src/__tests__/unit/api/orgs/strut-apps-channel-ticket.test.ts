/**
 * Unit tests for POST /api/orgs/[githubLogin]/strut/apps/channel-ticket —
 * mints a strut app channel ticket (strut#487); the page opens the socket.
 *
 * Coverage: 401 without a session; 404 / 403 from authorizeAppSwarm (nothing
 * forwarded); 400 on bad input; what is forwarded to `{lab}/apps/<name>/channel-ticket`
 * (body, x-api-token, x-strut-actor); the `{ ticket, exp, url }` answer with a
 * wss url and never the key; strut's 400/403/404/5xx mapped.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

const { mockDecrypt, mockActor } = vi.hoisted(() => ({
  mockDecrypt: vi.fn((_f: string, v: string) => `dec(${v})`),
  mockActor: vi.fn(async (userId: string) => `actor-of-${userId}`),
}));

vi.mock("@/lib/db", () => ({ db: { swarm: { findUnique: vi.fn() } } }));
vi.mock("@/lib/auth/org-access", () => ({ resolveAuthorizedOrgId: vi.fn() }));
vi.mock("@/services/workspace", () => ({ validateWorkspaceAccess: vi.fn() }));
vi.mock("@/lib/encryption", () => ({ EncryptionService: { getInstance: () => ({ decryptField: mockDecrypt }) } }));
vi.mock("@/services/bifrost/strut-delegation", () => ({
  strutLabBaseUrl: (u: string) => `${u.replace("/api", ":3355")}/lab`,
  resolveStrutActor: mockActor,
}));

const { db } = await import("@/lib/db");
const { resolveAuthorizedOrgId } = await import("@/lib/auth/org-access");
const { validateWorkspaceAccess } = await import("@/services/workspace");
const { POST } = await import("@/app/api/orgs/[githubLogin]/strut/apps/channel-ticket/route");

const mockSwarmFind = db.swarm.findUnique as Mock;
const mockResolveOrg = resolveAuthorizedOrgId as Mock;
const mockAccess = validateWorkspaceAccess as Mock;
const mockFetch = vi.fn();
const params = { params: Promise.resolve({ githubLogin: "test-org" }) };

const SWARM = {
  swarmUrl: "https://acme.sphinx.chat/api",
  swarmApiKey: "enc-key",
  workspace: { id: "ws-1", slug: "acme", sourceControlOrgId: "org-1", deleted: false },
};

function request(body: unknown, opts: { authed?: boolean; swarmId?: string; raw?: string } = {}): NextRequest {
  const req = new NextRequest(`http://localhost/api/orgs/test-org/strut/apps/channel-ticket?swarmId=${opts.swarmId ?? "swarm-1"}`, {
    method: "POST",
    body: opts.raw ?? JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  if (opts.authed !== false) {
    req.headers.set(MIDDLEWARE_HEADERS.USER_ID, "user-1");
    req.headers.set(MIDDLEWARE_HEADERS.USER_EMAIL, "t@e.com");
    req.headers.set(MIDDLEWARE_HEADERS.USER_NAME, "T");
    req.headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
  }
  return req;
}
const ok = { app: "bench", version: "v3" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  mockResolveOrg.mockResolvedValue("org-1");
  mockSwarmFind.mockResolvedValue(SWARM);
  mockAccess.mockResolvedValue({ hasAccess: true, canRead: true, canWrite: false, canAdmin: false });
  mockFetch.mockImplementation(async () => Response.json({ ticket: "tk.1", exp: 1234 }));
});

describe("POST /api/orgs/[githubLogin]/strut/apps/channel-ticket", () => {
  it("401 without a session", async () => {
    expect((await POST(request(ok, { authed: false }), params)).status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("404 outside the org, 403 for a swarm outside it or an unreadable workspace; nothing forwarded", async () => {
    mockResolveOrg.mockResolvedValueOnce(null);
    expect((await POST(request(ok), params)).status).toBe(404);
    mockAccess.mockResolvedValueOnce({ hasAccess: false, canRead: false, canWrite: false, canAdmin: false });
    expect((await POST(request(ok), params)).status).toBe(403);
    mockSwarmFind.mockResolvedValueOnce({ ...SWARM, workspace: { ...SWARM.workspace, sourceControlOrgId: "org-2" } });
    expect((await POST(request(ok), params)).status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("400 on bad input, never forwarded", async () => {
    for (const body of [{}, { version: "v3" }, { app: "../x", version: "v3" }, { app: "a?b", version: "v3" }, { app: "bench", version: "latest" }, { app: "bench", version: "" }, { app: 5, version: "v3" }]) {
      expect((await POST(request(body), params)).status).toBe(400);
    }
    expect((await POST(request(null, { raw: "{nope" }), params)).status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("forwards to {lab}/apps/<name>/channel-ticket with the key and actor, and answers { ticket, exp, url } without the key", async () => {
    const res = await POST(request({ app: "team/bench", version: "v3" }), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ticket: "tk.1", exp: 1234, url: "wss://acme.sphinx.chat:3355/lab/channels" });
    expect(text).not.toContain("dec(enc-key)");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://acme.sphinx.chat:3355/lab/apps/team%2Fbench/channel-ticket");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ version: "v3" });
    expect(init.headers).toMatchObject({ "content-type": "application/json", "x-api-token": "dec(enc-key)", "x-strut-actor": "actor-of-user-1" });
  });

  it("with no version, reads the live one from the versions endpoint and forwards it", async () => {
    mockFetch.mockImplementation(async (url: string) =>
      String(url).endsWith("/versions") ? Response.json({ active: "v7", versions: { v7: {} } }) : Response.json({ ticket: "tk.2", exp: 9 }),
    );
    const res = await POST(request({ app: "bench" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ticket: "tk.2", exp: 9 });
    const [vUrl, vInit] = mockFetch.mock.calls[0];
    expect(vUrl).toBe("https://acme.sphinx.chat:3355/lab/apps/bench/versions");
    expect(vInit.headers).toMatchObject({ "x-api-token": "dec(enc-key)" });
    const [tUrl, tInit] = mockFetch.mock.calls[1];
    expect(tUrl).toBe("https://acme.sphinx.chat:3355/lab/apps/bench/channel-ticket");
    expect(JSON.parse(tInit.body)).toEqual({ version: "v7" });
    expect(tInit.headers).toMatchObject({ "x-api-token": "dec(enc-key)", "x-strut-actor": "actor-of-user-1" });
  });

  it("passes a failed versions lookup through, minting no ticket", async () => {
    mockFetch.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    const res = await POST(request({ app: "bench" }), params);
    expect(res.status).toBe(404);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(await res.text()).not.toContain("dec(enc-key)");
  });

  it("uses ws:// for an http swarm", async () => {
    mockSwarmFind.mockResolvedValueOnce({ ...SWARM, swarmUrl: "http://swarm.local/api" });
    const body = await (await POST(request(ok), params)).json();
    expect(body.url).toBe("ws://swarm.local:3355/lab/channels");
  });

  it("maps strut's errors without leaking the key", async () => {
    for (const [from, to] of [[400, 400], [403, 403], [404, 404], [500, 502], [401, 502]] as const) {
      mockFetch.mockResolvedValueOnce(new Response("dec(enc-key) boom", { status: from }));
      const res = await POST(request(ok), params);
      expect(res.status).toBe(to);
      expect(await res.text()).not.toContain("dec(enc-key)");
    }
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect((await POST(request(ok), params)).status).toBe(502);
    mockFetch.mockResolvedValueOnce(Response.json({}));
    expect((await POST(request(ok), params)).status).toBe(502);
  });
});
