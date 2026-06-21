import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: vi.fn(),
}));

vi.mock("@/lib/utils/swarm", () => ({
  getJarvisUrl: vi.fn((name: string) => `https://${name}.sphinx.chat:8444`),
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  addEdge: vi.fn(),
  patchEdge: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { addEdge, patchEdge } from "@/services/swarm/api/nodes";

const mockGetWorkspaceSwarmAccess = vi.mocked(getWorkspaceSwarmAccess);
const mockAddEdge = vi.mocked(addEdge);
const mockPatchEdge = vi.mocked(patchEdge);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SLUG = "test-workspace";
const USER = { id: "user-1", email: "user@test.com", name: "Test User" };
const SWARM_DATA = {
  workspaceId: "ws-1",
  swarmName: "testswarm",
  swarmUrl: "https://testswarm.sphinx.chat",
  swarmApiKey: "api-key-123",
  swarmStatus: "ACTIVE",
  poolName: "pool-1",
  swarmSecretAlias: null,
};

function makeAuthenticatedRequest(
  url: string,
  options: { method?: string; body?: object } = {},
) {
  const req = new NextRequest(url, {
    method: options.method ?? "GET",
    ...(options.body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options.body),
        }
      : {}),
  });
  const headers = new Headers(req.headers);
  headers.set(MIDDLEWARE_HEADERS.USER_ID, USER.id);
  headers.set(MIDDLEWARE_HEADERS.USER_EMAIL, USER.email);
  headers.set(MIDDLEWARE_HEADERS.USER_NAME, USER.name);
  headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
  headers.set(MIDDLEWARE_HEADERS.REQUEST_ID, "req-1");
  return new NextRequest(url, {
    method: options.method ?? "GET",
    headers,
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

function unauthenticatedRequest(url: string) {
  return new NextRequest(url, { method: "GET" });
}

// ─── GET /lingo/nodes ─────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/lingo/nodes", () => {
  let GET: typeof import("@/app/api/workspaces/[slug]/lingo/nodes/route").GET;

  beforeEach(async () => {
    vi.resetAllMocks();
    delete process.env.USE_MOCKS;
    ({ GET } = await import("@/app/api/workspaces/[slug]/lingo/nodes/route"));
  });

  afterEach(() => {
    delete process.env.USE_MOCKS;
  });

  test("returns 401 for unauthenticated request", async () => {
    const req = unauthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(401);
  });

  test("returns 403 when ACCESS_DENIED", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: false,
      error: { type: "ACCESS_DENIED" },
    });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("returns 404 when WORKSPACE_NOT_FOUND", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: false,
      error: { type: "WORKSPACE_NOT_FOUND" },
    });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(404);
  });

  test("falls back to mock data when swarm not configured", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: false,
      error: { type: "SWARM_NOT_CONFIGURED" },
    });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.nodes)).toBe(true);
    expect(body.data.nodes.length).toBeGreaterThan(0);
    expect(typeof body.data.hasMore).toBe("boolean");
  });

  test("returns mock data when USE_MOCKS=true without calling jarvis", async () => {
    process.env.USE_MOCKS = "true";
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.nodes)).toBe(true);
    expect(mockGetWorkspaceSwarmAccess).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("forwards offset and limit to jarvis", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: true,
      data: SWARM_DATA,
    });
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ nodes: [] }), { status: 200 }),
    );
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes?limit=10&offset=20`,
    );
    await GET(req, { params: Promise.resolve({ slug: SLUG }) });

    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).toContain("limit=10");
    expect(calledUrl).toContain("offset=20");
    expect(calledUrl).toContain("type=Jargon");
    expect(calledUrl).toContain("namespace=testswarm");
  });

  test("sets hasMore=true when response length equals limit", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: true,
      data: SWARM_DATA,
    });
    const fakeNodes = Array.from({ length: 50 }, (_, i) => ({
      ref_id: `node-${i}`,
      name: `Node ${i}`,
    }));
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ nodes: fakeNodes }), { status: 200 }),
    );
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    const body = await res.json();
    expect(body.data.hasMore).toBe(true);
  });

  test("sets hasMore=false when response length < limit", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: true,
      data: SWARM_DATA,
    });
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ nodes: [{ ref_id: "n1" }] }), { status: 200 }),
    );
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    const body = await res.json();
    expect(body.data.hasMore).toBe(false);
  });
});

// ─── GET /lingo/nodes/[ref_id] ────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/lingo/nodes/[ref_id]", () => {
  let GET: typeof import("@/app/api/workspaces/[slug]/lingo/nodes/[ref_id]/route").GET;

  beforeEach(async () => {
    vi.resetAllMocks();
    delete process.env.USE_MOCKS;
    ({ GET } = await import(
      "@/app/api/workspaces/[slug]/lingo/nodes/[ref_id]/route"
    ));
  });

  afterEach(() => {
    delete process.env.USE_MOCKS;
  });

  test("returns 401 for unauthenticated request", async () => {
    const req = unauthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/jargon-001`,
    );
    const res = await GET(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "jargon-001" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 403 when ACCESS_DENIED", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: false,
      error: { type: "ACCESS_DENIED" },
    });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/jargon-001`,
    );
    const res = await GET(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "jargon-001" }),
    });
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("returns mock data for known ref_id when USE_MOCKS=true", async () => {
    process.env.USE_MOCKS = "true";
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/jargon-001`,
    );
    const res = await GET(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "jargon-001" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.node.ref_id).toBe("jargon-001");
    expect(Array.isArray(body.data.edges)).toBe(true);
  });

  test("returns 404 for unknown ref_id in mock mode", async () => {
    process.env.USE_MOCKS = "true";
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/unknown-node`,
    );
    const res = await GET(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "unknown-node" }),
    });
    expect(res.status).toBe(404);
  });

  test("URL-encodes ref_id in jarvis call", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: true,
      data: SWARM_DATA,
    });
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ref_id: "node ref/1" }), { status: 200 }),
    );
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/node%20ref%2F1`,
    );
    await GET(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "node ref/1" }),
    });
    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).toContain("node%20ref%2F1");
    expect(calledUrl).toContain("expand=true");
  });
});

// ─── GET /lingo/nodes/search ──────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/lingo/nodes/search", () => {
  let GET: typeof import("@/app/api/workspaces/[slug]/lingo/nodes/search/route").GET;

  beforeEach(async () => {
    vi.resetAllMocks();
    delete process.env.USE_MOCKS;
    ({ GET } = await import(
      "@/app/api/workspaces/[slug]/lingo/nodes/search/route"
    ));
  });

  afterEach(() => {
    delete process.env.USE_MOCKS;
  });

  test("returns 400 when q param is missing", async () => {
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/search`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(400);
  });

  test("returns filtered mock data when USE_MOCKS=true", async () => {
    process.env.USE_MOCKS = "true";
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/search?q=Swarm`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // Should match nodes whose name includes "Swarm"
    expect(body.data.every((n: { name: string }) =>
      n.name.toLowerCase().includes("swarm"),
    )).toBe(true);
  });

  test("forwards q and type params to jarvis", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: true,
      data: SWARM_DATA,
    });
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/search?q=pod&type=Jargon`,
    );
    await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).toContain("q=pod");
    expect(calledUrl).toContain("type=Jargon");
  });

  test("returns 403 on ACCESS_DENIED", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: false,
      error: { type: "ACCESS_DENIED" },
    });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/search?q=test`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── POST /lingo/edges ────────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/lingo/edges", () => {
  let POST: typeof import("@/app/api/workspaces/[slug]/lingo/edges/route").POST;

  beforeEach(async () => {
    vi.resetAllMocks();
    delete process.env.USE_MOCKS;
    ({ POST } = await import("@/app/api/workspaces/[slug]/lingo/edges/route"));
  });

  afterEach(() => {
    delete process.env.USE_MOCKS;
  });

  test("returns 401 for unauthenticated request", async () => {
    const req = unauthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/edges`,
    );
    const res = await POST(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(401);
  });

  test("returns 400 when source_ref_id or target_ref_id missing", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: true,
      data: SWARM_DATA,
    });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/edges`,
      { method: "POST", body: { source_ref_id: "src-1" } },
    );
    const res = await POST(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(400);
  });

  test("returns mock success when USE_MOCKS=true", async () => {
    process.env.USE_MOCKS = "true";
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/edges`,
      { method: "POST", body: { source_ref_id: "src-1", target_ref_id: "tgt-1" } },
    );
    const res = await POST(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockAddEdge).not.toHaveBeenCalled();
  });

  test("defaults edge_type to RELATED_TO when not provided", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: true,
      data: SWARM_DATA,
    });
    mockAddEdge.mockResolvedValueOnce({ success: true });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/edges`,
      { method: "POST", body: { source_ref_id: "src-1", target_ref_id: "tgt-1" } },
    );
    await POST(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(mockAddEdge).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ edge: { edge_type: "RELATED_TO" } }),
    );
  });

  test("passes provided edge_type to addEdge", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: true,
      data: SWARM_DATA,
    });
    mockAddEdge.mockResolvedValueOnce({ success: true });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/edges`,
      {
        method: "POST",
        body: { source_ref_id: "s1", target_ref_id: "t1", edge_type: "USES" },
      },
    );
    await POST(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(mockAddEdge).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ edge: { edge_type: "USES" } }),
    );
  });

  test("returns 403 on ACCESS_DENIED (IDOR guard)", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: false,
      error: { type: "ACCESS_DENIED" },
    });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/edges`,
      { method: "POST", body: { source_ref_id: "s1", target_ref_id: "t1" } },
    );
    const res = await POST(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(403);
    expect(mockAddEdge).not.toHaveBeenCalled();
  });

  test("returns 500 when addEdge fails", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: true,
      data: SWARM_DATA,
    });
    mockAddEdge.mockResolvedValueOnce({ success: false, error: "Jarvis error" });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/edges`,
      { method: "POST", body: { source_ref_id: "s1", target_ref_id: "t1" } },
    );
    const res = await POST(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(500);
  });
});

// ─── PATCH /lingo/edges/[ref_id] ──────────────────────────────────────────────

describe("PATCH /api/workspaces/[slug]/lingo/edges/[ref_id]", () => {
  let PATCH: typeof import("@/app/api/workspaces/[slug]/lingo/edges/[ref_id]/route").PATCH;

  beforeEach(async () => {
    vi.resetAllMocks();
    delete process.env.USE_MOCKS;
    ({ PATCH } = await import(
      "@/app/api/workspaces/[slug]/lingo/edges/[ref_id]/route"
    ));
  });

  afterEach(() => {
    delete process.env.USE_MOCKS;
  });

  test("returns 401 for unauthenticated request", async () => {
    const req = unauthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/edges/edge-001`,
    );
    const res = await PATCH(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "edge-001" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 403 on ACCESS_DENIED (IDOR guard)", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: false,
      error: { type: "ACCESS_DENIED" },
    });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/edges/edge-001`,
      { method: "PATCH" },
    );
    const res = await PATCH(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "edge-001" }),
    });
    expect(res.status).toBe(403);
    expect(mockPatchEdge).not.toHaveBeenCalled();
  });

  test("returns mock success when USE_MOCKS=true without calling patchEdge", async () => {
    process.env.USE_MOCKS = "true";
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/edges/edge-001`,
      { method: "PATCH" },
    );
    const res = await PATCH(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "edge-001" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockPatchEdge).not.toHaveBeenCalled();
  });

  test("always sends { is_deleted: true } to patchEdge", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: true,
      data: SWARM_DATA,
    });
    mockPatchEdge.mockResolvedValueOnce({ success: true });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/edges/edge-abc`,
      { method: "PATCH" },
    );
    await PATCH(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "edge-abc" }),
    });
    expect(mockPatchEdge).toHaveBeenCalledWith(
      expect.anything(),
      "edge-abc",
      { is_deleted: true },
    );
  });

  test("returns { success: true } on successful soft-delete", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: true,
      data: SWARM_DATA,
    });
    mockPatchEdge.mockResolvedValueOnce({ success: true });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/edges/edge-abc`,
      { method: "PATCH" },
    );
    const res = await PATCH(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "edge-abc" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test("returns 500 when patchEdge fails", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: true,
      data: SWARM_DATA,
    });
    mockPatchEdge.mockResolvedValueOnce({ success: false, error: "Jarvis error" });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/edges/edge-fail`,
      { method: "PATCH" },
    );
    const res = await PATCH(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "edge-fail" }),
    });
    expect(res.status).toBe(500);
  });

  test("returns 404 on WORKSPACE_NOT_FOUND", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: false,
      error: { type: "WORKSPACE_NOT_FOUND" },
    });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/bad-slug/lingo/edges/edge-001`,
      { method: "PATCH" },
    );
    const res = await PATCH(req, {
      params: Promise.resolve({ slug: "bad-slug", ref_id: "edge-001" }),
    });
    expect(res.status).toBe(404);
    expect(mockPatchEdge).not.toHaveBeenCalled();
  });
});
