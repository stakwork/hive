/**
 * Build a recursive entity tree from a flat Graph.
 *
 * Pipeline:
 * 1. Find structural roots (zero structural in-degree)
 * 2. BFS through structural edges → parent/children relationships
 * 3. Group unstructured nodes by their primary anchor (structural neighbor)
 * 4. Create proxy nodes in the graph for each cluster, as children of their anchor
 * 5. Recursively build entities — proxy nodes become cluster entities
 * 6. Wrap everything in a root entity
 *
 * Key invariant: a cluster is always a child of the structural node it connects to.
 * If unstructured nodes have no structural neighbor, they become top-level children.
 */

import type { Graph, GraphNode, GraphEdge, Vec3 } from "./types";
import { isStructuralEdge } from "./types";
import type {
  GraphEntity,
  EntityContent,
  ContentEdge,
  ContentStats,
  LayoutMode,
  Shell,
  EdgeKind,
} from "./entity";

// ── Graph mutation helper ──

/** Add a structural edge between two nodes, updating all adjacency arrays. */
function addStructuralEdge(graph: Graph, src: number, dst: number): void {
  const edge: GraphEdge = { src, dst };
  graph.edges.push(edge);
  graph.adj[src].push(dst);
  graph.adj[dst].push(src);
  graph.outAdj[src].push(dst);
  graph.inAdj[dst].push(src);
  if (graph.structuralAdj) {
    graph.structuralAdj[src].push(dst);
    graph.structuralAdj[dst].push(src);
  }
  if (graph.structuralOutAdj) graph.structuralOutAdj[src].push(dst);
  if (graph.structuralInAdj) graph.structuralInAdj[dst].push(src);
}

// ── Cluster info stored per proxy node ──

interface ClusterInfo {
  proxyNodeIndex: number;
  memberIds: number[];
  anchorNodeIndex: number | null;
  clusterIndex: number;
}

// ── Strip old proxy nodes before rebuilding ──

/**
 * Remove proxy nodes previously added by buildEntityTree.
 * Call this before re-running buildEntityTree on a mutated graph
 * to prevent orphaned proxy nodes from accumulating.
 *
 * @param graph The graph to clean
 * @param realNodeCount Number of "real" nodes (from buildGraph + appendToGraph).
 *   Everything at index >= realNodeCount is considered a proxy and removed.
 */
export function stripProxyNodes(graph: Graph, realNodeCount: number): void {
  if (graph.nodes.length <= realNodeCount) return;

  graph.nodes.length = realNodeCount;
  graph.adj.length = realNodeCount;
  graph.outAdj.length = realNodeCount;
  graph.inAdj.length = realNodeCount;
  if (graph.structuralAdj) graph.structuralAdj.length = realNodeCount;
  if (graph.structuralOutAdj) graph.structuralOutAdj.length = realNodeCount;
  if (graph.structuralInAdj) graph.structuralInAdj.length = realNodeCount;

  // Remove edges referencing pruned nodes
  graph.edges = graph.edges.filter(e => e.src < realNodeCount && e.dst < realNodeCount);

  // Clean adjacency lists of references to pruned nodes
  for (let i = 0; i < realNodeCount; i++) {
    graph.adj[i] = graph.adj[i].filter(n => n < realNodeCount);
    graph.outAdj[i] = graph.outAdj[i].filter(n => n < realNodeCount);
    graph.inAdj[i] = graph.inAdj[i].filter(n => n < realNodeCount);
    if (graph.structuralAdj) graph.structuralAdj[i] = graph.structuralAdj[i].filter(n => n < realNodeCount);
    if (graph.structuralOutAdj) graph.structuralOutAdj[i] = graph.structuralOutAdj[i].filter(n => n < realNodeCount);
    if (graph.structuralInAdj) graph.structuralInAdj[i] = graph.structuralInAdj[i].filter(n => n < realNodeCount);
  }
}

// ── Main entry point ──

export function buildEntityTree(graph: Graph): GraphEntity {
  const n = graph.nodes.length;
  if (n === 0) {
    return makeRootEntity([]);
  }

  const unstructured = graph.unstructuredNodeIds ?? new Set<number>();
  const structOutAdj = graph.structuralOutAdj ?? graph.outAdj;
  const structAdj = graph.structuralAdj ?? graph.adj;
  const structInAdj = graph.structuralInAdj ?? graph.inAdj;

  // ── Step 1: Find structural roots ──
  const roots: number[] = [];
  for (let i = 0; i < n; i++) {
    if (unstructured.has(i)) continue;
    if (structInAdj[i].length === 0 && structAdj[i].length > 0) {
      roots.push(i);
    }
  }

  // Fallback: highest-degree structural node
  if (roots.length === 0) {
    let bestDeg = -1;
    let bestNode = -1;
    for (let i = 0; i < n; i++) {
      if (unstructured.has(i)) continue;
      if (structAdj[i].length > bestDeg) {
        bestDeg = structAdj[i].length;
        bestNode = i;
      }
    }
    if (bestNode >= 0) roots.push(bestNode);
  }

  // ── Step 2: BFS structural tree ──
  const visited = new Set<number>();
  const childrenOf = new Map<number, number[]>();
  const queue: number[] = [];

  for (const r of roots) {
    if (visited.has(r)) continue;
    visited.add(r);
    queue.push(r);
    childrenOf.set(r, []);
  }

  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    for (const nb of structOutAdj[cur]) {
      if (!visited.has(nb) && !unstructured.has(nb)) {
        visited.add(nb);
        if (!childrenOf.has(cur)) childrenOf.set(cur, []);
        childrenOf.get(cur)!.push(nb);
        childrenOf.set(nb, []);
        queue.push(nb);
      }
    }
    for (const nb of structAdj[cur]) {
      if (!visited.has(nb) && !unstructured.has(nb)) {
        visited.add(nb);
        if (!childrenOf.has(cur)) childrenOf.set(cur, []);
        childrenOf.get(cur)!.push(nb);
        childrenOf.set(nb, []);
        queue.push(nb);
      }
    }
  }

  // ── Step 3: Group unstructured nodes by primary anchor ──
  //
  // For each unstructured node, find the structural node it connects to most.
  // Group all unstructured nodes that share the same anchor.
  // Nodes with no structural neighbor go into an "orphan" bucket.

  const anchorGroups = groupByAnchor(graph, unstructured);

  // ── Step 4: Create proxy nodes for each cluster, insert into structural tree ──
  const proxyMap = new Map<number, ClusterInfo>(); // proxyNodeIndex → cluster info

  for (let ci = 0; ci < anchorGroups.length; ci++) {
    const group = anchorGroups[ci];
    const proxyNodeIndex = graph.nodes.length;

    // Create proxy node in the graph
    const proxyNode: GraphNode = {
      id: proxyNodeIndex,
      label: `${group.memberIds.length} items`,
      position: { x: 0, y: 0, z: 0 },
      degree: 1,
    };
    graph.nodes.push(proxyNode);

    // Extend all adjacency arrays
    graph.adj.push([]);
    graph.outAdj.push([]);
    graph.inAdj.push([]);
    if (graph.structuralAdj) graph.structuralAdj.push([]);
    if (graph.structuralOutAdj) graph.structuralOutAdj.push([]);
    if (graph.structuralInAdj) graph.structuralInAdj.push([]);

    // Connect proxy into the structural tree (anchored clusters only)
    const anchor = group.anchorNodeIndex;
    if (anchor !== null) {
      addStructuralEdge(graph, anchor, proxyNodeIndex);
      if (!childrenOf.has(anchor)) childrenOf.set(anchor, []);
      childrenOf.get(anchor)!.push(proxyNodeIndex);
    }
    // Orphan clusters (anchor === null) stay disconnected — they are
    // independent subgraphs, positioned separately by layoutEntity

    childrenOf.set(proxyNodeIndex, []);

    proxyMap.set(proxyNodeIndex, {
      proxyNodeIndex,
      memberIds: group.memberIds,
      anchorNodeIndex: anchor,
      clusterIndex: ci,
    });
  }

  // ── Step 5: Build entity tree — proxy nodes become cluster entities ──
  const topEntities: GraphEntity[] = [];

  for (const r of roots) {
    topEntities.push(
      buildEntity(r, 1, graph, childrenOf, proxyMap)
    );
  }

  // Orphan clusters (no anchor) become top-level entities
  for (const [proxyIdx, info] of proxyMap) {
    if (info.anchorNodeIndex === null) {
      topEntities.push(
        buildClusterEntity(proxyIdx, info, 1, graph)
      );
    }
  }

  // ── Step 6: Root entity ──
  return makeRootEntity(topEntities);
}

// ── Entity builder (handles both structural nodes and proxy/cluster nodes) ──

function buildEntity(
  nodeIndex: number,
  depth: number,
  graph: Graph,
  childrenOf: Map<number, number[]>,
  proxyMap: Map<number, ClusterInfo>,
): GraphEntity {
  // If this node is a proxy, build a cluster entity instead
  const clusterInfo = proxyMap.get(nodeIndex);
  if (clusterInfo) {
    return buildClusterEntity(nodeIndex, clusterInfo, depth, graph);
  }

  // Structural entity
  const node = graph.nodes[nodeIndex];
  const kids = childrenOf.get(nodeIndex) ?? [];

  const shell: Shell = {
    position: { x: 0, y: 0, z: 0 },
    scale: 1,
    label: node.label,
    icon: node.icon,
    nodeIndex,
  };

  // Leaf entity (no children at all)
  if (kids.length === 0) {
    return {
      id: `node-${nodeIndex}`,
      shell,
      viewMode: "collapsed",
      depth,
      memberNodeIndices: [nodeIndex],
    };
  }

  // Build child entities recursively
  const childEntities = kids.map((k) =>
    buildEntity(k, depth + 1, graph, childrenOf, proxyMap)
  );

  // Collect all member node indices (structural + cluster members)
  const memberIndices = collectAllMembers(nodeIndex, childrenOf, proxyMap);

  // Compute local edge stats among direct structural members only
  const structuralMembers = collectSubtreeMembers(nodeIndex, childrenOf, proxyMap);
  const memberSet = new Set(structuralMembers);
  const localEdges: { edge: GraphEdge; index: number }[] = [];
  for (let ei = 0; ei < graph.edges.length; ei++) {
    const e = graph.edges[ei];
    if (memberSet.has(e.src) && memberSet.has(e.dst)) {
      localEdges.push({ edge: e, index: ei });
    }
  }

  const structCount = localEdges.filter((e) => isStructuralEdge(e.edge)).length;
  const structRatio = localEdges.length > 0 ? structCount / localEdges.length : 1;

  const contentEdges = buildContentEdges(childEntities, graph);

  const layoutMode = chooseLayoutMode(
    structRatio,
    childEntities.length,
    contentEdges.length,
    computeMaxDepth(childEntities),
  );

  const stats: ContentStats = {
    entityCount: childEntities.length,
    edgeCount: contentEdges.length,
    structuralEdgeCount: structCount,
    associativeEdgeCount: localEdges.length - structCount,
    maxDepth: computeMaxDepth(childEntities),
    density: computeDensity(childEntities.length, contentEdges.length),
  };

  const content: EntityContent = {
    children: childEntities,
    edges: contentEdges,
    layoutMode,
    structuralRatio: structRatio,
    stats,
  };

  shell.badge = memberIndices.length;

  return {
    id: `node-${nodeIndex}`,
    shell,
    viewMode: depth <= 1 ? "expanded" : "collapsed",
    content,
    depth,
    memberNodeIndices: memberIndices,
  };
}

// ── Cluster entity builder ──

function buildClusterEntity(
  proxyNodeIndex: number,
  info: ClusterInfo,
  depth: number,
  graph: Graph,
): GraphEntity {
  const { memberIds, anchorNodeIndex, clusterIndex } = info;

  // Each member is a leaf child entity
  const childEntities: GraphEntity[] = memberIds.map((idx) => {
    const node = graph.nodes[idx];
    return {
      id: `node-${idx}`,
      shell: {
        position: { x: 0, y: 0, z: 0 } as Vec3,
        scale: 1,
        label: node.label,
        icon: node.icon,
        nodeIndex: idx,
      },
      viewMode: "collapsed" as const,
      depth: depth + 1,
      memberNodeIndices: [idx],
    };
  });

  // Internal edges between members
  const memberSet = new Set(memberIds);
  const contentEdges: ContentEdge[] = [];
  for (let ei = 0; ei < graph.edges.length; ei++) {
    const e = graph.edges[ei];
    if (memberSet.has(e.src) && memberSet.has(e.dst)) {
      contentEdges.push({
        sourceId: `node-${e.src}`,
        targetId: `node-${e.dst}`,
        kind: isStructuralEdge(e) ? "structural" : "associative",
        label: e.label,
        type: e.type,
        graphEdgeIndices: [ei],
      });
    }
  }

  const stats: ContentStats = {
    entityCount: childEntities.length,
    edgeCount: contentEdges.length,
    structuralEdgeCount: contentEdges.filter((e) => e.kind === "structural").length,
    associativeEdgeCount: contentEdges.filter((e) => e.kind === "associative").length,
    maxDepth: 0,
    density: computeDensity(childEntities.length, contentEdges.length),
  };

  return {
    id: `cluster-${clusterIndex}`,
    shell: {
      position: { x: 0, y: 0, z: 0 },
      scale: 1.2,
      label: `${memberIds.length} items`,
      badge: memberIds.length,
      nodeIndex: proxyNodeIndex,
    },
    viewMode: "collapsed",
    content: {
      children: childEntities,
      edges: contentEdges,
      layoutMode: "force",
      structuralRatio: 0,
      stats,
    },
    depth,
    memberNodeIndices: memberIds,
    anchorNodeIndex: anchorNodeIndex ?? undefined,
  };
}

// ── Root entity wrapper ──

function makeRootEntity(children: GraphEntity[]): GraphEntity {
  const allMembers: number[] = [];
  for (const child of children) {
    allMembers.push(...child.memberNodeIndices);
  }

  const stats: ContentStats = {
    entityCount: children.length,
    edgeCount: 0,
    structuralEdgeCount: 0,
    associativeEdgeCount: 0,
    maxDepth: children.length > 0 ? 1 + Math.max(...children.map(computeMaxDepth)) : 0,
    density: 0,
  };

  return {
    id: "root",
    shell: { position: { x: 0, y: 0, z: 0 }, scale: 1, label: "Root" },
    viewMode: "expanded",
    content: {
      children,
      edges: [],
      layoutMode: "radial",
      structuralRatio: 1,
      stats,
    },
    depth: 0,
    memberNodeIndices: allMembers,
  };
}

// ── Group unstructured nodes by primary anchor ──

interface AnchorGroup {
  anchorNodeIndex: number | null;
  memberIds: number[];
}

function groupByAnchor(
  graph: Graph,
  unstructured: Set<number>,
): AnchorGroup[] {
  if (unstructured.size === 0) return [];

  // For each unstructured node, find its primary anchor
  const nodeAnchor = new Map<number, number | null>();

  for (const uid of unstructured) {
    const counts = new Map<number, number>();
    for (const nb of graph.adj[uid]) {
      if (!unstructured.has(nb)) {
        counts.set(nb, (counts.get(nb) ?? 0) + 1);
      }
    }
    let best: number | null = null;
    let bestCount = 0;
    for (const [anchor, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        best = anchor;
      }
    }
    nodeAnchor.set(uid, best);
  }

  // Group by anchor
  const groups = new Map<number | null, number[]>(); // anchor (or null) → member ids
  for (const [uid, anchor] of nodeAnchor) {
    if (!groups.has(anchor)) groups.set(anchor, []);
    groups.get(anchor)!.push(uid);
  }

  // Convert to array, anchored groups first
  const result: AnchorGroup[] = [];
  for (const [anchor, members] of groups) {
    if (anchor !== null) {
      result.push({ anchorNodeIndex: anchor, memberIds: members });
    }
  }

  // Orphans: split by connected component so independent clusters stay separate
  const orphans = groups.get(null);
  if (orphans && orphans.length > 0) {
    const orphanSet = new Set(orphans);
    const visited = new Set<number>();
    for (const uid of orphans) {
      if (visited.has(uid)) continue;
      const component: number[] = [];
      const stack = [uid];
      visited.add(uid);
      while (stack.length > 0) {
        const cur = stack.pop()!;
        component.push(cur);
        for (const nb of graph.adj[cur]) {
          if (orphanSet.has(nb) && !visited.has(nb)) {
            visited.add(nb);
            stack.push(nb);
          }
        }
      }
      result.push({ anchorNodeIndex: null, memberIds: component });
    }
  }

  return result;
}

// ── Content edge builder ──

function buildContentEdges(
  children: GraphEntity[],
  graph: Graph,
): ContentEdge[] {
  const nodeToEntity = new Map<number, string>();
  for (const child of children) {
    for (const idx of child.memberNodeIndices) {
      nodeToEntity.set(idx, child.id);
    }
  }

  const pairEdges = new Map<string, { kind: EdgeKind; indices: number[]; label?: string; type?: string }>();
  for (let ei = 0; ei < graph.edges.length; ei++) {
    const e = graph.edges[ei];
    const srcEntity = nodeToEntity.get(e.src);
    const dstEntity = nodeToEntity.get(e.dst);
    if (!srcEntity || !dstEntity || srcEntity === dstEntity) continue;

    const pairKey = `${srcEntity}:${dstEntity}`;
    if (!pairEdges.has(pairKey)) {
      pairEdges.set(pairKey, {
        kind: isStructuralEdge(e) ? "structural" : "associative",
        indices: [],
        label: e.label,
        type: e.type,
      });
    }
    pairEdges.get(pairKey)!.indices.push(ei);
  }

  const result: ContentEdge[] = [];
  for (const [key, data] of pairEdges) {
    const [sourceId, targetId] = key.split(":");
    result.push({
      sourceId,
      targetId,
      kind: data.kind,
      label: data.label,
      type: data.type,
      graphEdgeIndices: data.indices,
    });
  }
  return result;
}

// ── Helpers ──

/** Collect structural-only subtree members (excludes cluster proxy internals). */
function collectSubtreeMembers(
  nodeIndex: number,
  childrenOf: Map<number, number[]>,
  proxyMap: Map<number, ClusterInfo>,
): number[] {
  const members: number[] = [nodeIndex];
  const stack = [nodeIndex];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const kid of childrenOf.get(cur) ?? []) {
      if (proxyMap.has(kid)) continue; // skip proxy subtrees
      members.push(kid);
      stack.push(kid);
    }
  }
  return members;
}

/** Collect ALL members including cluster members. */
function collectAllMembers(
  nodeIndex: number,
  childrenOf: Map<number, number[]>,
  proxyMap: Map<number, ClusterInfo>,
): number[] {
  const members: number[] = [nodeIndex];
  const stack = [nodeIndex];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const cluster = proxyMap.get(cur);
    if (cluster) {
      members.push(...cluster.memberIds);
      continue;
    }
    for (const kid of childrenOf.get(cur) ?? []) {
      members.push(kid);
      stack.push(kid);
    }
  }
  return members;
}

function computeMaxDepth(entity: GraphEntity | GraphEntity[]): number {
  if (Array.isArray(entity)) {
    if (entity.length === 0) return 0;
    return Math.max(...entity.map((e) => computeMaxDepth(e)));
  }
  if (!entity.content || entity.content.children.length === 0) return 0;
  return 1 + computeMaxDepth(entity.content.children);
}

function computeDensity(entityCount: number, edgeCount: number): number {
  if (entityCount <= 1) return 0;
  return edgeCount / ((entityCount * (entityCount - 1)) / 2);
}

/**
 * Choose layout mode based on edge statistics.
 *
 *   structuralRatio > 0.7 and maxDepth >= 2 → radial
 *   structuralRatio > 0.7 and maxDepth < 2  → ring
 *   structuralRatio < 0.3                    → force
 *   0.3 ≤ structuralRatio ≤ 0.7             → hybrid
 *   entityCount > 200                        → collapsed
 *   entityCount ≤ 8 and no edges             → grid
 */
function chooseLayoutMode(
  structuralRatio: number,
  entityCount: number,
  edgeCount: number,
  maxDepth: number,
): LayoutMode {
  if (entityCount > 200) return "collapsed";
  if (entityCount <= 8 && edgeCount === 0) return "grid";
  if (structuralRatio > 0.7 && maxDepth >= 2) return "radial";
  if (structuralRatio > 0.7) return "ring";
  if (structuralRatio < 0.3) return "force";
  return "hybrid";
}
