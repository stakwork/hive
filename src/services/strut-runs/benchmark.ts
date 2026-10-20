/**
 * Generic benchmarks — one `StrutRun` kind (`benchmark:<slug>`) for every
 * entry of `lib/benchmarks/registry`. The row IS the result: `input` is the
 * launched `{ taskId, ...params }` and `output` the workflow's raw output;
 * the slug lives in the kind so runs list per benchmark. Like OpenHealth, a
 * PENDING row is settled from strut's summary when read and the callback
 * has not landed; the reconcile cron owns LOST.
 */

import { StrutRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { benchmarkKind, type Benchmark } from "@/lib/benchmarks/registry";
import { buildExtra, buildLaunchInput, parseHeadline, taskIdKey } from "@/lib/benchmarks/render";
import { dispatchStrutRun, STRUT_RUN_LOG_TAG, type StrutRunHandler, type StrutRunRow } from "@/services/strut-runs";
import { settleFromStrut } from "@/services/strut-runs/openhealth";
import type { BenchmarkRun, BenchmarkTask, BenchmarkRunDetail, BenchmarkRunStatus } from "@/types/benchmarks";

const LIST_LIMIT = 200;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const handleBenchmarkRunSettled: StrutRunHandler = async (row) => {
  logger.info("Benchmark run settled", STRUT_RUN_LOG_TAG, {
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
  jobId: true,
  createdAt: true,
  settledAt: true,
} as const;

export function toBenchmarkRun(row: StrutRunRow, benchmark: Pick<Benchmark, "input">): BenchmarkRun {
  const input = isRecord(row.input) ? row.input : {};
  const { score, metric, officialScore } = parseHeadline(row.output);
  const raw = input[taskIdKey(benchmark)];
  const taskId = typeof raw === "string" || typeof raw === "number" ? raw : null;
  return {
    id: row.id,
    status: row.status as BenchmarkRunStatus,
    taskId,
    score,
    metric,
    officialScore,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    settledAt: row.settledAt ? row.settledAt.toISOString() : null,
  };
}

export function toBenchmarkRunDetail(row: StrutRunRow, benchmark: Benchmark): BenchmarkRunDetail {
  const { [taskIdKey(benchmark)]: _taskId, ...params } = isRecord(row.input) ? row.input : ({} as Record<string, unknown>);
  return {
    ...toBenchmarkRun(row, benchmark),
    ...parseHeadline(row.output),
    params: Object.keys(params).length ? params : null,
    extra: buildExtra(row.output, benchmark.denyKeys),
  };
}

export async function listBenchmarkRuns(workspaceId: string, benchmark: Benchmark, now = new Date()): Promise<BenchmarkRun[]> {
  const rows = await db.strutRun.findMany({
    where: { workspaceId, kind: benchmarkKind(benchmark.slug) },
    select: ROW_SELECT,
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
  });
  const shown = await Promise.all(rows.map((row) => settleFromStrut(row, now)));
  return shown.map((row) => toBenchmarkRun(row, benchmark));
}

export async function getBenchmarkRun(
  workspaceId: string,
  benchmark: Benchmark,
  runId: string,
  now = new Date(),
): Promise<BenchmarkRunDetail | null> {
  const row = await db.strutRun.findFirst({
    where: { id: runId, workspaceId, kind: benchmarkKind(benchmark.slug) },
    select: ROW_SELECT,
  });
  if (!row) return null;
  return toBenchmarkRunDetail(await settleFromStrut(row, now), benchmark);
}

export async function hasPendingBenchmarkRun(workspaceId: string, benchmark: Benchmark, taskId: string | number): Promise<boolean> {
  const row = await db.strutRun.findFirst({
    where: {
      workspaceId,
      kind: benchmarkKind(benchmark.slug),
      status: StrutRunStatus.PENDING,
      input: { path: [taskIdKey(benchmark)], equals: taskId },
    },
    select: { id: true },
  });
  return row !== null;
}

export interface LaunchBenchmarkRunArgs {
  workspaceId: string;
  userId: string;
  publicBaseUrl: string;
  benchmark: Benchmark;
  taskId?: string | number;
  /** The task as the list workflow returned it (required when `benchmark.input.fromTask` is set). */
  task?: BenchmarkTask | null;
  params?: Record<string, unknown>;
}

/** Launch `benchmark.runWorkflow` with `{ taskId, ...params }`. */
export async function launchBenchmarkRun(args: LaunchBenchmarkRunArgs) {
  const { benchmark, taskId, params } = args;
  return dispatchStrutRun({
    workspaceId: args.workspaceId,
    userId: args.userId,
    kind: benchmarkKind(benchmark.slug),
    workflow: benchmark.runWorkflow,
    purpose: "benchmark",
    input: buildLaunchInput(benchmark, taskId, args.task ?? null, params),
    publicBaseUrl: args.publicBaseUrl,
  });
}
