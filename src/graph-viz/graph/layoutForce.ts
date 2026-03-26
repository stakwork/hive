import type { Vec3, LayoutResult } from "./types";

interface Edge {
  src: number;
  dst: number;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * Force-directed layout with grid-accelerated repulsion.
 * O(N) per iteration via spatial grid, ~80 iterations.
 */
export function computeForceLayout(
  nodeIds: number[],
  edges: Edge[],
  opts?: { iterations?: number }
): LayoutResult {
  const iterations = opts?.iterations ?? 80;
  const n = nodeIds.length;
  const positions = new Map<number, Vec3>();

  if (n === 0) {
    return { positions, treeEdgeSet: new Set(), childrenOf: new Map() };
  }

  if (n === 1) {
    positions.set(nodeIds[0], { x: 0, y: 0, z: 0 });
    return { positions, treeEdgeSet: new Set(), childrenOf: new Map() };
  }

  // Index mapping: nodeId → local index
  const idToIdx = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    idToIdx.set(nodeIds[i], i);
  }

  // Filter edges to only those within our node set
  const localEdges: [number, number][] = [];
  for (const e of edges) {
    const si = idToIdx.get(e.src);
    const di = idToIdx.get(e.dst);
    if (si !== undefined && di !== undefined) {
      localEdges.push([si, di]);
    }
  }

  // Build adjacency for local indices
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [s, d] of localEdges) {
    adj[s].push(d);
    adj[d].push(s);
  }

  // 1. Init: place nodes on a spiral (deterministic, avoids overlap)
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const angle = i * 2.399963; // golden angle
    const r = 3 * Math.sqrt(i + 1);
    x[i] = Math.cos(angle) * r;
    z[i] = Math.sin(angle) * r;
  }

  // Force accumulators
  const fx = new Float64Array(n);
  const fz = new Float64Array(n);

  const REPULSION = 500;
  const SPRING_K = 0.05;
  const SPRING_REST = 8;
  const CELL_SIZE = 15;

  // 2. Iterate
  for (let iter = 0; iter < iterations; iter++) {
    // Temperature: max displacement decreases over time
    const temp = 10 * (1 - iter / iterations);
    if (temp < 0.01) break;

    fx.fill(0);
    fz.fill(0);

    // Grid repulsion: partition into cells
    const grid = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(x[i] / CELL_SIZE);
      const cz = Math.floor(z[i] / CELL_SIZE);
      const key = `${cx},${cz}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(i);
    }

    // Compute repulsion only within neighboring cells
    for (const [key, cellNodes] of grid) {
      const [cx, cz] = key.split(",").map(Number);

      // Gather neighbor cell nodes
      const neighbors: number[] = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const nkey = `${cx + dx},${cz + dz}`;
          const ncell = grid.get(nkey);
          if (ncell) {
            for (const nid of ncell) neighbors.push(nid);
          }
        }
      }

      for (const i of cellNodes) {
        for (const j of neighbors) {
          if (j <= i) continue;
          const dx = x[i] - x[j];
          const dz = z[i] - z[j];
          const distSq = dx * dx + dz * dz;
          const dist = Math.sqrt(distSq) + 0.01;
          const force = REPULSION / distSq;
          const fnx = (dx / dist) * force;
          const fnz = (dz / dist) * force;
          fx[i] += fnx;
          fz[i] += fnz;
          fx[j] -= fnx;
          fz[j] -= fnz;
        }
      }
    }

    // Edge attraction: spring force
    for (const [s, d] of localEdges) {
      const dx = x[d] - x[s];
      const dz = z[d] - z[s];
      const dist = Math.sqrt(dx * dx + dz * dz) + 0.01;
      const displacement = dist - SPRING_REST;
      const force = SPRING_K * displacement;
      const fnx = (dx / dist) * force;
      const fnz = (dz / dist) * force;
      fx[s] += fnx;
      fz[s] += fnz;
      fx[d] -= fnx;
      fz[d] -= fnz;
    }

    // Apply forces with temperature-limited displacement
    for (let i = 0; i < n; i++) {
      const mag = Math.sqrt(fx[i] * fx[i] + fz[i] * fz[i]) + 0.01;
      const clamp = Math.min(mag, temp) / mag;
      x[i] += fx[i] * clamp;
      z[i] += fz[i] * clamp;
    }
  }

  // 3. Post-process: center at origin
  let cx = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    cx += x[i];
    cz += z[i];
  }
  cx /= n;
  cz /= n;
  for (let i = 0; i < n; i++) {
    x[i] -= cx;
    z[i] -= cz;
  }

  // Set positions with slight Y jitter for depth feel
  for (let i = 0; i < n; i++) {
    positions.set(nodeIds[i], {
      x: x[i],
      y: -2 + (Math.sin(i * 1.7) * 0.5), // slight jitter
      z: z[i],
    });
  }

  // BFS from highest-degree node → treeEdgeSet + childrenOf
  const treeEdgeSet = new Set<string>();
  const childrenOf = new Map<number, number[]>();

  // Find highest-degree node (in local indices)
  let maxDeg = -1;
  let root = 0;
  for (let i = 0; i < n; i++) {
    if (adj[i].length > maxDeg) {
      maxDeg = adj[i].length;
      root = i;
    }
  }

  const visited = new Set<number>();
  visited.add(root);
  const queue = [root];
  childrenOf.set(nodeIds[root], []);

  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    const curId = nodeIds[cur];

    for (const nb of adj[cur]) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      queue.push(nb);

      const nbId = nodeIds[nb];
      treeEdgeSet.add(edgeKey(curId, nbId));
      if (!childrenOf.has(curId)) childrenOf.set(curId, []);
      childrenOf.get(curId)!.push(nbId);
      if (!childrenOf.has(nbId)) childrenOf.set(nbId, []);
    }
  }

  // Handle disconnected components
  for (let i = 0; i < n; i++) {
    if (!visited.has(i)) {
      visited.add(i);
      if (!childrenOf.has(nodeIds[i])) childrenOf.set(nodeIds[i], []);
    }
  }

  return { positions, treeEdgeSet, childrenOf };
}
