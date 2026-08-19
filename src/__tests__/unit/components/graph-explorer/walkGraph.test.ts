/**
 * Unit tests for the graph-walk builders.
 *
 * These are the pieces that decide what the canvas holds as a walk grows, and
 * they're index-sensitive: `buildGraph` keys nodes by array position, so any
 * reordering silently corrupts every edge and layout position downstream.
 */

import { describe, expect, test } from "vitest";
import { detailToRawGraph, mergeRawGraph } from "@/components/graph-explorer/walkGraph";
import type { GraphNodeDetailResponse } from "@/types/graph-node";

function detail(
  refId: string,
  name: string,
  neighbors: GraphNodeDetailResponse["neighbors"],
): GraphNodeDetailResponse {
  return {
    node: { ref_id: refId, node_type: "Concept", name, properties: {} },
    neighbors,
  };
}

describe("detailToRawGraph", () => {
  test("puts the queried node first so it wins the layout root", () => {
    const { nodes } = detailToRawGraph(
      detail("a", "Node A", [
        { ref_id: "b", node_type: "File", name: "b.ts", edge_type: "DESCRIBES", direction: "forward" },
      ]),
    );

    expect(nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  test("orients edges by direction relative to the queried node", () => {
    const { edges } = detailToRawGraph(
      detail("a", "Node A", [
        { ref_id: "b", node_type: "File", name: "b.ts", edge_type: "DESCRIBES", direction: "forward" },
        { ref_id: "c", node_type: "File", name: "c.ts", edge_type: "CONTAINS", direction: "reverse" },
      ]),
    );

    expect(edges).toEqual([
      { source: "a", target: "b", label: "DESCRIBES" },
      { source: "c", target: "a", label: "CONTAINS" },
    ]);
  });

  test("keeps one node but both edges when a neighbor appears twice", () => {
    const { nodes, edges } = detailToRawGraph(
      detail("a", "Node A", [
        { ref_id: "b", node_type: "File", name: "b.ts", edge_type: "DESCRIBES", direction: "forward" },
        { ref_id: "b", node_type: "File", name: "b.ts", edge_type: "IMPORTS", direction: "forward" },
      ]),
    );

    expect(nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(edges).toHaveLength(2);
  });

  test("falls back to the ref_id when a node has no name", () => {
    const { nodes } = detailToRawGraph(detail("a", "", []));
    expect(nodes[0].label).toBe("a");
  });
});

describe("mergeRawGraph", () => {
  const prev = {
    nodes: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
    edges: [{ source: "a", target: "b", label: "DESCRIBES" }],
  };

  test("appends new nodes without disturbing existing indices", () => {
    const merged = mergeRawGraph(prev, {
      nodes: [
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      edges: [{ source: "b", target: "c", label: "CALLS" }],
    });

    // "a" and "b" must keep positions 0 and 1 — buildGraph indexes by position.
    expect(merged.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(merged.edges).toEqual([
      { source: "a", target: "b", label: "DESCRIBES" },
      { source: "b", target: "c", label: "CALLS" },
    ]);
  });

  test("does not duplicate an edge already present", () => {
    const merged = mergeRawGraph(prev, {
      nodes: [{ id: "a", label: "A" }],
      edges: [{ source: "a", target: "b", label: "DESCRIBES" }],
    });

    expect(merged.nodes).toHaveLength(2);
    expect(merged.edges).toHaveLength(1);
  });

  test("keeps parallel edges that differ only by type", () => {
    const merged = mergeRawGraph(prev, {
      nodes: [],
      edges: [{ source: "a", target: "b", label: "IMPORTS" }],
    });

    expect(merged.edges).toHaveLength(2);
  });

  test("re-expanding a node the walk already holds is a no-op", () => {
    const merged = mergeRawGraph(prev, prev);

    expect(merged.nodes).toEqual(prev.nodes);
    expect(merged.edges).toEqual(prev.edges);
  });

  test("keeps the existing node when the same id arrives again", () => {
    const merged = mergeRawGraph(prev, {
      nodes: [{ id: "a", label: "Renamed A" }],
      edges: [],
    });

    expect(merged.nodes[0].label).toBe("A");
  });
});
