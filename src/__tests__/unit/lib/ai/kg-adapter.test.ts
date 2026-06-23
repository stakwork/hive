/**
 * Unit tests for kg-adapter.ts
 *
 * Mocks globalThis.fetch to verify HTTP call construction and response mapping.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { kgGetNode, kgGetNeighbors, kgSearch } from "@/lib/ai/kg-adapter";

const SWARM_URL = "https://jarvis.example.com";
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
  it("happy path: maps node fields correctly", async () => {
    const raw = {
      ref_id: "node-abc",
      node_type: "Function",
      name: "myFunction",
      properties: { file: "src/index.ts" },
    };
    globalThis.fetch = mockFetch(raw);

    const result = await kgGetNode(SWARM_URL, API_KEY, "node-abc");

    expect(result).toEqual({
      ref_id: "node-abc",
      node_type: "Function",
      name: "myFunction",
      properties: { file: "src/index.ts" },
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${SWARM_URL}/v2/nodes/node-abc`,
      { headers: { "x-api-token": API_KEY } },
    );
  });

  it("returns null on HTTP error (non-2xx)", async () => {
    globalThis.fetch = mockFetch(null, false, 404);
    const result = await kgGetNode(SWARM_URL, API_KEY, "missing-node");
    expect(result).toBeNull();
  });

  it("returns null on network throw", async () => {
    globalThis.fetch = mockFetchThrow();
    const result = await kgGetNode(SWARM_URL, API_KEY, "any-ref");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// kgGetNeighbors
// ---------------------------------------------------------------------------

describe("kgGetNeighbors", () => {
  const QUERIED_REF = "ref-source";

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
      SWARM_URL,
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
      SWARM_URL,
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

    const { neighbors } = await kgGetNeighbors(SWARM_URL, API_KEY, QUERIED_REF);

    const selfEntry = neighbors.find((n) => n.ref_id === QUERIED_REF);
    expect(selfEntry).toBeUndefined();
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0].ref_id).toBe("ref-neighbor");
  });

  it("reachable: true with empty neighbors when response has no edges", async () => {
    const raw = { nodes: [], edges: [] };
    globalThis.fetch = mockFetch(raw);

    const { neighbors, reachable } = await kgGetNeighbors(
      SWARM_URL,
      API_KEY,
      QUERIED_REF,
    );

    expect(reachable).toBe(true);
    expect(neighbors).toHaveLength(0);
  });

  it("reachable: false when fetch throws", async () => {
    globalThis.fetch = mockFetchThrow();

    const { neighbors, reachable } = await kgGetNeighbors(
      SWARM_URL,
      API_KEY,
      QUERIED_REF,
    );

    expect(reachable).toBe(false);
    expect(neighbors).toHaveLength(0);
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

    const { neighbors } = await kgGetNeighbors(SWARM_URL, API_KEY, QUERIED_REF);

    expect(neighbors[0].importance).toBe(0.85);
  });

  it("edge_type filter URL-encoded as Python list literal", async () => {
    globalThis.fetch = mockFetch({ nodes: [], edges: [] });

    await kgGetNeighbors(SWARM_URL, API_KEY, QUERIED_REF, {
      edgeTypes: ["MODIFIES", "CITES"],
    });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain('edge_type=%5B%22MODIFIES%22%2C%22CITES%22%5D');
  });

  it("node_type filter URL-encoded as Python list literal", async () => {
    globalThis.fetch = mockFetch({ nodes: [], edges: [] });

    await kgGetNeighbors(SWARM_URL, API_KEY, QUERIED_REF, {
      nodeTypes: ["File"],
    });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain('node_type=%5B%22File%22%5D');
  });

  it("reachable: false on non-2xx HTTP response", async () => {
    globalThis.fetch = mockFetch(null, false, 500);

    const { reachable } = await kgGetNeighbors(SWARM_URL, API_KEY, QUERIED_REF);
    expect(reachable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// kgSearch
// ---------------------------------------------------------------------------

describe("kgSearch", () => {
  it("maps result array correctly", async () => {
    const raw = [
      { ref_id: "n1", node_type: "Function", name: "doThing", properties: {} },
      { ref_id: "n2", node_type: "File", name: "utils.ts" },
    ];
    globalThis.fetch = mockFetch(raw);

    const results = await kgSearch(SWARM_URL, API_KEY, "doThing");

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      ref_id: "n1",
      node_type: "Function",
      name: "doThing",
    });
    expect(results[1]).toMatchObject({ ref_id: "n2", node_type: "File" });
  });

  it("returns empty array on fetch error", async () => {
    globalThis.fetch = mockFetchThrow();
    const results = await kgSearch(SWARM_URL, API_KEY, "anything");
    expect(results).toEqual([]);
  });

  it("returns empty array on non-2xx response", async () => {
    globalThis.fetch = mockFetch(null, false, 503);
    const results = await kgSearch(SWARM_URL, API_KEY, "anything");
    expect(results).toEqual([]);
  });

  it("node_type filter forwarded as Python list literal", async () => {
    globalThis.fetch = mockFetch([]);

    await kgSearch(SWARM_URL, API_KEY, "func", { type: "Function" });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain('node_type=%5B%22Function%22%5D');
  });

  it("includes limit and expand=false params", async () => {
    globalThis.fetch = mockFetch([]);

    await kgSearch(SWARM_URL, API_KEY, "query", { limit: 42 });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("limit=42");
    expect(calledUrl).toContain("expand=false");
  });
});
