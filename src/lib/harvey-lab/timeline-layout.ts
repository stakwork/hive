/**
 * timeline-layout.ts
 *
 * Pure builder: given a subgraph `{ nodes, edges }` rooted at an EvalSet,
 * produces a deterministic column layout for the 2D run-progression timeline.
 *
 * Column derivation:
 *   Column 0 = BaselineTrigger (via locateBaselineTriggerRoot)
 *   Columns 1…N = ProposedFix nodes in BFS visitation order (walkDerivedFromChain)
 *
 * Lane assignment (case-insensitive):
 *   EvalTrigger       → top lane
 *   EvalTriggerOutput → middle lane
 *   ProposedFix       → bottom lane
 *
 * Score computation delegates to normalizeOutput to handle both the explicit
 * property path and the legacy judge_notes parse path.
 */

import {
  locateBaselineTriggerRoot,
  walkDerivedFromChain,
  type SubgraphNode,
  type SubgraphEdge,
} from "@/lib/harvey-lab/hill-climb-series";
import { normalizeOutput, type RawJarvisNode } from "@/lib/harvey-lab/eval-normalizers";

// ── Public types ──────────────────────────────────────────────────────────────

export interface RunColumn {
  /** 0-based column index (Run 1 display label = runIndex + 1) */
  runIndex: number;
  trigger: SubgraphNode | null;
  output: SubgraphNode | null;
  proposedFix: SubgraphNode | null;
  /** n_passed / n_total in [0, 1], or null when the output is unresolvable */
  scorePct: number | null;
  /** Score delta vs the previous column's scorePct (null for column 0) */
  scoreDelta: number | null;
}

export interface TimelineLayout {
  columns: RunColumn[];
  /** The EvalSet node, pinned as an anchor in the visualization */
  evalSetNode: SubgraphNode | null;
  /** True when the underlying fix-chain walk was capped before completion */
  partial: boolean;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function isNodeType(node: SubgraphNode, ...types: string[]): boolean {
  const t = (node.node_type ?? "").toLowerCase();
  return types.some((expected) => expected.toLowerCase() === t);
}

/**
 * Resolve an EvalTriggerOutput for a given trigger node via a HAS_OUTPUT edge.
 * Returns the raw SubgraphNode (not normalized) so the caller can store it for
 * rendering and then normalize separately for scoring.
 */
function resolveOutputForTrigger(
  triggerNode: SubgraphNode,
  edges: SubgraphEdge[],
  nodeMap: Map<string, SubgraphNode>,
): SubgraphNode | null {
  const edge = edges.find(
    (e) => e.source === triggerNode.ref_id && e.edge_type === "HAS_OUTPUT",
  );
  if (!edge) return null;
  return nodeMap.get(edge.target) ?? null;
}

/**
 * Resolve an EvalTriggerOutput for a ProposedFix node via PRODUCED_BY edges.
 * First-valid-wins: picks the first edge whose target exists in the subgraph
 * and has a non-null properties object with valid n_passed/n_total.
 * Mirrors resolveFixOutput in hill-climb-series.ts.
 */
function resolveOutputForFix(
  fixNode: SubgraphNode,
  edges: SubgraphEdge[],
  nodeMap: Map<string, SubgraphNode>,
): SubgraphNode | null {
  const producedByEdges = edges.filter(
    (e) => e.source === fixNode.ref_id && e.edge_type === "PRODUCED_BY",
  );
  for (const e of producedByEdges) {
    const target = nodeMap.get(e.target);
    if (target && target.properties != null) {
      // Require that normalizeOutput succeeds with valid counts
      const normalized = normalizeOutput(target as RawJarvisNode);
      if (normalized && normalized.n_passed != null && normalized.n_total != null) {
        return target;
      }
    }
  }
  return null;
}

/** Compute scorePct from an output SubgraphNode. Returns null on failure. */
function computeScorePct(outputNode: SubgraphNode | null): number | null {
  if (!outputNode) return null;
  const normalized = normalizeOutput(outputNode as RawJarvisNode);
  if (!normalized || normalized.n_passed == null || normalized.n_total == null) return null;
  if (normalized.n_total === 0) return null;
  return normalized.n_passed / normalized.n_total;
}

// ── Main builder ──────────────────────────────────────────────────────────────

/**
 * Build a deterministic 2D timeline layout from a recursion subgraph.
 *
 * @param nodes  - All nodes in the fix-chain subgraph
 * @param edges  - All edges in the fix-chain subgraph
 * @param partial - Whether the underlying walk was capped (forwarded from the API)
 */
export function buildTimelineLayout(
  nodes: SubgraphNode[],
  edges: SubgraphEdge[],
  partial = false,
): TimelineLayout {
  // Index by ref_id for O(1) lookup
  const nodeMap = new Map<string, SubgraphNode>();
  for (const n of nodes) {
    nodeMap.set(n.ref_id, n);
  }

  // Locate the EvalSet node (case-insensitive)
  const evalSetNode = nodes.find((n) => isNodeType(n, "EvalSet")) ?? null;

  if (!evalSetNode) {
    return { columns: [], evalSetNode: null, partial };
  }

  // Locate baseline trigger + root fix id
  const baseline = locateBaselineTriggerRoot(evalSetNode.ref_id, nodeMap, edges);
  if (!baseline) {
    return { columns: [], evalSetNode, partial };
  }

  const { baselineTriggerNode } = baseline;

  // ── Column 0: baseline trigger ────────────────────────────────────────────
  const baselineOutputNode = resolveOutputForTrigger(baselineTriggerNode, edges, nodeMap);
  const baselineScorePct = computeScorePct(baselineOutputNode);

  const columns: RunColumn[] = [
    {
      runIndex: 0,
      trigger: baselineTriggerNode,
      output: baselineOutputNode,
      proposedFix: null,
      scorePct: baselineScorePct,
      scoreDelta: null,
    },
  ];

  // ── Columns 1…N: ProposedFix BFS chain ───────────────────────────────────
  // Collect all HAS_PROPOSED_FIX edges from the baseline trigger, sorted by
  // date_added_to_graph ascending before BFS so that when multiple root edges
  // exist they are visited in chronological order.
  const rootFixEdges = edges.filter(
    (e) => e.source === baselineTriggerNode.ref_id && e.edge_type === "HAS_PROPOSED_FIX",
  );

  // Sort root fixes ascending by date_added_to_graph before BFS
  const rootFixNodes = rootFixEdges
    .map((e) => nodeMap.get(e.target))
    .filter((n): n is SubgraphNode => n != null)
    .sort((a, b) => {
      const ta = Number(a.date_added_to_graph ?? 0);
      const tb = Number(b.date_added_to_graph ?? 0);
      return ta - tb;
    });

  if (rootFixNodes.length > 0) {
    const sharedVisited = new Set<string>();
    const fixChain: SubgraphNode[] = [];
    for (const root of rootFixNodes) {
      const branch = walkDerivedFromChain(root.ref_id, nodeMap, edges, sharedVisited);
      fixChain.push(...branch);
    }

    let prevScorePct = baselineScorePct;

    for (const fixNode of fixChain) {
      if (!isNodeType(fixNode, "ProposedFix")) continue;

      const outputNode = resolveOutputForFix(fixNode, edges, nodeMap);
      const scorePct = computeScorePct(outputNode);

      const scoreDelta =
        scorePct != null && prevScorePct != null ? scorePct - prevScorePct : null;

      columns.push({
        runIndex: columns.length,
        trigger: null,
        output: outputNode,
        proposedFix: fixNode,
        scorePct,
        scoreDelta,
      });

      // Only advance prevScorePct when this column produced a real score
      if (scorePct != null) {
        prevScorePct = scorePct;
      }
    }
  }

  return { columns, evalSetNode, partial };
}
