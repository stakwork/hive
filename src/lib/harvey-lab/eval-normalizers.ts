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

export type RawJarvisNode = { ref_id: string; properties?: Record<string, unknown> };

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
  };
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
