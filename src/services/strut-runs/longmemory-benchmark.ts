/**
 * LongMemory on strut (`LONGMEMORY_SLUGS`): one question runs as
 * `longmemory-run`, a whole sweep as `longmemory-batch`, both on the
 * workspace's swarm and both tracked as `benchmark:longmemory` StrutRun rows
 * (the generic benchmark kind — dispatch, callback, settle and reconcile are
 * the shared ones; see `legal-benchmark.ts`, which this mirrors).
 *
 * The question list comes from the `longmemory/list-tasks` strut workflow.
 * Only the model's `hypothesis` is ever read back — never an answer key.
 */

import { StrutRunStatus, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { benchmarkKind, getBenchmark, type Benchmark } from "@/lib/benchmarks/registry";
import { RUN_LIST_LIMIT } from "@/lib/harvey-lab/benchmark-summary";
import { STRUT_ACTOR_HEADER } from "@/services/bifrost/strut-delegation";
import { dispatchStrutRun, type DispatchStrutRunResult, type StrutRunRow } from "@/services/strut-runs";
import { hasPendingBenchmarkRun } from "@/services/strut-runs/benchmark";
import { ROW_SELECT, STATUS, hasStrutReport } from "@/services/strut-runs/legal-benchmark";
import { settleFromStrut } from "@/services/strut-runs/openhealth";
import type { StrutTarget } from "@/services/strut-target";
import type {
  LongMemoryMiss,
  LongMemoryQuestion,
  LongMemoryRunResult,
  LongMemoryRunWireRow,
  LongMemoryTaskList,
  LongMemoryTypeAccuracy,
} from "@/types/longmemory";

export const LONGMEMORY_BENCHMARK_SLUG = "longmemory";
export const LONGMEMORY_RUN_WORKFLOW = "longmemory-run";
export const LONGMEMORY_BATCH_WORKFLOW = "longmemory-batch";
export const LONGMEMORY_LIST_TASKS_WORKFLOW = "longmemory/list-tasks";

/** Same models as Legal: reasoning, standard, and Hive's default judge. */
export const LONGMEMORY_MODELS = {
  reasoningModel: "claude-opus-5",
  standardModel: "claude-sonnet-5",
  judgeModel: "claude-sonnet-4-6",
} as const;

export function longMemoryBenchmark(): Benchmark {
  const benchmark = getBenchmark(LONGMEMORY_BENCHMARK_SLUG);
  if (!benchmark) throw new Error("longmemory is not in the benchmark registry");
  return benchmark;
}

/** The launch's strut `params`. */
export function longMemoryParams(): Record<string, unknown> {
  return {
    reasoning_model: LONGMEMORY_MODELS.reasoningModel,
    standard_model: LONGMEMORY_MODELS.standardModel,
    judge_model: LONGMEMORY_MODELS.judgeModel,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

// ─── Results ───────────────────────────────────────────────────────────────

function byTypeOf(value: unknown): Record<string, LongMemoryTypeAccuracy> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, LongMemoryTypeAccuracy> = {};
  for (const [type, v] of Object.entries(value)) {
    if (isRecord(v)) out[type] = { ...(num(v.n) !== undefined ? { n: num(v.n) } : {}), ...(num(v.accuracy) !== undefined ? { accuracy: num(v.accuracy) } : {}) };
    else if (num(v) !== undefined) out[type] = { accuracy: num(v) };
  }
  return out;
}

/** Misses reduced to id, type and cause; whatever else the workflow sent stays server-side. */
function missesOf(value: unknown): LongMemoryMiss[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: LongMemoryMiss[] = [];
  for (const m of value) {
    if (typeof m === "string") out.push({ question_id: m });
    else if (isRecord(m)) {
      const id = str(m.question_id) ?? str(m.id);
      if (!id) continue;
      out.push({
        question_id: id,
        ...(str(m.questionType) ? { questionType: str(m.questionType) } : {}),
        ...(str(m.missCause) ? { missCause: str(m.missCause) } : {}),
      });
    }
  }
  return out;
}

function errorMessageOf(row: Pick<StrutRunRow, "status" | "error">): string | undefined {
  if (row.status === StrutRunStatus.CANCELLED) return row.error ?? "The run was cancelled";
  if (row.status === StrutRunStatus.LOST) return row.error ?? "Strut never reported this run back";
  if (row.status === StrutRunStatus.ERROR) return row.error ?? "The run failed";
  return undefined;
}

/** The row as the page's `LongMemoryRunResult`. */
export function toLongMemoryRunResult(row: StrutRunRow): LongMemoryRunResult {
  const input = isRecord(row.input) ? row.input : {};
  const body = isRecord(row.output) ? (isRecord(row.output.callback) ? row.output.callback : row.output) : {};
  const batch = row.workflow === LONGMEMORY_BATCH_WORKFLOW;
  const errorMessage = errorMessageOf(row);
  const common = {
    workflow: row.workflow,
    ...(row.strutRunId ? { strutRunId: row.strutRunId } : {}),
    ...(errorMessage ? { errorMessage } : {}),
    ...(str(body.judgeModel) ?? str(body.judge_model) ? { judgeModel: str(body.judgeModel) ?? str(body.judge_model) } : {}),
  };
  if (batch) {
    const byType = byTypeOf(body.byType);
    const misses = missesOf(body.misses);
    return {
      mode: "batch",
      ...common,
      ...(num(input.limit) !== undefined ? { limit: num(input.limit) } : {}),
      ...(num(body.n) !== undefined ? { n: num(body.n) } : {}),
      ...(num(body.accuracy) !== undefined ? { accuracy: num(body.accuracy) } : {}),
      ...(byType ? { byType } : {}),
      ...(num(body.abstentionAccuracy) !== undefined ? { abstentionAccuracy: num(body.abstentionAccuracy) } : {}),
      ...(misses ? { misses } : {}),
      ...(num(body.totalCost) !== undefined ? { totalCost: num(body.totalCost) } : {}),
      ...(str(body.summary) ? { summary: str(body.summary) } : {}),
    };
  }
  const questionId = str(body.question_id) ?? str(input.question_id);
  return {
    mode: "single",
    ...common,
    ...(questionId ? { question_id: questionId } : {}),
    ...(str(body.questionType) ? { questionType: str(body.questionType) } : {}),
    ...(typeof body.abstention === "boolean" ? { abstention: body.abstention } : {}),
    ...(num(body.score) !== undefined ? { score: num(body.score) } : {}),
    ...(str(body.metric) ? { metric: str(body.metric) } : {}),
    ...(num(body.officialScore) !== undefined ? { officialScore: num(body.officialScore) } : {}),
    ...(str(body.summary) ? { summary: str(body.summary) } : {}),
    ...(str(body.missCause) ? { missCause: str(body.missCause) } : {}),
    ...(str(body.hypothesis) ? { hypothesis: str(body.hypothesis) } : {}),
  };
}

export function toLongMemoryRunWireRow(row: StrutRunRow): LongMemoryRunWireRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    status: STATUS[row.status],
    result: JSON.stringify(toLongMemoryRunResult(row)),
    hasReport: hasStrutReport(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: (row.settledAt ?? row.createdAt).toISOString(),
  };
}

const select = ROW_SELECT satisfies Prisma.StrutRunSelect;

/** The workspace's runs (single and batch), newest first; a PENDING one is settled from strut when its callback has not landed. */
export async function listLongMemoryRuns(
  workspaceId: string,
  now = new Date(),
): Promise<{ runs: LongMemoryRunWireRow[]; total: number }> {
  const where = { workspaceId, kind: benchmarkKind(LONGMEMORY_BENCHMARK_SLUG) };
  const [rows, total] = await Promise.all([
    db.strutRun.findMany({ where, select, orderBy: { createdAt: "desc" }, take: RUN_LIST_LIMIT }),
    db.strutRun.count({ where }),
  ]);
  const shown = await Promise.all(rows.map((row) => settleFromStrut(row, now)));
  return { runs: shown.map(toLongMemoryRunWireRow), total };
}

export async function findLongMemoryRunRow(workspaceId: string, runId: string): Promise<StrutRunRow | null> {
  return db.strutRun.findFirst({
    where: { id: runId, workspaceId, kind: benchmarkKind(LONGMEMORY_BENCHMARK_SLUG) },
    select,
  });
}

export async function getLongMemoryRun(
  workspaceId: string,
  runId: string,
  now = new Date(),
): Promise<LongMemoryRunWireRow | null> {
  const row = await findLongMemoryRunRow(workspaceId, runId);
  return row ? toLongMemoryRunWireRow(await settleFromStrut(row, now)) : null;
}

// ─── Launch ────────────────────────────────────────────────────────────────

export class LongMemoryRunInProgressError extends Error {
  constructor(what = "question") {
    super(`A run is already in progress for this ${what}`);
  }
}

interface LaunchBase {
  workspaceId: string;
  userId: string;
  publicBaseUrl: string;
}

export interface LaunchLongMemoryRunArgs extends LaunchBase {
  questionId: string;
  /** Optional URL the workflow also posts its result to. */
  webhookUrl?: string;
}

/** Launch `longmemory-run` for one question; one in flight per question. */
export async function launchLongMemoryRun(args: LaunchLongMemoryRunArgs): Promise<DispatchStrutRunResult> {
  const benchmark = longMemoryBenchmark();
  if (await hasPendingBenchmarkRun(args.workspaceId, benchmark, args.questionId)) {
    throw new LongMemoryRunInProgressError();
  }
  return dispatchStrutRun({
    workspaceId: args.workspaceId,
    userId: args.userId,
    kind: benchmarkKind(benchmark.slug),
    workflow: LONGMEMORY_RUN_WORKFLOW,
    purpose: "benchmark",
    input: { question_id: args.questionId, ...(args.webhookUrl ? { webhook_url: args.webhookUrl } : {}) },
    params: longMemoryParams(),
    publicBaseUrl: args.publicBaseUrl,
  });
}

export interface LaunchLongMemoryBatchArgs extends LaunchBase {
  /** Run only this many questions; absent → all. */
  limit?: number;
}

/** Is a `longmemory-batch` still PENDING in the workspace? */
export async function hasPendingLongMemoryBatch(workspaceId: string): Promise<boolean> {
  const row = await db.strutRun.findFirst({
    where: {
      workspaceId,
      kind: benchmarkKind(LONGMEMORY_BENCHMARK_SLUG),
      workflow: LONGMEMORY_BATCH_WORKFLOW,
      status: StrutRunStatus.PENDING,
    },
    select: { id: true },
  });
  return row !== null;
}

/** Launch `longmemory-batch` over all questions (or the first `limit`); one batch in flight. */
export async function launchLongMemoryBatch(args: LaunchLongMemoryBatchArgs): Promise<DispatchStrutRunResult> {
  if (await hasPendingLongMemoryBatch(args.workspaceId)) throw new LongMemoryRunInProgressError("batch");
  return dispatchStrutRun({
    workspaceId: args.workspaceId,
    userId: args.userId,
    kind: benchmarkKind(LONGMEMORY_BENCHMARK_SLUG),
    workflow: LONGMEMORY_BATCH_WORKFLOW,
    purpose: "benchmark",
    input: args.limit !== undefined ? { limit: args.limit } : {},
    params: longMemoryParams(),
    publicBaseUrl: args.publicBaseUrl,
  });
}

// ─── Questions ─────────────────────────────────────────────────────────────

const LOG_TAG = "longmemory-benchmarks";
const REQUEST_TIMEOUT_MS = 10_000;
const SUMMARY_ATTEMPTS = 20;
const SUMMARY_INTERVAL_MS = 500;
const CACHE_TTL_MS = 10 * 60 * 1000;

type CatalogueTarget = Pick<StrutTarget, "swarmId" | "labBase" | "swarmApiKey" | "actor">;

const cache = new Map<string, { list: LongMemoryTaskList; expiresAt: number }>();

/** For tests. */
export function clearLongMemoryTaskCache() {
  cache.clear();
}

/** The workflow's output reduced to id, type and abstention flag. Whatever else a row carries is dropped. */
export function parseLongMemoryTaskList(output: unknown): LongMemoryTaskList | null {
  const rows = Array.isArray(output) ? output : isRecord(output) && Array.isArray(output.tasks) ? output.tasks : null;
  if (!rows) return null;
  const tasks: LongMemoryQuestion[] = [];
  for (const r of rows) {
    if (!isRecord(r)) continue;
    const id = str(r.question_id) ?? str(r.id);
    if (!id) continue;
    tasks.push({
      id,
      type: str(r.questionType) ?? str(r.question_type) ?? str(r.type) ?? "",
      abstention: r.abstention === true || r.is_abstention === true || /_abs$/.test(id),
    });
  }
  return { total: tasks.length, tasks };
}

async function runListTasks(target: CatalogueTarget): Promise<LongMemoryTaskList | null> {
  const headers = {
    "Content-Type": "application/json",
    "x-api-token": target.swarmApiKey,
    [STRUT_ACTOR_HEADER]: target.actor,
  };
  const workflow = `${target.labBase}/workflows/${encodeURIComponent(LONGMEMORY_LIST_TASKS_WORKFLOW)}`;
  const launched = await fetch(`${workflow}/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: {} }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!launched.ok) throw new Error(`launch answered HTTP ${launched.status}`);
  const { runId } = (await launched.json()) as { runId?: unknown };
  if (typeof runId !== "string" || !runId) throw new Error("launch returned no run id");

  for (let attempt = 0; attempt < SUMMARY_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, SUMMARY_INTERVAL_MS));
    const res = await fetch(`${workflow}/runs/${encodeURIComponent(runId)}`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) continue;
    const summary = (await res.json()) as { status?: unknown; partial?: unknown; output?: unknown };
    if (summary.partial === true || summary.status === "running") continue;
    if (summary.status !== "success") throw new Error(`the run ended ${String(summary.status)}`);
    return parseLongMemoryTaskList(summary.output);
  }
  throw new Error("the run did not finish in time");
}

/** The questions strut lists on this swarm (cached briefly); null when the lab could not list them. */
export async function getLongMemoryTasks(target: CatalogueTarget): Promise<LongMemoryTaskList | null> {
  const held = cache.get(target.swarmId);
  if (held && held.expiresAt > Date.now()) return held.list;
  try {
    const list = await runListTasks(target);
    if (list && list.tasks.length > 0) cache.set(target.swarmId, { list, expiresAt: Date.now() + CACHE_TTL_MS });
    return list;
  } catch (err) {
    logger.warn("LongMemory question list unavailable", LOG_TAG, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
