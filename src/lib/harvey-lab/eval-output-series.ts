/**
 * eval-output-series.ts
 *
 * Pure builder: given a subgraph `{ nodes, edges }` rooted at an EvalSet,
 * produce one chart point per EvalTriggerOutput, in date order — no
 * ProposedFix requirement. Each point keeps its ACTUAL score in
 * `actualPassed`; `bestPassed` is the monotonic running best, so the chart's
 * line only ever climbs or holds while regressions render as hollow dots
 * below it.
 *
 * ## Why this exists
 * `buildHillClimbSeries` only charts nodes that pass
 * `isNodeType(fixNode, "ProposedFix")`. Concept-driven recursion never writes a
 * ProposedFix — it re-runs the eval and writes a fresh EvalTrigger +
 * EvalTriggerOutput — so an eval set re-run N times via concepts renders as a
 * single flat baseline point. This builder is the fallback for exactly that
 * shape; the ProposedFix hill-climb stays authoritative when it exists.
 *
 * Ontology traversed (both trigger hosts):
 *   EvalSet --HAS_BASELINE_TRIGGER--> EvalTrigger --HAS_OUTPUT--> EvalTriggerOutput
 *   EvalSet --HAS_TRIGGER----------> EvalTrigger --HAS_OUTPUT--> EvalTriggerOutput
 *   EvalSet --HAS_REQUIREMENT--> EvalRequirement --HAS_TRIGGER--> EvalTrigger
 *                                                --HAS_OUTPUT--> EvalTriggerOutput
 *
 * The requirement-hosted hop is NOT optional: hive's own benchmark run route
 * (`legal/benchmarks/run/route.ts`) attaches its EvalTrigger to the
 * EvalRequirement, not to the EvalSet. Collecting only from the EvalSet would
 * leave hive-dispatched runs invisible — the same class of bug this fixes.
 *
 * A bare HAS_TRIGGER from an arbitrary source is never accepted: the source must
 * be the EvalSet itself or an EvalRequirement that EvalSet owns.
 *
 * ## Divergence from the recursion cron (deliberate, out of scope here)
 * `collectAllAttempts` in `src/services/legal-recursion-attempt-stats.ts` skips
 * any node failing `isNodeType(fixNode, "ProposedFix")`, so attempt-cap and
 * plateau detection count ZERO attempts on the concept path even with this
 * builder shipped. The chart will show N re-runs while the cron sees none,
 * meaning concept-driven recursion does not self-limit. Changing an autonomous
 * loop's stopping conditions carries unbounded-spend risk in either direction
 * and belongs on its own brief — it is not silently fixed here.
 */

import {
  normalizeOutput,
  sortAttemptsChronologically,
  type EvalTriggerOutput,
  type RawJarvisNode,
} from "@/lib/harvey-lab/eval-normalizers";
import type {
  Subgraph,
  SubgraphEdge,
  SubgraphNode,
} from "@/lib/harvey-lab/hill-climb-series";
import { logger } from "@/lib/logger";

// ── Public types ──────────────────────────────────────────────────────────────

/** Which host the EvalTrigger hung off. */
export type TriggerHost = "evalset" | "requirement";

/** Why a candidate EvalTriggerOutput never became a chart point. */
export type DropReason = "no-counts" | "zero-total" | "duplicate";

/** How the final point order was decided. */
export type OrderingMode = "date" | "id-suffix" | "ref-id";

export interface DroppedOutput {
  ref_id: string;
  reason: DropReason;
}

export interface EvalOutputSeriesResult {
  /** Chart-ready points, baseline pinned first, then date order. */
  points: EvalTriggerOutput[];
  /** Single normalized denominator applied to every point (0 when empty). */
  denominator: number;
  orderingMode: OrderingMode;
  dropped: DroppedOutput[];
}

// ── Local helpers ─────────────────────────────────────────────────────────────

function isNodeType(node: SubgraphNode | undefined, ...types: string[]): boolean {
  if (!node) return false;
  const t = (node.node_type ?? "").toLowerCase();
  return types.some((expected) => expected.toLowerCase() === t);
}

/** A finite, non-negative integer-ish count. */
function isUsableCount(v: number | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

const EMPTY_RESULT: EvalOutputSeriesResult = {
  points: [],
  denominator: 0,
  orderingMode: "ref-id",
  dropped: [],
};

interface TriggerRef {
  refId: string;
  host: TriggerHost;
  edgeType: string;
  isBaseline: boolean;
}

// ── Trigger collection ────────────────────────────────────────────────────────

const EVALSET_TRIGGER_EDGE_TYPES = ["HAS_BASELINE_TRIGGER", "HAS_TRIGGER"];

/**
 * Collect every EvalTrigger reachable from the EvalSet, from both hosts,
 * deduplicated by trigger ref_id. The baseline flag is sticky: a trigger
 * reachable by both a baseline and a non-baseline path stays baseline.
 */
function collectTriggers(
  evalSetNode: SubgraphNode,
  nodeMap: Map<string, SubgraphNode>,
  edges: SubgraphEdge[],
): TriggerRef[] {
  const byRefId = new Map<string, TriggerRef>();

  function accept(refId: string, host: TriggerHost, edgeType: string) {
    if (!refId) return;
    // When the node is present it must actually be an EvalTrigger; when the walk
    // did not return it, accept the edge's word for it rather than dropping data.
    const node = nodeMap.get(refId);
    if (node && !isNodeType(node, "EvalTrigger")) return;

    const isBaseline = edgeType === "HAS_BASELINE_TRIGGER";
    const existing = byRefId.get(refId);
    if (existing) {
      existing.isBaseline = existing.isBaseline || isBaseline;
      return;
    }
    byRefId.set(refId, { refId, host, edgeType, isBaseline });
  }

  // Host 1: directly off the EvalSet.
  for (const e of edges) {
    if (e.source !== evalSetNode.ref_id) continue;
    if (!EVALSET_TRIGGER_EDGE_TYPES.includes(e.edge_type)) continue;
    accept(e.target, "evalset", e.edge_type);
  }

  // Host 2: off EvalRequirement nodes the EvalSet owns via HAS_REQUIREMENT.
  const requirementRefIds = new Set(
    edges
      .filter((e) => e.source === evalSetNode.ref_id && e.edge_type === "HAS_REQUIREMENT")
      .map((e) => e.target)
      .filter((refId) => {
        const node = nodeMap.get(refId);
        return !node || isNodeType(node, "EvalRequirement");
      }),
  );

  if (requirementRefIds.size > 0) {
    for (const e of edges) {
      if (e.edge_type !== "HAS_TRIGGER") continue;
      if (!requirementRefIds.has(e.source)) continue;
      accept(e.target, "requirement", e.edge_type);
    }
  }

  // Lexicographic order so downstream array order never depends on the walker's
  // batched fetch-completion order.
  return [...byRefId.values()].sort((a, b) => (a.refId < b.refId ? -1 : a.refId > b.refId ? 1 : 0));
}

// ── Main builder ──────────────────────────────────────────────────────────────

/**
 * Build the flat eval-output series: one point per scored EvalTriggerOutput,
 * in date order, each carrying its own score in `actualPassed`.
 *
 * `bestPassed` is the monotonic running best (assigned after ordering), so
 * `HillClimbChart`'s polyline ratchets up-or-flat exactly like the fix-chain
 * series — a regressed run sits as a hollow dot under the flat line.
 */
export function buildEvalOutputSeries(subgraph: Subgraph): EvalOutputSeriesResult {
  const { nodes, edges } = subgraph;

  const nodeMap = new Map<string, SubgraphNode>();
  for (const n of nodes) nodeMap.set(n.ref_id, n);

  // ── 1. Locate the EvalSet root (case-insensitive, mirroring hill-climb) ────
  const evalSetNode = nodes.find((n) => isNodeType(n, "EvalSet"));
  if (!evalSetNode) {
    logger.warn(
      "[legal/benchmarks/eval-output] No EvalSet node found in subgraph",
      "legal",
      { nodeCount: nodes.length },
    );
    return EMPTY_RESULT;
  }

  // ── 2. Collect triggers from both hosts ───────────────────────────────────
  const triggers = collectTriggers(evalSetNode, nodeMap, edges);

  const triggerCountByHost: Record<TriggerHost, number> = { evalset: 0, requirement: 0 };
  const triggerCountByEdgeType: Record<string, number> = {};
  for (const t of triggers) {
    triggerCountByHost[t.host] += 1;
    triggerCountByEdgeType[t.edgeType] = (triggerCountByEdgeType[t.edgeType] ?? 0) + 1;
  }

  if (triggers.length === 0) {
    logger.info(
      "[legal/benchmarks/eval-output] No triggers reachable from EvalSet — empty series",
      "legal",
      { evalSetId: evalSetNode.ref_id },
    );
    return EMPTY_RESULT;
  }

  // ── 3. Collect outputs per trigger, defensively ───────────────────────────
  const dropped: DroppedOutput[] = [];
  const seenOutputRefIds = new Set<string>();
  const kept: Array<{ output: EvalTriggerOutput; isBaseline: boolean }> = [];

  for (const trigger of triggers) {
    const outputRefIds = edges
      .filter((e) => e.source === trigger.refId && e.edge_type === "HAS_OUTPUT")
      .map((e) => e.target)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    for (const outputRefId of outputRefIds) {
      if (seenOutputRefIds.has(outputRefId)) {
        dropped.push({ ref_id: outputRefId, reason: "duplicate" });
        continue;
      }
      seenOutputRefIds.add(outputRefId);

      const outputNode = nodeMap.get(outputRefId);
      if (!isNodeType(outputNode, "EvalTriggerOutput")) continue;

      const normalized = normalizeOutput(outputNode as RawJarvisNode);
      if (!normalized) continue;

      if (!isUsableCount(normalized.n_passed) || !isUsableCount(normalized.n_total)) {
        dropped.push({ ref_id: outputRefId, reason: "no-counts" });
        continue;
      }
      // A 0/0 output carries no score. `stakwork-run.ts` writes judge_notes of the
      // form "0/0 criteria passed" with no n_passed/n_total properties at all, and
      // the judge-notes parser happily turns that into a 0/0 point — which would
      // then become the chart's entire y-domain via `yScale.domain([0, n_total])`.
      if (normalized.n_total <= 0) {
        dropped.push({ ref_id: outputRefId, reason: "zero-total" });
        continue;
      }

      kept.push({ output: normalized, isBaseline: trigger.isBaseline });
    }
  }

  if (kept.length === 0) {
    logger.info(
      "[legal/benchmarks/eval-output] No scored EvalTriggerOutputs — empty series",
      "legal",
      {
        evalSetId: evalSetNode.ref_id,
        triggerCount: triggers.length,
        triggerCountByHost,
        droppedCount: dropped.length,
      },
    );
    return { ...EMPTY_RESULT, dropped };
  }

  // ── 4. Normalize the denominator across the whole series ──────────────────
  // n_total can legitimately differ between re-runs (subset eval sets, newly
  // minted EvalRequirement nodes). The chart derives its entire y-domain and
  // target line from `points[0].n_total`, so one denominator is picked here —
  // in a pure, testable place — and numerators are clamped to it.
  const denominator = kept.reduce((max, k) => Math.max(max, k.output.n_total ?? 0), 0);

  const clamp = (v: number) => Math.min(Math.max(v, 0), denominator);

  const points: EvalTriggerOutput[] = kept.map(({ output, isBaseline }) => {
    const actualPassed = clamp(output.n_passed as number);
    return {
      ...output,
      n_total: denominator,
      n_passed: actualPassed,
      accepted: true,
      isBaseline,
      actualPassed,
      // bestPassed assigned after ordering — it depends on point order.
      bestPassed: actualPassed,
    };
  });

  // ── 5. Deterministic ordering ─────────────────────────────────────────────
  // `sortAttemptsChronologically` sorts by date only when EVERY output has a
  // non-empty date_added_to_graph; otherwise it falls back to the id suffix,
  // which returns -1 for any id lacking "--" — and hive writes
  // `id: randomUUID()` on EvalTriggerOutput, so every point ties and the
  // tie-break becomes array index. Pre-sorting by ref_id makes that index
  // ref_id order, so the result is identical however the input was shuffled
  // (both sort branches are stable).
  const byRefId = [...points].sort((a, b) =>
    a.ref_id < b.ref_id ? -1 : a.ref_id > b.ref_id ? 1 : 0,
  );

  const allHaveDate = byRefId.every(
    (p) => p.date_added_to_graph != null && p.date_added_to_graph !== "",
  );
  const anyHaveIdSuffix = byRefId.some((p) => (p.id ?? "").includes("--"));
  const orderingMode: OrderingMode = allHaveDate
    ? "date"
    : anyHaveIdSuffix
      ? "id-suffix"
      : "ref-id";

  const sorted = sortAttemptsChronologically(byRefId);

  // ── 6. Pin the baseline to index 0 ────────────────────────────────────────
  // Nothing in sortAttemptsChronologically does this, so a baseline whose
  // timestamp is absent or later than a re-run's would render `r1, base, r2`
  // and hand RecursionCard's `target: {attempts[0].n_total}` caption a
  // non-baseline point. With no baseline trigger, index 0 is simply the
  // earliest point and labels run r1…rN with no `base`.
  const baselineIdx = sorted.findIndex((p) => p.isBaseline);
  if (baselineIdx > 0) {
    const [baseline] = sorted.splice(baselineIdx, 1);
    sorted.unshift(baseline);
  }

  // ── 7. Labels + monotonic running best ────────────────────────────────────
  // The line only climbs or holds; a run that scored below the standing best
  // keeps its real score in actualPassed (the chart draws it as a hollow dot)
  // while bestPassed carries the ratchet the polyline follows.
  let rerunCounter = 0;
  let runningBest = 0;
  sorted.forEach((pt, i) => {
    runningBest = Math.max(runningBest, pt.actualPassed ?? 0);
    pt.bestPassed = runningBest;
    if (i === 0 && pt.isBaseline) {
      pt.label = "base";
      return;
    }
    rerunCounter += 1;
    pt.label = `r${rerunCounter}`;
  });

  const droppedByReason = dropped.reduce<Record<string, number>>((acc, d) => {
    acc[d.reason] = (acc[d.reason] ?? 0) + 1;
    return acc;
  }, {});

  logger.info(
    "[legal/benchmarks/eval-output] Series built",
    "legal",
    {
      evalSetId: evalSetNode.ref_id,
      triggerCount: triggers.length,
      triggerCountByHost,
      triggerCountByEdgeType,
      outputsKept: sorted.length,
      outputsDropped: dropped.length,
      droppedByReason,
      orderingMode,
      denominator,
      seriesLength: sorted.length,
      hasBaseline: sorted.length > 0 && sorted[0].isBaseline === true,
    },
  );

  return { points: sorted, denominator, orderingMode, dropped };
}
