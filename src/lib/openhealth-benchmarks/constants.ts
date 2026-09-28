/**
 * Shared constants for the OpenHealth Benchmarks feature.
 *
 * This file is deliberately narrow now that the feature reads/writes
 * exclusively through the `openhealth-run` / `openhealth-list-tasks` strut
 * (see `strut-client.ts` and `run-summary.ts`). The webhook, probe,
 * response, and task-list allowlists that used to live here belonged to the
 * retired `StakworkRun`-backed path (thin webhook + poll-on-read) and are
 * gone — projection is now `projectRunSummary` / `projectTaskRow` in
 * `run-summary.ts`, driven by the field names pinned in `contract.ts`.
 */

/**
 * Allowed dataset splits for BOTH the task-list route and the run route.
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

/** Fixed workflow name for the read-only task-list workflow. No env override. */
export const OPENHEALTH_LIST_TASKS_WORKFLOW = "openhealth-list-tasks";

/** Every GET route: 60/min per user, fail-closed. */
export const OPENHEALTH_READ_RATE_LIMIT = { limit: 60, windowSecs: 60 } as const;

/** `run` POST: 10/min per user, fail-closed. */
export const OPENHEALTH_RUN_RATE_LIMIT = { limit: 10, windowSecs: 60 } as const;

/** `tasks` POST (refresh dispatch): 10/min per user, fail-closed. */
export const OPENHEALTH_TASKS_DISPATCH_RATE_LIMIT = { limit: 10, windowSecs: 60 } as const;

/**
 * Keys that indicate a gold-shaped payload. Reject any request body
 * carrying one of these, even if the rest of the shape is otherwise valid —
 * checked recursively by `bodyHasGoldKey` so a nested `{ input: { gold } }`
 * is caught too.
 */
export const OPENHEALTH_GOLD_KEYS = [
  "ground_truth",
  "groundTruth",
  "gold",
  "problemList",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively scans `body` (including nested objects and array elements)
 * for a gold-shaped key. Returns the first key name found, else `null`.
 */
export function bodyHasGoldKey(body: unknown, _depth = 0): string | null {
  if (_depth > 10) return null; // guard against pathological nesting
  if (Array.isArray(body)) {
    for (const item of body) {
      const found = bodyHasGoldKey(item, _depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isPlainObject(body)) return null;
  for (const key of OPENHEALTH_GOLD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) return key;
  }
  for (const value of Object.values(body)) {
    const found = bodyHasGoldKey(value, _depth + 1);
    if (found) return found;
  }
  return null;
}
