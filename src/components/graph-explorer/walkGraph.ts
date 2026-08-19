import type { RawEdge, RawNode } from "@/graph-viz-kit";
import type { GraphNodeDetailResponse } from "@/types/graph-node";

export interface RawGraph {
  nodes: RawNode[];
  edges: RawEdge[];
}

/**
 * Turn a node-detail response into the star graph the 3D canvas renders: the
 * queried node first (so it lands at index 0 and wins `findBestRoot`), then one
 * node + edge per directly-linked neighbor.
 */
export function detailToRawGraph(detail: GraphNodeDetailResponse): RawGraph {
  const seen = new Set<string>([detail.node.ref_id]);
  const nodes: RawNode[] = [
    { id: detail.node.ref_id, label: detail.node.name || detail.node.ref_id },
  ];
  const edges: RawEdge[] = [];

  for (const n of detail.neighbors) {
    if (!seen.has(n.ref_id)) {
      seen.add(n.ref_id);
      nodes.push({ id: n.ref_id, label: n.name || n.ref_id });
    }
    // `direction` is relative to the queried node: forward = it's the source.
    edges.push(
      n.direction === "forward"
        ? { source: detail.node.ref_id, target: n.ref_id, label: n.edge_type }
        : { source: n.ref_id, target: detail.node.ref_id, label: n.edge_type },
    );
  }

  return { nodes, edges };
}

/**
 * Merge a freshly-expanded star into the accumulated walk, preserving the
 * existing node order — `buildGraph` indexes by array position, so reordering
 * would invalidate every index the canvas and the layout are holding.
 */
export function mergeRawGraph(prev: RawGraph, next: RawGraph): RawGraph {
  const byId = new Map(prev.nodes.map((n) => [n.id, n]));
  for (const n of next.nodes) {
    if (!byId.has(n.id)) byId.set(n.id, n);
  }

  const edgeKey = (e: RawEdge) => `${e.source}→${e.target}→${e.label ?? ""}`;
  const seen = new Set(prev.edges.map(edgeKey));
  const edges = [...prev.edges];
  for (const e of next.edges) {
    const key = edgeKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(e);
  }

  return { nodes: [...byId.values()], edges };
}

