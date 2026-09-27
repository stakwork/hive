/**
 * Shared constants for the OpenHealth Benchmarks feature.
 *
 * Kept in one place so the task-list route, the start route, the runs
 * projection, and the webhook branch all agree on the same allowlists —
 * drift between them is exactly how a gold-shaped key would leak.
 */

/** The four task names the OpenHealth strut runner already loads. */
export const OPENHEALTH_TASK_NAMES = [
  "patient_diagnosis",
  "context_summarization",
  "evidence_retrieval",
  "imaging_indication",
] as const;
export type OpenHealthTaskName = (typeof OPENHEALTH_TASK_NAMES)[number];

export function isOpenHealthTaskName(value: unknown): value is OpenHealthTaskName {
  return (
    typeof value === "string" &&
    (OPENHEALTH_TASK_NAMES as readonly string[]).includes(value)
  );
}

/**
 * Allowed dataset splits for BOTH the task-list route and the start route.
 * "train" (800 patients) is deliberately excluded — it is not a control and
 * must never load on first paint or be dispatchable.
 */
export const OPENHEALTH_SPLITS = ["public", "heldout"] as const;
export type OpenHealthSplit = (typeof OPENHEALTH_SPLITS)[number];

export function isOpenHealthSplit(value: unknown): value is OpenHealthSplit {
  return (
    typeof value === "string" &&
    (OPENHEALTH_SPLITS as readonly string[]).includes(value)
  );
}

export const OPENHEALTH_DEFAULT_SPLIT: OpenHealthSplit = "public";

/** Workflow name format — same shape as LEGAL_STRUT_WORKFLOW_NAME_RE. */
export const OPENHEALTH_STRUT_WORKFLOW_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const OPENHEALTH_DEFAULT_STRUT_WORKFLOW_NAME = "openhealth-run";

export function resolveOpenHealthStrutWorkflowName(): string {
  const raw = process.env.OPENHEALTH_STRUT_WORKFLOW_NAME;
  return raw && raw.trim().length > 0 ? raw : OPENHEALTH_DEFAULT_STRUT_WORKFLOW_NAME;
}

/**
 * Keys that indicate a gold-shaped payload. Reject any request/webhook body
 * carrying one of these, even if the rest of the shape is otherwise valid.
 */
export const OPENHEALTH_GOLD_KEYS = [
  "ground_truth",
  "groundTruth",
  "gold",
  "problemList",
] as const;

export function bodyHasGoldKey(body: Record<string, unknown>): string | null {
  for (const key of OPENHEALTH_GOLD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) return key;
  }
  return null;
}

/** Response allowlist for GET .../openhealth/benchmarks/tasks rows. */
export const OPENHEALTH_TASK_LIST_ALLOWLIST = [
  "gt_id",
  "task",
  "granularity",
  "split",
  "patient_id",
  "encounter_id",
  "difficulty",
  "variant",
  "clinical_question",
  "specialty",
] as const;

export function projectOpenHealthInstanceSummary(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const key of OPENHEALTH_TASK_LIST_ALLOWLIST) {
    projected[key] = key in row ? row[key] ?? null : null;
  }
  return projected;
}

/** 30-minute staleness threshold for active runs (mirrors legal benchmarks). */
export const OPENHEALTH_STALE_RUN_THRESHOLD_MS = 30 * 60 * 1000;

/** Bound on how many candidate active-run rows we scan per dispatch. */
export const OPENHEALTH_ACTIVE_RUN_SCAN_LIMIT = 25;

/**
 * Allowlist merged into `result` on the thin webhook leg
 * (processStakworkRunWebhook, before the shared updateMany). Everything else
 * — including problemList, ground_truth, groundTruth, gold, matched, and
 * report_url — is dropped.
 */
export const OPENHEALTH_WEBHOOK_ALLOWLIST = [
  "task",
  "gtId",
  "weighted_problem_list_f1_neutral",
  "gradeError",
] as const;

export function projectOpenHealthWebhookFields(
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const key of OPENHEALTH_WEBHOOK_ALLOWLIST) {
    if (key in incoming) projected[key] = incoming[key];
  }
  return projected;
}

/**
 * Allowlist copied from a terminal strut probe output into `result` by the
 * poll-on-read path (GET /api/stakwork/runs). `missed` and `extra` are kept
 * ONLY long enough to compute counts — the runs response projects them down
 * to `missedCount` / `extraCount` and must never return the raw arrays.
 */
export const OPENHEALTH_PROBE_OUTPUT_ALLOWLIST = [
  "task",
  "split",
  "gtId",
  "patientId",
  "difficulty",
  "title",
  "namespace",
  "weighted_problem_list_f1_neutral",
  "problem_list_recall",
  "problem_list_precision_neutral",
  "n_matched",
  "n_gt",
  "missed",
  "extra",
  "tier",
  "gradeError",
  "produceError",
  "evalset_ref",
] as const;

export function projectOpenHealthProbeOutput(
  output: Record<string, unknown>,
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const key of OPENHEALTH_PROBE_OUTPUT_ALLOWLIST) {
    if (key in output) projected[key] = output[key];
  }
  return projected;
}

/**
 * Fields the runs list (GET /api/stakwork/runs) may return for
 * OPENHEALTH_BENCHMARK_RUNNER rows. `missed` / `extra` raw arrays are
 * deliberately excluded — only their counts (`missedCount`/`extraCount`,
 * computed by the caller) may reach the client.
 */
export const OPENHEALTH_RUN_RESPONSE_ALLOWLIST = [
  "runner",
  "task",
  "split",
  "gtId",
  "patientId",
  "difficulty",
  "title",
  "namespace",
  "weighted_problem_list_f1_neutral",
  "problem_list_recall",
  "problem_list_precision_neutral",
  "n_matched",
  "n_gt",
  "tier",
  "gradeError",
  "produceError",
  "evalset_ref",
  "scoreError",
  "dispatchError",
  "strutRunId",
] as const;

export function projectOpenHealthRunResponse(
  result: Record<string, unknown>,
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const key of OPENHEALTH_RUN_RESPONSE_ALLOWLIST) {
    if (key in result) projected[key] = result[key];
  }
  const missed = result.missed;
  const extra = result.extra;
  projected.missedCount = Array.isArray(missed) ? missed.length : null;
  projected.extraCount = Array.isArray(extra) ? extra.length : null;
  return projected;
}
