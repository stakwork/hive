/**
 * hill-climb-series.ts
 *
 * Pure builder: given a subgraph `{ nodes, edges }` rooted at an EvalSet,
 * walks the confirmed ontology to produce the baseline + accepted-fix score
 * series ready to feed into HillClimbChart's `attempts` prop.
 *
 * Ontology traversed:
 *   EvalSet --HAS_BASELINE_TRIGGER--> EvalTrigger --HAS_OUTPUT--> EvalTriggerOutput (baseline)
 *   EvalTrigger --HAS_PROPOSED_FIX--> ProposedFix --DERIVED_FROM--> ProposedFix (chain)
 *   ProposedFix --PRODUCED_BY--> EvalTriggerOutput (per-fix score)
 *
 * Accept/reject is keyed on `eval_status` (canonical); falls back to `status`
 * when `eval_status` is absent (reflects today's UI write path).
 */

import {
  normalizeOutput,
  sortAttemptsChronologically,
  type EvalTriggerOutput,
  type RawJarvisNode,
} from "@/lib/harvey-lab/eval-normalizers";
import { logger } from "@/lib/logger";

// ── Shared edge/node shape ────────────────────────────────────────────────────

export interface SubgraphEdge {
  source: string;
  target: string;
  edge_type: string;
}

export interface SubgraphNode {
  ref_id: string;
  node_type?: string;
  date_added_to_graph?: string | number;
  properties?: Record<string, unknown>;
}

export interface Subgraph {
  nodes: SubgraphNode[];
  edges: SubgraphEdge[];
}

// ── Casing helpers ────────────────────────────────────────────────────────────

function isNodeType(node: SubgraphNode, ...types: string[]): boolean {
  const t = (node.node_type ?? "").toLowerCase();
  return types.some((expected) => expected.toLowerCase() === t);
}

function edgeType(edge: SubgraphEdge): string {
  return edge.edge_type ?? "";
}

// ── Accept/reject resolution ──────────────────────────────────────────────────

/**
 * A fix is accepted when:
 *   eval_status === "accepted"  (canonical, case-insensitive)
 *   OR — when eval_status is absent — status === "accepted" (legacy fallback).
 *
 * This mirrors the architecture note: the UI accept PATCH still writes only
 * `status`, so `eval_status` may be absent on older nodes.
 */
function isAccepted(props: Record<string, unknown> | undefined): boolean {
  if (!props) return false;
  const evalStatus = props.eval_status;
  if (evalStatus != null) {
    return String(evalStatus).toLowerCase() === "accepted";
  }
  // Fallback: eval_status absent → check legacy status
  const status = props.status;
  return status != null && String(status).toLowerCase() === "accepted";
}

// ── DERIVED_FROM chain walker ─────────────────────────────────────────────────

/**
 * Walk the DERIVED_FROM chain from a root ProposedFix, returning the fix nodes
 * in topological derivation order (root first, then each child).
 *
 * DERIVED_FROM is directed: child --DERIVED_FROM--> parent.
 * So to find children of a node we look for edges whose TARGET is that node.
 */
function walkDerivedFromChain(
  rootId: string,
  nodeMap: Map<string, SubgraphNode>,
  edges: SubgraphEdge[],
): SubgraphNode[] {
  const result: SubgraphNode[] = [];
  const visited = new Set<string>();

  // Build: parent → children map (edges where target === parent, source is child)
  const children = new Map<string, string[]>();
  for (const e of edges) {
    if (e.edge_type === "DERIVED_FROM") {
      const parent = e.target;
      const child = e.source;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent)!.push(child);
    }
  }

  // BFS/DFS from root
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodeMap.get(id);
    if (node) result.push(node);
    const kids = children.get(id) ?? [];
    queue.push(...kids);
  }

  return result;
}

// ── Score resolution for a ProposedFix ───────────────────────────────────────

/**
 * Attempt to resolve an EvalTriggerOutput for a given fix node.
 * Order:
 *  1. PRODUCED_BY edge → EvalTriggerOutput node (primary)
 *  2. fix.rerun_run_id matched to an in-subgraph EvalTriggerOutput.id (fallback, no second fetch)
 *  3. Parse fix.before_score / after_score as numbers, derive n_passed against baseline n_total
 *  4. Drop (return null) — never emit NaN/undefined
 */
function resolveFixOutput(
  fixNode: SubgraphNode,
  edges: SubgraphEdge[],
  nodeMap: Map<string, SubgraphNode>,
  outputsByInternalId: Map<string, EvalTriggerOutput>,
  baselineNTotal: number | undefined,
): EvalTriggerOutput | null {
  // 1. PRODUCED_BY edge
  const producedByEdge = edges.find(
    (e) => e.source === fixNode.ref_id && e.edge_type === "PRODUCED_BY",
  );
  if (producedByEdge) {
    const targetNode = nodeMap.get(producedByEdge.target);
    if (targetNode && isNodeType(targetNode, "EvalTriggerOutput")) {
      const normalized = normalizeOutput(targetNode as RawJarvisNode);
      if (normalized && normalized.n_passed != null && normalized.n_total != null) {
        return normalized;
      }
    }
  }

  // 2. rerun_run_id — in-subgraph EvalTriggerOutput with matching id property
  const rerunRunId = fixNode.properties?.rerun_run_id;
  if (rerunRunId != null) {
    const rid = String(rerunRunId);
    const matched = outputsByInternalId.get(rid);
    if (matched && matched.n_passed != null && matched.n_total != null) {
      return matched;
    }
  }

  // 3. Parse before_score / after_score
  if (baselineNTotal != null && baselineNTotal > 0) {
    const afterRaw = fixNode.properties?.after_score;
    if (afterRaw != null) {
      const afterNum = parseFloat(String(afterRaw));
      if (!isNaN(afterNum)) {
        const beforeRaw = fixNode.properties?.before_score;
        const beforeNum = beforeRaw != null ? parseFloat(String(beforeRaw)) : undefined;
        // Derive n_passed: treat the score as an absolute count if ≤ n_total,
        // otherwise treat as a percentage and round.
        const deriveCount = (val: number): number => {
          if (val <= baselineNTotal) return Math.round(val);
          // Assume percentage 0–100
          return Math.round((val / 100) * baselineNTotal);
        };
        const n_passed = deriveCount(afterNum);
        if (!isNaN(n_passed)) {
          const syntheticOutput: EvalTriggerOutput = {
            ref_id: `synthetic-${fixNode.ref_id}`,
            attempt_number: 0,
            result: n_passed === baselineNTotal ? "pass" : "partial",
            score: baselineNTotal > 0 ? n_passed / baselineNTotal : 0,
            n_passed,
            n_total: baselineNTotal,
            // Carry over date for chronological sorting
            date_added_to_graph: fixNode.date_added_to_graph
              ? String(fixNode.date_added_to_graph)
              : undefined,
            // before_score for context
            judge_notes: beforeNum != null
              ? `${n_passed}/${baselineNTotal} criteria passed (derived from before_score=${beforeNum}, after_score=${afterNum})`
              : `${n_passed}/${baselineNTotal} criteria passed (derived from after_score=${afterNum})`,
          };
          return syntheticOutput;
        }
      }
    }
  }

  // 4. Drop
  return null;
}

// ── Main builder ──────────────────────────────────────────────────────────────

/**
 * Build the hill-climb attempt series from a subgraph rooted at an EvalSet.
 *
 * Returns `EvalTriggerOutput[]` sorted chronologically (baseline first),
 * ready to pass directly to `HillClimbChart`'s `attempts` prop.
 */
export function buildHillClimbSeries(subgraph: Subgraph): EvalTriggerOutput[] {
  const { nodes, edges } = subgraph;

  // Index nodes by ref_id for O(1) lookup
  const nodeMap = new Map<string, SubgraphNode>();
  for (const n of nodes) {
    nodeMap.set(n.ref_id, n);
  }

  // ── 1. Locate EvalSet root (case-insensitive) ─────────────────────────────
  const evalSetNode = nodes.find((n) => isNodeType(n, "EvalSet"));
  if (!evalSetNode) {
    logger.warn(
      "[legal/benchmarks/hill-climb] No EvalSet node found in subgraph",
      "legal",
      { nodeCount: nodes.length },
    );
    return [];
  }

  // ── 2. Locate baseline EvalTrigger via HAS_BASELINE_TRIGGER ──────────────
  const baselineTriggerEdge = edges.find(
    (e) => e.source === evalSetNode.ref_id && e.edge_type === "HAS_BASELINE_TRIGGER",
  );
  if (!baselineTriggerEdge) {
    logger.warn(
      "[legal/benchmarks/hill-climb] No HAS_BASELINE_TRIGGER edge from EvalSet",
      "legal",
      { evalSetId: evalSetNode.ref_id },
    );
    return [];
  }
  const baselineTriggerNode = nodeMap.get(baselineTriggerEdge.target);
  if (!baselineTriggerNode || !isNodeType(baselineTriggerNode, "EvalTrigger")) {
    logger.warn(
      "[legal/benchmarks/hill-climb] HAS_BASELINE_TRIGGER target is not an EvalTrigger",
      "legal",
      { targetId: baselineTriggerEdge.target },
    );
    return [];
  }

  // ── 3. Locate baseline EvalTriggerOutput via HAS_OUTPUT ──────────────────
  const baselineOutputEdge = edges.find(
    (e) => e.source === baselineTriggerNode.ref_id && e.edge_type === "HAS_OUTPUT",
  );
  const baselineOutputNode = baselineOutputEdge ? nodeMap.get(baselineOutputEdge.target) : undefined;
  const baselineOutput = baselineOutputNode
    ? normalizeOutput(baselineOutputNode as RawJarvisNode)
    : null;

  if (!baselineOutput || baselineOutput.n_passed == null || baselineOutput.n_total == null) {
    logger.warn(
      "[legal/benchmarks/hill-climb] Baseline EvalTriggerOutput missing or lacks n_passed/n_total",
      "legal",
      { triggerId: baselineTriggerNode.ref_id },
    );
    return [];
  }

  const baselineNTotal = baselineOutput.n_total;

  // ── 4. Build index: EvalTriggerOutput.id → output (for rerun_run_id fallback) ──
  const outputsByInternalId = new Map<string, EvalTriggerOutput>();
  for (const n of nodes) {
    if (isNodeType(n, "EvalTriggerOutput")) {
      const normalized = normalizeOutput(n as RawJarvisNode);
      if (normalized?.id) {
        outputsByInternalId.set(normalized.id, normalized);
      }
      // Also index by ref_id for PRODUCED_BY fallback
      if (normalized) {
        outputsByInternalId.set(normalized.ref_id, normalized);
      }
    }
  }

  // ── 5. Walk DERIVED_FROM chain from root fix ──────────────────────────────
  const rootFixEdge = edges.find(
    (e) => e.source === baselineTriggerNode.ref_id && e.edge_type === "HAS_PROPOSED_FIX",
  );

  const series: EvalTriggerOutput[] = [baselineOutput];
  let derivedFixCount = 0;
  let acceptedFixCount = 0;

  if (rootFixEdge) {
    const fixChain = walkDerivedFromChain(rootFixEdge.target, nodeMap, edges);
    derivedFixCount = fixChain.length;

    for (const fixNode of fixChain) {
      if (!isNodeType(fixNode, "ProposedFix")) continue;

      // Accept/reject — eval_status is canonical, status is fallback
      if (!isAccepted(fixNode.properties)) continue;
      acceptedFixCount++;

      const output = resolveFixOutput(
        fixNode,
        edges,
        nodeMap,
        outputsByInternalId,
        baselineNTotal,
      );
      if (output !== null) {
        series.push(output);
      } else {
        logger.warn(
          "[legal/benchmarks/hill-climb] Accepted fix has no usable score — dropping point",
          "legal",
          { fixId: fixNode.ref_id },
        );
      }
    }
  } else {
    logger.info(
      "[legal/benchmarks/hill-climb] No HAS_PROPOSED_FIX edge from baseline trigger — baseline-only series",
      "legal",
      { triggerId: baselineTriggerNode.ref_id },
    );
  }

  logger.info(
    "[legal/benchmarks/hill-climb] Series built",
    "legal",
    {
      evalSetId: evalSetNode.ref_id,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      derivedFixCount,
      acceptedFixCount,
      seriesLength: series.length,
    },
  );

  // ── 6. Sort chronologically (baseline first) using the shared utility ──────
  return sortAttemptsChronologically(series);
}
