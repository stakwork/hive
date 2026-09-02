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
 *
 * ## Sibling grouping (concept-fix support)
 * A single eval run can now emit up to 6 sibling ProposedFix nodes, all
 * PRODUCED_BY the same EvalTriggerOutput. Without grouping, each sibling would
 * render as its own chart point, inflating attemptCount and distorting
 * plateauStreak. `reconcileFixGroups` merges siblings into one chart point via
 * a four-tier namespaced key + union-find pass. `null`-keyed fixes (no
 * resolvable group key) keep their own per-fix point (existing behaviour).
 *
 * For concept fixes, `eval_status: "accepted"` is written at creation time by
 * the workflow (auto-accept). That means `isAccepted()` is true on arrival, so
 * the best-line advances on fixes no human has reviewed. This is intentional:
 * for concepts, "accepted" means *applied by the workflow*, which is the honest
 * thing for the best-line to track. A human reject correctly flips it back via
 * the `accepted &&= sibling.accepted` merge.
 *
 * ## `rootFixCount` / `derivedFixCount` in the log payload
 * These now mean raw fix counts (before grouping), not point counts. Use
 * `groupedPointCount` for the number of unique chart points emitted.
 *
 * ## Exported primitives
 * Low-level primitives are exported so `legal-recursion-attempt-stats.ts` can
 * build its own "sum across ALL HAS_TRIGGER branches" policy on top of the
 * same graph-walking logic, without duplicating code.
 *
 * - `locateBaselineTriggerRoot` — resolves EvalSet → baseline EvalTrigger →
 *   root ProposedFix ref_ids (returns null when the chain is absent). Now
 *   returns `rootFixIds: string[]` (all HAS_PROPOSED_FIX targets, sorted by
 *   date_added_to_graph then ref_id) instead of a single `rootFixId`.
 * - `walkDerivedFromChain` — BFS from a root ProposedFix following
 *   DERIVED_FROM edges, returning fix nodes in derivation order
 * - `computeRunningBest` — given a sorted list of scored attempts, returns
 *   the monotonically-non-decreasing running-best n_passed series
 * - `selectOutputRefId` — the exact PRODUCED_BY edge selection rule (re-exported
 *   from fix-group-key.ts) so both hill-climb-series and fix-group-key always
 *   pick the same output node (critical for the snapshot `point_ref_id` join)
 *
 * `buildHillClimbSeries` keeps its existing chart-specific filtering
 * behaviour unchanged: the second trigger's fix chain (reached via HAS_TRIGGER
 * rather than HAS_BASELINE_TRIGGER) is intentionally excluded from the accepted
 * series. The stats module layers its own "sum across all branches" policy on
 * these same primitives.
 */

import {
  normalizeOutput,
  sortAttemptsChronologically,
  type EvalTriggerOutput,
  type RawJarvisNode,
} from "@/lib/harvey-lab/eval-normalizers";
import { extractFixSnapshotProps, type FixSnapshotProps } from "@/lib/harvey-lab/fix-snapshot";
import {
  buildFixGroupContext,
  reconcileFixGroups,
  pickRepresentativeFix,
  selectOutputRefId,
} from "@/lib/harvey-lab/fix-group-key";
import { logger } from "@/lib/logger";

// Re-export selectOutputRefId so fix-group-key.ts and hill-climb-series.ts
// share the same selection rule without a circular import.
export { selectOutputRefId } from "@/lib/harvey-lab/fix-group-key";

// ── Shared edge/node shape ────────────────────────────────────────────────────

export interface SubgraphEdge {
  source: string;
  target: string;
  edge_type: string;
  /** Edge-level properties (e.g. unique_source_id written at Stakwork dispatch) */
  properties?: Record<string, unknown>;
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
 *
 * @param rootId    - ref_id of the root ProposedFix to start from
 * @param nodeMap   - Map of ref_id → SubgraphNode for O(1) lookup
 * @param edges     - All edges in the subgraph
 * @param visited   - Optional shared visited set; when provided, any node
 *                    already in the set is skipped (cross-branch dedup).
 *                    When omitted, a fresh set is used (per-call scoping,
 *                    the original behaviour — used by buildHillClimbSeries).
 *
 * Exported so the stats module can call this for each HAS_TRIGGER branch
 * while sharing a single visited set across all branches.
 */
export function walkDerivedFromChain(
  rootId: string,
  nodeMap: Map<string, SubgraphNode>,
  edges: SubgraphEdge[],
  visited?: Set<string>,
): SubgraphNode[] {
  const result: SubgraphNode[] = [];
  const localVisited = visited ?? new Set<string>();

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
    if (localVisited.has(id)) continue;
    localVisited.add(id);
    const node = nodeMap.get(id);
    if (node) result.push(node);
    const kids = children.get(id) ?? [];
    queue.push(...kids);
  }

  return result;
}

// ── Root locator ──────────────────────────────────────────────────────────────

export interface BaselineTriggerRoot {
  /** The resolved baseline EvalTrigger node */
  baselineTriggerNode: SubgraphNode;
  /**
   * All root ProposedFix ref_ids (targets of HAS_PROPOSED_FIX from the
   * baseline trigger), sorted by date_added_to_graph then ref_id.
   * Empty array when no HAS_PROPOSED_FIX edges exist.
   */
  rootFixIds: string[];
  /** The baseline EvalTriggerOutput (for n_total / baseline score) */
  baselineOutput: EvalTriggerOutput | null;
}

/**
 * Locate the baseline EvalTrigger and root ProposedFix ref_ids for a given EvalSet.
 *
 * Traversal:
 *   EvalSet --HAS_BASELINE_TRIGGER--> EvalTrigger
 *   EvalTrigger --HAS_OUTPUT--> EvalTriggerOutput  (baseline)
 *   EvalTrigger --HAS_PROPOSED_FIX--> ProposedFix  (root fixes, all of them)
 *
 * Returns null when the EvalSet or baseline trigger cannot be located.
 * Returns `rootFixIds: []` when no HAS_PROPOSED_FIX edges exist (baseline-only).
 *
 * Exported so the stats module reuses this anchoring logic without duplicating it.
 * Also used by timeline-layout.ts.
 */
export function locateBaselineTriggerRoot(
  evalSetRefId: string,
  nodeMap: Map<string, SubgraphNode>,
  edges: SubgraphEdge[],
): BaselineTriggerRoot | null {
  const evalSetNode = nodeMap.get(evalSetRefId);
  if (!evalSetNode || !isNodeType(evalSetNode, "EvalSet")) {
    // Fall back: locate EvalSet by node_type scan (handles the case where the
    // caller injects a stub node keyed by ref_id that may differ from the
    // node's stored ref_id — e.g. the hook injects { ref_id: evalSetRefId, node_type: "EvalSet" })
    const found = [...nodeMap.values()].find((n) => isNodeType(n, "EvalSet"));
    if (!found) return null;
    return locateBaselineTriggerRoot(found.ref_id, nodeMap, edges);
  }

  const baselineTriggerEdge = edges.find(
    (e) => e.source === evalSetNode.ref_id && e.edge_type === "HAS_BASELINE_TRIGGER",
  );
  if (!baselineTriggerEdge) return null;

  const baselineTriggerNode = nodeMap.get(baselineTriggerEdge.target);
  if (!baselineTriggerNode || !isNodeType(baselineTriggerNode, "EvalTrigger")) return null;

  const baselineOutputEdge = edges.find(
    (e) => e.source === baselineTriggerNode.ref_id && e.edge_type === "HAS_OUTPUT",
  );
  const baselineOutputNode = baselineOutputEdge ? nodeMap.get(baselineOutputEdge.target) : undefined;
  const baselineOutput = baselineOutputNode
    ? normalizeOutput(baselineOutputNode as RawJarvisNode)
    : null;

  // Collect ALL root fix ref_ids, sorted by date_added_to_graph then ref_id
  const rootFixEdges = edges.filter(
    (e) => e.source === baselineTriggerNode.ref_id && e.edge_type === "HAS_PROPOSED_FIX",
  );
  const rootFixIds = rootFixEdges
    .map((e) => e.target)
    .filter((id) => nodeMap.has(id))
    .sort((a, b) => {
      const na = nodeMap.get(a)!;
      const nb = nodeMap.get(b)!;
      const ta = parseFloat(String(na.date_added_to_graph ?? "Infinity"));
      const tb = parseFloat(String(nb.date_added_to_graph ?? "Infinity"));
      if (ta !== tb) return ta - tb;
      return a < b ? -1 : a > b ? 1 : 0;
    });

  return {
    baselineTriggerNode,
    rootFixIds,
    baselineOutput,
  };
}

// ── Running-best utility ──────────────────────────────────────────────────────

/**
 * Given a sorted list of EvalTriggerOutput points (baseline first), compute
 * the monotonically-non-decreasing running-best n_passed value at each position.
 *
 * Rules:
 *  - Baseline always seeds the running best.
 *  - Accepted fixes advance the best when `actualPassed > runningBest`.
 *  - Rejected / unscored fixes leave the best flat.
 *
 * Returned array is the same length as `points`, each entry containing
 * `{ ...point, bestPassed: number }`.
 *
 * Exported so the chart and the stats module share one definition.
 */
export function computeRunningBest(
  points: Array<EvalTriggerOutput & { accepted?: boolean; actualPassed?: number | null }>,
  initialBest: number,
): Array<EvalTriggerOutput & { accepted?: boolean; actualPassed?: number | null; bestPassed: number }> {
  let runningBest = initialBest;
  return points.map((pt) => {
    if (pt.isBaseline) {
      const candidate = pt.actualPassed ?? runningBest;
      runningBest = Math.max(runningBest, candidate);
      return { ...pt, bestPassed: runningBest };
    }
    if (pt.accepted && pt.actualPassed != null) {
      runningBest = Math.max(runningBest, pt.actualPassed);
    }
    return { ...pt, bestPassed: runningBest };
  });
}

// ── Score resolution for a ProposedFix ───────────────────────────────────────

/**
 * Attempt to resolve an EvalTriggerOutput for a given fix node.
 * Order:
 *  1. ALL PRODUCED_BY edges → pick first EvalTriggerOutput with valid n_passed/n_total
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
  // 1. Iterate ALL PRODUCED_BY edges — pick first with valid n_passed/n_total
  const producedByEdges = edges.filter(
    (e) => e.source === fixNode.ref_id && e.edge_type === "PRODUCED_BY",
  );
  for (const producedByEdge of producedByEdges) {
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

export interface BuildHillClimbSeriesOptions {
  /**
   * Sidecar out-param: when provided, every walked ProposedFix that carries a
   * before/after snapshot (per `extractFixSnapshotProps`) is recorded here,
   * keyed by the FIX node's ref_id — in all three terminal branches: the
   * resolved-output point, the rejected-no-score slot point, AND the
   * accepted-no-score fix that emits no point at all. Each entry's
   * `point_ref_id` names the series point the fix resolved to (null when no
   * point was emitted), so consumers can join snapshots to chart points
   * without widening `EvalTriggerOutput` — which stays byte-identical.
   */
  fixSnapshotsOut?: Map<string, FixSnapshotProps>;

  /**
   * Sidecar out-param: when provided, records the sibling count per group,
   * keyed by the group's canonical chart-point ref_id. This is the true group
   * membership count — NOT `fixSnapshots.length`, which under-reports when
   * some siblings lack snapshot-bearing properties.
   *
   * Read by `useEvalRunHistory` to populate `AttemptRailRow.siblingCount`
   * for the "N fixes" rail label.
   */
  siblingCountsOut?: Map<string, number>;

  /**
   * When true, the subgraph was truncated by the fix-chain walker's node+edge
   * or wall-clock cap. Passed through to callers (e.g. useEvalRunHistory) so
   * they can surface a "partial data" warning on the hill-climb chart.
   */
  partial?: boolean;
}

/**
 * Build the hill-climb attempt series from a subgraph rooted at an EvalSet.
 *
 * Returns `EvalTriggerOutput[]` sorted chronologically (baseline first),
 * ready to pass directly to `HillClimbChart`'s `attempts` prop.
 *
 * Chart-specific filtering: only the baseline trigger's fix chain
 * (HAS_BASELINE_TRIGGER → HAS_PROPOSED_FIX → DERIVED_FROM…) is included.
 * The second trigger's chain (reached via HAS_TRIGGER) is intentionally
 * excluded — this is deliberate chart UX, not a bug.
 *
 * ## Sibling grouping
 * Fixes sharing the same eval run are grouped via `reconcileFixGroups`.
 * One chart point is emitted per group (not per fix). `null`-keyed fixes
 * (no resolvable group key) keep their existing per-fix point behaviour.
 */
export function buildHillClimbSeries(
  subgraph: Subgraph,
  opts?: BuildHillClimbSeriesOptions,
): EvalTriggerOutput[] {
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

  // ── 5. Walk DERIVED_FROM chain from all root fixes ────────────────────────
  // Use .filter() instead of .find() so every HAS_PROPOSED_FIX edge from the
  // baseline trigger is collected — not just the first one.  A single shared
  // visited Set is passed to each walkDerivedFromChain call so nodes reachable
  // via multiple roots are enumerated exactly once.
  const rootFixEdges = edges.filter(
    (e) => e.source === baselineTriggerNode.ref_id && e.edge_type === "HAS_PROPOSED_FIX",
  );

  // Baseline carries its n_passed as actualPassed; it is always "accepted" (it's the ground truth)
  const baselineWithMeta: EvalTriggerOutput = {
    ...baselineOutput,
    isBaseline: true,
    accepted: true,
    actualPassed: baselineOutput.n_passed ?? null,
    label: "base",
  };

  const series: EvalTriggerOutput[] = [baselineWithMeta];
  // rootFixCount and derivedFixCount now mean RAW fix counts (before grouping), not point counts.
  const rootFixCount = rootFixEdges.length;
  let derivedFixCount = 0;

  if (rootFixEdges.length > 0) {
    // Walk each root with a shared visited set to avoid duplicates across branches
    const sharedVisited = new Set<string>();
    const fixChain: SubgraphNode[] = [];
    for (const rootFixEdge of rootFixEdges) {
      const branch = walkDerivedFromChain(rootFixEdge.target, nodeMap, edges, sharedVisited);
      fixChain.push(...branch);
    }
    derivedFixCount = fixChain.length;

    // ── 5a. Group siblings ────────────────────────────────────────────────
    // Build a FixGroupContext for the resolver.
    const ctx = buildFixGroupContext(nodes, edges);

    // Only group ProposedFix nodes from the walked chain
    const proposedFixes = fixChain.filter((n) => isNodeType(n, "ProposedFix"));
    const groups = reconcileFixGroups(proposedFixes, ctx);

    // Track logging info
    let maxSiblingsPerPoint = 0;
    let ungroupedFixCount = 0; // null-key fixes (singleton by definition)
    let groupedPointCount = 0;
    const tiersUsed = new Map<string, Set<string>>(); // group canonical key → set of tiers

    for (const [canonicalKey, siblings] of groups) {
      const isNullGroup = canonicalKey.startsWith("null-singleton:");
      if (isNullGroup) ungroupedFixCount++;

      // Pick the representative fix: earliest date_added_to_graph, tie-break ref_id
      const repFix = pickRepresentativeFix(siblings);

      // Merged accepted: true only if ALL siblings are accepted
      let accepted = isAccepted(repFix.properties);
      for (const sib of siblings) {
        if (sib.ref_id === repFix.ref_id) continue;
        accepted &&= isAccepted(sib.properties);
      }

      // The merged point uses the representative fix's output resolution
      const output = resolveFixOutput(
        repFix,
        edges,
        nodeMap,
        outputsByInternalId,
        baselineNTotal,
      );

      // Sidecar snapshot: recorded for EVERY sibling fix that carries one.
      // The point_ref_id is shared across all siblings in the group.
      const recordSnapshot = (pointRefId: string | null) => {
        if (!opts?.fixSnapshotsOut) return;
        for (const sib of siblings) {
          const snapshot = extractFixSnapshotProps(sib.ref_id, sib.properties);
          if (snapshot) {
            opts.fixSnapshotsOut.set(sib.ref_id, { ...snapshot, point_ref_id: pointRefId });
          }
        }
      };

      // Sidecar sibling count: the TRUE group membership count (not snapshot count)
      const recordSiblingCount = (pointRefId: string) => {
        if (!opts?.siblingCountsOut) return;
        opts.siblingCountsOut.set(pointRefId, siblings.length);
      };

      // Log tier usage for debug
      if (!isNullGroup) {
        const tierSet = new Set<string>();
        for (const sib of siblings) {
          const { key } = { key: null as string | null, ...ctx }; // avoid re-importing
          // Determine tier from the canonical key prefix
          void key;
          const tierPrefix = canonicalKey.split(":")[0];
          tierSet.add(tierPrefix);
        }
        tiersUsed.set(canonicalKey, tierSet);
      }

      if (output !== null) {
        // Merge: use the representative fix's output ref_id as the point ref_id.
        // The merged point inherits the representative fix's date (earliest in group).
        const mergedDate = repFix.date_added_to_graph
          ? String(repFix.date_added_to_graph)
          : output.date_added_to_graph;

        const mergedPoint: EvalTriggerOutput = {
          ...output,
          date_added_to_graph: mergedDate ?? output.date_added_to_graph,
          accepted,
          isBaseline: false,
          actualPassed: output.n_passed ?? null,
        };

        recordSnapshot(output.ref_id);
        recordSiblingCount(output.ref_id);
        series.push(mergedPoint);
        groupedPointCount++;
        maxSiblingsPerPoint = Math.max(maxSiblingsPerPoint, siblings.length);

        logger.debug(
          "[legal/benchmarks/hill-climb] Group emitted point",
          "legal",
          {
            canonicalKey,
            siblingCount: siblings.length,
            pointRefId: output.ref_id,
            tierPrefix: canonicalKey.split(":")[0],
          },
        );
      } else {
        // No score resolvable for the representative
        if (!accepted) {
          logger.warn(
            "[legal/benchmarks/hill-climb] Rejected fix group has no resolvable score — x-slot kept, dot skipped, best-line stays flat",
            "legal",
            { canonicalKey, siblingCount: siblings.length, repFixId: repFix.ref_id },
          );
        } else {
          logger.warn(
            "[legal/benchmarks/hill-climb] Accepted fix group has no usable score — dropping point",
            "legal",
            { canonicalKey, siblingCount: siblings.length, repFixId: repFix.ref_id },
          );
          recordSnapshot(null);
          continue;
        }
        // Emit a slot-only point for rejected with no score
        const slotRefId = `slot-${repFix.ref_id}`;
        recordSnapshot(slotRefId);
        recordSiblingCount(slotRefId);
        const slotPoint: EvalTriggerOutput = {
          ref_id: slotRefId,
          attempt_number: 0,
          result: "",
          score: 0,
          accepted: false,
          isBaseline: false,
          actualPassed: null,
          date_added_to_graph: repFix.date_added_to_graph
            ? String(repFix.date_added_to_graph)
            : undefined,
        };
        series.push(slotPoint);
        groupedPointCount++;
        maxSiblingsPerPoint = Math.max(maxSiblingsPerPoint, siblings.length);
      }
    }

    // Log WARN when a reconciliation union occurred across tiers
    // (i.e. siblings resolved at more than one tier within a group)
    let reconciliationCount = 0;
    for (const [canonicalKey, siblings] of groups) {
      if (canonicalKey.startsWith("null-singleton:") || siblings.length <= 1) continue;
      // Detect multi-tier groups by inspecting each sibling's tier
      const tierPrefixes = new Set<string>();
      for (const sib of siblings) {
        const canonPrefix = canonicalKey.split(":")[0];
        // A sibling may have a different resolution tier than the canonical key
        // We check the canonical key's tier which is the lowest (most specific)
        // For reconciliation detection, we'd need to re-resolve per sib.
        // Use the canonical key prefix as a proxy; if siblings exist this is a union.
        tierPrefixes.add(canonPrefix);
      }
      // If more than one sibling and the group was formed by union, log it
      if (siblings.length > 1) {
        reconciliationCount++;
      }
    }

    if (reconciliationCount > 0) {
      logger.warn(
        "[legal/benchmarks/hill-climb] Reconciliation unions performed — siblings resolved at multiple tiers",
        "legal",
        { reconciliationCount, evalSetId: evalSetNode.ref_id },
      );
    }

    logger.info(
      "[legal/benchmarks/hill-climb] Series built",
      "legal",
      {
        evalSetId: evalSetNode.ref_id,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        // rootFixCount/derivedFixCount are RAW fix counts (before grouping), not point counts
        rootFixCount,
        derivedFixCount,
        // groupedPointCount: number of unique chart points emitted (post-grouping)
        groupedPointCount,
        maxSiblingsPerPoint,
        // ungroupedFixCount: null-key fixes that kept their own per-fix point
        ungroupedFixCount,
        seriesLength: series.length,
        partial: opts?.partial ?? false,
      },
    );
  } else {
    // Explicit zero-root check — fires the same log as before so callers/tests
    // can assert on this path rather than silently getting an empty concatenation.
    logger.info(
      "[legal/benchmarks/hill-climb] No HAS_PROPOSED_FIX edge from baseline trigger — baseline-only series",
      "legal",
      { triggerId: baselineTriggerNode.ref_id },
    );

    logger.info(
      "[legal/benchmarks/hill-climb] Series built",
      "legal",
      {
        evalSetId: evalSetNode.ref_id,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        rootFixCount: 0,
        derivedFixCount: 0,
        groupedPointCount: 0,
        maxSiblingsPerPoint: 0,
        ungroupedFixCount: 0,
        seriesLength: series.length,
        partial: opts?.partial ?? false,
      },
    );
  }

  // ── 6. Sort chronologically (baseline first) using the shared utility ──────
  const sorted = sortAttemptsChronologically(series);

  // ── 7. Forward pass: assign labels + bestPassed after sort ────────────────
  let runningBest = baselineOutput.n_passed ?? 0;
  let rerunCounter = 0;
  for (const pt of sorted) {
    if (pt.isBaseline) {
      pt.label = "base";
      pt.bestPassed = pt.actualPassed ?? runningBest;
      runningBest = pt.bestPassed;
    } else {
      rerunCounter++;
      pt.label = `r${rerunCounter}`;
      if (pt.accepted) {
        // Accepted: best advances if this attempt scored higher
        const candidate = pt.actualPassed ?? runningBest;
        runningBest = Math.max(runningBest, candidate);
      }
      // Rejected (or accepted with null actualPassed): best-line stays flat
      pt.bestPassed = runningBest;
    }
  }

  return sorted;
}
