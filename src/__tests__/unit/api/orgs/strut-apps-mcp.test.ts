/**
 * Unit tests for POST /api/orgs/[githubLogin]/strut/apps/mcp — the MCP relay
 * for a strut app's frame (strut plans/apps.md §7.4).
 *
 * Coverage:
 *   - 401 without a session; 404 for an org the caller is not in, 403 for a
 *     swarm outside the org or a workspace the caller cannot read — nothing
 *     is forwarded;
 *   - the ALLOWLIST: `tools/call` of any tool but `step_run`, a method off
 *     the list, a batch, a response — each refused with a JSON-RPC error and
 *     never forwarded;
 *   - a `tools/call` of `step_run`: `POST {lab}/mcp` with the body BYTE FOR
 *     BYTE, the decrypted swarm key as `x-api-token`, the member's actor as
 *     `x-strut-actor`, the Streamable HTTP `Accept`, the protocol version
 *     header — and strut's answer streamed back as it came;
 *   - `initialize` also makes sure of the member's delegation; a swarm that
 *     refuses the key is a 502, not the member's 401; GET is 405;
 *   - the ROLE FLOOR: `run/launch` and `run/cancel` (pinned or not) refused
 *     below Developer with a JSON-RPC error, never forwarded; Developer and
 *     up pass; reads pass for a Viewer; the 21st launch in a workspace's
 *     hour is refused (cancels and other workspaces don't count), and a
 *     limiter that is down lets the launch through.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

const { mockDecrypt, mockActor, mockEnsure, redisCounts, mockIncr } = vi.hoisted(() => {
  const redisCounts = new Map<string, number>();
  return {
    mockDecrypt: vi.fn((_f: string, v: string) => `dec(${v})`),
    mockActor: vi.fn(async (userId: string) => `actor-of-${userId}`),
    mockEnsure: vi.fn(async () => ({ status: "fresh" })),
    redisCounts,
    mockIncr: vi.fn(async (key: string) => {
      const n = (redisCounts.get(key) ?? 0) + 1;
      redisCounts.set(key, n);
      return n;
    }),
  };
});

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
  resolveStrutActor: mockActor,
  ensureStrutDelegation: mockEnsure,
}));
// The real checkRateLimit / checkRateLimitSafe over an in-memory counter.
vi.mock("@/lib/redis", () => ({ redis: { incr: mockIncr, expire: vi.fn(async () => 1), ttl: vi.fn(async () => 1800) } }));

const { db } = await import("@/lib/db");
const { resolveAuthorizedOrgId } = await import("@/lib/auth/org-access");
const { validateWorkspaceAccess } = await import("@/services/workspace");
const { POST, GET } = await import("@/app/api/orgs/[githubLogin]/strut/apps/mcp/route");

const mockSwarmFind = db.swarm.findUnique as Mock;
const mockResolveOrg = resolveAuthorizedOrgId as Mock;
const mockAccess = validateWorkspaceAccess as Mock;
const mockFetch = vi.fn();

const params = { params: Promise.resolve({ githubLogin: "test-org" }) };
const LAB = "https://acme.sphinx.chat:3355/lab";

function request(body: string, opts: { authed?: boolean; swarmId?: string; headers?: Record<string, string> } = {}): NextRequest {
  const req = new NextRequest(`http://localhost/api/orgs/test-org/strut/apps/mcp?swarmId=${opts.swarmId ?? "swarm-1"}`, {
    method: "POST",
    body,
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...opts.headers },
  });
  if (opts.authed !== false) {
    req.headers.set(MIDDLEWARE_HEADERS.USER_ID, "user-1");
    req.headers.set(MIDDLEWARE_HEADERS.USER_EMAIL, "t@e.com");
    req.headers.set(MIDDLEWARE_HEADERS.USER_NAME, "T");
    req.headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
  }
  return req;
}

const call = (name: string, id = 7, type = "run/list") =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: { type, config: { workflow: "wfbench-run" }, app: "app:bench@v2.tok" } } });
const step = (type: string, id = 7) => call("step_run", id, type);

/** The caller holds `role` in the swarm's workspace, as validateWorkspaceAccess answers it. */
function as(role: "VIEWER" | "STAKEHOLDER" | "DEVELOPER" | "PM" | "ADMIN" | "OWNER") {
  const level = ["VIEWER", "STAKEHOLDER", "DEVELOPER", "PM", "ADMIN", "OWNER"].indexOf(role);
  mockAccess.mockResolvedValue({ hasAccess: true, userRole: role, canRead: true, canWrite: level >= 2, canAdmin: level >= 4 });
}

const SWARM = {
  swarmUrl: "https://acme.sphinx.chat/api",
  swarmApiKey: "enc-key",
  workspace: { id: "ws-1", slug: "acme", sourceControlOrgId: "org-1", deleted: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  redisCounts.clear();
  vi.stubGlobal("fetch", mockFetch);
  mockResolveOrg.mockResolvedValue("org-1");
  mockSwarmFind.mockResolvedValue(SWARM);
  mockAccess.mockResolvedValue({ hasAccess: true, canRead: true, canWrite: false, canAdmin: false });
  mockFetch.mockImplementation(
    async () =>
      new Response('event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"content":[]}}\n\n', {
        status: 200,
        headers: { "content-type": "text/event-stream", "set-cookie": "not-for-the-browser=1" },
      }),
  );
});

describe("POST /api/orgs/[githubLogin]/strut/apps/mcp", () => {
  it("401 without a session", async () => {
    const res = await POST(request(call("step_run"), { authed: false }), params);
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses a caller outside the org (404) and a member who cannot read the swarm's workspace (403)", async () => {
    mockResolveOrg.mockResolvedValueOnce(null);
    expect((await POST(request(call("step_run")), params)).status).toBe(404);

    mockAccess.mockResolvedValueOnce({ hasAccess: false, canRead: false, canWrite: false, canAdmin: false });
    expect((await POST(request(call("step_run")), params)).status).toBe(403);

    mockSwarmFind.mockResolvedValueOnce({ ...SWARM, workspace: { ...SWARM.workspace, sourceControlOrgId: "org-2" } });
    expect((await POST(request(call("step_run")), params)).status).toBe(403);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDecrypt).not.toHaveBeenCalled();
  });

  it("refuses tools/call of any tool but step_run with a JSON-RPC error, and forwards nothing", async () => {
    for (const name of ["ask_workflow_builder", "run_workflow", "app_bench", "", "STEP_RUN"]) {
      const res = await POST(request(call(name, 11)), params);
      expect(res.status, name).toBe(200);
      const body = await res.json();
      expect(body, name).toMatchObject({ jsonrpc: "2.0", id: 11, error: { code: -32602 } });
      expect(body.error.message).toContain("step_run");
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses a method off the list, a batch and a response; a refused notification is a 400", async () => {
    const offList = await POST(request(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: "ui://strut/app/x" } })), params);
    expect(await offList.json()).toMatchObject({ id: 3, error: { code: -32601 } });

    const batch = await POST(request(JSON.stringify([JSON.parse(call("step_run"))])), params);
    expect(await batch.json()).toMatchObject({ error: { code: -32600 } });

    const response = await POST(request(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })), params);
    expect(await response.json()).toMatchObject({ id: 1, error: { code: -32600 } });

    const notification = await POST(request(JSON.stringify({ jsonrpc: "2.0", method: "notifications/roots/list_changed" })), params);
    expect(notification.status).toBe(400);

    const garbage = await POST(request("{not json"), params);
    expect(garbage.status).toBe(400);
    expect(await garbage.json()).toMatchObject({ error: { code: -32700 } });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("forwards a step_run call byte for byte with the swarm key, the member's actor and the MCP headers; streams the answer back", async () => {
    // Odd spacing and key order on purpose: the relay must not re-serialize.
    const raw = `{ "params": {"arguments":{"type":"run/get","config":{"workflow":"wfbench-run","runId":"r1"},"app":"app:bench@v2.tok"},"name":"step_run"},  "method":"tools/call", "id":7, "jsonrpc":"2.0" }`;
    const res = await POST(request(raw, { headers: { "mcp-protocol-version": "2025-06-18", cookie: "next-auth.session-token=secret" } }), params);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe(`${LAB}/mcp`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(raw);
    expect(init.headers["x-api-token"]).toBe("dec(enc-key)");
    expect(init.headers["x-strut-actor"]).toBe("actor-of-user-1");
    expect(init.headers.accept).toBe("application/json, text/event-stream");
    expect(init.headers["mcp-protocol-version"]).toBe("2025-06-18");
    // Hive's session never goes to the swarm.
    expect(Object.keys(init.headers).map((k) => k.toLowerCase())).not.toContain("cookie");
    expect(mockActor).toHaveBeenCalledWith("user-1");
    expect(mockEnsure).not.toHaveBeenCalled();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.text()).toContain('"id":7');
  });

  it("passes initialize, its notification and tools/list; initialize makes sure of the member's delegation", async () => {
    const init = JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "hive", version: "1" } } });
    await POST(request(init), params);
    expect(mockEnsure).toHaveBeenCalledWith(
      { workspaceId: "ws-1", workspaceSlug: "acme", userId: "user-1" },
      { swarmUrl: SWARM.swarmUrl, swarmApiKey: "dec(enc-key)" },
      { actor: "actor-of-user-1" },
    );
    mockFetch.mockResolvedValue(new Response(null, { status: 202 }));
    expect((await POST(request(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })), params)).status).toBe(202);
    await POST(request(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })), params);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockEnsure).toHaveBeenCalledTimes(1);
  });

  it("a swarm that refuses hive's key is a 502, never the member's 401", async () => {
    mockFetch.mockResolvedValue(new Response("nope", { status: 401 }));
    expect((await POST(request(call("step_run")), params)).status).toBe(502);
  });

  it("a swarm that cannot be reached is a 502", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    expect((await POST(request(call("step_run")), params)).status).toBe(502);
  });

  it("GET is 405: strut's door is stateless", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});

describe("POST /api/orgs/[githubLogin]/strut/apps/mcp — the role floor", () => {
  it("refuses run/launch and run/cancel below Developer with a JSON-RPC error the app can show, and forwards nothing", async () => {
    for (const role of ["VIEWER", "STAKEHOLDER"] as const) {
      as(role);
      for (const type of ["run/launch", "run/cancel", "run/launch@v1"]) {
        const res = await POST(request(step(type, 21)), params);
        expect(res.status, `${role} ${type}`).toBe(200);
        const body = await res.json();
        expect(body, `${role} ${type}`).toMatchObject({ jsonrpc: "2.0", id: 21, error: { code: -32003 } });
        expect(body.error.message).toContain("Developer");
      }
    }
    expect(mockFetch).not.toHaveBeenCalled();
    // A refused launch never counts against the workspace's limit.
    expect(mockIncr).not.toHaveBeenCalled();
  });

  it("a member Hive has no role for is refused a launch (fails closed)", async () => {
    mockAccess.mockResolvedValue({ hasAccess: true, canRead: true, canWrite: false, canAdmin: false });
    const body = await (await POST(request(step("run/launch")), params)).json();
    expect(body).toMatchObject({ error: { code: -32003 } });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("lets a Developer and up launch and cancel, forwarding the call as it came", async () => {
    for (const role of ["DEVELOPER", "PM", "ADMIN", "OWNER"] as const) {
      as(role);
      for (const type of ["run/launch", "run/cancel"]) {
        mockFetch.mockClear();
        const raw = step(type);
        const res = await POST(request(raw), params);
        expect(res.status, `${role} ${type}`).toBe(200);
        expect(mockFetch, `${role} ${type}`).toHaveBeenCalledTimes(1);
        expect((mockFetch.mock.calls[0] as [string, RequestInit])[1].body).toBe(raw);
      }
    }
  });

  it("leaves reads as they were: a Viewer's run/list, run/get, run/workflow and graph/find pass, uncounted", async () => {
    as("VIEWER");
    for (const type of ["run/list", "run/get", "run/workflow", "run/events", "graph/find"]) {
      const res = await POST(request(step(type)), params);
      expect(res.status, type).toBe(200);
      expect(await res.text(), type).toContain('"result"');
    }
    expect(mockFetch).toHaveBeenCalledTimes(5);
    expect(mockIncr).not.toHaveBeenCalled();
  });

  it("refuses the 21st launch in a workspace's hour; cancels and other workspaces are not counted", async () => {
    as("DEVELOPER");
    for (let i = 0; i < 20; i++) {
      const res = await POST(request(step("run/launch", i)), params);
      expect(await res.text(), `launch ${i + 1}`).toContain('"result"');
    }
    expect(mockFetch).toHaveBeenCalledTimes(20);

    const res = await POST(request(step("run/launch", 99)), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ jsonrpc: "2.0", id: 99, error: { code: -32029 } });
    expect(body.error.message).toContain("20 an hour");
    expect(body.error.message).toContain("30 min");
    expect(mockFetch).toHaveBeenCalledTimes(20);
    expect(mockIncr).toHaveBeenCalledWith("strut-app:launch:ws-1");

    // Stopping a run is never rate limited.
    await POST(request(step("run/cancel")), params);
    expect(mockFetch).toHaveBeenCalledTimes(21);

    // Another workspace's apps have their own hour.
    mockSwarmFind.mockResolvedValueOnce({ ...SWARM, workspace: { ...SWARM.workspace, id: "ws-2", slug: "other" } });
    await POST(request(step("run/launch"), { swarmId: "swarm-2" }), params);
    expect(mockFetch).toHaveBeenCalledTimes(22);
  });

  it("lets the launch through when the limiter is down (fails open)", async () => {
    as("DEVELOPER");
    mockIncr.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await POST(request(step("run/launch")), params);
    expect(await res.text()).toContain('"result"');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
