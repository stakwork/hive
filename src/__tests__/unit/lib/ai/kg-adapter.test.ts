/**
 * Unit tests for kg-adapter.ts
 *
 * Mocks globalThis.fetch to verify HTTP call construction and response mapping.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { kgGetNode, kgGetNeighbors, kgGetNodesByRefs, kgSearch, kgGetOntology } from "@/lib/ai/kg-adapter";

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
  it("hits the lite /v2/nodes/search endpoint and maps { nodes:[{title}] }", async () => {
    const raw = {
      nodes: [
        { ref_id: "n1", node_type: "Function", title: "doThing" },
        { ref_id: "n2", node_type: "File", title: "utils.ts" },
      ],
    };
    globalThis.fetch = mockFetch(raw);

    const results = await kgSearch(JARVIS_URL, API_KEY, "doThing");

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      ref_id: "n1",
      node_type: "Function",
      name: "doThing",
    });
    expect(results[1]).toMatchObject({ ref_id: "n2", node_type: "File", name: "utils.ts" });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("/v2/nodes/search");
  });

  it("returns [] when response is not the { nodes } object shape", async () => {
    globalThis.fetch = mockFetch([{ ref_id: "x" }]); // bare array → ignored
    const results = await kgSearch(JARVIS_URL, API_KEY, "anything");
    expect(results).toEqual([]);
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

  it("node_type filter forwarded comma-separated (not a Python list literal)", async () => {
    globalThis.fetch = mockFetch({ nodes: [] });

    await kgSearch(JARVIS_URL, API_KEY, "func", { type: "Function" });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("node_type=Function");
    expect(calledUrl).not.toContain("%5B"); // no "["
  });

  it("includes limit param", async () => {
    globalThis.fetch = mockFetch({ nodes: [] });

    await kgSearch(JARVIS_URL, API_KEY, "query", { limit: 42 });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("limit=42");
  });
});

// ---------------------------------------------------------------------------
// kgGetOntology
// ---------------------------------------------------------------------------

describe("kgGetOntology", () => {
  it("parses data.schemas into { type, description }[] and ignores edges", async () => {
    const raw = {
      schemas: [
        { type: "Person", description: "A human being." },
        { type: "File", description: "A source file." },
      ],
      edges: [{ type: "KNOWS" }],
    };
    globalThis.fetch = mockFetch(raw);

    const result = await kgGetOntology(JARVIS_URL, API_KEY);

    expect(result).toEqual([
      { type: "Person", description: "A human being." },
      { type: "File", description: "A source file." },
    ]);
  });

  it("uses ?concise=true in the request URL", async () => {
    globalThis.fetch = mockFetch({ schemas: [] });

    await kgGetOntology(JARVIS_URL, API_KEY);

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain("/schema/all?concise=true");
  });

  it("sends x-api-token header", async () => {
    globalThis.fetch = mockFetch({ schemas: [] });

    await kgGetOntology(JARVIS_URL, API_KEY);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { "x-api-token": API_KEY } }),
    );
  });

  it("fills missing description with empty string", async () => {
    globalThis.fetch = mockFetch({ schemas: [{ type: "Concept" }] });

    const result = await kgGetOntology(JARVIS_URL, API_KEY);

    expect(result).toEqual([{ type: "Concept", description: "" }]);
  });

  it("filters out entries missing a type", async () => {
    globalThis.fetch = mockFetch({
      schemas: [
        { description: "no type here" },
        { type: "File", description: "valid" },
      ],
    });

    const result = await kgGetOntology(JARVIS_URL, API_KEY);

    expect(result).toEqual([{ type: "File", description: "valid" }]);
  });

  it("returns [] on non-ok response", async () => {
    globalThis.fetch = mockFetch(null, false, 503);

    const result = await kgGetOntology(JARVIS_URL, API_KEY);

    expect(result).toEqual([]);
  });

  it("returns [] on thrown fetch", async () => {
    globalThis.fetch = mockFetchThrow();

    const result = await kgGetOntology(JARVIS_URL, API_KEY);

    expect(result).toEqual([]);
  });

  it("returns [] when schemas is missing from response", async () => {
    globalThis.fetch = mockFetch({ edges: [{ type: "RELATED_TO" }] });

    const result = await kgGetOntology(JARVIS_URL, API_KEY);

    expect(result).toEqual([]);
  });

  it("returns [] when schemas is not an array", async () => {
    globalThis.fetch = mockFetch({ schemas: "not-an-array" });

    const result = await kgGetOntology(JARVIS_URL, API_KEY);

    expect(result).toEqual([]);
  });
});
