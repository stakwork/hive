import type { Graph, GraphEdge } from "./types";

/** Virtual center ID used when there are multiple root nodes. */
export const VIRTUAL_CENTER = -1;

/** Returns the best single root for initial layout (highest undirected degree). */
export function findBestRoot(graph: Graph): number {
  return graph.nodes.reduce((best, node) =>
    node.degree > graph.nodes[best].degree ? node.id : best, 0);
}

/**
 * Build the initial subgraph for layout.
 * - If multiple source nodes (zero in-degree) exist, they all go on ring 1
 *   around a virtual center (VIRTUAL_CENTER = -1).
 * - If one source node exists, it becomes the center.
 * - If no source nodes exist, falls back to highest-degree node with undirected BFS.
 */
export function extractInitialSubgraph(graph: Graph, maxDepth = 30): Subgraph {
  const inAdjForRoots = graph.structuralInAdj ?? graph.inAdj;
  const bfsAdj = graph.structuralAdj ?? graph.adj;
  const unstructured = graph.unstructuredNodeIds;

  const roots = graph.nodes
    .filter((_, i) => inAdjForRoots[i].length === 0 && (!unstructured || !unstructured.has(i)))
    .map((n) => n.id);

  // Single root or no roots — use existing logic
  if (roots.length <= 1) {
    const center = roots.length === 1 ? roots[0] : findBestRoot(graph);
    return extractSubgraph(graph, center, maxDepth, { useAdj: "structural" });
  }

  // Multiple roots: virtual center, all roots on first ring
  const depthMap = new Map<number, number>();
  depthMap.set(VIRTUAL_CENTER, 0);

  const neighborsByDepth: number[][] = [];

  const queue: number[] = [];
  for (const r of roots) {
    depthMap.set(r, 1);
    if (!neighborsByDepth[0]) neighborsByDepth.push([]);
    neighborsByDepth[0].push(r);
    queue.push(r);
  }

  // BFS from all roots via structural adjacency
  let qi = 0;
  while (qi < queue.length) {
    const node = queue[qi++];
    const d = depthMap.get(node)!;
    if (d >= maxDepth) continue;

    for (const child of bfsAdj[node]) {
      if (!depthMap.has(child) && (!unstructured || !unstructured.has(child))) {
        depthMap.set(child, d + 1);
        while (neighborsByDepth.length <= d) neighborsByDepth.push([]);
        neighborsByDepth[d].push(child);
        queue.push(child);
      }
    }
  }

  const nodeIds = neighborsByDepth.flat();
  const nodeSet = new Set(nodeIds);
  const edges = graph.edges.filter(
    (e) => nodeSet.has(e.src) && nodeSet.has(e.dst)
  );

  return { centerId: VIRTUAL_CENTER, depthMap, neighborsByDepth, nodeIds, edges };
}

export interface Subgraph {
  centerId: number;
  parentId?: number;                               // parent node (via inAdj)
  depthMap: Map<number, number>;                   // nodeId → depth
  neighborsByDepth: number[][];                    // [hop1, hop2, ..., hopN]
  nodeIds: number[];
  edges: GraphEdge[];
}

/**
 * Extract the directed subgraph around a center node.
 * - BFS through outAdj (children only) up to maxDepth
 * - Identifies parent via inAdj[centerId]
 * - Parent is included in nodeIds but NOT in neighborsByDepth
 */
export function extractSubgraph(
  graph: Graph, centerId: number, maxDepth = 30,
  opts?: { useAdj?: "directed" | "undirected" | "structural" }
): Subgraph {
  const adjList = opts?.useAdj === "structural"
    ? (graph.structuralAdj ?? graph.adj)
    : opts?.useAdj === "undirected" ? graph.adj : graph.outAdj;
  const unstructured = opts?.useAdj === "structural" ? graph.unstructuredNodeIds : undefined;
  const depthMap = new Map<number, number>();
  depthMap.set(centerId, 0);

  const neighborsByDepth: number[][] = [];

  const queue: number[] = [centerId];

  // BFS through outAdj (children only — directed)
  let qi = 0;
  while (qi < queue.length) {
    const node = queue[qi++];
    const d = depthMap.get(node)!;
    if (d >= maxDepth) continue;

    for (const child of adjList[node]) {
      if (!depthMap.has(child) && (!unstructured || !unstructured.has(child))) {
        depthMap.set(child, d + 1);
        while (neighborsByDepth.length <= d) neighborsByDepth.push([]);
        neighborsByDepth[d].push(child);
        queue.push(child);
      }
    }
  }

  // Identify parent (first neighbor not in the subgraph, or at lower depth)
  let parentId: number | undefined;
  for (const p of graph.adj[centerId]) {
    if (!depthMap.has(p)) {
      parentId = p;
      break;
    }
  }

  const nodeIds = [centerId, ...neighborsByDepth.flat()];
  if (parentId !== undefined) {
    depthMap.set(parentId, -1); // special depth for parent
    nodeIds.push(parentId);
  }

  const nodeSet = new Set(nodeIds);

  const edges = graph.edges.filter(
    (e) => nodeSet.has(e.src) && nodeSet.has(e.dst)
  );

  return { centerId, parentId, depthMap, neighborsByDepth, nodeIds, edges };
}
