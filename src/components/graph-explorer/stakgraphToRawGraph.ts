import type { RawEdge, RawNode } from "@/graph-viz-kit";

/**
 * Returns true if `val` is a stakgraph node-like object.
 * Real stakgraph Cypher results use `ref_id`; legacy/mock data may use `id`.
 */
function isNodeLike(val: unknown): val is Record<string, unknown> {
  return (
    typeof val === "object" &&
    val !== null &&
    ("ref_id" in (val as object) || "id" in (val as object))
  );
}

/**
 * Convert stakgraph ArcadeDB/Neo4j query result columns+rows into the
 * `RawNode[]` / `RawEdge[]` shapes expected by `buildGraph()` from graph-viz-kit.
 *
 * Row interpretation:
 *  - 1 node-like object  → register node only (no edge)
 *  - 2+ node-like objects → emit one edge per consecutive node pair; relationship
 *    objects (non-node-like objects between each pair in the raw row) supply the
 *    edge label via their `type` field.
 */
export function stakgraphToRawGraph(
  _columns: string[],
  rows: unknown[][]
): { nodes: RawNode[]; edges: RawEdge[] } {
  const nodeMap = new Map<string, RawNode>();
  const edges: RawEdge[] = [];

  const registerNode = (obj: Record<string, unknown>): string => {
    const id = String(obj.ref_id ?? obj.id ?? "");
    if (!id) return "";
    if (!nodeMap.has(id)) {
      nodeMap.set(id, {
        id,
        label: String(obj.name ?? obj.node_type ?? obj.type ?? id),
        ...(obj.link != null && { link: String(obj.link) }),
        ...(obj.icon != null && { icon: String(obj.icon) }),
      });
    }
    return id;
  };

  for (const row of rows) {
    // Collect node-like entries with their raw-row positions
    const nodeEntries: Array<{ obj: Record<string, unknown>; rawIdx: number }> = [];
    row.forEach((val, rawIdx) => {
      if (isNodeLike(val)) nodeEntries.push({ obj: val as Record<string, unknown>, rawIdx });
    });

    if (nodeEntries.length === 0) continue;

    if (nodeEntries.length === 1) {
      registerNode(nodeEntries[0].obj);
      continue;
    }

    // Create one edge per consecutive node pair
    for (let i = 0; i < nodeEntries.length - 1; i++) {
      const srcId = registerNode(nodeEntries[i].obj);
      const tgtId = registerNode(nodeEntries[i + 1].obj);
      if (!srcId || !tgtId) continue; // guard: skip dangling edges when id is absent

      const startIdx = nodeEntries[i].rawIdx;
      const endIdx = nodeEntries[i + 1].rawIdx;
      // Relationship objects are non-node-like elements between this node pair in the raw row
      const relObjs = (row.slice(startIdx + 1, endIdx) as unknown[]).filter(
        (v): v is Record<string, unknown> =>
          !isNodeLike(v) && typeof v === "object" && v !== null
      );
      const relObj = relObjs[0];

      edges.push({
        source: srcId,
        target: tgtId,
        ...(relObj?.type != null ? { label: String(relObj.type) } : {}),
      });
    }
  }

  return { nodes: Array.from(nodeMap.values()), edges };
}
