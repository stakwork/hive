import type { RawEdge, RawNode } from "@/graph-viz-kit";

/** Returns true if `val` is a Neo4j/stakgraph node-like object (has an `id` field). */
function isNodeLike(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && "id" in (val as object);
}

/**
 * Convert stakgraph ArcadeDB/Neo4j query result columns+rows into the
 * `RawNode[]` / `RawEdge[]` shapes expected by `buildGraph()` from graph-viz-kit.
 *
 * Row interpretation:
 *  - 1 node-like object  → register node only (no edge)
 *  - 2+ node-like objects → first = source, last = target; middle objects are
 *    treated as relationship objects and produce one edge each; if no middle
 *    objects, a single generic edge is created between source and target.
 */
export function stakgraphToRawGraph(
  _columns: string[],
  rows: unknown[][]
): { nodes: RawNode[]; edges: RawEdge[] } {
  const nodeMap = new Map<string, RawNode>();
  const edges: RawEdge[] = [];

  const registerNode = (obj: Record<string, unknown>): string => {
    const id = String(obj.id);
    if (!nodeMap.has(id)) {
      nodeMap.set(id, {
        id,
        label: String(obj.name ?? obj.type ?? id),
        ...(obj.link != null && { link: String(obj.link) }),
        ...(obj.icon != null && { icon: String(obj.icon) }),
      });
    }
    return id;
  };

  for (const row of rows) {
    const nodeLikes = (row as unknown[]).filter(isNodeLike);

    if (nodeLikes.length === 0) continue;

    if (nodeLikes.length === 1) {
      registerNode(nodeLikes[0] as Record<string, unknown>);
      continue;
    }

    const src = nodeLikes[0] as Record<string, unknown>;
    const tgt = nodeLikes[nodeLikes.length - 1] as Record<string, unknown>;
    const srcId = registerNode(src);
    const tgtId = registerNode(tgt);

    const relationshipObjs = nodeLikes.slice(1, -1) as Record<string, unknown>[];

    if (relationshipObjs.length > 0) {
      for (const rel of relationshipObjs) {
        edges.push({
          source: srcId,
          target: tgtId,
          label: rel.type != null ? String(rel.type) : undefined,
        });
      }
    } else {
      // Two node-like objects with no relationship in between
      edges.push({ source: srcId, target: tgtId });
    }
  }

  return { nodes: Array.from(nodeMap.values()), edges };
}
