/**
 * Legal Benchmarks on strut (`LEGAL_STRUT_SLUGS`): a Harvey LAB task runs as
 * `harvey-lab-run` on the workspace's swarm, tracked as a `benchmark:harvey-lab`
 * StrutRun row (the generic benchmark kind, so dispatch, callback, settle
 * and reconcile are the shared ones), and read back in the shape the Legal
 * Benchmarks page already renders: `/api/stakwork/runs`' row, with a
 * `BenchmarkRunResult` JSON string in `result`.
 *
 * The workflow writes the task's graph records itself (the EvalSet roster,
 * trigger, output and criterion results); hive writes none. Its output's
 * `callback` is the score body (`criteria_results`, `n_passed`, …) and
 * `final_output` maps each deliverable file name to its path in the run's
 * artifacts.
 */

import { StakworkRunType, StrutRunStatus, WorkflowStatus, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { benchmarkKind, getBenchmark, type Benchmark } from "@/lib/benchmarks/registry";
import { RUN_LIST_LIMIT } from "@/lib/harvey-lab/benchmark-summary";
import type { HarveyTaskInput } from "@/lib/harvey-lab/task-input";
import { dispatchStrutRun, type DispatchStrutRunResult, type StrutRunRow } from "@/services/strut-runs";
import { hasPendingBenchmarkRun } from "@/services/strut-runs/benchmark";
import { settleFromStrut } from "@/services/strut-runs/openhealth";
import type { BenchmarkRunResult } from "@/types/legal";

export const HARVEY_LAB_BENCHMARK_SLUG = "harvey-lab";

export function harveyLabBenchmark(): Benchmark {
  const benchmark = getBenchmark(HARVEY_LAB_BENCHMARK_SLUG);
  if (!benchmark) throw new Error("harvey-lab is not in the benchmark registry");
  return benchmark;
}

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
} satisfies Prisma.StrutRunSelect;

/** A run as `/api/stakwork/runs` lists one — what the legal hooks parse. */
export interface LegalRunWireRow {
  id: string;
  workspaceId: string;
  type: typeof StakworkRunType.LEGAL_BENCHMARK_RUNNER;
  status: WorkflowStatus;
  projectId: null;
  result: string;
  hasReport: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The models a launch may pick (strut `params`); absent ones keep the workflow's defaults. */
export interface LegalRunModels {
  reasoningModel?: string;
  standardModel?: string;
  judgeModel?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Strip the provider: the judge runs on Anthropic's SDK directly, which takes a bare id. */
const bareModel = (model: string) => (model.includes("/") ? model.split("/").slice(1).join("/") : model);

/** The launch's strut `params`: only the models picked. */
export function paramsFor(models: LegalRunModels): Record<string, unknown> {
  return {
    ...(models.reasoningModel ? { reasoning_model: models.reasoningModel } : {}),
    ...(models.standardModel ? { standard_model: models.standardModel } : {}),
    ...(models.judgeModel ? { judge_model: bareModel(models.judgeModel) } : {}),
  };
}

const STATUS: Record<StrutRunStatus, WorkflowStatus> = {
  PENDING: WorkflowStatus.IN_PROGRESS,
  SUCCESS: WorkflowStatus.COMPLETED,
  ERROR: WorkflowStatus.FAILED,
  CANCELLED: WorkflowStatus.FAILED,
  LOST: WorkflowStatus.FAILED,
};

/**
 * A run's report is built from what the run left in its lab (its log and
 * files), so every run that got as far as settling has one: a failed run's
 * report still shows how far it got. A cancelled or lost run, or one strut
 * never started, has none.
 */
export function hasStrutReport(row: Pick<StrutRunRow, "status" | "strutRunId">): boolean {
  return !!row.strutRunId && (row.status === StrutRunStatus.SUCCESS || row.status === StrutRunStatus.ERROR);
}

function errorMessageOf(row: Pick<StrutRunRow, "status" | "error">): string | undefined {
  if (row.status === StrutRunStatus.CANCELLED) return row.error ?? "The run was cancelled";
  if (row.status === StrutRunStatus.LOST) return row.error ?? "Strut never reported this run back";
  if (row.status === StrutRunStatus.ERROR) return row.error ?? "The run failed";
  return undefined;
}

/** Deliverable names the run declared, each with its path under the run's artifacts. */
export function deliverablesOf(row: Pick<StrutRunRow, "output" | "strutRunId">): Map<string, string> {
  const out = new Map<string, string>();
  const finalOutput = isRecord(row.output) && isRecord(row.output.callback) ? row.output.callback.final_output : undefined;
  if (!isRecord(finalOutput) || !row.strutRunId) return out;
  const prefix = `/artifacts/${row.strutRunId}/`;
  for (const [name, path] of Object.entries(finalOutput)) {
    if (typeof path !== "string" || !path.startsWith(prefix)) continue;
    const rel = path.slice(prefix.length);
    // Never leave the run's folder, whatever the output says.
    if (!rel || rel.split("/").some((part) => part === "" || part === "." || part === "..")) continue;
    out.set(name, rel);
  }
  return out;
}

type Criterion = NonNullable<BenchmarkRunResult["criteria_results"]>[number];

function criteriaOf(value: unknown): Criterion[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Criterion[] = [];
  for (const c of value) {
    if (!isRecord(c) || typeof c.id !== "string" || typeof c.verdict !== "string") continue;
    out.push({
      id: c.id,
      title: typeof c.title === "string" ? c.title : c.id,
      verdict: c.verdict,
      reasoning: typeof c.reasoning === "string" ? c.reasoning : "",
      ...(c.flagged !== undefined ? { flagged: c.flagged as Criterion["flagged"] } : {}),
      ...(str(c.llm_flag_reason) ? { llm_flag_reason: c.llm_flag_reason as string } : {}),
      ...(str(c.flag_basis) ? { flag_basis: c.flag_basis as string } : {}),
      ...(c.contested !== undefined ? { contested: c.contested as Criterion["contested"] } : {}),
    });
  }
  return out;
}

/** The row as the legal page's `BenchmarkRunResult`. */
export function toLegalRunResult(row: StrutRunRow): BenchmarkRunResult {
  const input = isRecord(row.input) ? row.input : {};
  const taskSlug = str(input.task_slug) ?? "";
  const body = isRecord(row.output) && isRecord(row.output.callback) ? row.output.callback : {};
  const nPassed = num(body.n_passed);
  const nTotal = num(body.n_total);
  const deliverables = [...deliverablesOf(row).keys()];
  const spreadsheetUrl = str(body.spreadsheet_url);
  const errorMessage = errorMessageOf(row);
  return {
    taskSlug,
    taskTitle: str(input.task_title) ?? taskSlug,
    runner: "strut",
    ...(row.strutRunId ? { strutRunId: row.strutRunId } : {}),
    ...(errorMessage ? { errorMessage } : {}),
    // The Runs tab's Report cell reads this as "a report is on its way".
    ...(row.status === StrutRunStatus.PENDING ? { generateRunReport: true } : {}),
    ...(num(body.score) !== undefined ? { score: num(body.score) } : {}),
    ...(num(body.max_score) !== undefined ? { max_score: num(body.max_score) } : {}),
    ...(nPassed !== undefined ? { n_passed: nPassed } : {}),
    ...(nTotal !== undefined ? { n_total: nTotal } : {}),
    // The workflow sends "32/36"; the page's field is the fraction.
    ...(nPassed !== undefined && nTotal ? { pass_rate: nPassed / nTotal } : {}),
    ...(typeof body.all_pass === "boolean" ? { all_pass: body.all_pass } : {}),
    ...(str(body.model) ? { model: str(body.model) } : {}),
    ...(str(body.judge_model) ? { judge_model: str(body.judge_model) } : {}),
    ...(criteriaOf(body.criteria_results) ? { criteria_results: criteriaOf(body.criteria_results) } : {}),
    ...(deliverables.length ? { deliverables } : {}),
    ...(spreadsheetUrl && /^https:\/\//i.test(spreadsheetUrl) ? { spreadsheetUrl } : {}),
  };
}

export function toLegalRunWireRow(row: StrutRunRow): LegalRunWireRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    type: StakworkRunType.LEGAL_BENCHMARK_RUNNER,
    status: STATUS[row.status],
    projectId: null,
    result: JSON.stringify(toLegalRunResult(row)),
    hasReport: hasStrutReport(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: (row.settledAt ?? row.createdAt).toISOString(),
  };
}

/** The workspace's runs, newest first; a PENDING one is settled from strut when its callback has not landed. */
export async function listLegalStrutRuns(
  workspaceId: string,
  now = new Date(),
): Promise<{ runs: LegalRunWireRow[]; total: number }> {
  const where = { workspaceId, kind: benchmarkKind(HARVEY_LAB_BENCHMARK_SLUG) };
  const [rows, total] = await Promise.all([
    db.strutRun.findMany({ where, select: ROW_SELECT, orderBy: { createdAt: "desc" }, take: RUN_LIST_LIMIT }),
    db.strutRun.count({ where }),
  ]);
  const shown = await Promise.all(rows.map((row) => settleFromStrut(row, now)));
  return { runs: shown.map(toLegalRunWireRow), total };
}

export async function findLegalStrutRunRow(workspaceId: string, runId: string): Promise<StrutRunRow | null> {
  return db.strutRun.findFirst({
    where: { id: runId, workspaceId, kind: benchmarkKind(HARVEY_LAB_BENCHMARK_SLUG) },
    select: ROW_SELECT,
  });
}

export async function getLegalStrutRun(workspaceId: string, runId: string, now = new Date()): Promise<LegalRunWireRow | null> {
  const row = await findLegalStrutRunRow(workspaceId, runId);
  return row ? toLegalRunWireRow(await settleFromStrut(row, now)) : null;
}

export class LegalRunInProgressError extends Error {
  constructor() {
    super("A run is already in progress for this task");
  }
}

export interface LaunchLegalStrutRunArgs {
  workspaceId: string;
  userId: string;
  publicBaseUrl: string;
  input: HarveyTaskInput;
  models?: LegalRunModels;
}

/** Launch `harvey-lab-run` for one task; one in flight per task. */
export async function launchLegalStrutRun(args: LaunchLegalStrutRunArgs): Promise<DispatchStrutRunResult> {
  const benchmark = harveyLabBenchmark();
  if (await hasPendingBenchmarkRun(args.workspaceId, benchmark, args.input.task_slug)) {
    throw new LegalRunInProgressError();
  }
  return dispatchStrutRun({
    workspaceId: args.workspaceId,
    userId: args.userId,
    kind: benchmarkKind(benchmark.slug),
    workflow: benchmark.runWorkflow,
    purpose: "benchmark",
    input: { ...args.input },
    params: paramsFor(args.models ?? {}),
    publicBaseUrl: args.publicBaseUrl,
  });
}
