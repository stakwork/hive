/**
 * legal-recursion-attempt-stats.ts
 *
 * Pure computation: given a knowledge-graph subgraph rooted at an EvalSet,
 * derives two stopping-condition metrics for the recursion cron:
 *
 *   - `attemptCount`  — total ProposedFix nodes reachable across ALL
 *                        EvalTrigger branches (HAS_BASELINE_TRIGGER and every
 *                        HAS_TRIGGER), regardless of accept/reject/scorability.
 *
 *   - `plateauStreak` — length of the trailing run of attempts (sorted
 *                        chronologically, optionally filtered to those
 *                        at/after `opts.cutoff`) that have a resolvable
 *                        `actualPassed` score and do NOT exceed the running best.
 *
 * Design:
 *   - Reuses exported primitives from hill-climb-series.ts (walkDerivedFromChain,
 *     locateBaselineTriggerRoot, computeRunningBest) rather than duplicating logic.
 *   - Shares normalizeOutput / sortAttemptsChronologically from eval-normalizers.
 *   - Multi-branch walk uses a SINGLE shared `visited` set across all branches
 *     so a node reachable from two different trigger branches is counted once.
 *   - `attemptCount` is NEVER filtered by cutoff — it always reflects full history.
 *   - Unscored attempts count toward `attemptCount` but neither break nor extend
 *     the `plateauStreak`.
 */

import {
  walkDerivedFromChain,
  type SubgraphNode,
  type SubgraphEdge,
  type Subgraph,
} from "@/lib/harvey-lab/hill-climb-series";
import {
  normalizeOutput,
  sortAttemptsChronologically,
  type EvalTriggerOutput,
  type RawJarvisNode,
} from "@/lib/harvey-lab/eval-normalizers";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AttemptStats {
  /** Total ProposedFix nodes reachable across all trigger branches (full history, no cutoff filter). */
  attemptCount: number;
  /**
   * Length of the trailing run of scored attempts (optionally filtered to those
   * at/after opts.cutoff) that don't exceed the running best.
   * 0 means the most recent scored attempt beat the running best (i.e. still improving).
   */
  plateauStreak: number;
}

// ── Casing helper ─────────────────────────────────────────────────────────────

function nodeTypeLower(n: SubgraphNode): string {
  return (n.node_type ?? "").toLowerCase();
}

function isNodeType(n: SubgraphNode, ...types: string[]): boolean {
  const t = nodeTypeLower(n);
  return types.some((expected) => expected.toLowerCase() === t);
}

// ── Score resolver (simplified — only PRODUCED_BY and before/after derivation) ─

/**
 * Resolve a numeric `actualPassed` value for a fix node, or return null when
 * no score can be determined.
 *
 * We use a simplified resolver here (not the full resolveFixOutput from the
 * chart builder) because the stats module only needs a yes/no on scorability
 * and the numeric value, not a full EvalTriggerOutput object.
 *
 * Resolution order:
 *   1. PRODUCED_BY edges → normalizeOutput → n_passed
 *   2. rerun_run_id → in-subgraph EvalTriggerOutput by ref_id → n_passed
 *   3. after_score parsed as float → treated as count against baselineNTotal
 */
function resolveActualPassed(
  fixNode: SubgraphNode,
  edges: SubgraphEdge[],
  nodeMap: Map<string, SubgraphNode>,
  baselineNTotal: number | undefined,
): { actualPassed: number; date?: string } | null {
  const ts = fixNode.date_added_to_graph != null
    ? String(fixNode.date_added_to_graph)
    : undefined;

  // 1. PRODUCED_BY edges
  const pbEdges = edges.filter(
    (e) => e.source === fixNode.ref_id && e.edge_type === "PRODUCED_BY",
  );
  for (const e of pbEdges) {
    const target = nodeMap.get(e.target);
    if (target && isNodeType(target, "EvalTriggerOutput")) {
      const norm = normalizeOutput(target as RawJarvisNode);
      if (norm && norm.n_passed != null) {
        return {
          actualPassed: norm.n_passed,
          date: norm.date_added_to_graph ?? ts,
        };
      }
    }
  }

  // 2. rerun_run_id — look up in-subgraph EvalTriggerOutput by ref_id
  const rerunRunId = fixNode.properties?.rerun_run_id;
  if (rerunRunId != null && String(rerunRunId).length > 0) {
    const rid = String(rerunRunId);
    const target = nodeMap.get(rid);
    if (target && isNodeType(target, "EvalTriggerOutput")) {
      const norm = normalizeOutput(target as RawJarvisNode);
      if (norm && norm.n_passed != null) {
        return {
          actualPassed: norm.n_passed,
          date: norm.date_added_to_graph ?? ts,
        };
      }
    }
  }

  // 3. after_score derivation against baselineNTotal
  if (baselineNTotal != null && baselineNTotal > 0) {
    const afterRaw = fixNode.properties?.after_score;
    if (afterRaw != null) {
      const afterNum = parseFloat(String(afterRaw));
      if (!isNaN(afterNum)) {
        const n_passed =
          afterNum <= baselineNTotal
            ? Math.round(afterNum)
            : Math.round((afterNum / 100) * baselineNTotal);
        if (!isNaN(n_passed)) {
          return { actualPassed: n_passed, date: ts };
        }
      }
    }
  }

  return null;
}

// ── Multi-branch attempt collector ────────────────────────────────────────────

interface AttemptRecord {
  /** Resolved n_passed for plateau computation; null = unscored */
  actualPassed: number | null;
  /** Unix-epoch timestamp string (for chronological sorting) */
  date: string | undefined;
}

/**
 * Walk ALL EvalTrigger branches reachable from the EvalSet node
 * (both HAS_BASELINE_TRIGGER and every HAS_TRIGGER edge) and collect all
 * ProposedFix nodes reachable via HAS_PROPOSED_FIX → DERIVED_FROM chains.
 *
 * A single shared `visited` set is passed to each `walkDerivedFromChain`
 * call so a node that appears in two branches' chains is counted only once.
 */
function collectAllAttempts(
  evalSetRefId: string,
  nodeMap: Map<string, SubgraphNode>,
  edges: SubgraphEdge[],
  baselineNTotal: number | undefined,
): AttemptRecord[] {
  const records: AttemptRecord[] = [];
  const sharedVisited = new Set<string>();

  // Find the EvalSet node (may be keyed by evalSetRefId or found by type)
  let evalSetNode = nodeMap.get(evalSetRefId);
  if (!evalSetNode || !isNodeType(evalSetNode, "EvalSet")) {
    evalSetNode = [...nodeMap.values()].find((n) => isNodeType(n, "EvalSet"));
  }
  if (!evalSetNode) return records;

  // Collect all trigger edges (both baseline and rerun triggers)
  const triggerEdgeTypes = ["HAS_BASELINE_TRIGGER", "HAS_TRIGGER"];
  const triggerEdges = edges.filter(
    (e) => e.source === evalSetNode!.ref_id && triggerEdgeTypes.includes(e.edge_type),
  );

  for (const triggerEdge of triggerEdges) {
    const triggerNode = nodeMap.get(triggerEdge.target);
    if (!triggerNode || !isNodeType(triggerNode, "EvalTrigger")) continue;

    // Each trigger may have a HAS_PROPOSED_FIX edge to a root fix
    const rootFixEdge = edges.find(
      (e) => e.source === triggerNode.ref_id && e.edge_type === "HAS_PROPOSED_FIX",
    );
    if (!rootFixEdge) continue;

    // Walk the DERIVED_FROM chain, sharing the visited set across branches
    const fixChain = walkDerivedFromChain(
      rootFixEdge.target,
      nodeMap,
      edges,
      sharedVisited,
    );

    for (const fixNode of fixChain) {
      if (!isNodeType(fixNode, "ProposedFix")) continue;
      const resolved = resolveActualPassed(fixNode, edges, nodeMap, baselineNTotal);
      records.push({
        actualPassed: resolved?.actualPassed ?? null,
        date: resolved?.date ?? (
          fixNode.date_added_to_graph != null
            ? String(fixNode.date_added_to_graph)
            : undefined
        ),
      });
    }
  }

  return records;
}

// ── Plateau streak computation ─────────────────────────────────────────────────

/**
 * Given a chronologically-sorted list of AttemptRecords (earliest first),
 * compute the trailing plateau streak — the number of consecutive trailing
 * attempts (from the end) that have a resolvable score and do NOT exceed
 * the running best up to that point.
 *
 * @param scoredAttempts - Only attempts with a resolvable score (actualPassed != null)
 * @param initialBest    - The baseline n_passed (running best before any fix attempts).
 *                         Required so an attempt that scores below the baseline is
 *                         correctly classified as non-improving (not "new high" from 0).
 *
 * Unscored attempts (actualPassed === null) neither break nor extend the streak;
 * they are transparent to plateau computation.
 */
function computePlateauStreak(
  scoredAttempts: Array<{ actualPassed: number }>,
  initialBest: number,
): number {
  if (scoredAttempts.length === 0) return 0;

  // Compute running best forward pass, seeded at initialBest (baseline n_passed)
  let runningBest = initialBest;
  const withBest = scoredAttempts.map((a) => {
    const improved = a.actualPassed > runningBest;
    runningBest = Math.max(runningBest, a.actualPassed);
    return { ...a, improved };
  });

  // Count trailing non-improving attempts
  let streak = 0;
  for (let i = withBest.length - 1; i >= 0; i--) {
    if (!withBest[i].improved) {
      streak++;
    } else {
      // Hit an improving attempt → streak ends
      break;
    }
  }
  return streak;
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Compute attempt count and plateau streak for an EvalSet from its subgraph.
 *
 * @param subgraph      - The knowledge-graph subgraph returned by kgGetSubgraph
 * @param evalSetRefId  - ref_id of the EvalSet root node
 * @param opts.cutoff   - When provided, only attempts at/after this date
 *                        participate in plateau-streak computation.
 *                        `attemptCount` is NEVER filtered by cutoff.
 *
 * Definitions:
 *   `attemptCount`  — every ProposedFix reachable across all trigger branches
 *                     (accepts, rejects, unscored — all count)
 *   `plateauStreak` — trailing count of scored attempts (post-cutoff when set)
 *                     that don't beat the running best; unscored attempts are
 *                     transparent (don't break or extend the streak)
 */
export function computeAttemptStats(
  subgraph: Subgraph,
  evalSetRefId: string,
  opts?: { cutoff?: Date },
): AttemptStats {
  const { nodes, edges } = subgraph;

  // Index nodes by ref_id
  const nodeMap = new Map<string, SubgraphNode>();
  for (const n of nodes) {
    nodeMap.set(n.ref_id, n);
  }

  // Resolve baseline n_passed (initial running best) and n_total (for score derivation)
  let baselineNTotal: number | undefined;
  let baselineNPassed: number | undefined;
  {
    let evalSetNode = nodeMap.get(evalSetRefId);
    if (!evalSetNode || !isNodeType(evalSetNode, "EvalSet")) {
      evalSetNode = [...nodeMap.values()].find((n) => isNodeType(n, "EvalSet"));
    }
    if (evalSetNode) {
      const baselineTriggerEdge = edges.find(
        (e) => e.source === evalSetNode!.ref_id && e.edge_type === "HAS_BASELINE_TRIGGER",
      );
      if (baselineTriggerEdge) {
        const baselineTriggerNode = nodeMap.get(baselineTriggerEdge.target);
        if (baselineTriggerNode) {
          const baselineOutputEdge = edges.find(
            (e) => e.source === baselineTriggerNode.ref_id && e.edge_type === "HAS_OUTPUT",
          );
          if (baselineOutputEdge) {
            const baselineOutputNode = nodeMap.get(baselineOutputEdge.target);
            if (baselineOutputNode) {
              const norm = normalizeOutput(baselineOutputNode as RawJarvisNode);
              baselineNTotal = norm?.n_total;
              baselineNPassed = norm?.n_passed;
            }
          }
        }
      }
    }
  }

  // Collect all attempt records across all branches
  const allAttempts = collectAllAttempts(evalSetRefId, nodeMap, edges, baselineNTotal);

  // attemptCount = all records, never filtered by cutoff
  const attemptCount = allAttempts.length;

  // Sort chronologically for plateau streak computation
  // We need to sort as EvalTriggerOutput-shaped objects for the shared utility.
  // Since AttemptRecord uses `date`, we adapt inline.
  const sortable: EvalTriggerOutput[] = allAttempts.map((a, i) => ({
    ref_id: `attempt-${i}`,
    attempt_number: i,
    result: "",
    score: 0,
    n_passed: a.actualPassed ?? undefined,
    date_added_to_graph: a.date,
  }));

  const sorted = sortAttemptsChronologically(sortable);

  // Re-join sorted order back to actualPassed values
  const sortedPassed = sorted.map((s) => ({
    actualPassed: s.n_passed ?? null,
    date: s.date_added_to_graph,
  }));

  // Apply cutoff filter for plateau streak (NOT for attemptCount)
  const cutoff = opts?.cutoff;
  const streakCandidates = cutoff
    ? sortedPassed.filter((a) => {
        if (a.date == null) return true; // no date → include (fail-open)
        const ts = parseFloat(a.date);
        if (isNaN(ts)) return true;
        return ts >= cutoff.getTime() / 1000;
      })
    : sortedPassed;

  // Extract only scored attempts (actualPassed !== null) for plateau computation
  const scoredStreakCandidates = streakCandidates
    .filter((a): a is { actualPassed: number; date: string | undefined } => a.actualPassed !== null);

  // Seed the running best from the baseline n_passed, so attempts scoring below
  // baseline are correctly classified as non-improving (not "new high from 0").
  const initialBest = baselineNPassed ?? 0;
  const plateauStreak = computePlateauStreak(scoredStreakCandidates, initialBest);

  return { attemptCount, plateauStreak };
}
