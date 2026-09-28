/**
 * Unit tests for `lib/strut-run-graph/hydrate.ts`: resolving the nodes a run
 * touched against the graph.
 *
 * Coverage:
 *   - a node's type is the label left once the structural ones are set aside;
 *   - nodes and the edges among them come back from two queries;
 *   - a ref id that is not id-shaped never reaches a query;
 *   - a graph that cannot answer leaves the nodes as the log named them,
 *     and says what it did not read.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/constants", () => ({ getSwarmVanityAddress: (name: string) => `${name}.sphinx.chat` }));
vi.mock("@/lib/utils/stakgraph-url", () => ({ getStakgraphUrl: (host: string) => `https://${host}:7799` }));

import { hydrateRunGraph, RUN_GRAPH_MAX_NODES, typeFromLabels, type CypherRunner } from "@/lib/strut-run-graph/hydrate";

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

describe("hydrateRunGraph", () => {
  it("resolves nodes and the edges among them", async () => {
    const run = vi.fn<CypherRunner>(async (query) =>
      query.includes("-[r]->")
        ? { columns: ["edge_type", "source", "target"], rows: [["CONTAINS", "doc-1", "find-1"]] }
        : {
            // Upstream orders columns its own way.
            columns: ["labels", "name", "namespace", "ref_id"],
            rows: [
              [["Data_Bank", "Document", "Node", "Domain_content"], "enc-0-hpi.md", "oh-7532", "doc-1"],
              [["Data_Bank", "Node", "Domain_entity", "ClinicalFinding"], "  Lethargic on arrival  ", "oh-7532", "find-1"],
            ],
          },
    );

    const graph = await hydrateRunGraph([{ ref_id: "doc-1", node_type: "Document" }, { ref_id: "find-1" }], run);

    expect(run).toHaveBeenCalledTimes(2);
    expect(graph).toEqual({
      nodes: [
        { ref_id: "doc-1", node_type: "Document", name: "enc-0-hpi.md", namespace: "oh-7532", found: true },
        { ref_id: "find-1", node_type: "ClinicalFinding", name: "Lethargic on arrival", namespace: "oh-7532", found: true },
      ],
      edges: [{ source: "doc-1", target: "find-1", edge_type: "CONTAINS" }],
      nodesRead: true,
      edgesRead: true,
      truncated: false,
    });
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
      async () => null,
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
      truncated: false,
    });
  });

  it("tells edges it could not read from edges that are not there", async () => {
    const refs = [{ ref_id: "a" }, { ref_id: "b" }];
    const nodesOnly: CypherRunner = async (query) =>
      query.includes("-[r]->") ? null : { columns: ["ref_id"], rows: [["a"], ["b"]] };
    const noEdges: CypherRunner = async (query) =>
      query.includes("-[r]->") ? { columns: [], rows: [] } : { columns: ["ref_id"], rows: [["a"], ["b"]] };

    expect(await hydrateRunGraph(refs, nodesOnly)).toMatchObject({ edges: [], nodesRead: true, edgesRead: false });
    expect(await hydrateRunGraph(refs, noEdges)).toMatchObject({ edges: [], nodesRead: true, edgesRead: true });
  });

  it("tells a node it could not read from a node that is not there", async () => {
    const gone = await hydrateRunGraph([{ ref_id: "a" }], async () => ({ columns: ["ref_id"], rows: [] }));
    const unread = await hydrateRunGraph([{ ref_id: "a" }], async () => null);

    expect(gone).toMatchObject({ nodes: [{ ref_id: "a", found: false }], nodesRead: true });
    expect(unread).toMatchObject({ nodes: [{ ref_id: "a", found: false }], nodesRead: false });
  });

  it("marks a node the graph no longer holds", async () => {
    const graph = await hydrateRunGraph([{ ref_id: "gone" }], async (query) =>
      query.includes("-[r]->") ? { columns: [], rows: [] } : { columns: ["ref_id"], rows: [] },
    );
    expect(graph.nodes).toEqual([
      { ref_id: "gone", node_type: "Node", name: "gone", namespace: null, found: false },
    ]);
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
      truncated: false,
    });
    expect(run).not.toHaveBeenCalled();
  });
});
