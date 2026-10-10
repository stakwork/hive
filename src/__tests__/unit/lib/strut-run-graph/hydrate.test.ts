/**
 * Unit tests for `lib/strut-run-graph/hydrate.ts`: resolving the nodes a run
 * touched against the graph.
 *
 * Coverage:
 *   - a node's type is the label left once the structural ones are set aside;
 *   - nodes, the edges among them and their lineage come back from three
 *     queries, an ancestor the run never touched marked as such;
 *   - a ref id that is not id-shaped never reaches a query;
 *   - a graph that cannot answer leaves the nodes as the log named them,
 *     and says what it did not read, and why;
 *   - the swarm's refusal reaches the trace in its own words;
 *   - one node is read whole without its vectors, and a node the graph no
 *     longer holds is told from one it could not answer for;
 *   - a peer workspace's nodes are read from ITS graph and named by their
 *     qualified id, or kept as the log named them, with why, when its graph
 *     is not read for this viewer.
 */

import { afterEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/constants", () => ({ getSwarmVanityAddress: (name: string) => `${name}.sphinx.chat` }));
vi.mock("@/lib/utils/stakgraph-url", () => ({ getStakgraphUrl: (host: string) => `https://${host}:7799` }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));

import {
  hydrateRunGraph,
  hydrateRunGraphAcross,
  isRunGraphRefId,
  readRunGraphNode,
  RUN_GRAPH_MAX_NODES,
  swarmCypherRunner,
  typeFromLabels,
  type CypherRunner,
} from "@/lib/strut-run-graph/hydrate";
import { logger } from "@/lib/logger";

describe("typeFromLabels", () => {
  it("sets the structural labels aside", () => {
    expect(typeFromLabels(["Data_Bank", "Node", "Domain_entity", "ClinicalFinding"])).toBe("ClinicalFinding");
    expect(typeFromLabels(["Data_Bank", "Concept", "Domain_general"])).toBe("Concept");
  });

  it("falls back to the type the log gave, then to Node", () => {
    expect(typeFromLabels(["Data_Bank", "Node"], "Document")).toBe("Document");
    expect(typeFromLabels(["Data_Bank"])).toBe("Node");
    expect(typeFromLabels(null)).toBe("Node");
  });
});

/** Which of the three queries this is. */
const kind = (query: string): "nodes" | "edges" | "lineage" =>
  query.includes("PARENT_OF*") ? "lineage" : query.includes("-[r]->") ? "edges" : "nodes";

const CONCEPT = ["Data_Bank", "Node", "Concept", "Domain_general"];

describe("hydrateRunGraph", () => {
  it("resolves nodes, the edges among them, and the lineage above them", async () => {
    const run = vi.fn<CypherRunner>(async (query) => {
      switch (kind(query)) {
        case "edges":
          return { columns: ["edge_type", "source", "target"], rows: [["CONTAINS", "doc-1", "find-1"]] };
        case "lineage":
          // Every edge on the way up from a touched node, with the parent it comes from.
          return {
            columns: ["labels", "name", "namespace", "source", "target"],
            rows: [
              [CONCEPT, "Medicine", "default", "root", "list"],
              [CONCEPT, "Problem List", "default", "list", "rule"],
            ],
          };
        default:
          return {
            // Upstream orders columns its own way.
            columns: ["labels", "name", "namespace", "ref_id"],
            rows: [
              [["Data_Bank", "Document", "Node", "Domain_content"], "enc-0-hpi.md", "oh-7532", "doc-1"],
              [
                ["Data_Bank", "Node", "Domain_entity", "ClinicalFinding"],
                "  Lethargic on arrival  ",
                "oh-7532",
                "find-1",
              ],
              [CONCEPT, "Longitudinal Problem List Rules", "default", "rule"],
            ],
          };
      }
    });

    const graph = await hydrateRunGraph(
      [{ ref_id: "doc-1", node_type: "Document" }, { ref_id: "find-1" }, { ref_id: "rule", node_type: "Concept" }],
      run,
    );

    expect(run).toHaveBeenCalledTimes(3);
    expect(graph).toEqual({
      nodes: [
        { ref_id: "doc-1", node_type: "Document", name: "enc-0-hpi.md", namespace: "oh-7532", found: true },
        {
          ref_id: "find-1",
          node_type: "ClinicalFinding",
          name: "Lethargic on arrival",
          namespace: "oh-7532",
          found: true,
        },
        {
          ref_id: "rule",
          node_type: "Concept",
          name: "Longitudinal Problem List Rules",
          namespace: "default",
          found: true,
        },
        { ref_id: "root", node_type: "Concept", name: "Medicine", namespace: "default", found: true, ancestor: true },
        {
          ref_id: "list",
          node_type: "Concept",
          name: "Problem List",
          namespace: "default",
          found: true,
          ancestor: true,
        },
      ],
      edges: [
        { source: "doc-1", target: "find-1", edge_type: "CONTAINS" },
        { source: "root", target: "list", edge_type: "PARENT_OF" },
        { source: "list", target: "rule", edge_type: "PARENT_OF" },
      ],
      nodesRead: true,
      edgesRead: true,
      lineageRead: true,
      truncated: false,
    });
    const lineage = run.mock.calls.map(([query]) => query).find((query) => kind(query) === "lineage") ?? "";
    expect(lineage).toContain("-[:PARENT_OF*1..10]->");
    expect(lineage).toContain("['doc-1','find-1','rule']");
  });

  it("marks no ancestor the run touched, and keeps a lineage edge the edges gave once", async () => {
    const run: CypherRunner = async (query) => {
      switch (kind(query)) {
        case "edges":
          return { columns: ["edge_type", "source", "target"], rows: [["PARENT_OF", "list", "rule"]] };
        case "lineage":
          return {
            columns: ["labels", "name", "namespace", "source", "target"],
            rows: [
              [CONCEPT, "Medicine", "default", "root", "list"],
              [CONCEPT, "Problem List", "default", "list", "rule"],
              [CONCEPT, "Not an id", "default", "'] DETACH DELETE n //", "rule"],
            ],
          };
        default:
          return {
            columns: ["labels", "name", "namespace", "ref_id"],
            rows: [
              [CONCEPT, "Longitudinal Problem List Rules", "default", "rule"],
              [CONCEPT, "Problem List", "default", "list"],
            ],
          };
      }
    };

    const graph = await hydrateRunGraph([{ ref_id: "rule" }, { ref_id: "list" }], run);

    expect(graph.nodes.map((n) => [n.ref_id, n.ancestor ?? false])).toEqual([
      ["rule", false],
      ["list", false],
      ["root", true],
    ]);
    expect(graph.edges).toEqual([
      { source: "list", target: "rule", edge_type: "PARENT_OF" },
      { source: "root", target: "list", edge_type: "PARENT_OF" },
    ]);
  });

  it("never sends a ref id that is not id-shaped", async () => {
    const run = vi.fn<CypherRunner>(async () => ({ columns: [], rows: [] }));

    const graph = await hydrateRunGraph(
      [{ ref_id: "ok-1" }, { ref_id: "'] MATCH (n) DETACH DELETE n //" }, { ref_id: "a b" }],
      run,
    );

    for (const [query] of run.mock.calls) {
      expect(query).toContain("['ok-1']");
      expect(query).not.toContain("DELETE");
    }
    expect(graph.nodes.map((n) => n.ref_id)).toEqual(["ok-1"]);
  });

  it("leaves the nodes as the log named them when the graph cannot answer", async () => {
    const graph = await hydrateRunGraph(
      [{ ref_id: "93f14ce1-7f7f-4da7-a3c2-17c45935b7c2", node_type: "Document" }, { ref_id: "b5726f25" }],
      async () => ({ unread: "400 query too long" }),
    );

    expect(graph).toEqual({
      nodes: [
        {
          ref_id: "93f14ce1-7f7f-4da7-a3c2-17c45935b7c2",
          node_type: "Document",
          name: "93f14ce1",
          namespace: null,
          found: false,
        },
        { ref_id: "b5726f25", node_type: "Node", name: "b5726f25", namespace: null, found: false },
      ],
      edges: [],
      nodesRead: false,
      edgesRead: false,
      lineageRead: false,
      unreadReason: "400 query too long",
      truncated: false,
    });
  });

  it("tells a lineage it could not read from nodes with nothing above them", async () => {
    const refs = [{ ref_id: "a" }];
    const nodesAndEdges = { columns: ["ref_id"], rows: [["a"]] };
    const unread = await hydrateRunGraph(refs, async (query) =>
      kind(query) === "lineage" ? { unread: "no answer in 20 s" } : nodesAndEdges,
    );
    const none = await hydrateRunGraph(refs, async (query) =>
      kind(query) === "lineage" ? { columns: [], rows: [] } : nodesAndEdges,
    );

    expect(unread).toMatchObject({
      nodes: [{ ref_id: "a", found: true }],
      nodesRead: true,
      edgesRead: true,
      lineageRead: false,
      unreadReason: "no answer in 20 s",
    });
    expect(none).toMatchObject({ nodes: [{ ref_id: "a", found: true }], lineageRead: true });
    expect(none).not.toHaveProperty("unreadReason");
  });

  it("says so when the lineage ran into the row cap", async () => {
    const graph = await hydrateRunGraph([{ ref_id: "a" }], async (query) =>
      kind(query) === "lineage"
        ? {
            columns: ["labels", "name", "namespace", "source", "target"],
            rows: Array.from({ length: 1000 }, (_, i) => [CONCEPT, `Concept ${i}`, "default", `c${i}`, "a"]),
          }
        : { columns: ["ref_id"], rows: [["a"]] },
    );
    expect(graph.truncated).toBe(true);
    expect(graph.nodes).toHaveLength(1001);
  });

  it("tells edges it could not read from edges that are not there", async () => {
    const refs = [{ ref_id: "a" }, { ref_id: "b" }];
    const nodesOnly: CypherRunner = async (query) =>
      query.includes("-[r]->") ? { unread: "no answer in 20 s" } : { columns: ["ref_id"], rows: [["a"], ["b"]] };
    const noEdges: CypherRunner = async (query) =>
      query.includes("-[r]->") ? { columns: [], rows: [] } : { columns: ["ref_id"], rows: [["a"], ["b"]] };

    expect(await hydrateRunGraph(refs, nodesOnly)).toMatchObject({
      edges: [],
      nodesRead: true,
      edgesRead: false,
      unreadReason: "no answer in 20 s",
    });
    const read = await hydrateRunGraph(refs, noEdges);
    expect(read).toMatchObject({ edges: [], nodesRead: true, edgesRead: true });
    expect(read).not.toHaveProperty("unreadReason");
  });

  it("tells a node it could not read from a node that is not there", async () => {
    const gone = await hydrateRunGraph([{ ref_id: "a" }], async () => ({ columns: ["ref_id"], rows: [] }));
    const unread = await hydrateRunGraph([{ ref_id: "a" }], async () => ({ unread: "could not be reached" }));

    expect(gone).toMatchObject({ nodes: [{ ref_id: "a", found: false }], nodesRead: true });
    expect(unread).toMatchObject({ nodes: [{ ref_id: "a", found: false }], nodesRead: false });
  });

  it("marks a node the graph no longer holds", async () => {
    const graph = await hydrateRunGraph([{ ref_id: "gone" }], async (query) =>
      query.includes("-[r]->") ? { columns: [], rows: [] } : { columns: ["ref_id"], rows: [] },
    );
    expect(graph.nodes).toEqual([{ ref_id: "gone", node_type: "Node", name: "gone", namespace: null, found: false }]);
  });

  it("resolves no more than the cap and says so", async () => {
    const run = vi.fn<CypherRunner>(async () => ({ columns: [], rows: [] }));
    const refs = Array.from({ length: RUN_GRAPH_MAX_NODES + 5 }, (_, i) => ({ ref_id: `n${i}` }));

    const graph = await hydrateRunGraph(refs, run);

    expect(graph.nodes).toHaveLength(RUN_GRAPH_MAX_NODES);
    expect(graph.truncated).toBe(true);
  });

  it("asks nothing of the graph for a run that touched nothing", async () => {
    const run = vi.fn<CypherRunner>();
    expect(await hydrateRunGraph([], run)).toEqual({
      nodes: [],
      edges: [],
      nodesRead: true,
      edgesRead: true,
      lineageRead: true,
      truncated: false,
    });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("swarmCypherRunner", () => {
  const run = swarmCypherRunner({ name: "swarm38", apiKey: "key" });
  const answer = (body: unknown, init?: ResponseInit) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), init)),
    );

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("asks the swarm's graph and answers its rows", async () => {
    answer({ columns: ["ref_id"], rows: [["a"]] });

    expect(await run("MATCH (n) RETURN n.ref_id AS ref_id", 10)).toEqual({ columns: ["ref_id"], rows: [["a"]] });
    expect(fetch).toHaveBeenCalledWith(
      "https://swarm38.sphinx.chat:7799/api/hive/query",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ language: "cypher", query: "MATCH (n) RETURN n.ref_id AS ref_id", limit: 10 }),
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("says a refusal in the graph's own words, and keeps the database's to the log", async () => {
    answer({ error: "query too long" }, { status: 400 });
    expect(await run("q", 10)).toEqual({ unread: "400 query too long" });

    answer({ error: "query execution failed", details: "Neo.ClientError at bolt://10.0.0.4" }, { status: 500 });
    expect(await run("q", 10)).toEqual({ unread: "500 query execution failed" });
    expect(logger.warn).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ swarm: "swarm38", queryChars: 1, details: "Neo.ClientError at bolt://10.0.0.4" }),
    );
  });

  it("says the status of a refusal that is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("length limit exceeded", { status: 413, statusText: "Payload Too Large" })),
    );
    expect(await run("q", 10)).toEqual({ unread: "413 Payload Too Large" });
  });

  it("tells a graph that took too long from one that could not be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    );
    expect(await run("q", 10)).toEqual({ unread: "no answer in 20 s" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect(await run("q", 10)).toEqual({ unread: "could not be reached" });
  });

  it("does not take an answer that is not rows", async () => {
    answer({ ok: true });
    expect(await run("q", 10)).toEqual({ unread: "an answer that is not rows" });
  });
});

describe("isRunGraphRefId", () => {
  it("takes an id and refuses what is not one", () => {
    expect(isRunGraphRefId("140e5a09-41d3-4692-9dfe-219b00922c2c")).toBe(true);
    expect(isRunGraphRefId("concept_1")).toBe(true);
    expect(isRunGraphRefId("")).toBe(false);
    expect(isRunGraphRefId("a b")).toBe(false);
    expect(isRunGraphRefId("'}) MATCH (n) DETACH DELETE n //")).toBe(false);
  });
});

describe("readRunGraphNode", () => {
  it("reads a node whole, without its vectors", async () => {
    const run = vi.fn<CypherRunner>(async () => ({
      // Upstream orders columns its own way.
      columns: ["props", "labels"],
      rows: [
        [
          [
            ["ref_id", "c-1"],
            ["name", "Problem List"],
            ["docs", "# Problem List\n\nOne line per problem."],
            ["weight", 3],
          ],
          ["Data_Bank", "Concept", "Domain_general"],
        ],
      ],
    }));

    const read = await readRunGraphNode("c-1", run);

    expect(read).toEqual({
      found: true,
      node: {
        ref_id: "c-1",
        node_type: "Concept",
        labels: ["Data_Bank", "Concept", "Domain_general"],
        properties: { ref_id: "c-1", name: "Problem List", docs: "# Problem List\n\nOne line per problem.", weight: 3 },
      },
    });
    const [query, limit] = run.mock.calls[0];
    expect(query).toContain("{ref_id: 'c-1'}");
    // The projection leaves the vectors on the swarm.
    expect(query).toContain("NOT k IN ['embeddings','text_embeddings']");
    expect(limit).toBe(1);
  });

  it("tells a node the graph no longer holds from one it could not answer for", async () => {
    expect(await readRunGraphNode("gone", async () => ({ columns: ["labels", "props"], rows: [] }))).toEqual({
      found: false,
    });
    expect(await readRunGraphNode("c-1", async () => ({ unread: "no answer in 20 s" }))).toEqual({
      found: false,
      unread: "no answer in 20 s",
    });
  });

  it("never sends a ref id that is not id-shaped", async () => {
    const run = vi.fn<CypherRunner>();
    expect(await readRunGraphNode("'}) MATCH (n) DETACH DELETE n //", run)).toEqual({ found: false });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("hydrateRunGraphAcross", () => {
  /** A graph holding `held` (ref id → [name, labels]) and one PARENT_OF edge, `parent` → each held node. */
  const graph = (held: Record<string, string>, parent?: string) =>
    vi.fn<CypherRunner>(async (query) => {
      const asked = [...query.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((id) => id in held);
      switch (kind(query)) {
        case "nodes":
          return {
            columns: ["ref_id", "labels", "name", "namespace"],
            rows: asked.map((id) => [id, CONCEPT, held[id], "default"]),
          };
        case "edges":
          return { columns: ["source", "edge_type", "target"], rows: [] };
        case "lineage":
          return parent
            ? {
                columns: ["source", "target", "labels", "name", "namespace"],
                rows: asked.map((id) => [parent, id, CONCEPT, "Root", "default"]),
              }
            : { columns: ["source", "target", "labels", "name", "namespace"], rows: [] };
      }
    });

  it("reads this graph's nodes here and a peer's from its own graph, under qualified ids", async () => {
    const local = graph({ a: "Job" });
    const cloud = graph({ x: "verifySphinxToken" }, "r");
    const peerGraph = vi.fn(async (slug: string) => (slug === "cloud" ? { run: cloud } : { reason: "no" }));
    const trace = await hydrateRunGraphAcross(
      [
        { ref_id: "a", node_type: "Concept" },
        { ref_id: "@cloud:x", node_type: "Function", peer: "cloud" },
      ],
      local,
      peerGraph,
    );
    expect(peerGraph).toHaveBeenCalledWith("cloud");
    // The peer's graph is asked for its own ref id, never the qualified one.
    expect(cloud.mock.calls.every(([q]) => q.includes("'x'") && !q.includes("@cloud"))).toBe(true);
    expect(local.mock.calls.every(([q]) => !q.includes("'x'"))).toBe(true);
    expect(trace.nodes).toEqual([
      expect.objectContaining({ ref_id: "a", name: "Job", found: true }),
      expect.objectContaining({ ref_id: "@cloud:x", name: "verifySphinxToken", found: true, peer: "cloud" }),
      expect.objectContaining({ ref_id: "@cloud:r", name: "Root", ancestor: true, peer: "cloud" }),
    ]);
    expect(trace.edges).toEqual([{ source: "@cloud:r", target: "@cloud:x", edge_type: "PARENT_OF" }]);
    expect(trace.peers).toEqual([{ slug: "cloud", read: true }]);
  });

  it("keeps a peer's nodes as the log named them when its graph is not read for this viewer", async () => {
    const local = graph({});
    const trace = await hydrateRunGraphAcross(
      [{ ref_id: "@secret:x", node_type: "File", peer: "secret" }],
      local,
      async (slug) => ({ reason: `you are not a member of @${slug}` }),
    );
    expect(trace.nodes).toEqual([
      { ref_id: "@secret:x", node_type: "File", name: "x", namespace: null, found: false, peer: "secret" },
    ]);
    expect(trace.peers).toEqual([{ slug: "secret", read: false, reason: "you are not a member of @secret" }]);
    expect(trace.nodesRead).toBe(true);
  });

  it("is hydrateRunGraph when the run reached no peer", async () => {
    const local = graph({ a: "Job" });
    const trace = await hydrateRunGraphAcross([{ ref_id: "a" }], local, async () => ({ reason: "unused" }));
    expect(trace.peers).toBeUndefined();
    expect(trace.nodes).toEqual([expect.objectContaining({ ref_id: "a", found: true })]);
  });
});
