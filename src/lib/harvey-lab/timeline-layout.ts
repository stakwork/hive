/**
 * timeline-layout.ts
 *
 * Pure builder: given a subgraph `{ nodes, edges }` rooted at an EvalSet,
 * derives a deterministic 2D column layout for the RecursionTimelineViz.
 *
 * Column 0  = BaselineTrigger (EvalSet --HAS_BASELINE_TRIGGER--> EvalTrigger)
 * Columns 1…N = ProposedFix nodes in BFS visitation order following
 *   DERIVED_FROM edges from the baseline trigger's HAS_PROPOSED_FIX roots.
 *   When multiple HAS_PROPOSED_FIX edges exist, roots are sorted ascending by
 *   date_added_to_graph before BFS begins.
 *
 * Lane assignment (case-insensitive node_type):
 *   EvalTrigger      → top lane
 *   EvalTriggerOutput → middle lane
 *   ProposedFix      → bottom lane
 *
 * Score computation delegates to `normalizeOutput` — never reads
 * `properties.n_passed` / `properties.n_total` directly.
 *
 * Note: EvalRequirement / HAS_REQUIREMENT walking is intentionally omitted —
 * the production route excludes these nodes and the fixture contains none.
 */

import {
  normalizeOutput,
  type RawJarvisNode,
} from "@/lib/harvey-lab/eval-normalizers";
import {
  locateBaselineTriggerRoot,
  walkDerivedFromChain,
  type SubgraphNode,
  type SubgraphEdge,
} from "@/lib/harvey-lab/hill-climb-series";

// ── Public types ──────────────────────────────────────────────────────────────

export type RunColumn = {
  /** 0-based column index; column 0 is always the baseline run. */
  runIndex: number;
  /** EvalTrigger node for this column (null for ProposedFix columns). */
  trigger: SubgraphNode | null;
  /** EvalTriggerOutput node associated with this column (null when absent). */
  output: SubgraphNode | null;
  /** ProposedFix node for columns 1+; null for the baseline column. */
  proposedFix: SubgraphNode | null;
  /** n_passed / n_total from the output node; null when no scoreable output. */
  scorePct: number | null;
  /** scorePct − previous column's scorePct; null for column 0. */
  scoreDelta: number | null;
};

export type TimelineLayout = {
  columns: RunColumn[];
  /** The EvalSet root node, if found. */
  evalSetNode: SubgraphNode | null;
  /**
   * True when the graph walk returned a truncated result — mirrors the
   * fix-chain route's `partial` flag passed by the caller.
   */
  partial: boolean;
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function isNodeType(node: SubgraphNode, ...types: string[]): boolean {
  const t = (node.node_type ?? "").toLowerCase();
  return types.some((expected) => expected.toLowerCase() === t);
}

/**
 * Resolve the raw SubgraphNode for an output associated with a given source node.
 * For baseline trigger columns: follows HAS_OUTPUT edges from the trigger.
 * For ProposedFix columns: follows PRODUCED_BY edges from the fix; applies
 * first-valid-wins when multiple edges exist (mirrors `resolveFixOutput`).
 *
 * First-valid-wins for PRODUCED_BY: a target node is "valid" when it has a
 * non-null `properties` object AND `normalizeOutput` can extract a non-null
 * n_passed/n_total from it — exactly the same condition `resolveFixOutput` in
 * hill-climb-series.ts applies before picking an edge target.
 *
 * HAS_OUTPUT (baseline trigger) uses a simpler check: just non-null properties,
 * because the baseline always has a single output edge.
 */
function resolveOutputNode(
  sourceNode: SubgraphNode,
  edgeType: "HAS_OUTPUT" | "PRODUCED_BY",
  edges: SubgraphEdge[],
  nodeMap: Map<string, SubgraphNode>,
): SubgraphNode | null {
  const candidates = edges.filter(
    (e) => e.source === sourceNode.ref_id && e.edge_type === edgeType,
  );
  for (const edge of candidates) {
    const target = nodeMap.get(edge.target);
    if (!target || target.properties == null) continue;

    if (edgeType === "PRODUCED_BY") {
      // First-valid-wins: target must have resolvable n_passed/n_total via normalizeOutput.
      const normalized = normalizeOutput(target as RawJarvisNode);
      if (normalized && normalized.n_passed != null && normalized.n_total != null) {
        return target;
      }
      // Otherwise skip to the next candidate
      continue;
    }

    // HAS_OUTPUT: single edge, non-null properties suffices
    return target;
  }
  return null;
}

/**
 * Compute scorePct from a raw output node using normalizeOutput.
 * Returns null when the output node is absent or lacks n_passed/n_total.
 */
function computeScorePct(outputNode: SubgraphNode | null): number | null {
  if (!outputNode) return null;
  const normalized = normalizeOutput(outputNode as RawJarvisNode);
  if (!normalized || normalized.n_passed == null || normalized.n_total == null) return null;
  if (normalized.n_total === 0) return null;
  return normalized.n_passed / normalized.n_total;
}

// ── Main builder ──────────────────────────────────────────────────────────────

/**
 * Build a deterministic 2D timeline layout from an EvalSet subgraph.
 *
 * The `partial` flag is passed through from the caller — this function has
 * no knowledge of the walk budget; it operates only on the nodes/edges given.
 */
export function buildTimelineLayout(
  nodes: SubgraphNode[],
  edges: SubgraphEdge[],
  partial = false,
): TimelineLayout {
  // Index nodes for O(1) lookup
  const nodeMap = new Map<string, SubgraphNode>();
  for (const n of nodes) {
    nodeMap.set(n.ref_id, n);
  }

  // Locate the EvalSet node (case-insensitive)
  const evalSetNode = nodes.find((n) => isNodeType(n, "EvalSet")) ?? null;

  if (!evalSetNode) {
    return { columns: [], evalSetNode: null, partial };
  }

  // Locate the baseline trigger and root fix
  const baseline = locateBaselineTriggerRoot(evalSetNode.ref_id, nodeMap, edges);
  if (!baseline) {
    return { columns: [], evalSetNode, partial };
  }

  const { baselineTriggerNode, rootFixId } = baseline;

  // ── Column 0: Baseline ────────────────────────────────────────────────────
  const baselineOutputNode = resolveOutputNode(baselineTriggerNode, "HAS_OUTPUT", edges, nodeMap);
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

  // ── Columns 1+: ProposedFix chain ─────────────────────────────────────────
  if (!rootFixId) {
    // Baseline-only: no ProposedFix edges
    return { columns, evalSetNode, partial };
  }

  // Collect ALL HAS_PROPOSED_FIX edges from the baseline trigger.
  // Sort roots ascending by date_added_to_graph before BFS.
  const rootFixEdges = edges.filter(
    (e) => e.source === baselineTriggerNode.ref_id && e.edge_type === "HAS_PROPOSED_FIX",
  );

  const rootFixNodes = rootFixEdges
    .map((e) => nodeMap.get(e.target))
    .filter((n): n is SubgraphNode => n != null)
    .sort((a, b) => {
      const ta = parseFloat(String(a.date_added_to_graph ?? 0));
      const tb = parseFloat(String(b.date_added_to_graph ?? 0));
      return ta - tb;
    });

  // BFS over the DERIVED_FROM chain from all sorted roots.
  // Shared visited set prevents double-counting nodes reachable via multiple roots.
  const sharedVisited = new Set<string>();
  const fixChain: SubgraphNode[] = [];
  for (const rootFixNode of rootFixNodes) {
    const branch = walkDerivedFromChain(rootFixNode.ref_id, nodeMap, edges, sharedVisited);
    fixChain.push(...branch);
  }

  let prevScorePct = baselineScorePct;
  let colIndex = 1;

  for (const fixNode of fixChain) {
    if (!isNodeType(fixNode, "ProposedFix")) continue;

    // For ProposedFix columns, output is resolved via PRODUCED_BY (first-valid-wins)
    const outputNode = resolveOutputNode(fixNode, "PRODUCED_BY", edges, nodeMap);
    const scorePct = computeScorePct(outputNode);
    const scoreDelta =
      scorePct !== null && prevScorePct !== null ? scorePct - prevScorePct : null;

    columns.push({
      runIndex: colIndex,
      trigger: null,
      output: outputNode,
      proposedFix: fixNode,
      scorePct,
      scoreDelta,
    });

    if (scorePct !== null) {
      prevScorePct = scorePct;
    }
    colIndex++;
  }

  return { columns, evalSetNode, partial };
}
