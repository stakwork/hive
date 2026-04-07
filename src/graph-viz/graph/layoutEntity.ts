/**
 * Recursive Entity Layout Engine
 *
 * 1. Layout structural nodes (including anchored cluster proxies) via radial/force
 * 2. Position orphan clusters as independent subgraphs around the structural tree
 * 3. Scatter cluster members around their proxy positions
 * 4. Sync positions, compute bounds, populate legacy metadata
 */

import type { Graph, Vec3, LayoutStrategyName, UnstructuredRegion } from "./types";
import { isStructuralEdge } from "./types";
import type { GraphEntity } from "./entity";
import { walkEntities } from "./entity";
import { extractInitialSubgraph, VIRTUAL_CENTER } from "./extract";
import { applyLayout } from "./layoutStrategy";

// ── Public API ──

export interface LayoutEntityResult {
  treeEdgeSet: Set<string>;
  childrenOf: Map<number, number[]>;
  depthMap: Map<number, number>;
}

export function layoutEntityTree(
  root: GraphEntity,
  graph: Graph,
  layoutHint: LayoutStrategyName,
): LayoutEntityResult {
  // ── Step 1: Layout structural tree (includes anchored cluster proxies) ──
  const sub = extractInitialSubgraph(graph);
  const structuralEdges = graph.edges.filter((e) => isStructuralEdge(e));
  const layout = applyLayout(layoutHint, sub, structuralEdges, {
    parentId: sub.parentId,
  });

  for (const [id, pos] of layout.positions) {
    if (id !== VIRTUAL_CENTER && id >= 0 && id < graph.nodes.length) {
      graph.nodes[id].position = pos;
    }
  }

  // ── Step 2: Position orphan clusters independently ──
  const clusterEntities = findClusterEntities(root);
  const orphans = clusterEntities.filter((c) => {
    const idx = c.shell.nodeIndex;
    return idx !== undefined && !layout.positions.has(idx);
  });
  const anchored = clusterEntities.filter((c) => {
    const idx = c.shell.nodeIndex;
    return idx !== undefined && layout.positions.has(idx);
  });

  if (orphans.length > 0) {
    positionOrphanSubgraphs(orphans, graph, layout.positions);
  }

  // ── Step 3: Scatter all cluster members ──
  for (const cluster of [...anchored, ...orphans]) {
    scatterClusterMembers(cluster, graph);
  }

  // ── Step 4: Sync shell positions from graph.nodes ──
  walkEntities(root, (entity) => {
    const idx = entity.shell.nodeIndex;
    if (idx !== undefined && idx >= 0 && idx < graph.nodes.length) {
      entity.shell.position = { ...graph.nodes[idx].position };
    }
  });

  // ── Step 5: Compute bounds ──
  computeEntityBounds(root, graph);

  // ── Step 6: Graph metadata ──
  graph.treeEdgeSet = layout.treeEdgeSet;
  graph.childrenOf = layout.childrenOf;
  graph.initialDepthMap = sub.depthMap;
  populateLegacyRegions(clusterEntities, graph);

  return {
    treeEdgeSet: layout.treeEdgeSet,
    childrenOf: layout.childrenOf,
    depthMap: sub.depthMap,
  };
}

// ── Orphan subgraph positioning ──

/**
 * Position orphan clusters as independent subgraphs.
 * Each gets its own spot around the structural tree, spaced by size.
 * They are NOT connected to the structural tree — they float independently.
 */
function positionOrphanSubgraphs(
  orphans: GraphEntity[],
  graph: Graph,
  layoutPositions: Map<number, Vec3>,
): void {
  // Structural bounding radius
  let maxR = 0;
  for (const [id, pos] of layoutPositions) {
    if (id === VIRTUAL_CENTER) continue;
    const r = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
    if (r > maxR) maxR = r;
  }

  // Distribute orphans around a ring outside the structural tree.
  // Each orphan gets angular space proportional to its member count.
  const totalMembers = orphans.reduce((s, c) => s + c.memberNodeIndices.length, 0);
  const gap = Math.max(12, maxR * 0.35);

  let angle = 0;
  const TWO_PI = Math.PI * 2;

  for (const cluster of orphans) {
    const proxyIdx = cluster.shell.nodeIndex!;
    const memberCount = cluster.memberNodeIndices.length;

    // Angular share proportional to size
    const share = memberCount / totalMembers;
    const sweepAngle = share * TWO_PI;
    const midAngle = angle + sweepAngle / 2;

    // Distance from center — larger clusters sit further out
    const clusterRadius = Math.max(3, 2 * Math.sqrt(memberCount));
    const dist = maxR + gap + clusterRadius;

    graph.nodes[proxyIdx].position = {
      x: Math.cos(midAngle) * dist,
      y: -3,
      z: Math.sin(midAngle) * dist,
    };

    angle += sweepAngle;
  }
}

// ── Cluster member scatter ──

function scatterClusterMembers(cluster: GraphEntity, graph: Graph): void {
  const proxyIdx = cluster.shell.nodeIndex;
  if (proxyIdx === undefined) return;

  const center = graph.nodes[proxyIdx].position;
  const memberIds = cluster.memberNodeIndices;

  // Find nearest non-member neighbor to bound the cloud radius
  const memberSet = new Set(memberIds);
  let minNeighborDist = Infinity;
  for (let i = 0; i < graph.nodes.length; i++) {
    if (i === proxyIdx || memberSet.has(i)) continue;
    const p = graph.nodes[i].position;
    if (p.x === 0 && p.y === 0 && p.z === 0) continue; // unpositioned
    const dx = p.x - center.x, dy = p.y - center.y, dz = p.z - center.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 0 && d < minNeighborDist) minNeighborDist = d;
  }

  // Cloud radius: fit within half the distance to nearest neighbor,
  // but at least 2 and scale with member count
  const maxRadius = minNeighborDist < Infinity ? minNeighborDist * 0.4 : 10;
  const radius = Math.max(2, Math.min(maxRadius, 1.5 * Math.sqrt(memberIds.length)));

  // Scatter members inside a sphere (spherical distribution, not cubic)
  for (let i = 0; i < memberIds.length; i++) {
    const nid = memberIds[i];
    const s = spherePoint(i, 42 + (proxyIdx * 7), radius);
    graph.nodes[nid].position = {
      x: center.x + s.x,
      y: center.y + s.y * 0.6, // flatten slightly
      z: center.z + s.z,
    };
  }

  if (cluster.content) {
    for (const child of cluster.content.children) {
      const idx = child.shell.nodeIndex;
      if (idx !== undefined && idx >= 0 && idx < graph.nodes.length) {
        child.shell.position = { ...graph.nodes[idx].position };
      }
    }
  }
}

// ── Find cluster entities anywhere in the tree ──

function findClusterEntities(root: GraphEntity): GraphEntity[] {
  const clusters: GraphEntity[] = [];
  walkEntities(root, (entity) => {
    if (entity.id.startsWith("cluster-")) {
      clusters.push(entity);
    }
  });
  return clusters;
}

// ── Bounds ──

function computeEntityBounds(root: GraphEntity, graph: Graph): void {
  walkEntities(root, (entity) => {
    if (entity.memberNodeIndices.length === 0) return;

    const proxyIdx = entity.shell.nodeIndex;
    const indices = proxyIdx !== undefined && !entity.memberNodeIndices.includes(proxyIdx)
      ? [proxyIdx, ...entity.memberNodeIndices]
      : entity.memberNodeIndices;

    let cx = 0, cy = 0, cz = 0, count = 0;
    for (const idx of indices) {
      if (idx < 0 || idx >= graph.nodes.length) continue;
      const p = graph.nodes[idx].position;
      cx += p.x; cy += p.y; cz += p.z; count++;
    }
    if (count === 0) return;
    cx /= count; cy /= count; cz /= count;

    let maxR = 0;
    for (const idx of indices) {
      if (idx < 0 || idx >= graph.nodes.length) continue;
      const p = graph.nodes[idx].position;
      const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (r > maxR) maxR = r;
    }

    entity.bounds = { center: { x: cx, y: cy, z: cz }, radius: Math.max(maxR, 1) };
  });
}

// ── Legacy: populate unstructuredRegions for GraphView ──

function populateLegacyRegions(clusters: GraphEntity[], graph: Graph): void {
  if (clusters.length === 0) return;

  const regions: UnstructuredRegion[] = [];
  for (let ci = 0; ci < clusters.length; ci++) {
    const cluster = clusters[ci];
    const proxyNodeId = cluster.shell.nodeIndex;
    if (proxyNodeId === undefined) continue;

    const memberIds = cluster.memberNodeIndices;
    const center = graph.nodes[proxyNodeId].position;
    const radius = cluster.bounds?.radius ?? 5;

    const collapsedPositions = new Map<number, Vec3>();
    for (const mid of memberIds) {
      collapsedPositions.set(mid, { ...graph.nodes[mid].position });
    }

    regions.push({
      id: ci,
      proxyNodeId,
      memberIds: [...memberIds],
      anchorNodeId: cluster.anchorNodeIndex ?? null,
      center: { ...center },
      radius,
      collapsedPositions,
      expanded: false,
    });
  }

  graph.unstructuredRegions = regions;
}

// ── Sphere point distribution ──

/** Generate a deterministic point inside a sphere of given radius. */
function spherePoint(i: number, seed: number, radius: number): { x: number; y: number; z: number } {
  const n = noise3d(i, seed);
  // Normalize to unit sphere, then scale by radius with cube-root for uniform volume
  const len = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z) || 1;
  const r = radius * Math.cbrt(hashFloat(i, seed + 999));
  return { x: (n.x / len) * r, y: (n.y / len) * r, z: (n.z / len) * r };
}

/** Deterministic float 0..1 from index + seed. */
function hashFloat(i: number, seed: number): number {
  const h = Math.sin(i * 73.1 + seed * 53.3) * 43758.5453;
  return h - Math.floor(h);
}

// ── Noise ──

function noise3d(i: number, seed: number): { x: number; y: number; z: number } {
  const h1 = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  const h2 = Math.sin(i * 269.5 + seed * 183.3) * 43758.5453;
  const h3 = Math.sin(i * 419.2 + seed * 71.9) * 43758.5453;
  return {
    x: (h1 - Math.floor(h1)) * 2 - 1,
    y: (h2 - Math.floor(h2)) * 2 - 1,
    z: (h3 - Math.floor(h3)) * 2 - 1,
  };
}
