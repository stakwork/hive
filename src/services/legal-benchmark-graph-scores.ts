/**
 * legal-benchmark-graph-scores.ts
 *
 * Graph-backed score NUMERATORS for the Runs tab: EvalTriggerOutput nodes
 * fetched per task, so run rows can score from the graph instead of the
 * StakworkRun `result` column — the numerator counterpart of
 * `legal-benchmark-rubrics.ts`, which already sources the DENOMINATOR
 * (EvalSet → EvalRequirement roster, contested excluded).
 *
 * Two collection paths, matching where triggers actually live:
 *  1. EvalSet-hosted triggers (HAS_BASELINE_TRIGGER / HAS_TRIGGER) — where
 *     the recursion loop's re-scored attempts land. One depth-1 expand from
 *     the EvalSet resolved by task slug.
 *  2. Caller-supplied trigger refs — manual runs attach their EvalTrigger to
 *     an EvalRequirement (`legal/benchmarks/run`), which an EvalSet expand
 *     cannot reach and the fix-chain walk deliberately skips (the
 *     per-requirement fan-out burned its wall-clock budget). The run rows
 *     already know their own `evalTriggerRef`, so each is expanded directly:
 *     one call per distinct trigger in view, not one per requirement.
 *
 * Every output is normalized through `normalizeOutput`, which parses
 * n_passed/n_total out of `judge_notes` when explicit properties are absent —
 * hive's own inline output write (stakwork-run.ts) records counts ONLY in
 * judge_notes, so this fallback is load-bearing, not defensive.
 *
 * **Security:** callers must apply `requireAuth` + workspace-gate +
 * `getWorkspaceSwarmAccess` before calling — no authorization happens here.
 */

import type { JarvisConnectionConfig, JarvisNode } from "@/types/jarvis";
import { resolveEvalSetRefIdBySlug } from "@/services/legal-benchmark-recursion";
import { normalizeOutput, type RawJarvisNode } from "@/lib/harvey-lab/eval-normalizers";
import type { GraphScoreOutput } from "@/lib/harvey-lab/graph-run-score";
import { logger } from "@/lib/logger";

/**
 * Hard cap on triggers expanded per request. Bounds the Jarvis fan-out the
 * same way the runs list bounds rows in view; a task rarely has more than a
 * handful of set-hosted triggers plus one per visible manual run.
 */
export const GRAPH_SCORES_TRIGGER_CAP = 40;

export interface TaskGraphOutputsResult {
  ok: boolean;
  /** Null when the task has no EvalSet in the graph (trigger refs still expand). */
  evalSetRefId: string | null;
  outputs: GraphScoreOutput[];
  /** True when at least one expand failed — callers should not cache. */
  partial: boolean;
  error?: string;
}

/**
 * Depth-1 edge expand, the same call shape `fetchEvalSetRubrics` uses.
 * Returns the neighbor nodes (root excluded) or null on failure — failures
 * are per-hop, so one dead trigger doesn't blank the whole task.
 */
async function expandEdges(
  config: JarvisConnectionConfig,
  refId: string,
  edgeTypes: string[],
): Promise<JarvisNode[] | null> {
  const edgeType = encodeURIComponent(`[${edgeTypes.map((t) => `'${t}'`).join(",")}]`);
  const url = `${config.jarvisUrl}/v2/nodes/${encodeURIComponent(refId)}?expand=edges&edge_type=${edgeType}&depth=1`;
  try {
    const res = await fetch(url, { headers: { "x-api-token": config.apiKey } });
    if (!res.ok) {
      logger.warn(
        `[legal/benchmarks/graph-scores] Jarvis expand failed status=${res.status}`,
        "legal",
        { refId, status: res.status },
      );
      return null;
    }
    const data = (await res.json()) as { nodes?: JarvisNode[] };
    return (data?.nodes ?? []).filter((n) => n.ref_id !== refId);
  } catch (err) {
    logger.warn("[legal/benchmarks/graph-scores] Jarvis expand threw", "legal", {
      refId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function isNodeType(node: JarvisNode, expected: string): boolean {
  return String(node.node_type ?? "").toLowerCase() === expected.toLowerCase();
}

/**
 * Collect the EvalTriggerOutput nodes for a task: EvalSet-hosted triggers
 * plus any caller-supplied trigger refs, each expanded one HAS_OUTPUT hop.
 *
 * Never throws. `{ ok: false }` only when the graph yielded nothing AND at
 * least one call failed — an empty-but-healthy read is `{ ok: true }` so
 * callers can cache the (legitimate) absence of graph scores.
 */
export async function fetchTaskGraphOutputs(
  config: JarvisConnectionConfig,
  taskSlug: string,
  triggerRefs: string[] = [],
): Promise<TaskGraphOutputsResult> {
  let partial = false;

  const evalSetRefId = await resolveEvalSetRefIdBySlug(config, taskSlug);

  // 1. Set-hosted triggers (recursion re-runs).
  const setTriggerRefs: string[] = [];
  if (evalSetRefId) {
    const neighbors = await expandEdges(config, evalSetRefId, [
      "HAS_BASELINE_TRIGGER",
      "HAS_TRIGGER",
    ]);
    if (neighbors === null) {
      partial = true;
    } else {
      for (const n of neighbors) {
        if (isNodeType(n, "EvalTrigger")) setTriggerRefs.push(n.ref_id);
      }
    }
  }

  // 2. Union with caller refs (requirement-hosted manual triggers), capped.
  const allTriggerRefs = [...new Set([...setTriggerRefs, ...triggerRefs])];
  if (allTriggerRefs.length > GRAPH_SCORES_TRIGGER_CAP) {
    logger.warn(
      "[legal/benchmarks/graph-scores] Trigger cap hit — output list may be incomplete",
      "legal",
      { taskSlug, requested: allTriggerRefs.length, cap: GRAPH_SCORES_TRIGGER_CAP },
    );
    allTriggerRefs.length = GRAPH_SCORES_TRIGGER_CAP;
    partial = true;
  }

  // 3. One HAS_OUTPUT hop per trigger.
  const outputs: GraphScoreOutput[] = [];
  const perTrigger = await Promise.all(
    allTriggerRefs.map(async (triggerRef) => ({
      triggerRef,
      neighbors: await expandEdges(config, triggerRef, ["HAS_OUTPUT"]),
    })),
  );
  for (const { triggerRef, neighbors } of perTrigger) {
    if (neighbors === null) {
      partial = true;
      continue;
    }
    for (const n of neighbors) {
      if (!isNodeType(n, "EvalTriggerOutput")) continue;
      const normalized = normalizeOutput(n as RawJarvisNode);
      if (normalized) outputs.push({ ...normalized, triggerRef });
    }
  }

  const ok = outputs.length > 0 || !partial;
  return { ok, evalSetRefId, outputs, partial };
}
