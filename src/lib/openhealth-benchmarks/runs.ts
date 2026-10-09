/**
 * A `StrutRun` row of kind `openhealth_benchmark` → what the page shows, and
 * the metrics over a list of them. Pure.
 *
 * The row stores the workflow's `output` verbatim. Everything here reads it
 * field by field, so an output of another shape (an older workflow version)
 * degrades to nulls instead of throwing. The headline is read two ways: the
 * task-neutral `metric` + `score` the workflow reports since it took on the
 * summarization task, else the diagnosis-only `weighted_problem_list_f1_neutral`
 * every run before that reported.
 */

import type { StrutRunStatus } from "@prisma/client";
import {
  defaultOpenHealthVariant,
  isOpenHealthDifficulty,
  isOpenHealthTask,
  isOpenHealthVariant,
  OPENHEALTH_DEFAULT_TASK,
  OPENHEALTH_DIFFICULTIES,
} from "./constants";
import { contestsOf, rejectedContestsOf } from "./contests";
import type {
  OpenHealthBenchmarkTask,
  OpenHealthClimb,
  OpenHealthDifficulty,
  OpenHealthIngestedSection,
  OpenHealthOutcome,
  OpenHealthRun,
  OpenHealthRunDetail,
  OpenHealthScores,
  OpenHealthTask,
  OpenHealthVariant,
} from "@/types/openhealth";

export interface OpenHealthRunSource {
  id: string;
  strutRunId: string | null;
  status: StrutRunStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  durationMs: number | null;
  createdAt: Date;
  settledAt: Date | null;
}

/** What the catalogue knows of a task that a run's output may not say: its difficulty, benchmark and specialty. */
export type OpenHealthCatalogueEntry = Pick<OpenHealthTask, "difficulty" | "task" | "variant" | "specialty">;

/** A task's catalogue entry by `gtId`; null for a task the catalogue has not been read for. */
export type OpenHealthCatalogueLookup = (gtId: number) => OpenHealthCatalogueEntry | null;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
/** An object's finite numbers, by key; anything else dropped. */
const numbers = (value: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries(record(value)).filter((e): e is [string, number] => num(e[1]) !== null));

// ─── The headline ────────────────────────────────────────────────────────

/** The score a run is judged by, and what it is. */
export interface OpenHealthHeadline {
  metric: string;
  score: number;
  recall: number | null;
  precision: number | null;
}

/**
 * The headline of a run's output (or of the benchmark subflow's, inside a
 * climb): `metric` + `score` when the workflow reports them, else the
 * diagnosis key alone. Recall and precision are the diagnosis numbers, or
 * for a specialty summary the critical-finding recall and 1 − leakage its
 * conditioned F1 is made of; a whole-patient summary, scored by recall
 * alone, has neither beside its score.
 */
export function headlineOf(output: Record<string, unknown>): OpenHealthHeadline | null {
  const score = num(output.score) ?? num(output.weighted_problem_list_f1_neutral);
  if (score === null) return null;
  const metric = str(output.metric) ?? "weighted_problem_list_f1_neutral";
  const metrics = numbers(output.metrics);
  return {
    metric,
    score,
    recall:
      num(output.problem_list_recall) ??
      (metric === "conditioned_f1" ? (metrics.primary_recall_critical ?? null) : null),
    precision:
      num(output.problem_list_precision_neutral) ??
      (metric === "conditioned_f1" && metrics.leakage_rate !== undefined ? 1 - metrics.leakage_rate : null),
  };
}

function scoresOf(output: Record<string, unknown>): OpenHealthScores | null {
  const headline = headlineOf(output);
  if (!headline) return null;
  const found = Array.isArray(output.found) ? strings(output.found) : null;
  const missed = strings(output.missed);
  return {
    f1: headline.score,
    metric: headline.metric,
    official: num(output.scoreOfficial),
    contested: contestsOf(output.contested).length,
    recall: headline.recall,
    precision: headline.precision,
    tier: str(output.tier),
    nMatched: num(output.n_matched) ?? (found ? found.length : null),
    nGt: num(output.n_gt) ?? (found ? found.length + missed.length : null),
    nPred: num(output.n_pred),
  };
}

// ─── The benchmark ───────────────────────────────────────────────────────

export interface OpenHealthRowBenchmark {
  task: OpenHealthBenchmarkTask;
  variant: OpenHealthVariant | null;
  specialty: string | null;
}

/**
 * Which benchmark a row is: what its output says, else what it was launched
 * with, else what the catalogue knows of its task; a row that says nothing
 * (one from before the page had a second benchmark) is a diagnosis.
 */
export function benchmarkOfRow(
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  entry: OpenHealthCatalogueEntry | null,
): OpenHealthRowBenchmark {
  const task = isOpenHealthTask(output.task)
    ? output.task
    : isOpenHealthTask(input.task)
      ? input.task
      : (entry?.task ?? OPENHEALTH_DEFAULT_TASK);
  if (task !== "context_summarization") return { task, variant: null, specialty: null };
  const variant = isOpenHealthVariant(output.variant)
    ? output.variant
    : (entry?.variant ?? defaultOpenHealthVariant(task));
  return {
    task,
    variant,
    specialty: variant === "specialty_conditioned" ? (str(output.specialty) ?? entry?.specialty ?? null) : null,
  };
}

function ingestedOf(output: Record<string, unknown>): OpenHealthIngestedSection[] {
  if (!Array.isArray(output.ingested)) return [];
  return output.ingested.map(record).flatMap((section) => {
    const file = str(section.file);
    if (!file) return [];
    return [
      {
        file,
        needed: typeof section.needed === "boolean" ? section.needed : null,
        cost: num(section.cost),
        steps: num(section.steps),
        error: str(section.error),
      },
    ];
  });
}

/** The produce agent plus every ingested section; planning is not reported by the workflow. */
export function openHealthRunCost(output: Record<string, unknown>): number | null {
  const produce = num(output.produceCost);
  const sections = ingestedOf(output);
  if (produce === null && sections.length === 0) return null;
  return (produce ?? 0) + sections.reduce((sum, s) => sum + (s.cost ?? 0), 0);
}

/**
 * A `SUCCESS` row is a success only when it was scored: older workflow
 * versions reported success with a `gradeError` and a score of 0.
 */
function gradeErrorOf(status: StrutRunStatus, output: Record<string, unknown>): string | null {
  if (status !== "SUCCESS") return null;
  return str(output.gradeError) ?? (scoresOf(output) ? null : "The run finished without a score.");
}

export function outcomeOf(status: StrutRunStatus, output: unknown): OpenHealthOutcome {
  if (status === "PENDING") return "running";
  if (status === "CANCELLED") return "cancelled";
  if (status !== "SUCCESS") return "failed";
  return gradeErrorOf(status, record(output)) ? "failed" : "succeeded";
}

export function toOpenHealthRun(row: OpenHealthRunSource, catalogue?: OpenHealthCatalogueLookup): OpenHealthRun {
  const input = record(row.input);
  const output = record(row.output);
  const outcome = outcomeOf(row.status, output);
  const gtId = num(input.gtId) ?? num(output.gtId);
  const entry = gtId !== null ? (catalogue?.(gtId) ?? null) : null;
  return {
    id: row.id,
    strutRunId: row.strutRunId,
    status: row.status,
    outcome,
    gtId,
    patientId: num(output.patientId),
    difficulty: isOpenHealthDifficulty(output.difficulty) ? output.difficulty : (entry?.difficulty ?? null),
    ...benchmarkOfRow(input, output, entry),
    scores: outcome === "succeeded" ? scoresOf(output) : null,
    costUsd: openHealthRunCost(output),
    durationMs: row.durationMs,
    error: outcome === "failed" ? (row.error ?? gradeErrorOf(row.status, output) ?? "The run did not finish.") : null,
    createdAt: row.createdAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
  };
}

export function toOpenHealthRunDetail(
  row: OpenHealthRunSource,
  catalogue?: OpenHealthCatalogueLookup,
): OpenHealthRunDetail {
  const output = record(row.output);
  const hasOutput = Object.keys(output).length > 0;
  return {
    ...toOpenHealthRun(row, catalogue),
    title: str(output.title),
    namespace: str(output.namespace),
    clinicalQuestion: str(output.clinicalQuestion),
    matched: Array.isArray(output.matched)
      ? output.matched.map(record).flatMap((m) => {
          const pred = str(m.pred);
          const gt = str(m.gt);
          return pred && gt ? [{ pred, gt }] : [];
        })
      : [],
    missed: strings(output.missed),
    extra: strings(output.extra),
    found: strings(output.found),
    summaryWords: num(output.summaryWords),
    criticalCount: num(output.criticalCount),
    metrics: numbers(output.metrics),
    chart: hasOutput
      ? {
          chartChars: num(output.chartChars),
          sectionCount: num(output.sectionCount),
          sectionsIngested: num(output.sectionsIngested),
          sectionsFailed: strings(output.sectionsFailed),
          encounterCount: num(output.encounterCount),
          withheldSections: strings(output.withheldSections),
        }
      : null,
    ingested: ingestedOf(output),
    contested: contestsOf(output.contested),
    contestsRejected: rejectedContestsOf(output.contestsNotAccepted),
    produceCost: num(output.produceCost),
    produceSteps: num(output.produceSteps),
    spreadsheetUrl: /^https:\/\//.test(str(output.spreadsheetUrl) ?? "") ? str(output.spreadsheetUrl) : null,
  };
}

// ─── Metrics ─────────────────────────────────────────────────────────────
//
// Every metric is over ATTEMPTS at a task: the runs of their own, and the
// benchmark runs inside climbs (a climb's improve runs are not attempts).
// The summaries count a climb ONCE, by its final run (`finalAttemptsOf`);
// the per-task stats, the task list and the hill climb see every run.
// `climbs` is optional everywhere, so a caller with runs alone still works.
// The caller filters to one benchmark first when a mean across them would
// mean nothing (the Runs tab does).

/** One attempt at a task: a run of its own, or one benchmark run inside a climb. */
interface Attempt {
  /** Unique across runs and climbs: the run's id, or `<climb id>#<iteration>`. */
  key: string;
  runId: string | null;
  climb: { id: string; iteration: number } | null;
  gtId: number | null;
  difficulty: OpenHealthDifficulty | null;
  benchmark: OpenHealthRowBenchmark;
  outcome: OpenHealthOutcome;
  f1: number | null;
  /** The untouched score, when known; `f1` has the contested items excluded. */
  f1Official: number | null;
  /** How many answer-key items were excluded from `f1` as contested. */
  contested: number;
  recall: number | null;
  precision: number | null;
  createdAt: string;
  /** Order among attempts that share a `createdAt`: a climb's runs share the climb's. */
  seq: number;
}

function attemptsOf(runs: OpenHealthRun[], climbs: OpenHealthClimb[]): Attempt[] {
  const own = runs.map(
    (run): Attempt => ({
      key: run.id,
      runId: run.id,
      climb: null,
      gtId: run.gtId,
      difficulty: run.difficulty,
      benchmark: { task: run.task, variant: run.variant, specialty: run.specialty },
      outcome: run.outcome,
      f1: run.scores?.f1 ?? null,
      f1Official: run.scores?.official ?? null,
      contested: run.scores?.contested ?? 0,
      recall: run.scores?.recall ?? null,
      precision: run.scores?.precision ?? null,
      createdAt: run.createdAt,
      seq: 0,
    }),
  );
  const inside = climbs.flatMap((climb) =>
    climb.steps
      .filter((step) => step.kind === "benchmark")
      .map(
        (step): Attempt => ({
          key: `${climb.id}#${step.iteration}`,
          runId: null,
          climb: { id: climb.id, iteration: step.iteration },
          gtId: climb.gtId,
          difficulty: climb.difficulty,
          benchmark: { task: climb.task, variant: climb.variant, specialty: climb.specialty },
          outcome: step.outcome,
          f1: step.outcome === "succeeded" ? step.f1 : null,
          f1Official: step.outcome === "succeeded" ? step.f1Official : null,
          contested: step.contested.length,
          recall: null,
          precision: null,
          createdAt: step.startedAt ?? climb.createdAt,
          seq: step.iteration,
        }),
      ),
  );
  return [...own, ...inside];
}

/**
 * A climb's one attempt for the summaries: its final benchmark run — the last
 * that finished (succeeded or failed), so a run in flight or cut short by a
 * stop does not hide the result the climb reached; the last run of any kind
 * when none has finished. Null for a climb that has not run yet.
 */
function finalAttemptOf(climb: OpenHealthClimb): Attempt | null {
  const attempts = attemptsOf([], [climb]);
  const finished = attempts.filter((a) => a.outcome === "succeeded" || a.outcome === "failed");
  return (finished.length > 0 ? finished : attempts).reduce<Attempt | null>(
    (last, a) => (last === null || a.seq > last.seq ? a : last),
    null,
  );
}

/** The runs of their own, and each climb once: what the summaries are over. */
function finalAttemptsOf(runs: OpenHealthRun[], climbs: OpenHealthClimb[]): Attempt[] {
  return [...attemptsOf(runs, []), ...climbs.flatMap((climb) => finalAttemptOf(climb) ?? [])];
}

const byAge = (a: Attempt, b: Attempt) => a.createdAt.localeCompare(b.createdAt) || a.seq - b.seq;
/** Newest first, as the lists come. */
const newestFirst = (attempts: Attempt[]) => [...attempts].sort((a, b) => byAge(b, a));

export interface OpenHealthSummary {
  /**
   * Finished attempts: succeeded + failed. Running and cancelled runs are left
   * out, and a climb counts once, by its final run.
   */
  attempts: number;
  succeeded: number;
  /** succeeded / attempts; null with no attempts. */
  successRate: number | null;
  meanF1: number | null;
  meanRecall: number | null;
  meanPrecision: number | null;
  /** Scored attempts whose F1 excludes contested answer-key items — `meanF1` is over adjusted scores. */
  contested: number;
}

function mean(values: Array<number | null | undefined>): number | null {
  const present = values.filter((v): v is number => typeof v === "number");
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : null;
}

function summarize(attempts: Attempt[]): OpenHealthSummary {
  const succeeded = attempts.filter((a) => a.outcome === "succeeded" && a.f1 !== null);
  const finished = succeeded.length + attempts.filter((a) => a.outcome === "failed").length;
  return {
    attempts: finished,
    succeeded: succeeded.length,
    successRate: finished > 0 ? succeeded.length / finished : null,
    meanF1: mean(succeeded.map((a) => a.f1)),
    meanRecall: mean(succeeded.map((a) => a.recall)),
    meanPrecision: mean(succeeded.map((a) => a.precision)),
    contested: succeeded.filter((a) => a.contested > 0).length,
  };
}

/** The summary over runs of their own and each climb's final run. */
export function summarizeOpenHealthRuns(runs: OpenHealthRun[], climbs: OpenHealthClimb[] = []): OpenHealthSummary {
  return summarize(finalAttemptsOf(runs, climbs));
}

/** Per difficulty, the summary over runs of their own and each climb's final run. */
export function summarizeByDifficulty(
  runs: OpenHealthRun[],
  climbs: OpenHealthClimb[] = [],
): Record<OpenHealthDifficulty, OpenHealthSummary> {
  const attempts = finalAttemptsOf(runs, climbs);
  return Object.fromEntries(
    OPENHEALTH_DIFFICULTIES.map((d) => [d, summarize(attempts.filter((a) => a.difficulty === d))]),
  ) as Record<OpenHealthDifficulty, OpenHealthSummary>;
}

export interface OpenHealthTaskStats {
  /** Finished attempts: succeeded + failed. */
  attempts: number;
  succeeded: number;
  bestF1: number | null;
  /** The best attempt's F1 excludes contested answer-key items. */
  bestContested: boolean;
  /** The newest scored attempt's F1. */
  latestF1: number | null;
  /** A run or a climb of the task is in flight. */
  running: boolean;
}

/** Per-task stats, keyed by `gtId`. */
export function openHealthTaskStats(
  runs: OpenHealthRun[],
  climbs: OpenHealthClimb[] = [],
): Map<number, OpenHealthTaskStats> {
  const stats = new Map<number, OpenHealthTaskStats>();
  const statsFor = (gtId: number) => {
    const s = stats.get(gtId) ?? {
      attempts: 0,
      succeeded: 0,
      bestF1: null,
      bestContested: false,
      latestF1: null,
      running: false,
    };
    stats.set(gtId, s);
    return s;
  };
  for (const attempt of newestFirst(attemptsOf(runs, climbs))) {
    if (attempt.gtId === null) continue;
    const s = statsFor(attempt.gtId);
    if (attempt.outcome === "running") s.running = true;
    if (attempt.outcome === "succeeded" || attempt.outcome === "failed") s.attempts++;
    if (attempt.outcome === "succeeded" && attempt.f1 !== null) {
      s.succeeded++;
      if (s.bestF1 === null || attempt.f1 > s.bestF1) {
        s.bestF1 = attempt.f1;
        s.bestContested = attempt.contested > 0;
      }
      if (s.latestF1 === null) s.latestF1 = attempt.f1;
    }
  }
  // A climb that has not started its first run yet is still in flight.
  for (const climb of climbs) {
    if (climb.status === "running" && climb.gtId !== null) statsFor(climb.gtId).running = true;
  }
  return stats;
}

/** One point of the hill climb: a scored attempt, and the best so far up to it. */
export interface OpenHealthClimbPoint {
  /** The attempt's key: the run's id, or `<climb id>#<iteration>`. */
  key: string;
  /** The run of its own, or null for an iteration of a climb. */
  runId: string | null;
  climb: { id: string; iteration: number } | null;
  gtId: number | null;
  f1: number;
  /** The untouched score, when known. */
  f1Official: number | null;
  /** How many answer-key items were excluded from `f1` as contested. */
  contested: number;
  best: number;
  newBest: boolean;
  createdAt: string;
}

/** Scored attempts oldest first, each with the best score so far — for one task's chart. */
export function openHealthClimbSeries(runs: OpenHealthRun[], climbs: OpenHealthClimb[] = []): OpenHealthClimbPoint[] {
  const scored = attemptsOf(runs, climbs)
    .filter((a): a is Attempt & { f1: number } => a.outcome === "succeeded" && a.f1 !== null)
    .sort(byAge);
  let best = -Infinity;
  return scored.map((a) => {
    const newBest = a.f1 > best;
    if (newBest) best = a.f1;
    return {
      key: a.key,
      runId: a.runId,
      climb: a.climb,
      gtId: a.gtId,
      f1: a.f1,
      f1Official: a.f1Official,
      contested: a.contested,
      best,
      newBest,
      createdAt: a.createdAt,
    };
  });
}

export interface OpenHealthRunTask extends OpenHealthRowBenchmark {
  gtId: number;
  difficulty: OpenHealthDifficulty | null;
  /** Attempts at it: runs of its own and a climb's runs. */
  runs: number;
}

/** The tasks that have been attempted, most recently attempted first, with their attempt counts. */
export function openHealthRunTasks(runs: OpenHealthRun[], climbs: OpenHealthClimb[] = []): OpenHealthRunTask[] {
  const tasks = new Map<number, OpenHealthRunTask>();
  for (const attempt of newestFirst(attemptsOf(runs, climbs))) {
    if (attempt.gtId === null) continue;
    const t = tasks.get(attempt.gtId) ?? {
      gtId: attempt.gtId,
      difficulty: null,
      ...attempt.benchmark,
      runs: 0,
    };
    t.difficulty ??= attempt.difficulty;
    t.specialty ??= attempt.benchmark.specialty;
    t.runs++;
    tasks.set(attempt.gtId, t);
  }
  // A climb with no run yet still names its task.
  for (const climb of climbs) {
    if (climb.gtId === null) continue;
    const t = tasks.get(climb.gtId);
    if (t) t.difficulty ??= climb.difficulty;
    else {
      tasks.set(climb.gtId, {
        gtId: climb.gtId,
        difficulty: climb.difficulty,
        task: climb.task,
        variant: climb.variant,
        specialty: climb.specialty,
        runs: 0,
      });
    }
  }
  return [...tasks.values()];
}
