/**
 * fix-group-key.ts
 *
 * Shared helpers for grouping sibling ProposedFix nodes that all originate from
 * a single eval run. A single eval workflow can emit up to 6 concept fixes per
 * run, which would otherwise fan out into 6 separate chart points, 6 attempt
 * counts, and 6 timeline columns.
 *
 * ## Merging policy
 * Two fixes are merged when they share ANY candidate key at tiers 1, 2, or 3.
 * Tier 4 (`pending:<triggerId>`) does NOT cause merging on its own — it is only
 * used as a canonical key label when a group has no stronger identifier.
 * This preserves the existing behaviour where separate prompt-fixes attached to
 * the same trigger via different HAS_PROPOSED_FIX edges remain separate.
 *
 * ## Mixed-materialization
 * When a workflow is mid-rerun, some siblings have a PRODUCED_BY output (tier 1)
 * and some don't yet. All siblings share a rerun_run_id (tier 2) or a run-id
 * property (tier 3). The union pass merges them via the shared tier-2/3 key.
 *
 * ## null keys never collapse
 * A fix with no resolvable key stays in its own singleton bucket.
 *
 * ## CriterionResult guard on tier 4
 * The fix-chain walker does NOT fetch HAS_PROPOSED_FIX edges (fixEdgeTypes =
 * ["DERIVED_FROM","PRODUCED_BY"]). Tier 4 checks that the source of an inbound
 * HAS_PROPOSED_FIX is node_type EvalTrigger — never a CriterionResult.
 */

import type { SubgraphNode, SubgraphEdge } from "@/lib/harvey-lab/hill-climb-series";

// ── Public context type ───────────────────────────────────────────────────────

export interface FixGroupContext {
  nodeMap: Map<string, SubgraphNode>;
  edgesBySource: Map<string, SubgraphEdge[]>;
  edgesByTarget: Map<string, SubgraphEdge[]>;
}

export function buildFixGroupContext(
  nodes: SubgraphNode[],
  edges: SubgraphEdge[],
): FixGroupContext {
  const nodeMap = new Map<string, SubgraphNode>();
  for (const n of nodes) nodeMap.set(n.ref_id, n);

  const edgesBySource = new Map<string, SubgraphEdge[]>();
  const edgesByTarget = new Map<string, SubgraphEdge[]>();

  for (const e of edges) {
    if (!edgesBySource.has(e.source)) edgesBySource.set(e.source, []);
    edgesBySource.get(e.source)!.push(e);

    if (!edgesByTarget.has(e.target)) edgesByTarget.set(e.target, []);
    edgesByTarget.get(e.target)!.push(e);
  }

  return { nodeMap, edgesBySource, edgesByTarget };
}

// ── Candidate value validation ────────────────────────────────────────────────

const SAFE_KEY_RE = /^[A-Za-z0-9_-]+$/;

function isSafeKeyFragment(v: unknown): v is string {
  return typeof v === "string" && SAFE_KEY_RE.test(v);
}

// ── Tier-1 selection ──────────────────────────────────────────────────────────

/**
 * First PRODUCED_BY edge whose target has non-null n_passed AND n_total.
 * Mirrors `resolveFixOutput` in hill-climb-series.ts. Both call sites must use
 * this so they always pick the SAME output node (critical for point_ref_id join).
 */
export function selectOutputRefId(
  fixRefId: string,
  ctx: FixGroupContext,
): string | null {
  const outEdges = ctx.edgesBySource.get(fixRefId)?.filter(
    (e) => e.edge_type === "PRODUCED_BY",
  ) ?? [];

  for (const e of outEdges) {
    const target = ctx.nodeMap.get(e.target);
    if (!target) continue;
    const props = target.properties ?? {};
    if (props.n_passed != null && props.n_total != null) {
      return isSafeKeyFragment(e.target) ? e.target : null;
    }
  }
  return null;
}

// ── Tier-3 run-id ─────────────────────────────────────────────────────────────

const RUN_ID_PROPS = ["stakwork_run_id", "run_id", "project_id"] as const;

function resolveRunId(props: Record<string, unknown> | undefined): string | null {
  if (!props) return null;
  for (const key of RUN_ID_PROPS) {
    const v = props[key];
    if (isSafeKeyFragment(v)) return v;
  }
  return null;
}

// ── resolveFixGroupKey ────────────────────────────────────────────────────────

export interface FixKeyResolution {
  /** Lowest-tier key, or null. */
  key: string | null;
  /**
   * All tier 1/2/3 candidate keys (the "strong" ones that drive the union pass).
   * Tier 4 is excluded; see reconcileFixGroups for why.
   */
  strongCandidates: string[];
  /** Tier-4 key if resolvable, null otherwise. */
  tier4Key: string | null;
}

export function resolveFixGroupKey(
  fixNode: SubgraphNode,
  ctx: FixGroupContext,
): FixKeyResolution {
  const strongCandidates: string[] = [];
  let lowestKey: string | null = null;

  // Tier 1: PRODUCED_BY output
  const outRef = selectOutputRefId(fixNode.ref_id, ctx);
  if (outRef !== null) {
    const k = `out:${outRef}`;
    strongCandidates.push(k);
    if (lowestKey === null) lowestKey = k;
  }

  // Tier 2: rerun_run_id property
  const rerunRunId = fixNode.properties?.rerun_run_id;
  if (isSafeKeyFragment(rerunRunId)) {
    const k = `rerun:${rerunRunId}`;
    strongCandidates.push(k);
    if (lowestKey === null) lowestKey = k;
  }

  // Tier 3: run-id candidate properties
  const runId = resolveRunId(fixNode.properties);
  if (runId !== null) {
    const k = `run:${runId}`;
    strongCandidates.push(k);
    if (lowestKey === null) lowestKey = k;
  }

  // Tier 4: inbound HAS_PROPOSED_FIX from an EvalTrigger.
  // NOTE: the fix-chain walker does NOT fetch HAS_PROPOSED_FIX edges
  // (fixEdgeTypes = ["DERIVED_FROM","PRODUCED_BY"] — HAS_PROPOSED_FIX is absent
  // from that list, which keeps CriterionResult→ProposedFix edges out of the
  // subgraph; adding HAS_PROPOSED_FIX to fixEdgeTypes would change that).
  // Guard the source node type so this survives such a future change safely.
  let tier4Key: string | null = null;
  const inboundEdges = ctx.edgesByTarget.get(fixNode.ref_id) ?? [];
  for (const e of inboundEdges) {
    if (e.edge_type !== "HAS_PROPOSED_FIX") continue;
    const src = ctx.nodeMap.get(e.source);
    if (!src) continue;
    if ((src.node_type ?? "").toLowerCase() !== "evaltrigger") continue;
    if (!isSafeKeyFragment(e.source)) continue;
    tier4Key = `pending:${e.source}`;
    if (lowestKey === null) lowestKey = tier4Key;
    break;
  }

  return { key: lowestKey, strongCandidates, tier4Key };
}

// ── reconcileFixGroups ────────────────────────────────────────────────────────

/**
 * Group sibling ProposedFix nodes into canonical groups using union-find.
 *
 * Two fixes merge only when they share a strong (tier 1/2/3) candidate key.
 * Tier-4 sharing (same parent trigger) does NOT cause merging.
 *
 * Returns Map<canonicalKey, SubgraphNode[]>.
 * Null-keyed fixes each get a unique `null-singleton:<ref_id>` bucket.
 */
export function reconcileFixGroups(
  fixNodes: SubgraphNode[],
  ctx: FixGroupContext,
): Map<string, SubgraphNode[]> {
  if (fixNodes.length === 0) return new Map();

  type FixEntry = {
    node: SubgraphNode;
    key: string | null;
    strongCandidates: string[];
    tier4Key: string | null;
    tierRank: number;
  };

  const tierOf = (key: string | null): number => {
    if (key === null) return 5;
    if (key.startsWith("out:")) return 1;
    if (key.startsWith("rerun:")) return 2;
    if (key.startsWith("run:")) return 3;
    if (key.startsWith("pending:")) return 4;
    return 5;
  };

  const entries: FixEntry[] = fixNodes.map((node) => {
    const res = resolveFixGroupKey(node, ctx);
    return {
      node,
      key: res.key,
      strongCandidates: res.strongCandidates,
      tier4Key: res.tier4Key,
      tierRank: tierOf(res.key),
    };
  });

  // ── Iterative union-find (no recursion) ───────────────────────────────────
  // Map from ref_id to root ref_id. Initially each node is its own root.
  const parent = new Map<string, string>();
  const rank = new Map<string, number>(); // union-by-rank for flat trees

  for (const e of entries) {
    parent.set(e.node.ref_id, e.node.ref_id);
    rank.set(e.node.ref_id, 0);
  }

  function find(id: string): string {
    // Iterative path-halving
    let x = id;
    while (parent.get(x) !== x) {
      const p = parent.get(x)!;
      parent.set(x, parent.get(p) ?? p); // halve
      x = parent.get(x)!;
    }
    return x;
  }

  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    const rankA = rank.get(ra) ?? 0;
    const rankB = rank.get(rb) ?? 0;
    if (rankA < rankB) {
      parent.set(ra, rb);
    } else if (rankA > rankB) {
      parent.set(rb, ra);
    } else {
      // Equal rank: break ties by ref_id for determinism
      if (ra < rb) {
        parent.set(rb, ra);
        rank.set(ra, rankA + 1);
      } else {
        parent.set(ra, rb);
        rank.set(rb, rankB + 1);
      }
    }
  }

  // Union only on strong (tier 1/2/3) candidates
  const claimedBy = new Map<string, string>(); // strong key → first fix ref_id

  for (const e of entries) {
    if (e.key === null) continue; // null-keyed: skip union phase
    for (const cand of e.strongCandidates) {
      const prior = claimedBy.get(cand);
      if (prior === undefined) {
        claimedBy.set(cand, e.node.ref_id);
      } else {
        union(e.node.ref_id, prior);
      }
    }
  }

  // ── Collect groups by root ─────────────────────────────────────────────────
  const groupsByRoot = new Map<string, SubgraphNode[]>();

  for (const e of entries) {
    if (e.key === null) {
      // Null-keyed: own synthetic bucket
      groupsByRoot.set(`null-singleton:${e.node.ref_id}`, [e.node]);
      continue;
    }
    const root = find(e.node.ref_id);
    if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
    groupsByRoot.get(root)!.push(e.node);
  }

  // ── Canonical key per group ────────────────────────────────────────────────
  const result = new Map<string, SubgraphNode[]>();

  for (const [root, nodes] of groupsByRoot) {
    if (root.startsWith("null-singleton:")) {
      result.set(root, nodes);
      continue;
    }

    // Best strong key in the group (lowest tier, then lowest ref_id)
    let bestStrongKey: string | null = null;
    let bestStrongTier = 6;
    let bestStrongRef = "";

    // Best tier-4 key in the group (fallback when no strong key)
    let bestTier4Key: string | null = null;
    let bestTier4Ref = "";

    for (const node of nodes) {
      const e = entries.find((en) => en.node.ref_id === node.ref_id);
      if (!e) continue;

      for (const cand of e.strongCandidates) {
        const t = tierOf(cand);
        if (t < bestStrongTier || (t === bestStrongTier && node.ref_id < bestStrongRef)) {
          bestStrongKey = cand;
          bestStrongTier = t;
          bestStrongRef = node.ref_id;
        }
      }

      if (e.tier4Key !== null && (bestTier4Key === null || node.ref_id < bestTier4Ref)) {
        bestTier4Key = e.tier4Key;
        bestTier4Ref = node.ref_id;
      }
    }

    const canonicalKey = bestStrongKey ?? bestTier4Key ?? `fallback:${root}`;
    result.set(canonicalKey, nodes);
  }

  return result;
}

// ── Representative fix selection ──────────────────────────────────────────────

/**
 * Earliest date_added_to_graph in the group, tie-broken by lowest ref_id.
 * Used consistently in hill-climb-series, timeline-layout, and locateBaselineTriggerRoot.
 */
export function pickRepresentativeFix(siblings: SubgraphNode[]): SubgraphNode {
  return [...siblings].sort((a, b) => {
    const ta = parseFloat(String(a.date_added_to_graph ?? "Infinity"));
    const tb = parseFloat(String(b.date_added_to_graph ?? "Infinity"));
    if (ta !== tb) return ta - tb;
    return a.ref_id < b.ref_id ? -1 : a.ref_id > b.ref_id ? 1 : 0;
  })[0];
}
