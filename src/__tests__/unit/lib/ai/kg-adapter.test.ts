/**
 * Unit tests for kg-adapter.ts
 *
 * Mocks globalThis.fetch to verify HTTP call construction and response mapping.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { kgGetNode, kgGetNeighbors, kgGetNodesByRefs, kgSearch, kgGetOntology, kgGetNodesByType, kgGetSubgraph } from "@/lib/ai/kg-adapter";

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
// kgGetSubgraph
// ---------------------------------------------------------------------------

describe("kgGetSubgraph", () => {
  const START_REF_ID = "eval-set-001";

  it("successful fetch: returns { ok: true, subgraph } with nodes and edges", async () => {
    const mockSubgraph = {
      nodes: [
        { ref_id: "node-1", node_type: "EvalTrigger", properties: { agent: "test" } },
        { ref_id: "node-2", node_type: "ProposedFix", properties: {} },
      ],
      edges: [
        { source: "node-1", target: "node-2", edge_type: "HAS_PROPOSED_FIX" },
      ],
    };
    globalThis.fetch = mockFetch(mockSubgraph);

    const result = await kgGetSubgraph(JARVIS_URL, API_KEY, START_REF_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.subgraph.nodes).toHaveLength(2);
      expect(result.subgraph.edges).toHaveLength(1);
      expect(result.subgraph.nodes[0].ref_id).toBe("node-1");
    }
  });

  it("successful fetch: sends correct params (start_node, node_type, depth, include_properties)", async () => {
    globalThis.fetch = mockFetch({ nodes: [], edges: [] });

    await kgGetSubgraph(JARVIS_URL, API_KEY, START_REF_ID);

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("/graph/subgraph");
    expect(calledUrl).toContain(`start_node=${encodeURIComponent(START_REF_ID)}`);
    expect(calledUrl).toContain("node_type=");
    expect(calledUrl).toContain("depth=");
    expect(calledUrl).toContain("include_properties=true");
  });

  it("uses correct auth header (x-api-token)", async () => {
    globalThis.fetch = mockFetch({ nodes: [], edges: [] });

    await kgGetSubgraph(JARVIS_URL, API_KEY, START_REF_ID);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { "x-api-token": API_KEY } }),
    );
  });

  it("failed HTTP response: returns { ok: false, error }", async () => {
    globalThis.fetch = mockFetch(null, false, 500);

    const result = await kgGetSubgraph(JARVIS_URL, API_KEY, START_REF_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("500");
    }
  });

  it("network error (fetch throws): returns { ok: false, error }", async () => {
    globalThis.fetch = mockFetchThrow(new Error("Connection refused"));

    const result = await kgGetSubgraph(JARVIS_URL, API_KEY, START_REF_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Connection refused");
    }
  });

  it("abort timeout (AbortError): returns { ok: false, error }", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    globalThis.fetch = mockFetchThrow(abortError);

    const result = await kgGetSubgraph(JARVIS_URL, API_KEY, START_REF_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("aborted");
    }
  });

  it("oversized subgraph: truncated to size cap, returns { ok: true } with warning", async () => {
    // Build a subgraph with 400 nodes + 400 edges = 800 total (>= KG_SUBGRAPH_CAP=500)
    const manyNodes = Array.from({ length: 400 }, (_, i) => ({
      ref_id: `node-${i}`,
      node_type: "ProposedFix",
      properties: {},
    }));
    const manyEdges = Array.from({ length: 400 }, (_, i) => ({
      source: `node-${i}`,
      target: `node-${i + 1}`,
      edge_type: "DERIVED_FROM",
    }));
    globalThis.fetch = mockFetch({ nodes: manyNodes, edges: manyEdges });

    const result = await kgGetSubgraph(JARVIS_URL, API_KEY, START_REF_ID);

    // Should still return ok:true but with truncated data
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Total should be <= cap (500)
      const total = result.subgraph.nodes.length + result.subgraph.edges.length;
      expect(total).toBeLessThanOrEqual(500);
    }
  });

  it("default depth is 999 (full history)", async () => {
    globalThis.fetch = mockFetch({ nodes: [], edges: [] });

    await kgGetSubgraph(JARVIS_URL, API_KEY, START_REF_ID);

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("depth=999");
  });

  it("custom depth is passed through", async () => {
    globalThis.fetch = mockFetch({ nodes: [], edges: [] });

    await kgGetSubgraph(JARVIS_URL, API_KEY, START_REF_ID, { depth: 3 });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("depth=3");
  });

  it("custom nodeTypes override the default SUBGRAPH_NODE_TYPES", async () => {
    globalThis.fetch = mockFetch({ nodes: [], edges: [] });

    await kgGetSubgraph(JARVIS_URL, API_KEY, START_REF_ID, { nodeTypes: ["CustomType"] });

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("node_type=");
    expect(calledUrl).toContain("CustomType");
  });

  it("strips trailing slash from jarvisUrl", async () => {
    globalThis.fetch = mockFetch({ nodes: [], edges: [] });

    await kgGetSubgraph(`${JARVIS_URL}/`, API_KEY, START_REF_ID);

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("//graph");
    expect(calledUrl).toContain("/graph/subgraph");
  });

  it("empty subgraph response: returns { ok: true, subgraph: { nodes: [], edges: [] } }", async () => {
    globalThis.fetch = mockFetch({ nodes: [], edges: [] });

    const result = await kgGetSubgraph(JARVIS_URL, API_KEY, START_REF_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.subgraph.nodes).toHaveLength(0);
      expect(result.subgraph.edges).toHaveLength(0);
    }
  });
});
