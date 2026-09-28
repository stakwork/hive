/**
 * The task-list "cache" the `run` route validates against and the `tasks`
 * GET route serves: the newest `success` `openhealth-list-tasks` run for a
 * split, with **no** `input.difficulty` (a difficulty-filtered refresh must
 * never become the split cache — `resolveCachedTaskList` skips it).
 *
 * Shared by `tasks/route.ts` (GET) and `run/route.ts` (POST, step 5: gtId
 * must be in a cached public/heldout list) so the two routes can never
 * disagree about what "cached" means.
 */
import type { StrutTarget } from "@/services/strut-target";
import { listWorkflowRuns, fetchRunDetailForWorkflow, OPENHEALTH_WORKFLOWS } from "./strut-client";
import { OPENHEALTH_LIST_TASKS_OUTPUT_FIELD, type OpenHealthRawTaskRow } from "./contract";
import { projectTaskRow, type OpenHealthTaskRow } from "./run-summary";
import type { OpenHealthSplit } from "./constants";

const LIVE_STATUSES = new Set(["running", "pausing", "paused", "cancelling"]);
/** Bound on how many in-flight/undetailed rows we probe per call. */
const DETAIL_FETCH_LIMIT = 25;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strut run ids are millisecond timestamps — numeric sort is newest-first. */
function numericRunId(id: string): number {
  const n = Number(id);
  return Number.isFinite(n) ? n : 0;
}

export interface CachedTaskListResult {
  tasks: OpenHealthTaskRow[];
  /** Unprojected rows, aligned 1:1 with `tasks` — carries the NATIVE gtId type. */
  rawTasks: OpenHealthRawTaskRow[];
  sourceRunId: string | null;
  fetchedAt: string;
  refreshing: boolean;
}

const EMPTY_RESULT = (): CachedTaskListResult => ({
  tasks: [],
  rawTasks: [],
  sourceRunId: null,
  fetchedAt: new Date().toISOString(),
  refreshing: false,
});

/**
 * Resolve the cached task list for one split. Scans the (unpaged)
 * `openhealth-list-tasks` run history — accepted cost, since that history
 * only grows on a manual refresh.
 */
export async function resolveCachedTaskList(
  target: StrutTarget,
  split: OpenHealthSplit,
): Promise<CachedTaskListResult> {
  const listed = await listWorkflowRuns(target, OPENHEALTH_WORKFLOWS.listTasks);
  if (!listed.ok) return EMPTY_RESULT();

  const rows = [...listed.runs].sort((a, b) => numericRunId(b.runId) - numericRunId(a.runId));

  // Bounded-concurrency detail fetch for rows that arrived without `input`
  // (in-flight / stale entries the list endpoint shapes minimally).
  const needDetail = rows.filter((r) => !isRecord(r.input)).slice(0, DETAIL_FETCH_LIMIT);
  const detailByRunId = new Map<string, Record<string, unknown> | null>();
  await Promise.all(
    needDetail.map(async (r) => {
      detailByRunId.set(r.runId, await fetchRunDetailForWorkflow(target, OPENHEALTH_WORKFLOWS.listTasks, r.runId));
    }),
  );

  let refreshing = false;
  let sourceRunId: string | null = null;
  let rawTasks: OpenHealthRawTaskRow[] = [];

  for (const row of rows) {
    const status = typeof row.status === "string" ? row.status : undefined;
    const detail = isRecord(row.input) ? null : (detailByRunId.get(row.runId) ?? null);
    const input = isRecord(row.input) ? row.input : detail && isRecord(detail.input) ? detail.input : undefined;
    const rowSplit = input?.split;
    const hasDifficulty = !!input && Object.prototype.hasOwnProperty.call(input, "difficulty") && input.difficulty != null;

    if (!refreshing && rowSplit === split && (status === undefined || LIVE_STATUSES.has(status))) {
      refreshing = true;
    }

    if (sourceRunId === null && status === "success" && rowSplit === split && !hasDifficulty) {
      const full = detail ?? (await fetchRunDetailForWorkflow(target, OPENHEALTH_WORKFLOWS.listTasks, row.runId));
      const output = full && isRecord(full.output) ? full.output : {};
      const list = Array.isArray(output[OPENHEALTH_LIST_TASKS_OUTPUT_FIELD])
        ? (output[OPENHEALTH_LIST_TASKS_OUTPUT_FIELD] as unknown[])
        : [];
      rawTasks = list.filter(isRecord) as OpenHealthRawTaskRow[];
      sourceRunId = row.runId;
    }
  }

  const tasks: OpenHealthTaskRow[] = [];
  const alignedRaw: OpenHealthRawTaskRow[] = [];
  for (const raw of rawTasks) {
    const projected = projectTaskRow(raw);
    if (projected) {
      tasks.push(projected);
      alignedRaw.push(raw);
    }
  }

  return { tasks, rawTasks: alignedRaw, sourceRunId, fetchedAt: new Date().toISOString(), refreshing };
}

export interface CachedTaskMatch {
  row: OpenHealthTaskRow;
  /** The gtId exactly as it appears on the cached task row — string or number. */
  nativeGtId: string | number;
  split: OpenHealthSplit;
}

/** Look up `gtId` (already normalized to a string) across BOTH splits' caches. */
export async function findCachedTaskRow(target: StrutTarget, gtId: string): Promise<CachedTaskMatch | null> {
  for (const split of ["public", "heldout"] as const) {
    const result = await resolveCachedTaskList(target, split);
    const idx = result.tasks.findIndex((t) => t.gtId === gtId);
    if (idx !== -1) {
      const raw = result.rawTasks[idx];
      const nativeGtId = raw.gtId ?? raw.gt_id ?? gtId;
      return { row: result.tasks[idx], nativeGtId, split };
    }
  }
  return null;
}
