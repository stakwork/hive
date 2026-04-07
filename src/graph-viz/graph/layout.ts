export type Vec3 = { x: number; y: number; z: number };
export type Edge = { src: number; dst: number };

const TWO_PI = Math.PI * 2;

const MIN_R1 = 22;
const MIN_ARC_LENGTH = 10;

export function adaptiveRadius(
  count: number,
  minArc = MIN_ARC_LENGTH,
  minR = MIN_R1
): number {
  if (count <= 1) return minR;
  return Math.max(minR, (minArc * count) / (Math.PI * 2));
}

function buildAdj(edges: Edge[]): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const e of edges) {
    if (!m.has(e.src)) m.set(e.src, []);
    if (!m.has(e.dst)) m.set(e.dst, []);
    m.get(e.src)!.push(e.dst);
    m.get(e.dst)!.push(e.src);
  }
  return m;
}

function normAngle(a: number) {
  a %= TWO_PI;
  if (a < 0) a += TWO_PI;
  return a;
}

export interface DepthVisual {
  scale: number;
  r: number;
  g: number;
  b: number;
  showLabel: boolean;
}

export function depthVisuals(depth: number, degreeRatio: number): DepthVisual {
  const base =
    depth === 0 ? 1.0 :
      depth === 1 ? 0.62 :
        depth === 2 ? 0.26 :
          depth === 3 ? 0.13 : 0.07;

  const scale = base * (0.85 + 0.45 * degreeRatio);

  switch (depth) {
    case 0:
      return { scale, r: 0.20, g: 0.90, b: 1.00, showLabel: true };
    case 1:
      return { scale, r: 0.15 * 0.85, g: 0.50 * 0.85, b: 0.90 * 0.85, showLabel: true };
    case 2:
      return { scale, r: 0.10 * 0.55, g: 0.35 * 0.55, b: 0.65 * 0.55, showLabel: false };
    case 3:
      return { scale, r: 0.08 * 0.28, g: 0.20 * 0.28, b: 0.40 * 0.28, showLabel: false };
    default:
      return { scale: base, r: 0.05 * 0.14, g: 0.10 * 0.14, b: 0.20 * 0.14, showLabel: false };
  }
}

export interface RadialLayoutResult {
  positions: Map<number, Vec3>;
  treeEdgeSet: Set<string>;
  childrenOf: Map<number, number[]>;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function computeRadialLayout(
  centerId: number,
  neighborsByDepth: number[][],
  edges: Edge[],
  opts?: {
    r1?: number | "auto";
    y1?: number;
    localMinSpacing?: number;
    startAngle?: number;
    wedgePad?: number;
    parentId?: number;
  }
): RadialLayoutResult {
  const {
    r1: r1Opt = "auto",
    startAngle = -Math.PI / 2,
    parentId,
  } = opts ?? {};

  const positions = new Map<number, Vec3>();
  const treeEdgeSet = new Set<string>();
  positions.set(centerId, { x: 0, y: 0, z: 0 });

  if (neighborsByDepth.length === 0 || neighborsByDepth[0].length === 0) {
    return { positions, treeEdgeSet, childrenOf: new Map() };
  }

  const adj = buildAdj(edges);
  const maxDepth = neighborsByDepth.length;

  // ---- 1. Build BFS tree (assign each node exactly one parent) ----
  const childrenOf = new Map<number, number[]>();
  childrenOf.set(centerId, []);

  for (let d = 0; d < maxDepth; d++) {
    if (d === 0) {
      for (const node of neighborsByDepth[0]) {
        if (!childrenOf.has(node)) childrenOf.set(node, []);
        childrenOf.get(centerId)!.push(node);
      }
      continue;
    }

    const prevSet = new Set(neighborsByDepth[d - 1]);
    for (const node of neighborsByDepth[d]) {
      if (!childrenOf.has(node)) childrenOf.set(node, []);
      const ns = adj.get(node) ?? [];
      let best = -1;
      let bestDeg = -1;

      for (const x of ns) {
        if (!prevSet.has(x)) continue;
        const deg = adj.get(x)?.length ?? 0;
        if (deg > bestDeg) {
          bestDeg = deg;
          best = x;
        }
      }

      if (best !== -1) childrenOf.get(best)!.push(node);
    }
  }

  for (const [, kids] of childrenOf) kids.sort((a, b) => a - b);

  // ---- 2b. Populate treeEdgeSet from childrenOf ----
  for (const [parent, kids] of childrenOf) {
    for (const kid of kids) {
      treeEdgeSet.add(edgeKey(parent, kid));
    }
  }

  // ---- 2c. Cross-edge-aware angular ordering of hop-1 children ----
  const hop1Raw = childrenOf.get(centerId)!;
  if (hop1Raw.length > 2) {
    const subtreeOf = new Map<number, number>();

    for (const h of hop1Raw) {
      subtreeOf.set(h, h);
      const stack = [h];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        for (const kid of childrenOf.get(cur) ?? []) {
          subtreeOf.set(kid, h);
          stack.push(kid);
        }
      }
    }

    const crossCount = new Map<string, number>();
    for (const e of edges) {
      const sa = subtreeOf.get(e.src);
      const sb = subtreeOf.get(e.dst);
      if (sa === undefined || sb === undefined || sa === sb) continue;
      if (treeEdgeSet.has(edgeKey(e.src, e.dst))) continue;
      const key = edgeKey(sa, sb);
      crossCount.set(key, (crossCount.get(key) ?? 0) + 1);
    }

    if (crossCount.size > 0) {
      const remaining = new Set(hop1Raw);
      const ordered: number[] = [];
      let cur = hop1Raw[0];
      ordered.push(cur);
      remaining.delete(cur);

      while (remaining.size > 0) {
        let best = -1;
        let bestScore = -1;

        for (const cand of remaining) {
          const score = crossCount.get(edgeKey(cur, cand)) ?? 0;
          if (score > bestScore) {
            bestScore = score;
            best = cand;
          }
        }

        if (best === -1) best = remaining.values().next().value!;
        ordered.push(best);
        remaining.delete(best);
        cur = best;
      }

      childrenOf.set(centerId, ordered);
    }
  }

  // ---- 3. Ring radii & y-offsets ----
  const hop1 = childrenOf.get(centerId)!;
  const n1 = hop1.length;
  const r1 = r1Opt === "auto" ? adaptiveRadius(n1) : r1Opt;

  const yOff: number[] = [0];
  yOff[1] = -r1 * 0.35;

  // ---- 4. Placement ----
  if (n1 === 0) return { positions, treeEdgeSet, childrenOf: new Map() };

  const R1 = r1;

  // Fixed ring radii per depth — geometric series
  const DEPTH_SHRINK = 0.55;
  const orbitR: number[] = [0, R1];
  for (let d = 2; d <= maxDepth + 1; d++) {
    orbitR[d] = orbitR[d - 1] * DEPTH_SHRINK;
  }

  // Y-offset proportional to ring radius
  const Y_RATIO = 0.6;
  for (let d = 2; d <= maxDepth + 1; d++) {
    yOff[d] = yOff[d - 1] - orbitR[d] * Y_RATIO;
  }

  // Hop-1: EVEN angular spacing (not weighted)
  const sectorSpan = TWO_PI / n1;
  for (let i = 0; i < n1; i++) {
    const angle = startAngle + i * sectorSpan;
    positions.set(hop1[i], {
      x: Math.cos(angle) * R1,
      y: yOff[1],
      z: Math.sin(angle) * R1,
    });
  }

  // Deeper layers: children on a ring of radius orbitR[childDepth]
  // around their parent. Angular step = 2π/nChildren.
  for (let d = 0; d < maxDepth; d++) {
    for (const node of neighborsByDepth[d]) {
      const kids = childrenOf.get(node) ?? [];
      if (!kids.length) continue;

      const parentPos = positions.get(node);
      if (!parentPos) continue;

      const childDepth = d + 2;
      if (childDepth > maxDepth) continue;

      const outward = Math.atan2(parentPos.z, parentPos.x);
      const localR = orbitR[childDepth];
      const step = TWO_PI / kids.length;

      for (let j = 0; j < kids.length; j++) {
        const phi = outward + j * step;
        positions.set(kids[j], {
          x: parentPos.x + Math.cos(phi) * localR,
          y: yOff[childDepth],
          z: parentPos.z + Math.sin(phi) * localR,
        });
      }
    }
  }

  // ---- 5. Parent node ----
  if (parentId !== undefined) {
    const parentDist = r1 * 3.5;
    const parentAngle = normAngle(startAngle + Math.PI);

    positions.set(parentId, {
      x: Math.cos(parentAngle) * parentDist,
      y: yOff[1],
      z: Math.sin(parentAngle) * parentDist,
    });
  }

  return { positions, treeEdgeSet, childrenOf };
}
