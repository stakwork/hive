/**
 * A `StrutRun` row of kind `openhealth_benchmark` → what the page shows, and
 * the metrics over a list of them. Pure.
 *
 * The row stores the workflow's `output` verbatim. Everything here reads it
 * field by field, so an output of another shape (an older workflow version)
 * degrades to nulls instead of throwing.
 */

import type { StrutRunStatus } from "@prisma/client";
import { isOpenHealthDifficulty, OPENHEALTH_DIFFICULTIES } from "./constants";
import type {
  OpenHealthClimb,
  OpenHealthDifficulty,
  OpenHealthIngestedSection,
  OpenHealthOutcome,
  OpenHealthRun,
  OpenHealthRunDetail,
  OpenHealthScores,
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

/** Difficulty of a task the run's output does not name (a failed run has no output). */
export type DifficultyLookup = (gtId: number) => OpenHealthDifficulty | null;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

function scoresOf(output: Record<string, unknown>): OpenHealthScores | null {
  const f1 = num(output.weighted_problem_list_f1_neutral);
  if (f1 === null) return null;
  return {
    f1,
    recall: num(output.problem_list_recall),
    precision: num(output.problem_list_precision_neutral),
    tier: str(output.tier),
    nMatched: num(output.n_matched),
    nGt: num(output.n_gt),
    nPred: num(output.n_pred),
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

export function toOpenHealthRun(row: OpenHealthRunSource, difficultyFor?: DifficultyLookup): OpenHealthRun {
  const input = record(row.input);
  const output = record(row.output);
  const outcome = outcomeOf(row.status, output);
  const gtId = num(input.gtId) ?? num(output.gtId);
  return {
    id: row.id,
    strutRunId: row.strutRunId,
    status: row.status,
    outcome,
    gtId,
    patientId: num(output.patientId),
    difficulty: isOpenHealthDifficulty(output.difficulty)
      ? output.difficulty
      : gtId !== null
        ? (difficultyFor?.(gtId) ?? null)
        : null,
    scores: outcome === "succeeded" ? scoresOf(output) : null,
    costUsd: openHealthRunCost(output),
    durationMs: row.durationMs,
    error: outcome === "failed" ? (row.error ?? gradeErrorOf(row.status, output) ?? "The run did not finish.") : null,
    createdAt: row.createdAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
  };
}

export function toOpenHealthRunDetail(row: OpenHealthRunSource, difficultyFor?: DifficultyLookup): OpenHealthRunDetail {
  const output = record(row.output);
  const hasOutput = Object.keys(output).length > 0;
  return {
    ...toOpenHealthRun(row, difficultyFor),
    title: str(output.title),
    namespace: str(output.namespace),
    matched: Array.isArray(output.matched)
      ? output.matched.map(record).flatMap((m) => {
          const pred = str(m.pred);
          const gt = str(m.gt);
          return pred && gt ? [{ pred, gt }] : [];
        })
      : [],
    missed: strings(output.missed),
    extra: strings(output.extra),
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
    produceCost: num(output.produceCost),
    produceSteps: num(output.produceSteps),
    spreadsheetUrl: /^https:\/\//.test(str(output.spreadsheetUrl) ?? "") ? str(output.spreadsheetUrl) : null,
  };
}

// ─── Metrics ─────────────────────────────────────────────────────────────
//
// Every metric is over ATTEMPTS at a task: the runs of their own, and the
// benchmark runs inside climbs (a climb's improve runs are not attempts).
// `climbs` is optional everywhere, so a caller with runs alone still works.

/** One attempt at a task: a run of its own, or one benchmark run inside a climb. */
interface Attempt {
  /** Unique across runs and climbs: the run's id, or `<climb id>#<iteration>`. */
  key: string;
  runId: string | null;
  climb: { id: string; iteration: number } | null;
  gtId: number | null;
  difficulty: OpenHealthDifficulty | null;
  outcome: OpenHealthOutcome;
  f1: number | null;
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
      outcome: run.outcome,
      f1: run.scores?.f1 ?? null,
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
          outcome: step.outcome,
          f1: step.outcome === "succeeded" ? step.f1 : null,
          recall: null,
          precision: null,
          createdAt: step.startedAt ?? climb.createdAt,
          seq: step.iteration,
        }),
      ),
  );
  return [...own, ...inside];
}

const byAge = (a: Attempt, b: Attempt) => a.createdAt.localeCompare(b.createdAt) || a.seq - b.seq;
/** Newest first, as the lists come. */
const newestFirst = (attempts: Attempt[]) => [...attempts].sort((a, b) => byAge(b, a));

export interface OpenHealthSummary {
  /** Finished attempts: succeeded + failed. Running and cancelled runs are left out. */
  attempts: number;
  succeeded: number;
  /** succeeded / attempts; null with no attempts. */
  successRate: number | null;
  meanF1: number | null;
  meanRecall: number | null;
  meanPrecision: number | null;
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
  };
}

export function summarizeOpenHealthRuns(runs: OpenHealthRun[], climbs: OpenHealthClimb[] = []): OpenHealthSummary {
  return summarize(attemptsOf(runs, climbs));
}

export function summarizeByDifficulty(
  runs: OpenHealthRun[],
  climbs: OpenHealthClimb[] = [],
): Record<OpenHealthDifficulty, OpenHealthSummary> {
  const attempts = attemptsOf(runs, climbs);
  return Object.fromEntries(
    OPENHEALTH_DIFFICULTIES.map((d) => [d, summarize(attempts.filter((a) => a.difficulty === d))]),
  ) as Record<OpenHealthDifficulty, OpenHealthSummary>;
}

export interface OpenHealthTaskStats {
  /** Finished attempts: succeeded + failed. */
  attempts: number;
  succeeded: number;
  bestF1: number | null;
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
    const s = stats.get(gtId) ?? { attempts: 0, succeeded: 0, bestF1: null, latestF1: null, running: false };
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
      s.bestF1 = s.bestF1 === null ? attempt.f1 : Math.max(s.bestF1, attempt.f1);
      if (s.latestF1 === null) s.latestF1 = attempt.f1;
    }
  }
  // A climb that has not started its first run yet is still in flight.
  for (const climb of climbs) {
    if (climb.status === "running" && climb.gtId !== null) statsFor(climb.gtId).running = true;
  }
  return stats;
}

// ─── Hill climb ──────────────────────────────────────────────────────────

export interface OpenHealthClimbPoint {
  /** Unique across runs and climbs. */
  key: string;
  /** A run of its own. */
  runId: string | null;
  /** One benchmark run inside a climb. */
  climb: { id: string; iteration: number } | null;
  createdAt: string;
  gtId: number | null;
  f1: number;
  /** The best F1 so far, as of this attempt — the line's level. */
  best: number;
  /** Did this attempt raise the best so far? */
  newBest: boolean;
}

/**
 * One task's scored attempts oldest first, with the best F1 so far — the
 * hill climb. Across tasks a best-so-far would only track the easiest one,
 * so the page draws this for a single task.
 */
export function openHealthClimbSeries(runs: OpenHealthRun[], climbs: OpenHealthClimb[] = []): OpenHealthClimbPoint[] {
  const scored = attemptsOf(runs, climbs)
    .filter((a): a is Attempt & { f1: number } => a.outcome === "succeeded" && a.f1 !== null)
    .sort(byAge);
  let best = -Infinity;
  return scored.map((attempt) => {
    const newBest = attempt.f1 > best;
    best = Math.max(best, attempt.f1);
    return {
      key: attempt.key,
      runId: attempt.runId,
      climb: attempt.climb,
      createdAt: attempt.createdAt,
      gtId: attempt.gtId,
      f1: attempt.f1,
      best,
      newBest,
    };
  });
}

/** The tasks the runs and climbs cover, most recently tried first, with how many attempts each has. */
export function openHealthRunTasks(
  runs: OpenHealthRun[],
  climbs: OpenHealthClimb[] = [],
): Array<{ gtId: number; difficulty: OpenHealthDifficulty | null; runs: number }> {
  const tasks = new Map<number, { gtId: number; difficulty: OpenHealthDifficulty | null; runs: number }>();
  const taskFor = (gtId: number, difficulty: OpenHealthDifficulty | null) => {
    const task = tasks.get(gtId) ?? { gtId, difficulty, runs: 0 };
    task.difficulty ??= difficulty;
    tasks.set(gtId, task);
    return task;
  };
  for (const attempt of newestFirst(attemptsOf(runs, climbs))) {
    if (attempt.gtId !== null) taskFor(attempt.gtId, attempt.difficulty).runs++;
  }
  // A climb with no run yet still names its task.
  for (const climb of climbs) {
    if (climb.gtId !== null) taskFor(climb.gtId, climb.difficulty);
  }
  return [...tasks.values()];
}
