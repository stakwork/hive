import type { LayoutStrategyName, LayoutResult } from "./types";
import type { Subgraph } from "./extract";
import { computeRadialLayout } from "./layout";
import { computeForceLayout } from "./layoutForce";

interface Edge {
  src: number;
  dst: number;
}

/**
 * Dispatch layout to the appropriate strategy.
 * - "radial" → existing radial BFS layout
 * - "force"  → force-directed with grid repulsion
 * - "auto"   → heuristic: high cross-edge ratio or many roots → force, else radial
 */
export function applyLayout(
  strategy: LayoutStrategyName,
  subgraph: Subgraph,
  edges: Edge[],
  opts?: { parentId?: number }
): LayoutResult {
  const resolved = strategy === "auto" ? detectStrategy(subgraph, edges) : strategy;

  if (resolved === "force") {
    return computeForceLayout(subgraph.nodeIds, edges);
  }

  // Default: radial
  return computeRadialLayout(
    subgraph.centerId,
    subgraph.neighborsByDepth,
    edges,
    { parentId: opts?.parentId }
  );
}

/**
 * Auto-detect: use force layout if the graph looks more like a network than a tree.
 * Heuristic: cross-edge ratio > 0.5 or roots > 30% of nodes → force.
 */
function detectStrategy(subgraph: Subgraph, edges: Edge[]): "radial" | "force" {
  const nodeSet = new Set(subgraph.nodeIds);
  const n = nodeSet.size;
  if (n <= 3) return "radial";

  // Count edges within subgraph
  let totalEdges = 0;
  for (const e of edges) {
    if (nodeSet.has(e.src) && nodeSet.has(e.dst)) totalEdges++;
  }

  // Tree edges = n - 1 (for a spanning tree)
  const treeEdges = Math.max(n - 1, 1);
  const crossEdges = totalEdges - treeEdges;
  const crossRatio = crossEdges / totalEdges;

  if (crossRatio > 0.5) return "force";

  // Check root density: nodes at depth 1 / total
  const roots = subgraph.neighborsByDepth[0]?.length ?? 0;
  if (roots / n > 0.3) return "force";

  return "radial";
}
