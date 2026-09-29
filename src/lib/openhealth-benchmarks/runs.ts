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
function costOf(output: Record<string, unknown>): number | null {
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
    costUsd: costOf(output),
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

export function summarizeOpenHealthRuns(runs: OpenHealthRun[]): OpenHealthSummary {
  const succeeded = runs.filter((r) => r.outcome === "succeeded");
  const attempts = succeeded.length + runs.filter((r) => r.outcome === "failed").length;
  return {
    attempts,
    succeeded: succeeded.length,
    successRate: attempts > 0 ? succeeded.length / attempts : null,
    meanF1: mean(succeeded.map((r) => r.scores?.f1)),
    meanRecall: mean(succeeded.map((r) => r.scores?.recall)),
    meanPrecision: mean(succeeded.map((r) => r.scores?.precision)),
  };
}

export function summarizeByDifficulty(runs: OpenHealthRun[]): Record<OpenHealthDifficulty, OpenHealthSummary> {
  return Object.fromEntries(
    OPENHEALTH_DIFFICULTIES.map((d) => [d, summarizeOpenHealthRuns(runs.filter((r) => r.difficulty === d))]),
  ) as Record<OpenHealthDifficulty, OpenHealthSummary>;
}

export interface OpenHealthTaskStats {
  /** Finished attempts: succeeded + failed. */
  attempts: number;
  succeeded: number;
  bestF1: number | null;
  /** The newest scored run's F1. */
  latestF1: number | null;
  running: boolean;
}

/** Per-task stats, keyed by `gtId`. `runs` newest first, as the list returns them. */
export function openHealthTaskStats(runs: OpenHealthRun[]): Map<number, OpenHealthTaskStats> {
  const stats = new Map<number, OpenHealthTaskStats>();
  for (const run of runs) {
    if (run.gtId === null) continue;
    const s = stats.get(run.gtId) ?? { attempts: 0, succeeded: 0, bestF1: null, latestF1: null, running: false };
    if (run.outcome === "running") s.running = true;
    if (run.outcome === "succeeded" || run.outcome === "failed") s.attempts++;
    if (run.outcome === "succeeded" && run.scores) {
      s.succeeded++;
      s.bestF1 = s.bestF1 === null ? run.scores.f1 : Math.max(s.bestF1, run.scores.f1);
      if (s.latestF1 === null) s.latestF1 = run.scores.f1;
    }
    stats.set(run.gtId, s);
  }
  return stats;
}

// ─── Hill climb ──────────────────────────────────────────────────────────

export interface OpenHealthClimbPoint {
  runId: string;
  createdAt: string;
  gtId: number | null;
  f1: number;
  /** The best F1 so far, as of this run — the line's level. */
  best: number;
  /** Did this run raise the best so far? */
  newBest: boolean;
}

/**
 * One task's scored runs oldest first, with the best F1 so far — the hill
 * climb. Across tasks a best-so-far would only track the easiest one, so the
 * page draws this for a single task.
 */
export function openHealthClimbSeries(runs: OpenHealthRun[]): OpenHealthClimbPoint[] {
  const scored = runs
    .filter((r): r is OpenHealthRun & { scores: OpenHealthScores } => r.outcome === "succeeded" && r.scores !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let best = -Infinity;
  return scored.map((run) => {
    const f1 = run.scores.f1;
    const newBest = f1 > best;
    best = Math.max(best, f1);
    return { runId: run.id, createdAt: run.createdAt, gtId: run.gtId, f1, best, newBest };
  });
}

/** The tasks the runs cover, most recently run first, with how many runs each has. */
export function openHealthRunTasks(
  runs: OpenHealthRun[],
): Array<{ gtId: number; difficulty: OpenHealthDifficulty | null; runs: number }> {
  const tasks = new Map<number, { gtId: number; difficulty: OpenHealthDifficulty | null; runs: number }>();
  for (const run of runs) {
    if (run.gtId === null) continue;
    const task = tasks.get(run.gtId) ?? { gtId: run.gtId, difficulty: run.difficulty, runs: 0 };
    task.runs++;
    task.difficulty ??= run.difficulty;
    tasks.set(run.gtId, task);
  }
  return [...tasks.values()];
}
