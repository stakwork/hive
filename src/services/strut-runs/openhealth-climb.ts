/**
 * OpenHealth climbs — benchmark run → improve run → benchmark run … on one
 * task, driven from the runs' settle handler. The rules are in
 * `lib/openhealth-benchmarks/climb.ts`; this module owns the rows and the
 * launches.
 *
 * One `OpenHealthClimb` row per climb; its steps are the `StrutRun` rows
 * whose `climbId` is the climb (plus an adopted seed run). The row's
 * `currentRunId` is the step in flight, and the one lever against double
 * launches: a settled step advances the climb only while it IS the current
 * step, and the advance claims the row (`updateMany` gated on
 * `currentRunId`) before anything is launched, so a replayed callback — or
 * the reconcile cron settling the same run — finds nothing to do.
 *
 * Both `openhealth_benchmark` and `openhealth_improve` settle here. A run
 * launched by hand has no `climbId` and only gets logged.
 *
 * Retry contract (`completeStrutRun`): when strut cannot be reached for the
 * next launch the claim is given back and the error rethrown, so the
 * webhook answers 5xx and strut re-delivers; any other launch failure ends
 * the climb as FAILED with the reason. A climb left RUNNING with a settled
 * current step (re-deliveries exhausted, a crash mid-advance) is picked up
 * by `sweepOpenHealthClimbs` from the `strut-runs-reconcile` cron.
 */

import { OpenHealthClimbStatus, StrutRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { decideClimbStep, isAtTarget, toOpenHealthClimb } from "@/lib/openhealth-benchmarks/climb";
import { toOpenHealthRun } from "@/lib/openhealth-benchmarks/runs";
import {
  cancelStrutRun,
  STRUT_RUN_LOG_TAG,
  StrutDispatchError,
  type StrutRunHandler,
  type StrutRunRow,
} from "@/services/strut-runs";
import {
  launchOpenHealthImprove,
  launchOpenHealthRun,
  OPENHEALTH_ROW_SELECT,
  settleFromStrut,
} from "@/services/strut-runs/openhealth";
import { describeStrutTargetError, resolveStrutTarget } from "@/services/strut-target";
import type { OpenHealthClimb } from "@/types/openhealth";

export const OPENHEALTH_CLIMB_LOG_TAG = "OPENHEALTH_CLIMB";

/** How many climbs the page lists. */
const LIST_LIMIT = 50;
/** The sweep leaves a RUNNING climb alone this long after its last change. */
export const CLIMB_SWEEP_MIN_AGE_MS = 10 * 60 * 1000;
const SWEEP_BATCH = 25;
/** Cap on a stored `stopReason`. */
const MAX_REASON_CHARS = 2_000;

const capReason = (reason: string) =>
  reason.length > MAX_REASON_CHARS ? `${reason.slice(0, MAX_REASON_CHARS)}…` : reason;

export type OpenHealthClimbErrorCode = "not_scored" | "target_reached" | "wrong_swarm" | "no_run_id";

/** A refusal the route reports as a 409. */
export class OpenHealthClimbError extends Error {
  constructor(
    public readonly code: OpenHealthClimbErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OpenHealthClimbError";
  }
}

type ClimbRow = Awaited<ReturnType<typeof db.openHealthClimb.findUniqueOrThrow>>;

// ─── The settle handler ──────────────────────────────────────────────────

/** The `StrutRunHandler` for both OpenHealth kinds: the row is the result; a climb step advances its climb. */
export const handleOpenHealthRunSettled: StrutRunHandler = async (row) => {
  logger.info("OpenHealth run settled", STRUT_RUN_LOG_TAG, {
    runId: row.id,
    kind: row.kind,
    workspaceId: row.workspaceId,
    status: row.status,
    climbId: row.climbId,
  });
  if (row.climbId) await advanceOpenHealthClimb(row);
};

// ─── Launching a step ────────────────────────────────────────────────────

type Step = { kind: "benchmark" } | { kind: "improve"; strutRunId: string };

/**
 * Launch one step on the climb's swarm and record it as the current step.
 * Throws `StrutDispatchError` / `OpenHealthClimbError`; the caller decides
 * what that does to the climb.
 */
async function launchStep(climb: ClimbRow, step: Step): Promise<string> {
  // The improve workflow reads the benchmark run from its own strut's run
  // store: every step has to run where the first one did.
  const resolved = await resolveStrutTarget({
    purpose: "benchmark",
    userId: climb.userId,
    workspaceId: climb.workspaceId,
  });
  if (!resolved.ok) throw new StrutDispatchError("no_target", describeStrutTargetError(resolved.error));
  if (resolved.target.swarmId !== climb.swarmId) {
    throw new OpenHealthClimbError(
      "wrong_swarm",
      "The workspace now uses another swarm than the one the climb runs on.",
    );
  }

  const common = {
    workspaceId: climb.workspaceId,
    userId: climb.userId,
    publicBaseUrl: climb.publicBaseUrl,
    climbId: climb.id,
  };
  const dispatched =
    step.kind === "benchmark"
      ? await launchOpenHealthRun({ ...common, gtId: climb.gtId })
      : await launchOpenHealthImprove({ ...common, strutRunId: step.strutRunId });

  await db.openHealthClimb.update({
    where: { id: climb.id },
    data: {
      currentRunId: dispatched.runId,
      ...(step.kind === "benchmark" ? { attempts: { increment: 1 } } : {}),
    },
  });
  logger.info("OpenHealth climb step launched", OPENHEALTH_CLIMB_LOG_TAG, {
    climbId: climb.id,
    step: step.kind,
    runId: dispatched.runId,
    attempts: climb.attempts + (step.kind === "benchmark" ? 1 : 0),
  });
  return dispatched.runId;
}

async function endClimb(
  id: string,
  status: Exclude<OpenHealthClimbStatus, "RUNNING">,
  reason: string,
  extra: { bestF1?: number | null } = {},
): Promise<boolean> {
  const { count } = await db.openHealthClimb.updateMany({
    where: { id, status: OpenHealthClimbStatus.RUNNING },
    data: {
      status,
      stopReason: capReason(reason),
      currentRunId: null,
      settledAt: new Date(),
      ...(extra.bestF1 !== undefined ? { bestF1: extra.bestF1 } : {}),
    },
  });
  if (count > 0) logger.info("OpenHealth climb ended", OPENHEALTH_CLIMB_LOG_TAG, { climbId: id, status, reason });
  return count > 0;
}

// ─── Start / advance / stop ──────────────────────────────────────────────

export interface StartOpenHealthClimbArgs {
  workspaceId: string;
  userId: string;
  /** Swarm-reachable base URL of this hive (the callback host), kept on the climb. */
  publicBaseUrl: string;
  gtId: number;
  targetF1: number;
  maxAttempts: number;
  /** A scored benchmark run of `gtId` to adopt as attempt 1: the climb starts with an improve over it. */
  seed?: StrutRunRow | null;
}

/**
 * Create a climb and launch its first step. Throws `OpenHealthClimbError`
 * for a seed that cannot start one and `StrutDispatchError` when the step
 * could not be launched (the climb is then FAILED with the reason).
 */
export async function startOpenHealthClimb(
  args: StartOpenHealthClimbArgs,
): Promise<{ climbId: string; runId: string }> {
  const resolved = await resolveStrutTarget({
    purpose: "benchmark",
    userId: args.userId,
    workspaceId: args.workspaceId,
  });
  if (!resolved.ok) throw new StrutDispatchError("no_target", describeStrutTargetError(resolved.error));
  const swarmId = resolved.target.swarmId;

  let seedF1: number | null = null;
  if (args.seed) {
    if (args.seed.swarmId !== swarmId) {
      throw new OpenHealthClimbError(
        "wrong_swarm",
        "This run was made on another swarm, which the workspace no longer uses.",
      );
    }
    if (!args.seed.strutRunId) throw new OpenHealthClimbError("no_run_id", "This run has no id on strut yet.");
    const run = toOpenHealthRun(args.seed);
    if (run.outcome !== "succeeded" || !run.scores) {
      throw new OpenHealthClimbError("not_scored", "Only a scored run can start a climb.");
    }
    seedF1 = run.scores.f1;
    if (isAtTarget(seedF1, args.targetF1)) {
      throw new OpenHealthClimbError(
        "target_reached",
        `This run already scored ${seedF1.toFixed(2)}, at or above the target.`,
      );
    }
  }

  const climb = await db.openHealthClimb.create({
    data: {
      workspaceId: args.workspaceId,
      swarmId,
      userId: args.userId,
      gtId: args.gtId,
      targetF1: args.targetF1,
      maxAttempts: args.maxAttempts,
      seedRunId: args.seed?.id ?? null,
      attempts: args.seed ? 1 : 0,
      startF1: seedF1,
      bestF1: seedF1,
      publicBaseUrl: args.publicBaseUrl,
    },
  });
  logger.info("OpenHealth climb started", OPENHEALTH_CLIMB_LOG_TAG, {
    climbId: climb.id,
    workspaceId: args.workspaceId,
    gtId: args.gtId,
    targetF1: args.targetF1,
    maxAttempts: args.maxAttempts,
    seedRunId: climb.seedRunId,
  });

  try {
    const runId = await launchStep(
      climb,
      args.seed ? { kind: "improve", strutRunId: args.seed.strutRunId as string } : { kind: "benchmark" },
    );
    return { climbId: climb.id, runId };
  } catch (err) {
    await endClimb(climb.id, OpenHealthClimbStatus.FAILED, `Could not launch the first step: ${messageOf(err)}`);
    throw err;
  }
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * A climb step settled: end the climb or launch the next step. Idempotent —
 * a row that is not the climb's current step (a replay, a step of a stopped
 * climb) does nothing.
 */
export async function advanceOpenHealthClimb(row: StrutRunRow): Promise<void> {
  if (!row.climbId) return;
  const climb = await db.openHealthClimb.findUnique({ where: { id: row.climbId } });
  if (!climb || climb.status !== OpenHealthClimbStatus.RUNNING || climb.currentRunId !== row.id) {
    logger.debug("OpenHealth climb step is not the current one", OPENHEALTH_CLIMB_LOG_TAG, {
      climbId: row.climbId,
      runId: row.id,
      status: climb?.status ?? null,
      currentRunId: climb?.currentRunId ?? null,
    });
    return;
  }

  const decision = decideClimbStep(climb, row);
  if (decision.next === "wait") return;
  const scored = "f1" in decision && typeof decision.f1 === "number" ? decision.f1 : null;
  const bestF1 = scored === null ? climb.bestF1 : Math.max(climb.bestF1 ?? -Infinity, scored);
  const startF1 = climb.startF1 ?? scored;

  if (decision.next === "end") {
    const { count } = await db.openHealthClimb.updateMany({
      where: { id: climb.id, status: OpenHealthClimbStatus.RUNNING, currentRunId: row.id },
      data: {
        status: decision.status,
        stopReason: capReason(decision.reason),
        currentRunId: null,
        bestF1,
        startF1,
        settledAt: new Date(),
      },
    });
    if (count > 0) {
      logger.info("OpenHealth climb ended", OPENHEALTH_CLIMB_LOG_TAG, {
        climbId: climb.id,
        status: decision.status,
        reason: decision.reason,
        bestF1,
      });
    }
    return;
  }

  // The claim: whoever nulls `currentRunId` launches the next step.
  const { count } = await db.openHealthClimb.updateMany({
    where: { id: climb.id, status: OpenHealthClimbStatus.RUNNING, currentRunId: row.id },
    data: { currentRunId: null, bestF1, startF1 },
  });
  if (count === 0) return;

  if (decision.next === "improve" && !row.strutRunId) {
    await endClimb(climb.id, OpenHealthClimbStatus.FAILED, "The scored run has no id on strut to improve over.");
    return;
  }
  try {
    await launchStep(
      climb,
      decision.next === "improve" ? { kind: "improve", strutRunId: row.strutRunId as string } : { kind: "benchmark" },
    );
  } catch (err) {
    if (err instanceof StrutDispatchError && err.code === "unreachable") {
      // Give the claim back: the webhook answers 5xx and strut re-delivers.
      await db.openHealthClimb.updateMany({
        where: { id: climb.id, status: OpenHealthClimbStatus.RUNNING, currentRunId: null },
        data: { currentRunId: row.id },
      });
      throw err;
    }
    await endClimb(climb.id, OpenHealthClimbStatus.FAILED, `Could not launch the next step: ${messageOf(err)}`);
  }
}

/**
 * Stop a running climb and ask strut to cancel its step in flight (best
 * effort: the step settles as cancelled and finds the climb no longer
 * running). False when it was not running.
 */
export async function stopOpenHealthClimb(
  climb: { id: string; currentRunId: string | null },
  reason: string,
): Promise<boolean> {
  const stopped = await endClimb(climb.id, OpenHealthClimbStatus.STOPPED, reason);
  if (!stopped) return false;
  if (climb.currentRunId) {
    const run = await db.strutRun.findUnique({
      where: { id: climb.currentRunId },
      select: { id: true, swarmId: true, workflow: true, strutRunId: true, status: true },
    });
    if (run?.status === StrutRunStatus.PENDING) {
      const acknowledged = await cancelStrutRun(run).catch(() => false);
      if (!acknowledged) {
        logger.warn("OpenHealth climb step cancel not acknowledged", OPENHEALTH_CLIMB_LOG_TAG, {
          climbId: climb.id,
          runId: run.id,
        });
      }
    }
  }
  return true;
}

// ─── Reading ─────────────────────────────────────────────────────────────

export async function findOpenHealthClimbRow(workspaceId: string, climbId: string): Promise<ClimbRow | null> {
  return db.openHealthClimb.findFirst({ where: { id: climbId, workspaceId } });
}

/** Is a climb of this task running in the workspace? */
export async function hasRunningOpenHealthClimb(workspaceId: string, gtId: number): Promise<boolean> {
  const row = await db.openHealthClimb.findFirst({
    where: { workspaceId, gtId, status: OpenHealthClimbStatus.RUNNING },
    select: { id: true },
  });
  return row !== null;
}

/** The step rows of these climbs (their seeds included), oldest first. */
async function stepRowsOf(workspaceId: string, climbs: ClimbRow[]): Promise<StrutRunRow[]> {
  const seedIds = climbs.flatMap((c) => (c.seedRunId ? [c.seedRunId] : []));
  return db.strutRun.findMany({
    where: {
      workspaceId,
      OR: [{ climbId: { in: climbs.map((c) => c.id) } }, ...(seedIds.length > 0 ? [{ id: { in: seedIds } }] : [])],
    },
    select: OPENHEALTH_ROW_SELECT,
    orderBy: { createdAt: "asc" },
  });
}

/**
 * The climbs with their steps. A PENDING step whose callback never landed
 * is settled from strut first (which advances the climb through the
 * handler), and the climbs re-read when that happened.
 */
async function withSteps(workspaceId: string, climbs: ClimbRow[], now: Date): Promise<OpenHealthClimb[]> {
  if (climbs.length === 0) return [];
  let rows = await stepRowsOf(workspaceId, climbs);
  const shown = await Promise.all(rows.map((row) => settleFromStrut(row, now)));
  if (shown.some((row, i) => row.status !== rows[i].status)) {
    const ids = climbs.map((c) => c.id);
    climbs = await db.openHealthClimb.findMany({
      where: { id: { in: ids }, workspaceId },
      orderBy: { createdAt: "desc" },
    });
    rows = await stepRowsOf(workspaceId, climbs);
  } else {
    rows = shown;
  }
  const byClimb = new Map<string, StrutRunRow[]>();
  for (const row of rows) {
    const owners = climbs.filter((c) => c.id === row.climbId || c.seedRunId === row.id);
    for (const owner of owners) byClimb.set(owner.id, [...(byClimb.get(owner.id) ?? []), row]);
  }
  return climbs.map((climb) => toOpenHealthClimb(climb, byClimb.get(climb.id) ?? []));
}

/** The workspace's climbs, newest first; of one task when `gtId` is given. */
export async function listOpenHealthClimbs(
  workspaceId: string,
  opts: { gtId?: number; now?: Date } = {},
): Promise<OpenHealthClimb[]> {
  const climbs = await db.openHealthClimb.findMany({
    where: { workspaceId, ...(opts.gtId !== undefined ? { gtId: opts.gtId } : {}) },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
  });
  return withSteps(workspaceId, climbs, opts.now ?? new Date());
}

export async function getOpenHealthClimb(
  workspaceId: string,
  climbId: string,
  opts: { now?: Date } = {},
): Promise<OpenHealthClimb | null> {
  const climb = await findOpenHealthClimbRow(workspaceId, climbId);
  if (!climb) return null;
  const [shown] = await withSteps(workspaceId, [climb], opts.now ?? new Date());
  return shown ?? null;
}

// ─── Sweep (cron) ────────────────────────────────────────────────────────

export interface SweepOpenHealthClimbsStats {
  swept: number;
  advanced: number;
  failed: number;
  waiting: number;
}

/**
 * The backstop for a climb left RUNNING with nothing to wait on: its
 * current step settled but the advance never ran to the end (strut's
 * re-deliveries exhausted, a deploy mid-handler), or the next step was
 * claimed and never launched. Runs after `reconcileStrutRuns`, which
 * settles the steps themselves. Never touches a climb changed recently.
 */
export async function sweepOpenHealthClimbs(
  opts: { now?: Date; minAgeMs?: number; limit?: number } = {},
): Promise<SweepOpenHealthClimbsStats> {
  const now = opts.now ?? new Date();
  const stats: SweepOpenHealthClimbsStats = { swept: 0, advanced: 0, failed: 0, waiting: 0 };
  const climbs = await db.openHealthClimb.findMany({
    where: {
      status: OpenHealthClimbStatus.RUNNING,
      updatedAt: { lt: new Date(now.getTime() - (opts.minAgeMs ?? CLIMB_SWEEP_MIN_AGE_MS)) },
    },
    orderBy: { updatedAt: "asc" },
    take: opts.limit ?? SWEEP_BATCH,
  });

  for (const climb of climbs) {
    stats.swept++;
    try {
      if (!climb.currentRunId) {
        await endClimb(climb.id, OpenHealthClimbStatus.FAILED, "The next step was never launched.");
        stats.failed++;
        continue;
      }
      const row = await db.strutRun.findUnique({ where: { id: climb.currentRunId }, select: OPENHEALTH_ROW_SELECT });
      if (!row) {
        await endClimb(climb.id, OpenHealthClimbStatus.FAILED, "The step in flight is gone.");
        stats.failed++;
        continue;
      }
      if (row.status === StrutRunStatus.PENDING) {
        stats.waiting++;
        continue;
      }
      await advanceOpenHealthClimb(row);
      stats.advanced++;
    } catch (err) {
      logger.error("OpenHealth climb sweep threw", OPENHEALTH_CLIMB_LOG_TAG, {
        climbId: climb.id,
        error: messageOf(err),
      });
    }
  }
  if (stats.swept > 0) logger.info("OpenHealth climbs sweep", OPENHEALTH_CLIMB_LOG_TAG, { ...stats });
  return stats;
}
