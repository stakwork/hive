/**
 * graph-run-score.ts
 *
 * Pure join logic between StakworkRun rows on the Runs tab and the graph's
 * EvalTriggerOutput nodes, so row NUMERATORS can come from the graph instead
 * of the run row's `result` JSON — completing the graph-first score story
 * whose DENOMINATOR (EvalSet → EvalRequirement roster, contested excluded)
 * already comes from `useBenchmarkRubricsMap` + `computeBenchmarkScore`.
 *
 * Join keys, in precedence order:
 *  1. `run.result.evalOutputRef` — the EXACT pointer to the run's own
 *     EvalTriggerOutput node, persisted by the completion webhook (or
 *     supplied by an external pipeline's webhook payload). When it resolves,
 *     the node is authoritative for numerator AND denominator — no
 *     convention involved.
 *  2. `run.result.evalTriggerRef` — the EvalTrigger node hive attaches when a
 *     manual run is dispatched (`legal/benchmarks/run`); its completion
 *     webhook writes the EvalTriggerOutput behind a HAS_OUTPUT edge.
 *  3. `run.projectId` against the output node's `id` suffix — the external
 *     re-score workflow writes outputs with
 *     `id: "task_slug-source_run_id--<rerun_project_id>"` (the documented
 *     convention `parseIdSuffix` in eval-normalizers.ts relies on), which is
 *     the only handle recursion-pipeline rows have without a pointer.
 *
 * Every join can legitimately miss (legacy runs, failed instrumentation,
 * in-flight attempts) — callers must fall back to the row's own result-table
 * fields rather than blanking a previously scored row.
 */

import type { EvalTriggerOutput } from "@/lib/harvey-lab/eval-normalizers";

/** An EvalTriggerOutput plus the EvalTrigger it hangs off (the row join key). */
export type GraphScoreOutput = EvalTriggerOutput & {
  /**
   * ref_id of the EvalTrigger this output was reached through. Absent when
   * the node was fetched directly by a stored evalOutputRef pointer — those
   * joins go by ref_id, not by trigger.
   */
  triggerRef?: string;
};

/** True when the output carries counts a score can be built from. */
function hasUsableCounts(output: EvalTriggerOutput): boolean {
  return output.n_passed != null && output.n_total != null && output.n_total > 0;
}

/** Newest-first comparator on the graph write timestamp (missing sorts last). */
function byNewestFirst(a: EvalTriggerOutput, b: EvalTriggerOutput): number {
  const ta = a.date_added_to_graph ? parseFloat(a.date_added_to_graph) : -Infinity;
  const tb = b.date_added_to_graph ? parseFloat(b.date_added_to_graph) : -Infinity;
  return tb - ta;
}

/** How a row's graph output was found — drives how much the caller trusts it. */
export type GraphScoreMatch = {
  output: GraphScoreOutput;
  /**
   * "output-ref"  — exact stored pointer: the node is authoritative for both
   *                 numerator and denominator.
   * "trigger-ref" / "project-id" — derived joins: numerator source only, the
   *                 roster still owns the denominator.
   */
  matchedBy: "output-ref" | "trigger-ref" | "project-id";
};

/**
 * Resolve the graph output for one run row. Returns null when no usable
 * output joins — the caller keeps the row's result-table score.
 *
 * When several outputs join (a trigger re-scored more than once), the newest
 * usable one wins: the graph is append-only, so the latest write is the
 * current score for that attempt.
 */
export function resolveGraphOutputForRun(
  run: {
    evalOutputRef?: string | null;
    evalTriggerRef?: string | null;
    projectId?: number | null;
  },
  outputs: GraphScoreOutput[] | null | undefined,
): GraphScoreMatch | null {
  if (!outputs || outputs.length === 0) return null;

  // 1. Exact pointer — the row names its own output node.
  if (run.evalOutputRef) {
    const matched = outputs.find(
      (o) => o.ref_id === run.evalOutputRef && hasUsableCounts(o),
    );
    if (matched) return { output: matched, matchedBy: "output-ref" };
  }

  // 2. Trigger join — manual runs without a stored pointer.
  if (run.evalTriggerRef) {
    const matched = outputs
      .filter((o) => o.triggerRef === run.evalTriggerRef && hasUsableCounts(o))
      .sort(byNewestFirst);
    if (matched.length > 0) return { output: matched[0], matchedBy: "trigger-ref" };
  }

  // 3. Project-id suffix join — recursion re-runs without a pointer.
  if (run.projectId != null) {
    const suffix = `--${run.projectId}`;
    const matched = outputs
      .filter((o) => typeof o.id === "string" && o.id.endsWith(suffix) && hasUsableCounts(o))
      .sort(byNewestFirst);
    if (matched.length > 0) return { output: matched[0], matchedBy: "project-id" };
  }

  return null;
}
