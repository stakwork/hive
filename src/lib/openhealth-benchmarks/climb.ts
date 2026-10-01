/**
 * A climb — `openhealth-improve-loop` on one task: benchmark run → improve
 * run → benchmark run … until a run scores the target or the runs are
 * spent — as the page shows it. Pure.
 *
 * The loop is ONE strut run; its iterations are subflows with no run of
 * their own. A settled row carries the loop's output, whose `history` lists
 * every iteration. A row in flight has no output yet: its iterations are
 * read from the run's event log (`projectOpenHealthClimbEvents`), which
 * also carries what the output never does — each run's cost, recall and
 * precision, and when it started — and the stages of the run in flight.
 *
 * Like `runs.ts`, everything reads the workflow's fields one by one, so an
 * output of another shape degrades to nulls and empty lists. The improve
 * files the history names (`report`, `analysis`, `backup`, `problemList`)
 * are paths on the lab and are not carried over.
 */

import type { StrutRunStatus } from "@prisma/client";
import type {
  OpenHealthClimb,
  OpenHealthClimbStatus,
  OpenHealthClimbStep,
  OpenHealthOutcome,
  OpenHealthStage,
} from "@/types/openhealth";
import { openHealthRunCost, type DifficultyLookup } from "./runs";
import { projectOpenHealthStages } from "./stages";

/** The target a climb is given when the member picks none. */
export const OPENHEALTH_CLIMB_DEFAULT_TARGET = 1;
export const OPENHEALTH_CLIMB_DEFAULT_RUNS = 5;
/** A climb is at most this many benchmark runs. */
export const OPENHEALTH_CLIMB_MAX_RUNS = 10;
/** The loop's own ceiling on iterations (`maxIterations`); an iteration index is below it. */
export const OPENHEALTH_CLIMB_MAX_ITERATIONS = 50;

/** What the workflow assumes when the launch names no target or run count. */
const WORKFLOW_DEFAULT_TARGET = 1;
const WORKFLOW_DEFAULT_RUNS = 3;

/** Scores are floats off the scorer; a hair under the target counts. */
export function isAtTarget(f1: number, target: number): boolean {
  return f1 + 1e-9 >= target;
}

export function isClimbTarget(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1;
}

export function isClimbRuns(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= OPENHEALTH_CLIMB_MAX_RUNS;
}

export function isClimbIteration(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < OPENHEALTH_CLIMB_MAX_ITERATIONS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v !== "") : [];

// ─── The event log ───────────────────────────────────────────────────────

/** Where one step of an iteration is, read from its events. */
export type OpenHealthClimbPhase = "pending" | "running" | "done" | "failed" | "skipped";

export interface OpenHealthClimbIterationEvents {
  iteration: number;
  startedAt: string | null;
  run: OpenHealthClimbPhase;
  improve: OpenHealthClimbPhase;
  /** From the benchmark run's output, once it ended. */
  f1: number | null;
  recall: number | null;
  precision: number | null;
  missed: string[];
  extra: string[];
  costUsd: number | null;
  /** The benchmark run's stages while it runs. */
  stages: OpenHealthStage[] | null;
  /** The loop recorded this iteration: `history` holds it. */
  recorded: boolean;
}

export interface OpenHealthClimbEvents {
  /** The newest `history` the loop recorded, as the workflow wrote it. Empty before the first iteration ends. */
  history: unknown[];
  /** Every iteration the log has seen start, in order. */
  iterations: OpenHealthClimbIterationEvents[];
}

const ITERATION_RE = /^loop#(\d+)$/;
const ENDED = new Set(["step.end", "step.replayed"]);

function phaseAfter(type: string, before: OpenHealthClimbPhase): OpenHealthClimbPhase {
  if (type === "step.start") return before === "pending" ? "running" : before;
  if (ENDED.has(type)) return "done";
  if (type === "step.error") return "failed";
  if (type === "step.skipped") return "skipped";
  return before;
}

/**
 * The loop's iterations from its event log. Paths are
 * `<workflow>/loop#N`, `<workflow>/loop#N/run` (the benchmark subflow) and
 * `<workflow>/loop#N/improve`; deeper paths are the subflows' own steps.
 */
export function projectOpenHealthClimbEvents(events: unknown): OpenHealthClimbEvents {
  const list = Array.isArray(events) ? events : [];
  const iterations = new Map<number, OpenHealthClimbIterationEvents>();
  let history: unknown[] = [];
  let root: string | null = null;

  const at = (iteration: number): OpenHealthClimbIterationEvents => {
    let it = iterations.get(iteration);
    if (!it) {
      it = {
        iteration,
        startedAt: null,
        run: "pending",
        improve: "pending",
        f1: null,
        recall: null,
        precision: null,
        missed: [],
        extra: [],
        costUsd: null,
        stages: null,
        recorded: false,
      };
      iterations.set(iteration, it);
    }
    return it;
  };

  for (const event of list) {
    if (!isRecord(event) || typeof event.path !== "string" || typeof event.type !== "string") continue;
    const segments = event.path.split("/");
    const match = segments.length >= 2 ? ITERATION_RE.exec(segments[1]) : null;
    if (!match) continue;
    root ??= segments[0];
    const it = at(Number(match[1]));
    if (segments.length === 2) {
      if (event.type === "step.start") it.startedAt = str(event.ts);
      else if (ENDED.has(event.type)) {
        it.recorded = true;
        const recorded = record(event.output).history;
        if (Array.isArray(recorded)) history = recorded;
      }
    } else if (segments.length === 3 && segments[2] === "run") {
      it.run = phaseAfter(event.type, it.run);
      if (ENDED.has(event.type)) {
        const output = record(event.output);
        it.f1 = num(output.weighted_problem_list_f1_neutral);
        it.recall = num(output.problem_list_recall);
        it.precision = num(output.problem_list_precision_neutral);
        it.missed = strings(output.missed);
        it.extra = strings(output.extra);
        it.costUsd = openHealthRunCost(output);
      }
    } else if (segments.length === 3 && segments[2] === "improve") {
      it.improve = phaseAfter(event.type, it.improve);
    }
  }

  const ordered = [...iterations.values()].sort((a, b) => a.iteration - b.iteration);
  for (const it of ordered) {
    if (it.run === "running" && root !== null) {
      it.stages = projectOpenHealthStages(list, { under: `${root}/loop#${it.iteration}/run` });
    }
  }
  return { history, iterations: ordered };
}

// ─── The row ─────────────────────────────────────────────────────────────

export interface OpenHealthClimbSource {
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

const EMPTY_STEP = {
  f1: null,
  recall: null,
  precision: null,
  newBest: false,
  missed: [] as string[],
  extra: [] as string[],
  costUsd: null,
  stages: null,
  applied: false,
  created: [] as string[],
  amended: [] as string[],
  rejected: [] as string[],
  summary: null,
  startedAt: null,
  error: null,
};

function benchmarkStep(
  iteration: number,
  outcome: OpenHealthOutcome,
  fields: Partial<OpenHealthClimbStep>,
): OpenHealthClimbStep {
  return { ...EMPTY_STEP, kind: "benchmark", iteration, outcome, ...fields };
}

function improveStep(
  iteration: number,
  outcome: OpenHealthOutcome,
  fields: Partial<OpenHealthClimbStep>,
): OpenHealthClimbStep {
  return { ...EMPTY_STEP, kind: "improve", iteration, outcome, ...fields };
}

/** The outcome of a step the loop never recorded, by how the loop itself ended. */
function unrecordedOutcome(status: StrutRunStatus, phase: OpenHealthClimbPhase): OpenHealthOutcome {
  if (phase === "done") return "succeeded";
  if (phase === "failed") return "failed";
  if (status === "PENDING") return "running";
  return status === "CANCELLED" ? "cancelled" : "failed";
}

/**
 * The climb's steps oldest first: the recorded history, then whatever the
 * event log has seen of an iteration the loop has not recorded yet (the one
 * in flight, or the one that failed).
 */
function stepsOf(
  row: OpenHealthClimbSource,
  history: unknown[],
  events: OpenHealthClimbEvents | null | undefined,
): OpenHealthClimbStep[] {
  const steps: OpenHealthClimbStep[] = [];
  const seen = new Set<number>();
  history.forEach((raw, index) => {
    const entry = record(raw);
    const iteration = num(entry.iteration) ?? index;
    seen.add(iteration);
    const ev = events?.iterations.find((it) => it.iteration === iteration);
    steps.push(
      benchmarkStep(iteration, "succeeded", {
        f1: num(entry.score),
        // The history records no recall or precision today; the log has them.
        recall: num(entry.recall) ?? ev?.recall ?? null,
        precision: num(entry.precision) ?? ev?.precision ?? null,
        missed: strings(entry.missed),
        extra: strings(entry.extra),
        costUsd: ev?.costUsd ?? null,
        startedAt: ev?.startedAt ?? null,
      }),
    );
    if (entry.improved === true) {
      steps.push(
        improveStep(iteration, "succeeded", {
          applied: entry.applied === true,
          created: strings(entry.creates),
          amended: strings(entry.amends),
          rejected: strings(entry.rejected),
          summary: str(entry.summary),
        }),
      );
    }
  });

  for (const it of events?.iterations ?? []) {
    if (seen.has(it.iteration) || it.run === "pending") continue;
    const outcome = unrecordedOutcome(row.status, it.run);
    steps.push(
      benchmarkStep(it.iteration, outcome, {
        f1: it.f1,
        recall: it.recall,
        precision: it.precision,
        missed: it.missed,
        extra: it.extra,
        costUsd: it.costUsd,
        stages: outcome === "running" ? it.stages : null,
        startedAt: it.startedAt,
        error: outcome === "failed" ? (row.error ?? "The run did not finish.") : null,
      }),
    );
    if (it.run === "done" && it.improve !== "pending" && it.improve !== "skipped") {
      const improveOutcome = unrecordedOutcome(row.status, it.improve);
      steps.push(
        improveStep(it.iteration, improveOutcome, {
          error: improveOutcome === "failed" ? (row.error ?? "The improve run did not finish.") : null,
        }),
      );
    }
  }
  return steps;
}

const score = (value: number) => value.toFixed(2);

function statusOf(
  row: OpenHealthClimbSource,
  output: Record<string, unknown>,
  history: unknown[],
  rules: { targetF1: number; maxRuns: number },
  scored: { attempt: number; f1: number } | null,
  bestF1: number | null,
): { status: OpenHealthClimbStatus; stopReason: string | null } {
  switch (row.status) {
    case "PENDING":
      return { status: "running", stopReason: null };
    case "CANCELLED":
      return { status: "stopped", stopReason: "Stopped by a member." };
    case "ERROR":
    case "LOST":
      return { status: "failed", stopReason: row.error ?? "The loop did not finish." };
  }
  // SUCCESS: the workflow says why it stopped.
  const reason = str(output.stopReason);
  const reached =
    reason === "target_reached" || (reason === null && bestF1 !== null && isAtTarget(bestF1, rules.targetF1));
  if (history.length === 0) {
    return { status: "failed", stopReason: "The loop finished without recording a run." };
  }
  if (reached) {
    return {
      status: "reached",
      stopReason: scored ? `Run ${scored.attempt} scored ${score(scored.f1)}.` : `Reached ${score(rules.targetF1)}.`,
    };
  }
  return {
    status: "exhausted",
    stopReason: `All ${rules.maxRuns} runs used; the best scored ${bestF1 === null ? "nothing" : score(bestF1)}.`,
  };
}

export function toOpenHealthClimb(
  row: OpenHealthClimbSource,
  difficultyFor?: DifficultyLookup,
  events?: OpenHealthClimbEvents | null,
): OpenHealthClimb {
  const input = record(row.input);
  const output = record(row.output);
  const gtId = num(input.gtId) ?? num(output.gtId);
  const rules = {
    targetF1: num(input.target) ?? WORKFLOW_DEFAULT_TARGET,
    maxRuns: num(input.maxRuns) ?? WORKFLOW_DEFAULT_RUNS,
  };
  const history = Array.isArray(output.history) ? output.history : (events?.history ?? []);
  const steps = stepsOf(row, history, events);

  let best = -Infinity;
  let bestIteration: number | null = null;
  let bestRecall: number | null = null;
  let bestPrecision: number | null = null;
  let startF1: number | null = null;
  let latest: { attempt: number; f1: number } | null = null;
  let cost: number | null = null;
  let attempts = 0;
  for (const step of steps) {
    if (step.kind !== "benchmark") continue;
    attempts++;
    if (step.costUsd !== null) cost = (cost ?? 0) + step.costUsd;
    if (step.f1 === null) continue;
    startF1 ??= step.f1;
    latest = { attempt: step.iteration + 1, f1: step.f1 };
    step.newBest = step.f1 > best;
    if (step.newBest) {
      best = step.f1;
      bestIteration = step.iteration;
      bestRecall = step.recall;
      bestPrecision = step.precision;
    }
  }
  const bestF1 = bestIteration === null ? null : best;
  const { status, stopReason } = statusOf(row, output, history, rules, latest, bestF1);

  return {
    id: row.id,
    strutRunId: row.strutRunId,
    gtId,
    difficulty: gtId === null ? null : (difficultyFor?.(gtId) ?? null),
    status,
    stopReason,
    targetF1: rules.targetF1,
    maxRuns: rules.maxRuns,
    attempts,
    startF1,
    bestF1,
    bestRecall,
    bestPrecision,
    latestF1: latest?.f1 ?? null,
    bestIteration,
    costUsd: cost,
    steps,
    durationMs: row.durationMs,
    error: status === "failed" ? stopReason : null,
    createdAt: row.createdAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
  };
}
