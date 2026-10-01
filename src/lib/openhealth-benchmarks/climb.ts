/**
 * A climb — benchmark run → improve run → benchmark run … on one task —
 * as the page shows it, and the decision taken after each step settles.
 * Pure; the service (`services/strut-runs/openhealth-climb.ts`) applies it.
 *
 * The rules, in order, once a step settles:
 *   - a step that failed, was lost or was cancelled ends the climb;
 *   - a scored run at or above the target ends it as REACHED;
 *   - a scored run with the attempts spent ends it as EXHAUSTED;
 *   - an improve run that wrote nothing ends it as STALLED (another run
 *     would only measure the scorer's noise);
 *   - otherwise the next step is launched: improve over the scored run,
 *     or the next attempt after an improve.
 */

import type { OpenHealthClimbStatus as PrismaClimbStatus } from "@prisma/client";
import { improveOutcomeOf, toOpenHealthImprovement } from "./improve";
import { toOpenHealthRun, type OpenHealthRunSource } from "./runs";
import { OPENHEALTH_IMPROVE_RUN_KIND, OPENHEALTH_RUN_KIND } from "./constants";
import type {
  OpenHealthClimb,
  OpenHealthClimbStatus,
  OpenHealthClimbStep,
  OpenHealthImprovement,
} from "@/types/openhealth";

/** The target a climb is given when the member picks none. */
export const OPENHEALTH_CLIMB_DEFAULT_TARGET = 1;
export const OPENHEALTH_CLIMB_DEFAULT_ATTEMPTS = 5;
/** A climb is at most this many benchmark runs, the seed included. */
export const OPENHEALTH_CLIMB_MAX_ATTEMPTS = 10;

/** Scores are floats off the scorer; a hair under the target counts. */
export function isAtTarget(f1: number, target: number): boolean {
  return f1 + 1e-9 >= target;
}

export function isClimbTarget(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1;
}

export function isClimbAttempts(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= OPENHEALTH_CLIMB_MAX_ATTEMPTS;
}

/**
 * What an improve run changed in the graph: new Concepts the graph
 * confirmed, and amendments. The workflow applies an amendment without
 * reporting a write per item, so a proposed amendment counts as one.
 */
export function improveWrites(improvement: OpenHealthImprovement): { created: number; amended: number } {
  if (!improvement.applied) return { created: 0, amended: 0 };
  return {
    created: improvement.proposals.filter((p) => p.action === "create" && p.write === "created").length,
    amended: improvement.proposals.filter((p) => p.action === "amend").length,
  };
}

const STATUS: Record<PrismaClimbStatus, OpenHealthClimbStatus> = {
  RUNNING: "running",
  REACHED: "reached",
  EXHAUSTED: "exhausted",
  STALLED: "stalled",
  STOPPED: "stopped",
  FAILED: "failed",
};

export interface OpenHealthClimbSource {
  id: string;
  gtId: number;
  status: PrismaClimbStatus;
  stopReason: string | null;
  targetF1: number;
  maxAttempts: number;
  attempts: number;
  startF1: number | null;
  bestF1: number | null;
  seedRunId: string | null;
  currentRunId: string | null;
  createdAt: Date;
  settledAt: Date | null;
}

/** A step row: a `StrutRun` of either OpenHealth kind. */
export interface OpenHealthClimbStepRow extends OpenHealthRunSource {
  kind: string;
}

function stepOf(row: OpenHealthClimbStepRow, attempt: number): OpenHealthClimbStep | null {
  if (row.kind === OPENHEALTH_RUN_KIND) {
    const run = toOpenHealthRun(row);
    return {
      runId: row.id,
      kind: "benchmark",
      attempt,
      outcome: run.outcome,
      f1: run.scores?.f1 ?? null,
      newBest: false,
      created: null,
      amended: null,
      costUsd: run.costUsd,
      error: run.error,
      createdAt: run.createdAt,
      settledAt: run.settledAt,
    };
  }
  if (row.kind === OPENHEALTH_IMPROVE_RUN_KIND) {
    const improvement = toOpenHealthImprovement(row);
    const writes = improvement.outcome === "succeeded" ? improveWrites(improvement) : null;
    return {
      runId: row.id,
      kind: "improve",
      attempt,
      outcome: improvement.outcome,
      f1: null,
      newBest: false,
      created: writes?.created ?? null,
      amended: writes?.amended ?? null,
      costUsd: null,
      error: improvement.error,
      createdAt: improvement.createdAt,
      settledAt: improvement.settledAt,
    };
  }
  return null;
}

/**
 * The climb with its steps oldest first: the seed row (adopted as attempt
 * 1) and then every row that names the climb, in launch order. `rows` may
 * come in any order and may hold rows of other kinds (skipped).
 */
export function toOpenHealthClimb(climb: OpenHealthClimbSource, rows: OpenHealthClimbStepRow[]): OpenHealthClimb {
  const ordered = [...rows].sort((a, b) => {
    if (a.id === climb.seedRunId) return -1;
    if (b.id === climb.seedRunId) return 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const steps: OpenHealthClimbStep[] = [];
  let attempt = 0;
  let best = -Infinity;
  let bestRunId: string | null = null;
  let latestF1: number | null = null;
  let cost: number | null = null;
  for (const row of ordered) {
    if (row.kind === OPENHEALTH_RUN_KIND) attempt++;
    const step = stepOf(row, Math.max(attempt, 1));
    if (!step) continue;
    if (step.kind === "benchmark") {
      if (step.f1 !== null) {
        step.newBest = step.f1 > best;
        if (step.newBest) {
          best = step.f1;
          bestRunId = step.runId;
        }
        latestF1 = step.f1;
      }
      if (step.costUsd !== null) cost = (cost ?? 0) + step.costUsd;
    }
    steps.push(step);
  }

  return {
    id: climb.id,
    gtId: climb.gtId,
    status: STATUS[climb.status],
    stopReason: climb.stopReason,
    targetF1: climb.targetF1,
    maxAttempts: climb.maxAttempts,
    attempts: climb.attempts,
    startF1: climb.startF1 ?? steps.find((s) => s.kind === "benchmark" && s.f1 !== null)?.f1 ?? null,
    bestF1: climb.bestF1 ?? (bestRunId ? best : null),
    latestF1,
    bestRunId,
    currentRunId: climb.currentRunId,
    costUsd: cost,
    steps,
    createdAt: climb.createdAt.toISOString(),
    settledAt: climb.settledAt?.toISOString() ?? null,
  };
}

// ─── The decision after a step ───────────────────────────────────────────

export type ClimbDecision =
  /** Launch `openhealth-improve` over the run that just scored `f1`. */
  | { next: "improve"; f1: number }
  /** Launch the next attempt. */
  | { next: "benchmark" }
  /** The climb is over. `f1` is the score that ended it, when a run did. */
  | { next: "end"; status: Exclude<PrismaClimbStatus, "RUNNING">; reason: string; f1?: number }
  /** The row is not settled (never from the handler; defensive). */
  | { next: "wait" };

export interface ClimbRules {
  targetF1: number;
  maxAttempts: number;
  /** Attempts launched or adopted so far — the settled run's number when it is one. */
  attempts: number;
}

export function decideClimbStep(climb: ClimbRules, row: OpenHealthClimbStepRow): ClimbDecision {
  const attempt = Math.max(climb.attempts, 1);
  if (row.kind === OPENHEALTH_RUN_KIND) {
    const run = toOpenHealthRun(row);
    if (run.outcome === "running") return { next: "wait" };
    if (run.outcome === "cancelled") {
      return { next: "end", status: "STOPPED", reason: `Attempt ${attempt} was cancelled.` };
    }
    if (run.outcome === "failed" || !run.scores) {
      return {
        next: "end",
        status: "FAILED",
        reason: `Attempt ${attempt} failed: ${run.error ?? "the run did not finish."}`,
      };
    }
    const f1 = run.scores.f1;
    if (isAtTarget(f1, climb.targetF1)) {
      return { next: "end", status: "REACHED", reason: `Attempt ${attempt} scored ${f1.toFixed(2)}.`, f1 };
    }
    if (climb.attempts >= climb.maxAttempts) {
      return {
        next: "end",
        status: "EXHAUSTED",
        reason: `All ${climb.maxAttempts} attempts used; attempt ${attempt} scored ${f1.toFixed(2)}.`,
        f1,
      };
    }
    return { next: "improve", f1 };
  }

  if (row.kind === OPENHEALTH_IMPROVE_RUN_KIND) {
    const outcome = improveOutcomeOf(row.status);
    if (outcome === "running") return { next: "wait" };
    if (outcome === "cancelled") {
      return { next: "end", status: "STOPPED", reason: `The improve run after attempt ${attempt} was cancelled.` };
    }
    const improvement = toOpenHealthImprovement(row);
    if (outcome === "failed") {
      return {
        next: "end",
        status: "FAILED",
        reason: `The improve run after attempt ${attempt} failed: ${improvement.error ?? "the run did not finish."}`,
      };
    }
    const writes = improveWrites(improvement);
    if (writes.created + writes.amended === 0) {
      return {
        next: "end",
        status: "STALLED",
        reason: improvement.applied
          ? `The improve run after attempt ${attempt} wrote nothing to the graph.`
          : `The improve run after attempt ${attempt} did not apply its proposals.`,
      };
    }
    if (climb.attempts >= climb.maxAttempts) {
      return { next: "end", status: "EXHAUSTED", reason: `All ${climb.maxAttempts} attempts used.` };
    }
    return { next: "benchmark" };
  }

  return { next: "end", status: "FAILED", reason: `A run of kind "${row.kind}" is not a climb step.` };
}
