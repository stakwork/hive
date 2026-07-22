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
  /** n_passed — explicit integer property set by hill-climb workflows */
  n_passed?: number;
  /** n_total — explicit integer property set by hill-climb workflows */
  n_total?: number;
  /** Top-level Unix-epoch timestamp string stamped by jarvis at write time */
  date_added_to_graph?: string;
  /** Node id (e.g. "task_slug-source_run_id" or "task_slug-source_run_id--<rerun_id>") */
  id?: string;
  // ── Hill-climb series fields (set by buildHillClimbSeries) ───────────────
  /** Whether this attempt was accepted; false for rejected/pending */
  accepted?: boolean;
  /** True only for the baseline point */
  isBaseline?: boolean;
  /** Actual n_passed for dot rendering; null = no dot, x-slot is preserved */
  actualPassed?: number | null;
  /** Running best n_passed for the connected line (monotonic non-decreasing) */
  bestPassed?: number;
  /** Display label: "base" for baseline, "r1"/"r2"/… for subsequent attempts */
  label?: string;
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
  /** Top-level Unix-epoch timestamp set by the jarvis generic node writer (outside `properties`) */
  date_added_to_graph?: string;
};

/**
 * Parse n_passed/n_total from judge_notes as a fallback for older hive-written nodes
 * whose properties don't carry these fields.
 * Format: "{n_passed}/{n_total} criteria passed…"
 */
function parseCountsFromJudgeNotes(
  judgeNotes: string | undefined,
): { n_passed: number; n_total: number } | null {
  if (!judgeNotes) return null;
  const match = judgeNotes.match(/^(\d+)\/(\d+)\s+criteria\s+passed/i);
  if (!match) return null;
  const n_passed = parseInt(match[1], 10);
  const n_total = parseInt(match[2], 10);
  if (isNaN(n_passed) || isNaN(n_total)) return null;
  return { n_passed, n_total };
}

/**
 * Normalize a raw Jarvis output node into a typed EvalTriggerOutput.
 * Returns null for nodes that have no ref_id (malformed).
 *
 * n_passed / n_total are read from node.properties first (hill-climb workflow schema);
 * falls back to parsing judge_notes for older nodes written by hive's inline path.
 */
export function normalizeOutput(n: RawJarvisNode): EvalTriggerOutput | null {
  if (!n.ref_id) return null;

  const judgeNotes = n.properties?.judge_notes
    ? String(n.properties.judge_notes)
    : undefined;

  // Prefer explicit integer properties; fall back to judge_notes parse
  let n_passed: number | undefined;
  let n_total: number | undefined;

  if (n.properties?.n_passed != null && n.properties?.n_total != null) {
    n_passed = Number(n.properties.n_passed);
    n_total = Number(n.properties.n_total);
  } else {
    const fromNotes = parseCountsFromJudgeNotes(judgeNotes);
    if (fromNotes) {
      n_passed = fromNotes.n_passed;
      n_total = fromNotes.n_total;
    }
  }

  return {
    ref_id: n.ref_id,
    attempt_number: Number(n.properties?.attempt_number ?? 0),
    result: String(n.properties?.result ?? ""),
    score: Number(n.properties?.score ?? 0),
    judge_notes: judgeNotes,
    n_passed,
    n_total,
    date_added_to_graph: n.date_added_to_graph
      ? String(n.date_added_to_graph)
      : undefined,
    id: n.properties?.id ? String(n.properties.id) : undefined,
  };
}

/**
 * Parse the rerun numeric suffix from an EvalTriggerOutput node id.
 * - Baseline: "task_slug-source_run_id" (no "--" suffix) → returns -1 to sort first
 * - Rerun: "task_slug-source_run_id--<rerun_project_id>" → returns the numeric suffix
 */
function parseIdSuffix(id: string | undefined): number {
  if (!id) return -1;
  const sepIdx = id.lastIndexOf("--");
  if (sepIdx === -1) return -1; // baseline
  const suffix = id.slice(sepIdx + 2);
  const n = parseInt(suffix, 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Sort EvalTriggerOutput nodes chronologically — baseline first, reruns after.
 *
 * Option A (preferred): sort ascending by `date_added_to_graph` when all nodes have it.
 * Option B (fallback): sort by the `--<rerun_project_id>` id suffix (baseline = no suffix → first).
 *
 * NOTE: `attempt_number` is intentionally NOT used — hive's inline write path hardcodes it to 1,
 * making it unreliable as an ordering key.
 */
export function sortAttemptsChronologically(
  outputs: EvalTriggerOutput[],
): EvalTriggerOutput[] {
  if (outputs.length === 0) return [];

  const allHaveTimestamp = outputs.every(
    (o) => o.date_added_to_graph != null && o.date_added_to_graph !== "",
  );

  if (allHaveTimestamp) {
    // Option A: sort by Unix-epoch timestamp string ascending
    return [...outputs].sort((a, b) => {
      const ta = parseFloat(a.date_added_to_graph!);
      const tb = parseFloat(b.date_added_to_graph!);
      return ta - tb;
    });
  }

  // Option B: sort by id suffix (baseline = -1, reruns by numeric suffix)
  console.warn(
    "[sortAttemptsChronologically] Not all outputs have date_added_to_graph; " +
      "falling back to id-suffix ordering.",
  );
  return [...outputs].sort((a, b) => parseIdSuffix(a.id) - parseIdSuffix(b.id));
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
