/**
 * OpenHealth Benchmarks — the `openhealth-run` strut workflow behind
 * `/w/<slug>/openhealth/benchmarks`. One run takes one task (`gtId`, a
 * patient): agents read the chart and write a problem list, which is scored
 * against a hidden answer key.
 *
 * The launch targets the workspace's own swarm (`purpose: "benchmark"`).
 * There is nothing to deliver on completion: the `StrutRun` row IS the
 * result, and the page reads it back through `listOpenHealthRuns` /
 * `getOpenHealthRun`. Both settle a PENDING row from strut's run summary
 * when the `run.end` callback has not landed (a hive the swarm cannot reach),
 * so the page shows the result with or without callbacks. Missing / stale
 * runs are left to the `strut-runs-reconcile` cron, which owns the LOST
 * verdict.
 *
 * A scored run can be improved: `openhealth-improve` reads that run's scoring
 * errors and writes the Concepts that would have prevented them. It is a
 * `StrutRun` of its own kind, tied to the benchmark run by the strut run id
 * in its input, and tracked the same way.
 */

import { StrutRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  OPENHEALTH_IMPROVE_RUN_KIND,
  OPENHEALTH_IMPROVE_WORKFLOW,
  OPENHEALTH_RUN_KIND,
  OPENHEALTH_SPLITS,
  openHealthWorkdir,
  resolveOpenHealthStrutWorkflowName,
} from "@/lib/openhealth-benchmarks/constants";
import { toOpenHealthImprovement } from "@/lib/openhealth-benchmarks/improve";
import { toOpenHealthRun, toOpenHealthRunDetail } from "@/lib/openhealth-benchmarks/runs";
import { cachedDifficultyLookup } from "@/services/openhealth-benchmarks/tasks";
import {
  completeStrutRun,
  dispatchStrutRun,
  probeStrutRun,
  STRUT_RUN_LOG_TAG,
  type DispatchStrutRunResult,
  type StrutRunHandler,
  type StrutRunRow,
} from "@/services/strut-runs";
import type { OpenHealthImprovement, OpenHealthRun, OpenHealthRunDetail } from "@/types/openhealth";

/** How many runs the page lists. */
const LIST_LIMIT = 200;
/** How many improve runs of one benchmark run the viewer is given. */
const IMPROVE_LIST_LIMIT = 10;
/** A PENDING row younger than this is not probed — a run takes minutes. */
const PROBE_MIN_AGE_MS = 60_000;

/** The `StrutRunHandler` for `openhealth_benchmark` and `openhealth_improve`: the row is the delivery. */
export const handleOpenHealthRunSettled: StrutRunHandler = async (row) => {
  logger.info("OpenHealth run settled", STRUT_RUN_LOG_TAG, {
    runId: row.id,
    kind: row.kind,
    workspaceId: row.workspaceId,
    status: row.status,
  });
};

const ROW_SELECT = {
  id: true,
  workspaceId: true,
  swarmId: true,
  userId: true,
  kind: true,
  workflow: true,
  strutRunId: true,
  status: true,
  input: true,
  output: true,
  error: true,
  durationMs: true,
  conversationId: true,
  proposalId: true,
  createdAt: true,
  settledAt: true,
} as const;

/** Settle a PENDING row from strut's summary when the run is over there. Returns the row to show. */
async function settleFromStrut(row: StrutRunRow, now: Date): Promise<StrutRunRow> {
  if (row.status !== StrutRunStatus.PENDING || !row.strutRunId) return row;
  if (now.getTime() - row.createdAt.getTime() < PROBE_MIN_AGE_MS) return row;
  try {
    const probe = await probeStrutRun(row);
    if (probe.kind !== "settled") return row;
    const full = await db.strutRun.findUnique({ where: { id: row.id }, select: { id: true, tokenHash: true } });
    if (!full) return row;
    await completeStrutRun(full, probe.completion);
    return (await db.strutRun.findUnique({ where: { id: row.id }, select: ROW_SELECT })) ?? row;
  } catch (err) {
    logger.warn("OpenHealth run probe failed (showing as pending)", STRUT_RUN_LOG_TAG, {
      runId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return row;
  }
}

/** The workspace's benchmark runs, newest first. */
export async function listOpenHealthRuns(workspaceId: string, opts: { now?: Date } = {}): Promise<OpenHealthRun[]> {
  const now = opts.now ?? new Date();
  const rows = await db.strutRun.findMany({
    where: { workspaceId, kind: OPENHEALTH_RUN_KIND },
    select: ROW_SELECT,
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
  });
  if (rows.length === 0) return [];
  const [shown, difficultyFor] = await Promise.all([
    Promise.all(rows.map((row) => settleFromStrut(row, now))),
    cachedDifficultyLookup(rows[0].swarmId, OPENHEALTH_SPLITS),
  ]);
  return shown.map((row) => toOpenHealthRun(row, difficultyFor));
}

/** One of the workspace's benchmark runs as stored; null when it is not one. */
export async function findOpenHealthRunRow(workspaceId: string, runId: string): Promise<StrutRunRow | null> {
  return db.strutRun.findFirst({
    where: { id: runId, workspaceId, kind: OPENHEALTH_RUN_KIND },
    select: ROW_SELECT,
  });
}

export async function getOpenHealthRun(
  workspaceId: string,
  runId: string,
  opts: { now?: Date } = {},
): Promise<OpenHealthRunDetail | null> {
  const row = await findOpenHealthRunRow(workspaceId, runId);
  if (!row) return null;
  const [shown, difficultyFor] = await Promise.all([
    settleFromStrut(row, opts.now ?? new Date()),
    cachedDifficultyLookup(row.swarmId, OPENHEALTH_SPLITS),
  ]);
  return toOpenHealthRunDetail(shown, difficultyFor);
}

/** Is a run of this task already in flight for the workspace? (One at a time, per task.) */
export async function hasPendingOpenHealthRun(workspaceId: string, gtId: number): Promise<boolean> {
  const row = await db.strutRun.findFirst({
    where: {
      workspaceId,
      kind: OPENHEALTH_RUN_KIND,
      status: StrutRunStatus.PENDING,
      input: { path: ["gtId"], equals: gtId },
    },
    select: { id: true },
  });
  return row !== null;
}

export interface LaunchOpenHealthRunArgs {
  workspaceId: string;
  userId: string;
  /** Swarm-reachable base URL of this hive (the callback host). */
  publicBaseUrl: string;
  /** A `gtId` from the task catalogue — the caller checks it is one. */
  gtId: number;
}

/** Launch one run for one task. Throws `StrutDispatchError` when nothing is running on strut's side. */
export async function launchOpenHealthRun(args: LaunchOpenHealthRunArgs): Promise<DispatchStrutRunResult> {
  return dispatchStrutRun({
    workspaceId: args.workspaceId,
    userId: args.userId,
    kind: OPENHEALTH_RUN_KIND,
    workflow: resolveOpenHealthStrutWorkflowName(),
    purpose: "benchmark",
    input: { gtId: args.gtId, workdir: openHealthWorkdir(args.gtId) },
    publicBaseUrl: args.publicBaseUrl,
  });
}

// ─── Improve ─────────────────────────────────────────────────────────────

/** The improve runs of one benchmark run, by that run's id on strut. */
const improveRunsOf = (workspaceId: string, strutRunId: string) => ({
  workspaceId,
  kind: OPENHEALTH_IMPROVE_RUN_KIND,
  input: { path: ["runIds"], equals: strutRunId },
});

/** The improve runs of one benchmark run, newest first. */
export async function listOpenHealthImprovements(
  workspaceId: string,
  strutRunId: string,
  opts: { now?: Date } = {},
): Promise<OpenHealthImprovement[]> {
  const now = opts.now ?? new Date();
  const rows = await db.strutRun.findMany({
    where: improveRunsOf(workspaceId, strutRunId),
    select: ROW_SELECT,
    orderBy: { createdAt: "desc" },
    take: IMPROVE_LIST_LIMIT,
  });
  const shown = await Promise.all(rows.map((row) => settleFromStrut(row, now)));
  return shown.map(toOpenHealthImprovement);
}

/** Is an improve run of this benchmark run already in flight? (One at a time, per run.) */
export async function hasPendingOpenHealthImprove(workspaceId: string, strutRunId: string): Promise<boolean> {
  const row = await db.strutRun.findFirst({
    where: { ...improveRunsOf(workspaceId, strutRunId), status: StrutRunStatus.PENDING },
    select: { id: true },
  });
  return row !== null;
}

export interface LaunchOpenHealthImproveArgs {
  workspaceId: string;
  userId: string;
  /** Swarm-reachable base URL of this hive (the callback host). */
  publicBaseUrl: string;
  /** The benchmark run's id on strut — the caller checks the run was scored. */
  strutRunId: string;
}

/**
 * Launch one improve run over one benchmark run. `apply` is on: what passes
 * the workflow's validation is written to the graph.
 */
export async function launchOpenHealthImprove(args: LaunchOpenHealthImproveArgs): Promise<DispatchStrutRunResult> {
  return dispatchStrutRun({
    workspaceId: args.workspaceId,
    userId: args.userId,
    kind: OPENHEALTH_IMPROVE_RUN_KIND,
    workflow: OPENHEALTH_IMPROVE_WORKFLOW,
    purpose: "benchmark",
    // `runIds` is the workflow's comma-separated list; this is a list of one.
    input: { runIds: args.strutRunId, apply: true },
    publicBaseUrl: args.publicBaseUrl,
  });
}
