/**
 * Shared normalizer utilities for Jarvis EvalTrigger/EvalTriggerOutput nodes,
 * used by both EvalTriggerList.tsx and useEvalRunHistory.ts.
 */

export interface EvalTriggerOutput {
  ref_id: string;
  attempt_number: number;
  result: string;
  score: number;
  judge_notes?: string;
  /** Explicit n_passed count from node properties (set by eval workflows) */
  n_passed?: number;
  /** Explicit n_total count from node properties (set by eval workflows) */
  n_total?: number;
  /** Top-level Jarvis timestamp (Unix-epoch string) — set outside node_data */
  date_added_to_graph?: string;
  /** Node id from properties — shape: `task_slug-source_run_id` (baseline) or `task_slug-source_run_id--<rerun_project_id>` */
  id?: string;
}

export interface EvalTrigger {
  ref_id: string;
  properties: {
    agent?: string;
    start_point?: string;
    end_point?: string;
    environment?: string;
    run_count?: number;
    change_type?: string;
    desirable_cases?: string[];
    undesirable_cases?: string[];
    [key: string]: unknown;
  };
  outputs?: EvalTriggerOutput[];
}

export type RawJarvisNode = {
  ref_id: string;
  properties?: Record<string, unknown>;
  /** Top-level Jarvis timestamp (Unix-epoch string), set outside node_data by the generic node writer */
  date_added_to_graph?: string;
};

/**
 * Normalize a raw Jarvis output node into a typed EvalTriggerOutput.
 * Returns null for nodes that have no ref_id (malformed).
 */
export function normalizeOutput(n: RawJarvisNode): EvalTriggerOutput | null {
  if (!n.ref_id) return null;
  return {
    ref_id: n.ref_id,
    attempt_number: Number(n.properties?.attempt_number ?? 0),
    result: String(n.properties?.result ?? ""),
    score: Number(n.properties?.score ?? 0),
    judge_notes: n.properties?.judge_notes ? String(n.properties.judge_notes) : undefined,
    n_passed: n.properties?.n_passed !== undefined ? Number(n.properties.n_passed) : undefined,
    n_total: n.properties?.n_total !== undefined ? Number(n.properties.n_total) : undefined,
    date_added_to_graph: n.date_added_to_graph ?? undefined,
    id: n.properties?.id !== undefined ? String(n.properties.id) : undefined,
  };
}

/**
 * Parse the numeric suffix from an EvalTriggerOutput id.
 *
 * Id shapes:
 *   baseline: `task_slug-source_run_id`           → no `--` suffix → 0
 *   rerun:    `task_slug-source_run_id--<project_id>` → numeric suffix
 *
 * Returns 0 for baseline (no `--` suffix), otherwise the numeric rerun project id.
 * Returns Infinity when the suffix is present but not numeric (should not occur).
 */
function parseIdSuffix(id: string | undefined): number {
  if (!id) return 0;
  const idx = id.lastIndexOf("--");
  if (idx === -1) return 0; // baseline
  const suffix = id.slice(idx + 2);
  const num = Number(suffix);
  return isFinite(num) ? num : Infinity;
}

/**
 * Sort EvalTriggerOutput nodes into chronological order so that the baseline
 * attempt is first and later reruns follow in ascending order.
 *
 * Option A (preferred): sort ascending by `date_added_to_graph` (Unix-epoch
 *   string) when all outputs carry it.
 * Option B (fallback): sort by id-suffix parse — no `--` suffix = baseline
 *   first, then ascending numeric rerun project_id.
 *
 * Mutates a shallow copy (does not mutate the input array).
 */
export function sortAttemptsChronologically(outputs: EvalTriggerOutput[]): EvalTriggerOutput[] {
  if (outputs.length <= 1) return outputs.slice();

  const allHaveDates = outputs.every(
    (o) => o.date_added_to_graph !== undefined && o.date_added_to_graph !== "",
  );

  if (allHaveDates) {
    // Option A: sort by Unix-epoch string ascending
    return outputs.slice().sort((a, b) => {
      const ta = Number(a.date_added_to_graph!);
      const tb = Number(b.date_added_to_graph!);
      return ta - tb;
    });
  }

  // Option B: fall back to id-suffix parse
  console.warn(
    "[sortAttemptsChronologically] Not all EvalTriggerOutput nodes carry date_added_to_graph — " +
      "falling back to id-suffix ordering. This may be imprecise.",
  );
  return outputs.slice().sort((a, b) => parseIdSuffix(a.id) - parseIdSuffix(b.id));
}

/**
 * Filter out partial Jarvis trigger nodes that lack agent, start_point, or
 * end_point — these are incomplete/legacy nodes that add phantom rows.
 */
export function triggerHasIdentity(trigger: EvalTrigger): boolean {
  const agent = String(trigger.properties?.agent ?? "").trim();
  const start = String(trigger.properties?.start_point ?? "").trim();
  const end = String(trigger.properties?.end_point ?? "").trim();
  return Boolean(agent || start || end);
}
