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
  addNode: vi.fn(),
  addEdge: vi.fn(),
  patchEdge: vi.fn(),
  deleteNode: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { addNode, addEdge, patchEdge, deleteNode } from "@/services/swarm/api/nodes";

const mockGetWorkspaceSwarmAccess = vi.mocked(getWorkspaceSwarmAccess);
const mockAddNode = vi.mocked(addNode);
const mockAddEdge = vi.mocked(addEdge);
const mockPatchEdge = vi.mocked(patchEdge);
const mockDeleteNode = vi.mocked(deleteNode);

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
    vi.unstubAllEnvs();
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

  test("returns empty nodes list when swarm not configured", async () => {
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
    expect(body.data.nodes).toEqual([]);
    expect(body.data.hasMore).toBe(false);
  });

  test("returns mock data when USE_MOCKS=true in development without calling jarvis", async () => {
    vi.stubEnv("USE_MOCKS", "true");
    vi.stubEnv("NODE_ENV", "development");
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

  test("does not use mock data when USE_MOCKS=true in production", async () => {
    vi.stubEnv("USE_MOCKS", "true");
    vi.stubEnv("NODE_ENV", "production");
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
    // Should hit the swarm check (not mock), and return empty because swarm not configured
    expect(mockGetWorkspaceSwarmAccess).toHaveBeenCalled();
    expect(body.data.nodes).toEqual([]);
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
    expect(calledUrl).toContain("type=Lingo");
    expect(calledUrl).not.toContain("namespace=");
    expect(calledUrl).not.toContain("sort=");
  });

  test("returns nodes sorted by date_added_to_graph descending", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: true,
      data: SWARM_DATA,
    });
    const unsortedNodes = [
      { ref_id: "node-b", node_type: "Lingo", date_added_to_graph: 1000, properties: { name: "Middle" } },
      { ref_id: "node-c", node_type: "Lingo", date_added_to_graph: 500,  properties: { name: "Oldest" } },
      { ref_id: "node-a", node_type: "Lingo", date_added_to_graph: 2000, properties: { name: "Newest" } },
    ];
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ nodes: unsortedNodes }), { status: 200 }),
    );
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    const dates = body.data.nodes.map((n: { date_added_to_graph: number }) => n.date_added_to_graph);
    expect(dates).toEqual([2000, 1000, 500]);
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

  test("returns 500 when Jarvis returns non-2xx", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({ success: true, data: SWARM_DATA });
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "bad request" }), { status: 400 }),
    );
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Failed to fetch Lingo nodes");
  });

  test("returns 500 when Jarvis fetch throws", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({ success: true, data: SWARM_DATA });
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Failed to fetch Lingo nodes");
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
    vi.unstubAllEnvs();
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

  test("returns mock data for known ref_id when USE_MOCKS=true in development", async () => {
    vi.stubEnv("USE_MOCKS", "true");
    vi.stubEnv("NODE_ENV", "development");
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
    vi.stubEnv("USE_MOCKS", "true");
    vi.stubEnv("NODE_ENV", "development");
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/unknown-node`,
    );
    const res = await GET(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "unknown-node" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 404 when swarm not configured", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: false,
      error: { type: "SWARM_NOT_CONFIGURED" },
    });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/jargon-001`,
    );
    const res = await GET(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "jargon-001" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Node not found");
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
    expect(calledUrl).toContain("expand=edges");
  });

  test("returns 404 when Jarvis returns non-2xx", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({ success: true, data: SWARM_DATA });
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "not found" }), { status: 400 }),
    );
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/jargon-001`,
    );
    const res = await GET(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "jargon-001" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Node not found");
  });

  test("returns 404 when Jarvis fetch throws", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({ success: true, data: SWARM_DATA });
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/jargon-001`,
    );
    const res = await GET(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "jargon-001" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Node not found");
  });

  test("returns 404 when Jarvis returns non-2xx for unknown ref_id", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({ success: true, data: SWARM_DATA });
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "not found" }), { status: 400 }),
    );
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/unknown-ref-xyz`,
    );
    const res = await GET(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "unknown-ref-xyz" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test("calls Jarvis with expand=edges", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({ success: true, data: SWARM_DATA });
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          nodes: [{ ref_id: "jargon-001", node_type: "Lingo", properties: { name: "Term" } }],
          edges: [],
        }),
        { status: 200 },
      ),
    );
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/jargon-001`,
    );
    await GET(req, { params: Promise.resolve({ slug: SLUG, ref_id: "jargon-001" }) });
    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).toContain("expand=edges");
  });

  test("maps edges where source === currentRefId", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({ success: true, data: SWARM_DATA });
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          nodes: [
            { ref_id: "jargon-001", node_type: "Lingo", properties: { name: "Source Node" } },
            { ref_id: "neighbor-001", node_type: "Lingo", properties: { name: "Neighbor" } },
          ],
          edges: [
            { ref_id: "edge-001", edge_type: "HAS_DEFINITION", source: "jargon-001", target: "neighbor-001" },
          ],
        }),
        { status: 200 },
      ),
    );
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/jargon-001`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG, ref_id: "jargon-001" }) });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.edges).toHaveLength(1);
    expect(body.data.edges[0].neighbor_node.ref_id).toBe("neighbor-001");
    expect(body.data.edges[0].edge_type).toBe("HAS_DEFINITION");
  });

  test("maps edges where target === currentRefId", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({ success: true, data: SWARM_DATA });
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          nodes: [
            { ref_id: "jargon-001", node_type: "Lingo", properties: { name: "Current Node" } },
            { ref_id: "source-node", node_type: "Lingo", properties: { name: "The Source" } },
          ],
          edges: [
            { ref_id: "edge-002", edge_type: "SUPERSEDES", source: "source-node", target: "jargon-001" },
          ],
        }),
        { status: 200 },
      ),
    );
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/jargon-001`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG, ref_id: "jargon-001" }) });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.edges).toHaveLength(1);
    expect(body.data.edges[0].neighbor_node.ref_id).toBe("source-node");
  });

  test("filters out edges with missing neighbor nodes", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({ success: true, data: SWARM_DATA });
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          nodes: [
            { ref_id: "jargon-001", node_type: "Lingo", properties: { name: "Current Node" } },
          ],
          edges: [
            { ref_id: "edge-003", edge_type: "RELATED_TO", source: "jargon-001", target: "missing-node" },
          ],
        }),
        { status: 200 },
      ),
    );
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/jargon-001`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG, ref_id: "jargon-001" }) });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.edges).toHaveLength(0);
  });

  test("promotes name and definition from properties into node", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({ success: true, data: SWARM_DATA });
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          nodes: [
            {
              ref_id: "jargon-001",
              node_type: "Lingo",
              date_added_to_graph: 9999,
              properties: { name: "Foo", definition: "Bar", lingo_type: "acronym" },
            },
          ],
          edges: [],
        }),
        { status: 200 },
      ),
    );
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/jargon-001`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG, ref_id: "jargon-001" }) });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.node.name).toBe("Foo");
    expect(body.data.node.definition).toBe("Bar");
    expect(body.data.node.lingo_type).toBe("acronym");
    expect(body.data.node.ref_id).toBe("jargon-001");
    expect(body.data.node.date_added_to_graph).toBe(9999);
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
    vi.unstubAllEnvs();
  });

  test("returns 400 when q param is missing", async () => {
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/search`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(400);
  });

  test("returns filtered mock data when USE_MOCKS=true in development", async () => {
    vi.stubEnv("USE_MOCKS", "true");
    vi.stubEnv("NODE_ENV", "development");
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

  test("returns empty array when swarm not configured", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: false,
      error: { type: "SWARM_NOT_CONFIGURED" },
    });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/search?q=test`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
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
    expect(calledUrl).toContain("/v2/nodes/search");
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

  test("returns empty array when Jarvis returns non-2xx", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({ success: true, data: SWARM_DATA });
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "bad request" }), { status: 400 }),
    );
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/search?q=Swarm`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  test("returns empty array when Jarvis fetch throws", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({ success: true, data: SWARM_DATA });
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/search?q=test`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
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

// ─── POST /lingo/nodes ────────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/lingo/nodes", () => {
  let POST: typeof import("@/app/api/workspaces/[slug]/lingo/nodes/route").POST;

  beforeEach(async () => {
    vi.resetAllMocks();
    delete process.env.USE_MOCKS;
    ({ POST } = await import("@/app/api/workspaces/[slug]/lingo/nodes/route"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("returns 401 for unauthenticated request", async () => {
    const req = new NextRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
      { method: "POST", body: JSON.stringify({ name: "Test" }), headers: { "Content-Type": "application/json" } },
    );
    const res = await POST(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(401);
  });

  test("returns 400 when name is missing", async () => {
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
      { method: "POST", body: {} },
    );
    const res = await POST(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ success: false, error: "name is required" });
  });

  test("returns 400 when name is empty string", async () => {
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
      { method: "POST", body: { name: "   " } },
    );
    const res = await POST(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  test("returns 403 when ACCESS_DENIED", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: false,
      error: { type: "ACCESS_DENIED" },
    });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
      { method: "POST", body: { name: "MyTerm" } },
    );
    const res = await POST(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(403);
  });

  test("returns 404 when WORKSPACE_NOT_FOUND", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: false,
      error: { type: "WORKSPACE_NOT_FOUND" },
    });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/bad-slug/lingo/nodes`,
      { method: "POST", body: { name: "MyTerm" } },
    );
    const res = await POST(req, { params: Promise.resolve({ slug: "bad-slug" }) });
    expect(res.status).toBe(404);
  });

  test("returns success on fresh create", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: true,
      data: SWARM_DATA,
    });
    mockAddNode.mockResolvedValueOnce({ success: true, ref_id: "new-ref-123" });

    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
      { method: "POST", body: { name: "My Term", definition: "A great term" } },
    );
    const res = await POST(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.ref_id).toBe("new-ref-123");
    expect(json.data.name).toBe("My Term");
    expect(json.data.definition).toBe("A great term");
    expect(json.alreadyExists).toBeUndefined();
  });

  test("returns alreadyExists: true on duplicate name", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: true,
      data: SWARM_DATA,
    });
    mockAddNode.mockResolvedValueOnce({ success: true, ref_id: "existing-ref", alreadyExists: true });

    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
      { method: "POST", body: { name: "Existing Term" } },
    );
    const res = await POST(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.alreadyExists).toBe(true);
    expect(json.data.ref_id).toBe("existing-ref");
  });

  test("returns 500 when addNode fails", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: true,
      data: SWARM_DATA,
    });
    mockAddNode.mockResolvedValueOnce({ success: false, error: "Jarvis error" });

    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
      { method: "POST", body: { name: "Bad Term" } },
    );
    const res = await POST(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  test("USE_MOCKS=true returns mock node without calling addNode", async () => {
    process.env.USE_MOCKS = "true";
    process.env.NODE_ENV = "test";

    // Auth check (getWorkspaceSwarmAccess) now runs before the mock fallback
    // so workspace ownership is verified even in mock mode.
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: true,
      data: SWARM_DATA,
    });

    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
      { method: "POST", body: { name: "Mock Term", definition: "Mock def" } },
    );
    const res = await POST(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.ref_id).toBe("mock-lingo-ref");
    expect(json.data.name).toBe("Mock Term");
    expect(mockAddNode).not.toHaveBeenCalled();
  });
});

// ─── DELETE /lingo/nodes/[ref_id] ─────────────────────────────────────────────

describe("DELETE /api/workspaces/[slug]/lingo/nodes/[ref_id]", () => {
  let DELETE: typeof import("@/app/api/workspaces/[slug]/lingo/nodes/[ref_id]/route").DELETE;

  beforeEach(async () => {
    vi.resetAllMocks();
    delete process.env.USE_MOCKS;
    ({ DELETE } = await import("@/app/api/workspaces/[slug]/lingo/nodes/[ref_id]/route"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("returns 401 for unauthenticated request", async () => {
    const req = new NextRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/node-001`,
      { method: "DELETE" },
    );
    const res = await DELETE(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "node-001" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 403 on ACCESS_DENIED — deleteNode must NOT be called", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: false,
      error: { type: "ACCESS_DENIED" },
    });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/node-001`,
      { method: "DELETE" },
    );
    const res = await DELETE(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "node-001" }),
    });
    expect(res.status).toBe(403);
    expect(mockDeleteNode).not.toHaveBeenCalled();
  });

  test("returns 404 on WORKSPACE_NOT_FOUND", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: false,
      error: { type: "WORKSPACE_NOT_FOUND" },
    });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/bad-slug/lingo/nodes/node-001`,
      { method: "DELETE" },
    );
    const res = await DELETE(req, {
      params: Promise.resolve({ slug: "bad-slug", ref_id: "node-001" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 503 on SWARM_NOT_CONFIGURED", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: false,
      error: { type: "SWARM_NOT_CONFIGURED" },
    });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/node-001`,
      { method: "DELETE" },
    );
    const res = await DELETE(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "node-001" }),
    });
    expect(res.status).toBe(503);
  });

  test("returns { success: true } when USE_MOCKS=true without calling deleteNode", async () => {
    process.env.USE_MOCKS = "true";
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/node-001`,
      { method: "DELETE" },
    );
    const res = await DELETE(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "node-001" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockDeleteNode).not.toHaveBeenCalled();
  });

  test("returns 200 { success: true } when deleteNode succeeds", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: true,
      data: SWARM_DATA,
    });
    mockDeleteNode.mockResolvedValueOnce({ success: true });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/node-001`,
      { method: "DELETE" },
    );
    const res = await DELETE(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "node-001" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockDeleteNode).toHaveBeenCalledWith(
      { jarvisUrl: expect.any(String), apiKey: SWARM_DATA.swarmApiKey },
      "node-001",
    );
  });

  test("returns 500 { success: false } when deleteNode fails", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      success: true,
      data: SWARM_DATA,
    });
    mockDeleteNode.mockResolvedValueOnce({ success: false, error: "Jarvis error" });
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/node-001`,
      { method: "DELETE" },
    );
    const res = await DELETE(req, {
      params: Promise.resolve({ slug: SLUG, ref_id: "node-001" }),
    });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});

// ─── ref_id filter guards ─────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/lingo/nodes — ref_id filter", () => {
  let GET: typeof import("@/app/api/workspaces/[slug]/lingo/nodes/route").GET;

  beforeEach(async () => {
    vi.resetAllMocks();
    delete process.env.USE_MOCKS;
    ({ GET } = await import("@/app/api/workspaces/[slug]/lingo/nodes/route"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("drops items missing ref_id and returns only valid nodes", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({ success: true, data: SWARM_DATA });
    const rawNodes = [
      { ref_id: "valid-1", node_type: "Lingo", date_added_to_graph: 2000, properties: { name: "Valid Node" } },
      { node_type: "Lingo", date_added_to_graph: 1000, properties: { name: "Missing ref_id" } },
      null,
      undefined,
      { ref_id: "valid-2", node_type: "Lingo", date_added_to_graph: 500, properties: { name: "Another Valid" } },
    ];
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ nodes: rawNodes }), { status: 200 }),
    );
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.nodes).toHaveLength(2);
    expect(body.data.nodes.map((n: { ref_id: string }) => n.ref_id)).toEqual(["valid-1", "valid-2"]);
  });

  test("returns empty array when all items lack ref_id", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({ success: true, data: SWARM_DATA });
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ nodes: [null, { node_type: "Lingo" }] }), { status: 200 }),
    );
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    const body = await res.json();
    expect(body.data.nodes).toEqual([]);
  });
});

describe("GET /api/workspaces/[slug]/lingo/nodes/search — ref_id filter", () => {
  let GET: typeof import("@/app/api/workspaces/[slug]/lingo/nodes/search/route").GET;

  beforeEach(async () => {
    vi.resetAllMocks();
    delete process.env.USE_MOCKS;
    ({ GET } = await import("@/app/api/workspaces/[slug]/lingo/nodes/search/route"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("drops items missing ref_id and returns only valid search results", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({ success: true, data: SWARM_DATA });
    const rawNodes = [
      { ref_id: "search-1", node_type: "Lingo", name: "Pod", date_added_to_graph: 1000 },
      { node_type: "Lingo", name: "No ref_id item", date_added_to_graph: 900 },
      null,
      { ref_id: "search-2", node_type: "Lingo", name: "Pod Runner", date_added_to_graph: 800 },
    ];
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(rawNodes), { status: 200 }),
    );
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/search?q=pod`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data.map((n: { ref_id: string }) => n.ref_id)).toEqual(["search-1", "search-2"]);
  });

  test("returns empty array when all search results lack ref_id", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({ success: true, data: SWARM_DATA });
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([null, { name: "ghost" }]), { status: 200 }),
    );
    const req = makeAuthenticatedRequest(
      `http://localhost/api/workspaces/${SLUG}/lingo/nodes/search?q=ghost`,
    );
    const res = await GET(req, { params: Promise.resolve({ slug: SLUG }) });
    const body = await res.json();
    expect(body.data).toEqual([]);
  });
});
