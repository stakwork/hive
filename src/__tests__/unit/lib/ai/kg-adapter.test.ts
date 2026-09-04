/**
 * Unit tests for kg-adapter.ts
 *
 * Mocks globalThis.fetch to verify HTTP call construction and response mapping.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — declared before imports (vitest hoists these)
// ---------------------------------------------------------------------------

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  kgGetNode,
  normalizeAncestors,
  kgGetNeighbors,
  kgGetNodesByRefs,
  kgSearch,
  kgGetOntology,
  kgGetNodesByType,
  kgGetOntologyType,
  KG_ONTOLOGY_TYPE_SWARM_UNAVAILABLE,
  KG_ONTOLOGY_TYPE_UNKNOWN,
} from "@/lib/ai/kg-adapter";
import { logger } from "@/lib/logger";

// Typed aliases for the mocked logger methods.
const mockLoggerWarn = logger.warn as unknown as ReturnType<typeof vi.fn>;
const mockLoggerInfo = logger.info as unknown as ReturnType<typeof vi.fn>;
const mockLoggerDebug = logger.debug as unknown as ReturnType<typeof vi.fn>;

const JARVIS_URL = "https://jarvis.example.com";
const API_KEY = "test-api-key";

function mockFetch(response: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(response),
  });
}

function mockFetchThrow(error = new Error("Network error")) {
  return vi.fn().mockRejectedValue(error);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// kgGetNode
// ---------------------------------------------------------------------------

describe("kgGetNode", () => {
  it("bare shape: maps node fields directly", async () => {
    const raw = {
      ref_id: "node-abc",
      node_type: "Function",
      name: "myFunction",
      properties: { file: "src/index.ts" },
    };
    globalThis.fetch = mockFetch(raw);

    const result = await kgGetNode(JARVIS_URL, API_KEY, "node-abc");

    expect(result).toEqual({
      ref_id: "node-abc",
      node_type: "Function",
      name: "myFunction",
      properties: { file: "src/index.ts" },
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${JARVIS_URL}/v2/nodes/node-abc?limit=1`,
      expect.objectContaining({ headers: { "x-api-token": API_KEY } }),
    );
  });

  it("wrapped shape: finds the queried node inside { nodes, edges, status }", async () => {
    // The deployed Jarvis wraps the node in { nodes, edges, status } and the
    // queried node has NO top-level name — its label lives in properties.
    const wrapped = {
      status: "Success",
      edges: [{ source: "node-abc", target: "other", edge_type: "RELATED_TO" }],
      nodes: [
        { ref_id: "other", node_type: "Clip", properties: { description: "x" } },
        { ref_id: "node-abc", node_type: "Topic", properties: { name: "Auth" } },
      ],
    };
    globalThis.fetch = mockFetch(wrapped);

    const result = await kgGetNode(JARVIS_URL, API_KEY, "node-abc");

    expect(result).toEqual({
      ref_id: "node-abc",
      node_type: "Topic",
      name: "Auth",
      properties: { name: "Auth" },
    });
  });

  it("derives name from properties.entity when no top-level name", async () => {
    const raw = {
      ref_id: "ent-1",
      node_type: "Entity",
      properties: { entity: "Auth", entity_lower: "auth" },
    };
    globalThis.fetch = mockFetch(raw);

    const result = await kgGetNode(JARVIS_URL, API_KEY, "ent-1");
    expect(result?.name).toBe("Auth");
  });

  it("includeEdgeCounts: fetches /connection-counts and attaches a collapsed edges map", async () => {
    const node = { ref_id: "node-abc", node_type: "Function", name: "myFn", properties: {} };
    const counts = {
      counts: [
        { edge_type: "MODIFIES", target_type: "File", count: 3 },
        { edge_type: "MODIFIES", target_type: "Function", count: 2 },
        { edge_type: "CITES", target_type: "Paper", count: 1 },
      ],
    };
    globalThis.fetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(url.includes("/connection-counts") ? counts : node),
      }),
    );

    const result = await kgGetNode(JARVIS_URL, API_KEY, "node-abc", {
      includeEdgeCounts: true,
    });

    // Counts collapse across target types: MODIFIES 3+2, CITES 1.
    expect(result?.edges).toEqual({ MODIFIES: 5, CITES: 1 });
    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    );
    expect(urls.some((u) => u.includes("/v2/nodes/node-abc/connection-counts"))).toBe(true);
  });

  it("includeEdgeCounts: a failed counts lookup leaves edges as {} without failing the call", async () => {
    const node = { ref_id: "node-abc", node_type: "Function", name: "myFn", properties: {} };
    globalThis.fetch = vi.fn().mockImplementation((url: string) =>
      url.includes("/connection-counts")
        ? Promise.reject(new Error("boom"))
        : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(node) }),
    );

    const result = await kgGetNode(JARVIS_URL, API_KEY, "node-abc", {
      includeEdgeCounts: true,
    });

    expect(result?.ref_id).toBe("node-abc");
    expect(result?.edges).toEqual({});
  });

  it("does not fetch connection-counts by default", async () => {
    globalThis.fetch = mockFetch({ ref_id: "n", node_type: "File", properties: {} });

    const result = await kgGetNode(JARVIS_URL, API_KEY, "n");

    expect(result?.edges).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("includeAncestors: fetches /ancestors (PARENT_OF, in) and attaches the DAG nearest-first", async () => {
    const node = { ref_id: "leaf", node_type: "Concept", name: "Leaf", properties: {} };
    const ancestors = {
      ref_id: "leaf",
      edge_type: "PARENT_OF",
      direction: "in",
      max_depth: 10,
      ancestors: [
        { ref_id: "mid-a", name: "Mid A", node_type: "Concept", depth: 1, parents: ["root"] },
        { ref_id: "mid-b", name: "Mid B", node_type: "Concept", depth: 1, parents: ["root"] },
        { ref_id: "root", name: "Law", node_type: "Concept", depth: 2, parents: [] },
      ],
    };
    globalThis.fetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(url.includes("/ancestors") ? ancestors : node),
      }),
    );

    const result = await kgGetNode(JARVIS_URL, API_KEY, "leaf", {
      includeEdgeCounts: false,
      includeAncestors: true,
    });

    expect(result?.ancestors?.map((a) => a.ref_id)).toEqual(["mid-a", "mid-b", "root"]);
    expect(result?.ancestors?.[0]).toEqual({
      ref_id: "mid-a",
      name: "Mid A",
      node_type: "Concept",
      depth: 1,
      parents: ["root"],
    });
    expect(result?.ancestors?.[2].parents).toEqual([]);
    expect(result?.edges).toBeUndefined();
    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    );
    const anUrl = urls.find((u) => u.includes("/v2/nodes/leaf/ancestors"));
    expect(anUrl).toBeDefined();
    expect(anUrl).toContain("edge_type=PARENT_OF");
    expect(anUrl).toContain("direction=in");
    expect(anUrl).toContain("max_depth=10");
  });

  it("includeAncestors: omits the field when the node has no parents, on 404, or on error", async () => {
    const node = { ref_id: "n", node_type: "File", name: "f", properties: {} };
    const cases: Array<(url: string) => Promise<unknown>> = [
      // empty list
      (url) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(url.includes("/ancestors") ? { ancestors: [] } : node),
        }),
      // older Jarvis without the endpoint
      (url) =>
        url.includes("/ancestors")
          ? Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
          : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(node) }),
      // network error
      (url) =>
        url.includes("/ancestors")
          ? Promise.reject(new Error("boom"))
          : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(node) }),
    ];
    for (const impl of cases) {
      globalThis.fetch = vi.fn().mockImplementation(impl);
      const result = await kgGetNode(JARVIS_URL, API_KEY, "n", { includeAncestors: true });
      expect(result?.ref_id).toBe("n");
      expect(result?.ancestors).toBeUndefined();
    }
  });

  it("includeEdgeCounts + includeAncestors fire both side lookups", async () => {
    const node = { ref_id: "n", node_type: "Concept", name: "N", properties: {} };
    globalThis.fetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            url.includes("/ancestors")
              ? { ancestors: [{ ref_id: "p", name: "P", node_type: "Concept", depth: 1, parents: [] }] }
              : url.includes("/connection-counts")
                ? { counts: [{ edge_type: "PARENT_OF", target_type: "Concept", count: 1 }] }
                : node,
          ),
      }),
    );

    const result = await kgGetNode(JARVIS_URL, API_KEY, "n", {
      includeEdgeCounts: true,
      includeAncestors: true,
    });

    expect(result?.edges).toEqual({ PARENT_OF: 1 });
    expect(result?.ancestors?.map((a) => a.ref_id)).toEqual(["p"]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("does not fetch ancestors by default", async () => {
    globalThis.fetch = mockFetch({ ref_id: "n", node_type: "File", properties: {} });
    const result = await kgGetNode(JARVIS_URL, API_KEY, "n");
    expect(result?.ancestors).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns null on HTTP error (non-2xx)", async () => {
    globalThis.fetch = mockFetch(null, false, 404);
    const result = await kgGetNode(JARVIS_URL, API_KEY, "missing-node");
    expect(result).toBeNull();
  });

  it("returns null on network throw", async () => {
    globalThis.fetch = mockFetchThrow();
    const result = await kgGetNode(JARVIS_URL, API_KEY, "any-ref");
    expect(result).toBeNull();
  });

  it("normalizes a trailing-slash jarvisUrl to exactly one slash before the path (regression)", async () => {
    const raw = {
      ref_id: "node-abc",
      node_type: "Function",
      name: "myFunction",
      properties: {},
    };
    globalThis.fetch = mockFetch(raw);

    await kgGetNode(`${JARVIS_URL}/`, API_KEY, "node-abc");

    // The base's trailing slash must be stripped — never a double slash.
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${JARVIS_URL}/v2/nodes/node-abc?limit=1`,
      expect.objectContaining({ headers: { "x-api-token": API_KEY } }),
    );
  });

  it("keeps exactly ?limit=1 when nothing else is appended (no trailing slash on base)", async () => {
    globalThis.fetch = mockFetch({
      ref_id: "node-abc",
      node_type: "Function",
      name: "myFunction",
      properties: {},
    });

    await kgGetNode(JARVIS_URL, API_KEY, "node-abc");

    const [calledUrl] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(calledUrl).toBe(`${JARVIS_URL}/v2/nodes/node-abc?limit=1`);
  });
});

// ---------------------------------------------------------------------------
// kgGetNeighbors
// ---------------------------------------------------------------------------

describe("kgGetNeighbors", () => {
  const QUERIED_REF = "ref-source";

  it("omits the root by default and returns it with includeRoot", async () => {
    const raw = {
      nodes: [
        {
          ref_id: QUERIED_REF,
          node_type: "Concept",
          properties: { name: "Auth Flow", description: "How login works" },
        },
        { ref_id: "ref-target", node_type: "File", name: "auth.ts" },
      ],
      edges: [
        { source: QUERIED_REF, target: "ref-target", edge_type: "DESCRIBES", properties: {} },
      ],
    };

    globalThis.fetch = mockFetch(raw);
    const withoutRoot = await kgGetNeighbors(JARVIS_URL, API_KEY, QUERIED_REF);
    expect(withoutRoot.root).toBeUndefined();

    globalThis.fetch = mockFetch(raw);
    const withRoot = await kgGetNeighbors(JARVIS_URL, API_KEY, QUERIED_REF, {
      includeRoot: true,
    });

    expect(withRoot.root).toEqual({
      ref_id: QUERIED_REF,
      node_type: "Concept",
      name: "Auth Flow",
      properties: { name: "Auth Flow", description: "How login works" },
    });
    // The root never leaks into the neighbor list.
    expect(withRoot.neighbors.map((n) => n.ref_id)).toEqual(["ref-target"]);
  });

  it("leaves root undefined when the queried node is absent from the response", async () => {
    globalThis.fetch = mockFetch({ nodes: [], edges: [] });

    const result = await kgGetNeighbors(JARVIS_URL, API_KEY, QUERIED_REF, {
      includeRoot: true,
    });

    expect(result.reachable).toBe(true);
    expect(result.root).toBeUndefined();
  });

  it("direction forward when edge.source === refId (MODIFIES edge)", async () => {
    const raw = {
      nodes: [
        { ref_id: QUERIED_REF, node_type: "Function", name: "myFn" },
        { ref_id: "ref-target", node_type: "File", name: "target.ts" },
      ],
      edges: [
        {
          source: QUERIED_REF,
          target: "ref-target",
          edge_type: "MODIFIES",
          properties: {},
        },
      ],
    };
    globalThis.fetch = mockFetch(raw);

    const { neighbors, reachable } = await kgGetNeighbors(
      JARVIS_URL,
      API_KEY,
      QUERIED_REF,
    );

    expect(reachable).toBe(true);
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0].direction).toBe("forward");
    expect(neighbors[0].edgeType).toBe("MODIFIES");
    expect(neighbors[0].ref_id).toBe("ref-target");
    expect(neighbors[0].node_type).toBe("File");
  });

  it("direction reverse when edge.source !== refId (TOUCHES edge)", async () => {
    const raw = {
      nodes: [
        { ref_id: QUERIED_REF, node_type: "File", name: "src.ts" },
        { ref_id: "ref-other", node_type: "Function", name: "caller" },
      ],
      edges: [
        {
          source: "ref-other",
          target: QUERIED_REF,
          edge_type: "TOUCHES",
          properties: {},
        },
      ],
    };
    globalThis.fetch = mockFetch(raw);

    const { neighbors, reachable } = await kgGetNeighbors(
      JARVIS_URL,
      API_KEY,
      QUERIED_REF,
    );

    expect(reachable).toBe(true);
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0].direction).toBe("reverse");
    expect(neighbors[0].edgeType).toBe("TOUCHES");
    expect(neighbors[0].ref_id).toBe("ref-other");
  });

  it("source-node dedup: queried node is never in the neighbors output", async () => {
    const raw = {
      nodes: [
        { ref_id: QUERIED_REF, node_type: "Function", name: "src" },
        { ref_id: "ref-neighbor", node_type: "File", name: "file.ts" },
      ],
      edges: [
        {
          source: QUERIED_REF,
          target: "ref-neighbor",
          edge_type: "MODIFIES",
          properties: {},
        },
      ],
    };
    globalThis.fetch = mockFetch(raw);

    const { neighbors } = await kgGetNeighbors(JARVIS_URL, API_KEY, QUERIED_REF);

    const selfEntry = neighbors.find((n) => n.ref_id === QUERIED_REF);
    expect(selfEntry).toBeUndefined();
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0].ref_id).toBe("ref-neighbor");
  });

  it("reachable: true with empty neighbors when response has no edges", async () => {
    const raw = { nodes: [], edges: [] };
    globalThis.fetch = mockFetch(raw);

    const { neighbors, reachable } = await kgGetNeighbors(
      JARVIS_URL,
      API_KEY,
      QUERIED_REF,
    );

    expect(reachable).toBe(true);
    expect(neighbors).toHaveLength(0);
  });

  it("sends a limit to Jarvis to bound the Cypher traversal (OOM guard)", async () => {
    globalThis.fetch = mockFetch({ nodes: [], edges: [] });

    await kgGetNeighbors(JARVIS_URL, API_KEY, QUERIED_REF);

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("expand=edges");
    expect(calledUrl).toContain("limit=50");
  });

  it("requests importance-ordered neighbors so the cap keeps the most important", async () => {
    globalThis.fetch = mockFetch({ nodes: [], edges: [] });

    await kgGetNeighbors(JARVIS_URL, API_KEY, QUERIED_REF);

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("sort_by=importance");
  });

  it("caps neighbors at 50 (hot node with many edges)", async () => {
    const edges = Array.from({ length: 200 }, (_, i) => ({
      source: QUERIED_REF,
      target: `n-${i}`,
      edge_type: "MODIFIES",
      properties: {},
    }));
    globalThis.fetch = mockFetch({ nodes: [], edges });

    const { neighbors, reachable } = await kgGetNeighbors(
      JARVIS_URL,
      API_KEY,
      QUERIED_REF,
    );

    expect(reachable).toBe(true);
    expect(neighbors).toHaveLength(50);
  });

  it("dedups a neighbor reached via multiple parallel edges", async () => {
    const edges = [
      { source: QUERIED_REF, target: "dup", edge_type: "MODIFIES", properties: {} },
      { source: QUERIED_REF, target: "dup", edge_type: "MODIFIES", properties: {} },
      { source: QUERIED_REF, target: "other", edge_type: "MODIFIES", properties: {} },
    ];
    globalThis.fetch = mockFetch({ nodes: [], edges });

    const { neighbors } = await kgGetNeighbors(JARVIS_URL, API_KEY, QUERIED_REF);

    expect(neighbors).toHaveLength(2);
    expect(neighbors.map((n) => n.ref_id).sort()).toEqual(["dup", "other"]);
  });

  it("reachable: false when fetch throws", async () => {
    globalThis.fetch = mockFetchThrow();

    const { neighbors, reachable } = await kgGetNeighbors(
      JARVIS_URL,
      API_KEY,
      QUERIED_REF,
    );

    expect(reachable).toBe(false);
    expect(neighbors).toHaveLength(0);
  });

  it("propagates the neighbor's top-level name as the neighbor label", async () => {
    const raw = {
      nodes: [
        { ref_id: QUERIED_REF, node_type: "Concept", name: "Unit Tests" },
        { ref_id: "ref-file", node_type: "File", name: "graphWalkerTools.ts" },
      ],
      edges: [
        { source: QUERIED_REF, target: "ref-file", edge_type: "MODIFIES", properties: {} },
      ],
    };
    globalThis.fetch = mockFetch(raw);

    const { neighbors } = await kgGetNeighbors(JARVIS_URL, API_KEY, QUERIED_REF);

    expect(neighbors[0].name).toBe("graphWalkerTools.ts");
  });

  it("derives a neighbor label from properties when there is no top-level name", async () => {
    const raw = {
      nodes: [
        { ref_id: QUERIED_REF, node_type: "Concept" },
        // No top-level name; label lives under properties.file_name
        {
          ref_id: "ref-file",
          node_type: "File",
          properties: { file_name: "kg-adapter.ts" },
        },
      ],
      edges: [
        { source: QUERIED_REF, target: "ref-file", edge_type: "MODIFIES", properties: {} },
      ],
    };
    globalThis.fetch = mockFetch(raw);

    const { neighbors } = await kgGetNeighbors(JARVIS_URL, API_KEY, QUERIED_REF);

    expect(neighbors[0].name).toBe("kg-adapter.ts");
  });

  it("leaves the neighbor label empty when no recognizable field exists", async () => {
    const raw = {
      nodes: [
        { ref_id: QUERIED_REF, node_type: "Concept" },
        { ref_id: "ref-x", node_type: "Mystery", properties: { weight: 3 } },
      ],
      edges: [
        { source: QUERIED_REF, target: "ref-x", edge_type: "REL", properties: {} },
      ],
    };
    globalThis.fetch = mockFetch(raw);

    const { neighbors } = await kgGetNeighbors(JARVIS_URL, API_KEY, QUERIED_REF);

    expect(neighbors[0].name).toBe("");
  });

  it("importance passthrough from edge.properties.importance", async () => {
    const raw = {
      nodes: [
        { ref_id: QUERIED_REF, node_type: "Function" },
        { ref_id: "ref-imp", node_type: "File", name: "imp.ts" },
      ],
      edges: [
        {
          source: QUERIED_REF,
          target: "ref-imp",
          edge_type: "MODIFIES",
          properties: { importance: 0.85 },
        },
      ],
    };
    globalThis.fetch = mockFetch(raw);

    const { neighbors } = await kgGetNeighbors(JARVIS_URL, API_KEY, QUERIED_REF);

    expect(neighbors[0].importance).toBe(0.85);
  });

  it("edge_type filter URL-encoded as Python list literal", async () => {
    globalThis.fetch = mockFetch({ nodes: [], edges: [] });

    await kgGetNeighbors(JARVIS_URL, API_KEY, QUERIED_REF, {
      edgeTypes: ["MODIFIES", "CITES"],
    });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain('edge_type=%5B%22MODIFIES%22%2C%22CITES%22%5D');
  });

  it("node_type filter URL-encoded as Python list literal", async () => {
    globalThis.fetch = mockFetch({ nodes: [], edges: [] });

    await kgGetNeighbors(JARVIS_URL, API_KEY, QUERIED_REF, {
      nodeTypes: ["File"],
    });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain('node_type=%5B%22File%22%5D');
  });

  it("includeEdgeCounts: sends include_edge_counts=true and attaches each neighbor's edges map", async () => {
    const raw = {
      nodes: [
        { ref_id: QUERIED_REF, node_type: "Concept" },
        {
          ref_id: "ref-file",
          node_type: "File",
          name: "a.ts",
          edges: { MODIFIES: 4, TOUCHES: 2 },
        },
      ],
      edges: [
        { source: QUERIED_REF, target: "ref-file", edge_type: "MODIFIES", properties: {} },
      ],
    };
    globalThis.fetch = mockFetch(raw);

    const { neighbors } = await kgGetNeighbors(JARVIS_URL, API_KEY, QUERIED_REF, {
      includeEdgeCounts: true,
    });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("include_edge_counts=true");
    expect(neighbors[0].edges).toEqual({ MODIFIES: 4, TOUCHES: 2 });
  });

  it("does not send include_edge_counts (and omits edges) by default", async () => {
    const raw = {
      nodes: [
        { ref_id: QUERIED_REF, node_type: "Concept" },
        { ref_id: "ref-file", node_type: "File", name: "a.ts", edges: { MODIFIES: 4 } },
      ],
      edges: [
        { source: QUERIED_REF, target: "ref-file", edge_type: "MODIFIES", properties: {} },
      ],
    };
    globalThis.fetch = mockFetch(raw);

    const { neighbors } = await kgGetNeighbors(JARVIS_URL, API_KEY, QUERIED_REF);

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).not.toContain("include_edge_counts");
    expect(neighbors[0].edges).toBeUndefined();
  });

  it("sends canonicalize=false so multi-hump node_type filters match real labels", async () => {
    globalThis.fetch = mockFetch({ nodes: [], edges: [] });

    await kgGetNeighbors(JARVIS_URL, API_KEY, QUERIED_REF, {
      nodeTypes: ["PullRequest"],
    });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("canonicalize=false");
  });

  it("reachable: false on non-2xx HTTP response", async () => {
    globalThis.fetch = mockFetch(null, false, 500);

    const { reachable } = await kgGetNeighbors(JARVIS_URL, API_KEY, QUERIED_REF);
    expect(reachable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// kgGetNodesByRefs
// ---------------------------------------------------------------------------

describe("kgGetNodesByRefs", () => {
  it("POSTs ref_ids to /v2/nodes/by-refs and returns a ref_id→name map", async () => {
    const raw = {
      nodes: [
        { ref_id: "c1", node_type: "Concept", properties: { name: "Integration Tests" } },
        { ref_id: "c2", node_type: "Concept", properties: { name: "Org Canvas" } },
      ],
    };
    globalThis.fetch = mockFetch(raw);

    const map = await kgGetNodesByRefs(JARVIS_URL, API_KEY, ["c1", "c2"]);

    expect(map.get("c1")).toBe("Integration Tests");
    expect(map.get("c2")).toBe("Org Canvas");

    const [calledUrl, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledUrl).toBe(`${JARVIS_URL}/v2/nodes/by-refs`);
    expect(init).toMatchObject({
      method: "POST",
      headers: { "x-api-token": API_KEY, "Content-Type": "application/json" },
    });
    expect(JSON.parse(init.body as string)).toEqual({ ref_ids: ["c1", "c2"] });
  });

  it("derives names from fallback property keys (file_name) and skips unlabeled nodes", async () => {
    const raw = {
      nodes: [
        { ref_id: "f1", node_type: "File", properties: { file_name: "kg-adapter.ts" } },
        { ref_id: "x1", node_type: "Mystery", properties: { weight: 3 } },
      ],
    };
    globalThis.fetch = mockFetch(raw);

    const map = await kgGetNodesByRefs(JARVIS_URL, API_KEY, ["f1", "x1"]);

    expect(map.get("f1")).toBe("kg-adapter.ts");
    expect(map.has("x1")).toBe(false);
  });

  it("dedups and drops empty ref_ids before sending", async () => {
    globalThis.fetch = mockFetch({ nodes: [] });

    await kgGetNodesByRefs(JARVIS_URL, API_KEY, ["a", "a", "", "b"]);

    const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(JSON.parse(init.body as string)).toEqual({ ref_ids: ["a", "b"] });
  });

  it("returns an empty map without calling fetch when given no ref_ids", async () => {
    globalThis.fetch = mockFetch({ nodes: [] });

    const map = await kgGetNodesByRefs(JARVIS_URL, API_KEY, []);

    expect(map.size).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns an empty map on non-2xx response", async () => {
    globalThis.fetch = mockFetch(null, false, 401);
    const map = await kgGetNodesByRefs(JARVIS_URL, API_KEY, ["c1"]);
    expect(map.size).toBe(0);
  });

  it("returns an empty map on fetch throw", async () => {
    globalThis.fetch = mockFetchThrow();
    const map = await kgGetNodesByRefs(JARVIS_URL, API_KEY, ["c1"]);
    expect(map.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// kgSearch
// ---------------------------------------------------------------------------

describe("kgSearch", () => {
  it("hits the ranked /v2/nodes pipeline and maps hits with name/description/edges", async () => {
    const raw = {
      nodes: [
        {
          ref_id: "n1",
          node_type: "Function",
          properties: { name: "doThing", description: "Does the thing." },
          edges: { MODIFIES: 3, CALLS: 1 },
        },
        { ref_id: "n2", node_type: "File", properties: { file_name: "utils.ts" } },
      ],
    };
    globalThis.fetch = mockFetch(raw);

    const results = await kgSearch(JARVIS_URL, API_KEY, "doThing");

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      ref_id: "n1",
      node_type: "Function",
      name: "doThing",
      description: "Does the thing.",
      edges: { MODIFIES: 3, CALLS: 1 },
    });
    expect(results[1]).toMatchObject({
      ref_id: "n2",
      node_type: "File",
      name: "utils.ts",
      description: "",
      edges: {},
    });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("/v2/nodes?");
    expect(calledUrl).not.toContain("/v2/nodes/search");
    expect(calledUrl).toContain("q=doThing");
    expect(calledUrl).toContain("include_edge_counts=true");
  });

  it("handles a bare-array response shape", async () => {
    globalThis.fetch = mockFetch([
      { ref_id: "x", node_type: "Topic", properties: { name: "Auth" } },
    ]);
    const results = await kgSearch(JARVIS_URL, API_KEY, "auth");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ref_id: "x", name: "Auth" });
  });

  it("returns empty array on fetch error", async () => {
    globalThis.fetch = mockFetchThrow();
    const results = await kgSearch(JARVIS_URL, API_KEY, "anything");
    expect(results).toEqual([]);
  });

  it("returns empty array on non-2xx response", async () => {
    globalThis.fetch = mockFetch(null, false, 503);
    const results = await kgSearch(JARVIS_URL, API_KEY, "anything");
    expect(results).toEqual([]);
  });

  it("returns [] without fetching when no query and no input_q/output_q", async () => {
    globalThis.fetch = mockFetch({ nodes: [] });
    const results = await kgSearch(JARVIS_URL, API_KEY, "");
    expect(results).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("type filter forwarded comma-separated (not a Python list literal)", async () => {
    globalThis.fetch = mockFetch({ nodes: [] });

    await kgSearch(JARVIS_URL, API_KEY, "func", { type: "Function,File" });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("type=Function%2CFile");
    expect(calledUrl).not.toContain("%5B"); // no "["
  });

  it("includes limit param", async () => {
    globalThis.fetch = mockFetch({ nodes: [] });

    await kgSearch(JARVIS_URL, API_KEY, "query", { limit: 42 });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("limit=42");
  });

  it("forwards input_q / output_q / domains as field-scoped retriever params", async () => {
    globalThis.fetch = mockFetch({ nodes: [] });

    await kgSearch(JARVIS_URL, API_KEY, "transcribe", {
      inputQ: "a video file url",
      outputQ: "transcript",
      domains: "content,entity",
    });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("input_q=a+video+file+url");
    expect(calledUrl).toContain("output_q=transcript");
    expect(calledUrl).toContain("domains=content%2Centity");
  });

  it("searches with only input_q (no keyword query)", async () => {
    globalThis.fetch = mockFetch({ nodes: [] });

    await kgSearch(JARVIS_URL, API_KEY, "", { inputQ: "pdf document" });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("input_q=pdf+document");
    expect(new URL(calledUrl).searchParams.get("q")).toBeNull();
  });

  it("filters excluded internal types (Hint/Memory/Clip/Turn) client-side", async () => {
    const raw = {
      nodes: [
        { ref_id: "good", node_type: "Topic", properties: { name: "Auth" } },
        { ref_id: "bad-1", node_type: "Hint", properties: { name: "hint" } },
        { ref_id: "bad-2", node_type: "clip", properties: { name: "clip" } },
      ],
    };
    globalThis.fetch = mockFetch(raw);

    const results = await kgSearch(JARVIS_URL, API_KEY, "auth");

    expect(results.map((r) => r.ref_id)).toEqual(["good"]);
  });

  it("truncates long descriptions to 300 chars", async () => {
    const raw = {
      nodes: [
        {
          ref_id: "n1",
          node_type: "Topic",
          properties: { name: "Auth", description: "x".repeat(500) },
        },
      ],
    };
    globalThis.fetch = mockFetch(raw);

    const results = await kgSearch(JARVIS_URL, API_KEY, "auth");
    expect(results[0].description).toHaveLength(300);
  });

  // -------------------------------------------------------------------------
  // namespace option
  // -------------------------------------------------------------------------

  describe("namespace option", () => {
    it("forwards namespace into the /v2/nodes query string when supplied", async () => {
      globalThis.fetch = mockFetch({ nodes: [] });

      await kgSearch(JARVIS_URL, API_KEY, "doThing", { namespace: "team-alpha" });

      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(new URL(calledUrl).searchParams.get("namespace")).toBe("team-alpha");
    });

    it("emits NO namespace param when omitted (byte-identical request)", async () => {
      globalThis.fetch = mockFetch({ nodes: [] });

      await kgSearch(JARVIS_URL, API_KEY, "doThing");

      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      const sp = new URL(calledUrl).searchParams;
      expect(sp.has("namespace")).toBe(false);
      // Existing params untouched by the feature.
      expect(sp.get("q")).toBe("doThing");
      expect(sp.get("limit")).toBe("20");
      expect(sp.get("include_edge_counts")).toBe("true");
    });

    it("treats a blank/whitespace-only namespace as omitted (no namespace param)", async () => {
      globalThis.fetch = mockFetch({ nodes: [] });

      await kgSearch(JARVIS_URL, API_KEY, "doThing", { namespace: "   " });

      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(new URL(calledUrl).searchParams.has("namespace")).toBe(false);
    });

    it("leaves existing params (q/type/domains/limit/include_edge_counts) unchanged alongside namespace", async () => {
      globalThis.fetch = mockFetch({ nodes: [] });

      await kgSearch(JARVIS_URL, API_KEY, "func", {
        type: "Function",
        domains: "entity",
        limit: 7,
        namespace: "ns1",
      });

      const sp = new URL(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string,
      ).searchParams;
      expect(sp.get("namespace")).toBe("ns1");
      expect(sp.get("q")).toBe("func");
      expect(sp.get("type")).toBe("Function");
      expect(sp.get("domains")).toBe("entity");
      expect(sp.get("limit")).toBe("7");
      expect(sp.get("include_edge_counts")).toBe("true");
    });
  });

  // -------------------------------------------------------------------------
  // query-outcome logging
  // -------------------------------------------------------------------------

  describe("query-outcome logging", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("warns with status + applied namespace on !res.ok and still returns []", async () => {
      globalThis.fetch = mockFetch(null, false, 503);

      const results = await kgSearch(JARVIS_URL, API_KEY, "auth", {
        namespace: "prod-ns",
      });

      expect(results).toEqual([]);
      expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining("rejected"),
        "kg-adapter:kgSearch",
        expect.objectContaining({ status: 503, namespace: "prod-ns" }),
      );
      // A rejection must NOT also produce a success debug line — the two
      // outcomes stay distinguishable.
      expect(mockLoggerDebug).not.toHaveBeenCalled();
    });

    it('logs "<none>" for the applied namespace when none was supplied (!res.ok path)', async () => {
      globalThis.fetch = mockFetch(null, false, 404);

      await kgSearch(JARVIS_URL, API_KEY, "auth");

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.any(String),
        "kg-adapter:kgSearch",
        expect.objectContaining({ status: 404, namespace: "<none>" }),
      );
    });

    it("emits a debug line with count 0 + applied namespace on a 200-with-zero-rows response", async () => {
      globalThis.fetch = mockFetch({ nodes: [] });

      const results = await kgSearch(JARVIS_URL, API_KEY, "auth", {
        namespace: "empty-partition",
      });

      expect(results).toEqual([]);
      expect(mockLoggerDebug).toHaveBeenCalledTimes(1);
      expect(mockLoggerDebug).toHaveBeenCalledWith(
        expect.any(String),
        "kg-adapter:kgSearch",
        expect.objectContaining({ count: 0, namespace: "empty-partition" }),
      );
      // Zero rows is success-shaped — no warn line may fire for it.
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });

    it("warns with a timeout-specific message when fetch throws an AbortError", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      globalThis.fetch = mockFetchThrow(abortError);

      const results = await kgSearch(JARVIS_URL, API_KEY, "auth", {
        namespace: "prod-ns",
      });

      expect(results).toEqual([]);
      expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining("timed out"),
        "kg-adapter:kgSearch",
        expect.objectContaining({
          timeoutMs: expect.any(Number),
          namespace: "prod-ns",
        }),
      );
    });

    it("warns differently for a generic throw than for an abort (distinguishable catch paths)", async () => {
      globalThis.fetch = mockFetchThrow(new Error("Network error"));

      await kgSearch(JARVIS_URL, API_KEY, "auth");

      expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
      const [message, , metadata] = mockLoggerWarn.mock.calls[0];
      // Distinct from the AbortError branch: no "timed out" phrasing and no
      // timeoutMs field; carries the underlying error name instead.
      expect(message).not.toContain("timed out");
      expect(metadata).toMatchObject({ errorType: "Error", namespace: "<none>" });
      expect((metadata as { timeoutMs?: number }).timeoutMs).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// kgGetOntology
// ---------------------------------------------------------------------------

describe("kgGetOntology", () => {
  /** Route fetch to per-endpoint responses for the two ontology sources. */
  function mockOntologyFetch(
    labelsResponse: unknown,
    schemaResponse: unknown,
    { labelsOk = true, schemaOk = true } = {},
  ) {
    return vi.fn().mockImplementation((url: string) => {
      const isLabels = url.includes("/graph/labels");
      return Promise.resolve({
        ok: isLabels ? labelsOk : schemaOk,
        status: 200,
        json: () => Promise.resolve(isLabels ? labelsResponse : schemaResponse),
      });
    });
  }

  it("merges /graph/labels (real casing) with /v2/schema (domains + descriptions)", async () => {
    globalThis.fetch = mockOntologyFetch(
      {
        labels: [
          { type: "PullRequest", description: "A GitHub pull request." },
          { type: "File" },
        ],
      },
      {
        schemas: [
          { type: "Pullrequest", domain: "Code", description: "schema PR desc" },
          { type: "File", domain: "code", description: "A source file." },
        ],
      },
    );

    const result = await kgGetOntology(JARVIS_URL, API_KEY);

    expect(result).toEqual({
      domains: ["code"],
      node_types: [
        // Real label casing wins; label description preferred over schema's.
        { type: "PullRequest", domain: "code", description: "A GitHub pull request." },
        // Missing label description falls back to schema description.
        { type: "File", domain: "code", description: "A source file." },
      ],
    });
  });

  it("requests both /graph/labels and /v2/schema with x-api-token", async () => {
    globalThis.fetch = mockOntologyFetch({ labels: [] }, { schemas: [] });

    await kgGetOntology(JARVIS_URL, API_KEY);

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const urls = calls.map((c) => c[0] as string).sort();
    expect(urls).toEqual([`${JARVIS_URL}/graph/labels`, `${JARVIS_URL}/v2/schema`]);
    for (const call of calls) {
      expect(call[1]).toMatchObject({ headers: { "x-api-token": API_KEY } });
    }
  });

  it("includes schema-only types (registered but no live nodes yet)", async () => {
    globalThis.fetch = mockOntologyFetch(
      { labels: [{ type: "File" }] },
      {
        schemas: [
          { type: "Statute", domain: "legal", description: "A legal statute." },
        ],
      },
    );

    const result = await kgGetOntology(JARVIS_URL, API_KEY);

    expect(result.node_types).toEqual([
      { type: "File", domain: null, description: "" },
      { type: "Statute", domain: "legal", description: "A legal statute." },
    ]);
    expect(result.domains).toEqual(["legal"]);
  });

  it("filters wildcard and deleted schema entries", async () => {
    globalThis.fetch = mockOntologyFetch(
      { labels: [] },
      {
        schemas: [
          { type: "*", domain: "meta" },
          { type: "Ghost", domain: "old", is_deleted: true },
          { type: "Keep", domain: "entity" },
        ],
      },
    );

    const result = await kgGetOntology(JARVIS_URL, API_KEY);

    expect(result.node_types).toEqual([
      { type: "Keep", domain: "entity", description: "" },
    ]);
    expect(result.domains).toEqual(["entity"]);
  });

  it("still returns labels when /v2/schema fails (best-effort merge)", async () => {
    globalThis.fetch = mockOntologyFetch(
      { labels: [{ type: "PullRequest", description: "PR" }] },
      null,
      { schemaOk: false },
    );

    const result = await kgGetOntology(JARVIS_URL, API_KEY);

    expect(result).toEqual({
      domains: [],
      node_types: [{ type: "PullRequest", domain: null, description: "PR" }],
    });
  });

  it("still returns schema types when /graph/labels fails", async () => {
    globalThis.fetch = mockOntologyFetch(
      null,
      { schemas: [{ type: "File", domain: "code", description: "A file." }] },
      { labelsOk: false },
    );

    const result = await kgGetOntology(JARVIS_URL, API_KEY);

    expect(result.node_types).toEqual([
      { type: "File", domain: "code", description: "A file." },
    ]);
  });

  it("filters out label entries missing a type", async () => {
    globalThis.fetch = mockOntologyFetch(
      { labels: [{ description: "no type here" }, { type: "File" }] },
      { schemas: [] },
    );

    const result = await kgGetOntology(JARVIS_URL, API_KEY);

    expect(result.node_types).toEqual([{ type: "File", domain: null, description: "" }]);
  });

  it("returns empty payload when both fetches throw", async () => {
    globalThis.fetch = mockFetchThrow();

    const result = await kgGetOntology(JARVIS_URL, API_KEY);

    expect(result).toEqual({ domains: [], node_types: [] });
  });

  it("returns empty payload on malformed responses", async () => {
    globalThis.fetch = mockOntologyFetch(
      { labels: "not-an-array" },
      { schemas: "nope" },
    );

    const result = await kgGetOntology(JARVIS_URL, API_KEY);

    expect(result).toEqual({ domains: [], node_types: [] });
  });
});

// ---------------------------------------------------------------------------
// kgGetNodesByType
// ---------------------------------------------------------------------------

describe("kgGetNodesByType", () => {
  it("raw-array response: maps nodes correctly", async () => {
    const raw = [
      { ref_id: "ep-1", node_type: "Episode", name: "My Episode", properties: { description: "desc" } },
      { ref_id: "ep-2", node_type: "Episode", properties: { title: "Ep 2" } },
    ];
    globalThis.fetch = mockFetch(raw);

    const result = await kgGetNodesByType(JARVIS_URL, API_KEY, "Episode", 50);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ ref_id: "ep-1", node_type: "Episode", name: "My Episode" });
    expect(result[1]).toMatchObject({ ref_id: "ep-2", node_type: "Episode", name: "Ep 2" });
  });

  it("wrapped { nodes: [] } response: maps nodes correctly", async () => {
    const raw = {
      nodes: [
        { ref_id: "msg-1", node_type: "Message", properties: { content: "hello" } },
      ],
    };
    globalThis.fetch = mockFetch(raw);

    const result = await kgGetNodesByType(JARVIS_URL, API_KEY, "Message", 200);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ ref_id: "msg-1", node_type: "Message" });
    expect(result[0].properties).toMatchObject({ content: "hello" });
  });

  it("filters out nodes with missing ref_id", async () => {
    const raw = [
      { ref_id: "good-1", node_type: "Episode", name: "Good" },
      { node_type: "Episode", name: "No ref" }, // no ref_id
    ];
    globalThis.fetch = mockFetch(raw);

    const result = await kgGetNodesByType(JARVIS_URL, API_KEY, "Episode", 50);

    expect(result).toHaveLength(1);
    expect(result[0].ref_id).toBe("good-1");
  });

  it("sends correct URL with type and limit params", async () => {
    globalThis.fetch = mockFetch([]);

    await kgGetNodesByType(JARVIS_URL, API_KEY, "HiveChatMessage", 200);

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("/v2/nodes");
    expect(calledUrl).toContain("type=HiveChatMessage");
    expect(calledUrl).toContain("limit=200");
  });

  it("sends x-api-token auth header", async () => {
    globalThis.fetch = mockFetch([]);

    await kgGetNodesByType(JARVIS_URL, API_KEY, "Episode", 50);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { "x-api-token": API_KEY } }),
    );
  });

  it("returns [] on non-ok HTTP response", async () => {
    globalThis.fetch = mockFetch(null, false, 500);

    const result = await kgGetNodesByType(JARVIS_URL, API_KEY, "Episode", 50);

    expect(result).toEqual([]);
  });

  it("returns [] on thrown fetch error", async () => {
    globalThis.fetch = mockFetchThrow();

    const result = await kgGetNodesByType(JARVIS_URL, API_KEY, "Message", 200);

    expect(result).toEqual([]);
  });

  it("returns [] when response is empty array", async () => {
    globalThis.fetch = mockFetch([]);

    const result = await kgGetNodesByType(JARVIS_URL, API_KEY, "Call", 50);

    expect(result).toEqual([]);
  });

  it("returns [] when wrapped response has empty nodes array", async () => {
    globalThis.fetch = mockFetch({ nodes: [] });

    const result = await kgGetNodesByType(JARVIS_URL, API_KEY, "Call", 50);

    expect(result).toEqual([]);
  });

  it("strips trailing slash from jarvisUrl", async () => {
    globalThis.fetch = mockFetch([]);

    await kgGetNodesByType(`${JARVIS_URL}/`, API_KEY, "Episode", 50);

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("//v2");
    expect(calledUrl).toContain("/v2/nodes");
  });
});


// ---------------------------------------------------------------------------
// kgGetOntologyType
// ---------------------------------------------------------------------------

describe("kgGetOntologyType", () => {
  /** Minimal representative schema response — includes attributes, inherited_attributes, edges. */
  const BASE_SCHEMA_RESPONSE = {
    schemas: [
      {
        type: "Concept",
        domain: "entity",
        description: "A knowledge-graph concept.",
        node_key: "name",
        parent: "Thing",
        attributes: {
          name: "string",
          summary: "?string",
        },
        inherited_attributes: {
          label: "?string",
          // Declared `name` already in attributes — inherited duplicate should be dropped.
          name: "string",
          // Reserved key — must be skipped.
          is_deleted: false,
          status: "?string",
          boost: "?number",
          algo_score: "?float",
        },
      },
    ],
    edges: [
      { source_type: "Concept", target_type: "Concept", edge_type: "RELATED_TO" },
      { source_type: "HiveFeature", target_type: "Concept", edge_type: "IMPLEMENTS" },
      // Wildcard source — must be included.
      { source_type: "*", target_type: "Concept", edge_type: "CITES" },
      // Wildcard target — must be included.
      { source_type: "Concept", target_type: "*", edge_type: "MENTIONS" },
      // Unrelated edge — must NOT be included.
      { source_type: "HiveFeature", target_type: "HiveTask", edge_type: "HAS_TASK" },
    ],
  };

  it("happy path: merges attributes and inherited_attributes into one list", async () => {
    globalThis.fetch = mockFetch(BASE_SCHEMA_RESPONSE);

    const result = await kgGetOntologyType(JARVIS_URL, API_KEY, "Concept");

    expect(result).not.toBe(KG_ONTOLOGY_TYPE_SWARM_UNAVAILABLE);
    expect(result).not.toBe(KG_ONTOLOGY_TYPE_UNKNOWN);

    // Cast to schema type for assertions
    const schema = result as {
      type: string;
      node_key: string;
      parent: string;
      attributes: Array<{ name: string; type: string; required: boolean }>;
      edges: Array<{ source_type: string; target_type: string; edge_type: string }>;
    };

    expect(schema.type).toBe("Concept");
    expect(schema.node_key).toBe("name");
    expect(schema.parent).toBe("Thing");
  });

  it("required-ness: ?-prefix means optional, no prefix means required", async () => {
    globalThis.fetch = mockFetch(BASE_SCHEMA_RESPONSE);

    const result = await kgGetOntologyType(JARVIS_URL, API_KEY, "Concept");
    const schema = result as { attributes: Array<{ name: string; type: string; required: boolean }> };

    const nameAttr = schema.attributes.find((a) => a.name === "name");
    expect(nameAttr).toEqual({ name: "name", type: "string", required: true });

    const summaryAttr = schema.attributes.find((a) => a.name === "summary");
    expect(summaryAttr).toEqual({ name: "summary", type: "string", required: false });
  });

  it("inherited_attributes: includes inherited optional field with correct required=false", async () => {
    globalThis.fetch = mockFetch(BASE_SCHEMA_RESPONSE);

    const result = await kgGetOntologyType(JARVIS_URL, API_KEY, "Concept");
    const schema = result as { attributes: Array<{ name: string; type: string; required: boolean }> };

    // `label` only in inherited_attributes, ?string → required: false
    const labelAttr = schema.attributes.find((a) => a.name === "label");
    expect(labelAttr).toEqual({ name: "label", type: "string", required: false });
  });

  it("deduplication: declared attribute wins over identically-named inherited attribute", async () => {
    globalThis.fetch = mockFetch(BASE_SCHEMA_RESPONSE);

    const result = await kgGetOntologyType(JARVIS_URL, API_KEY, "Concept");
    const schema = result as { attributes: Array<{ name: string; type: string; required: boolean }> };

    // `name` appears in both maps; declared wins, only one entry should appear.
    const nameAttrs = schema.attributes.filter((a) => a.name === "name");
    expect(nameAttrs).toHaveLength(1);
    expect(nameAttrs[0].required).toBe(true); // declared: required
  });

  it("reserved keys are skipped: is_deleted, status, boost are not surfaced as attributes", async () => {
    globalThis.fetch = mockFetch(BASE_SCHEMA_RESPONSE);

    const result = await kgGetOntologyType(JARVIS_URL, API_KEY, "Concept");
    const schema = result as { attributes: Array<{ name: string }> };

    const attrNames = schema.attributes.map((a) => a.name);
    expect(attrNames).not.toContain("is_deleted");
    expect(attrNames).not.toContain("status");
    expect(attrNames).not.toContain("boost");
  });

  it("reserved algo_* keys are skipped", async () => {
    globalThis.fetch = mockFetch(BASE_SCHEMA_RESPONSE);

    const result = await kgGetOntologyType(JARVIS_URL, API_KEY, "Concept");
    const schema = result as { attributes: Array<{ name: string }> };

    const attrNames = schema.attributes.map((a) => a.name);
    expect(attrNames).not.toContain("algo_score");
    expect(attrNames.some((n) => n.startsWith("algo_"))).toBe(false);
  });

  it("non-string attribute values are skipped (e.g. boolean is_deleted)", async () => {
    globalThis.fetch = mockFetch({
      schemas: [
        {
          type: "Thing",
          attributes: {
            name: "string",
            active: true,    // boolean — skip
            count: 42,       // number — skip
            tags: ["a"],     // array — skip
          },
          inherited_attributes: {},
        },
      ],
      edges: [],
    });

    const result = await kgGetOntologyType(JARVIS_URL, API_KEY, "Thing");
    const schema = result as { attributes: Array<{ name: string }> };

    expect(schema.attributes).toHaveLength(1);
    expect(schema.attributes[0].name).toBe("name");
  });

  it("edge filtering: keeps type-matching edges (source or target) and wildcard edges", async () => {
    globalThis.fetch = mockFetch(BASE_SCHEMA_RESPONSE);

    const result = await kgGetOntologyType(JARVIS_URL, API_KEY, "Concept");
    const schema = result as { edges: Array<{ source_type: string; target_type: string; edge_type: string }> };

    const edgeTypes = schema.edges.map((e) => e.edge_type);
    // Type-specific edges
    expect(edgeTypes).toContain("RELATED_TO");    // Concept → Concept
    expect(edgeTypes).toContain("IMPLEMENTS");    // HiveFeature → Concept (target matches)
    // Wildcard source/target
    expect(edgeTypes).toContain("CITES");         // * → Concept (wildcard source)
    expect(edgeTypes).toContain("MENTIONS");      // Concept → * (wildcard target)
    // Unrelated edge must NOT appear
    expect(edgeTypes).not.toContain("HAS_TASK");  // HiveFeature → HiveTask
  });

  it("edge filtering: does NOT include edges unrelated to the requested type or wildcards", async () => {
    globalThis.fetch = mockFetch(BASE_SCHEMA_RESPONSE);

    const result = await kgGetOntologyType(JARVIS_URL, API_KEY, "Concept");
    const schema = result as { edges: Array<{ source_type: string; target_type: string }> };

    // HiveFeature → HiveTask is unrelated to Concept and has no wildcard
    const unrelated = schema.edges.filter(
      (e) => e.source_type === "HiveFeature" && e.target_type === "HiveTask",
    );
    expect(unrelated).toHaveLength(0);
  });

  it("case-insensitive type match: 'concept' resolves to 'Concept' schema entry", async () => {
    globalThis.fetch = mockFetch(BASE_SCHEMA_RESPONSE);

    const result = await kgGetOntologyType(JARVIS_URL, API_KEY, "concept");

    expect(result).not.toBe(KG_ONTOLOGY_TYPE_SWARM_UNAVAILABLE);
    expect(result).not.toBe(KG_ONTOLOGY_TYPE_UNKNOWN);
    const schema = result as { type: string };
    expect(schema.type).toBe("Concept");
  });

  it("excludes the wildcard '*' schema entry when looking up '*'", async () => {
    globalThis.fetch = mockFetch({
      schemas: [
        { type: "*", domain: "meta", attributes: {}, inherited_attributes: {} },
        { type: "Real", domain: "entity", attributes: { id: "string" }, inherited_attributes: {} },
      ],
      edges: [],
    });

    const result = await kgGetOntologyType(JARVIS_URL, API_KEY, "*");

    // The wildcard sentinel type must be excluded — return unknown
    expect(result).toBe(KG_ONTOLOGY_TYPE_UNKNOWN);
  });

  it("excludes is_deleted schema entries (returns unknown)", async () => {
    globalThis.fetch = mockFetch({
      schemas: [
        { type: "Ghost", domain: "old", is_deleted: true, attributes: {}, inherited_attributes: {} },
      ],
      edges: [],
    });

    const result = await kgGetOntologyType(JARVIS_URL, API_KEY, "Ghost");

    expect(result).toBe(KG_ONTOLOGY_TYPE_UNKNOWN);
  });

  it("unknown type returns KG_ONTOLOGY_TYPE_UNKNOWN", async () => {
    globalThis.fetch = mockFetch({ schemas: [], edges: [] });

    const result = await kgGetOntologyType(JARVIS_URL, API_KEY, "NonExistentType");

    expect(result).toBe(KG_ONTOLOGY_TYPE_UNKNOWN);
  });

  it("label-only type (not in schemas) returns KG_ONTOLOGY_TYPE_UNKNOWN", async () => {
    // /v2/schema returns a list that does NOT include the type the caller wants
    globalThis.fetch = mockFetch({
      schemas: [{ type: "Other", attributes: {}, inherited_attributes: {} }],
      edges: [],
    });

    const result = await kgGetOntologyType(JARVIS_URL, API_KEY, "LabelOnly");

    expect(result).toBe(KG_ONTOLOGY_TYPE_UNKNOWN);
  });

  it("non-ok HTTP response returns KG_ONTOLOGY_TYPE_SWARM_UNAVAILABLE", async () => {
    globalThis.fetch = mockFetch(null, false, 503);

    const result = await kgGetOntologyType(JARVIS_URL, API_KEY, "Concept");

    expect(result).toBe(KG_ONTOLOGY_TYPE_SWARM_UNAVAILABLE);
  });

  it("fetch throw returns KG_ONTOLOGY_TYPE_SWARM_UNAVAILABLE", async () => {
    globalThis.fetch = mockFetchThrow(new Error("network down"));

    const result = await kgGetOntologyType(JARVIS_URL, API_KEY, "Concept");

    expect(result).toBe(KG_ONTOLOGY_TYPE_SWARM_UNAVAILABLE);
  });

  it("calls GET /v2/schema with include_attributes and include_edges params", async () => {
    globalThis.fetch = mockFetch({ schemas: [], edges: [] });

    await kgGetOntologyType(JARVIS_URL, API_KEY, "Concept");

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("/v2/schema");
    expect(calledUrl).toContain("include_attributes=true");
    expect(calledUrl).toContain("include_edges=true");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { "x-api-token": API_KEY } }),
    );
  });

  it("strips trailing slash from jarvisUrl", async () => {
    globalThis.fetch = mockFetch({ schemas: [], edges: [] });

    await kgGetOntologyType(`${JARVIS_URL}/`, API_KEY, "Concept");

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("//v2");
    expect(calledUrl).toContain("/v2/schema");
  });

  it("swarm and unknown-type failures return distinct sentinel values", async () => {
    // Swarm unavailable
    globalThis.fetch = mockFetchThrow();
    const unreachable = await kgGetOntologyType(JARVIS_URL, API_KEY, "Concept");

    // Unknown type
    globalThis.fetch = mockFetch({ schemas: [], edges: [] });
    const unknown = await kgGetOntologyType(JARVIS_URL, API_KEY, "Concept");

    expect(unreachable).toBe(KG_ONTOLOGY_TYPE_SWARM_UNAVAILABLE);
    expect(unknown).toBe(KG_ONTOLOGY_TYPE_UNKNOWN);
    expect(unreachable).not.toBe(unknown);
  });
});

// ---------------------------------------------------------------------------
// normalizeAncestors
// ---------------------------------------------------------------------------

describe("normalizeAncestors", () => {
  it("returns [] for missing, non-array, or empty ancestors", () => {
    expect(normalizeAncestors(undefined)).toEqual([]);
    expect(normalizeAncestors({})).toEqual([]);
    expect(normalizeAncestors({ ancestors: null })).toEqual([]);
    expect(normalizeAncestors({ ancestors: "nope" })).toEqual([]);
    expect(normalizeAncestors({ ancestors: [] })).toEqual([]);
  });

  it("drops malformed rows, dedupes ref_ids, and coerces bad fields to safe defaults", () => {
    const out = normalizeAncestors({
      ancestors: [
        null,
        { name: "no ref" },
        { ref_id: "", name: "empty ref" },
        { ref_id: "x", name: 42, node_type: null, depth: "abc", parents: "root" },
        { ref_id: "x", name: "dup", depth: 1, parents: [] },
        { ref_id: "y", name: "Y", node_type: "Claim", depth: 0, parents: ["p", 7, "", null] },
      ],
    });
    expect(out).toEqual([
      { ref_id: "x", name: "", node_type: "unknown", depth: 1, parents: [] },
      { ref_id: "y", name: "Y", node_type: "Claim", depth: 1, parents: ["p"] },
    ]);
  });

  it("truncates at the cap (nearest first) and clamps long names to the label cap", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      ref_id: `a${i}`,
      name: i === 0 ? "x".repeat(500) : `A${i}`,
      node_type: "Concept",
      depth: i + 1,
      parents: [],
    }));
    const out = normalizeAncestors({ ancestors: rows }, 3);
    expect(out.map((a) => a.ref_id)).toEqual(["a0", "a1", "a2"]);
    expect(out[0].name.length).toBe(160);
  });
});
