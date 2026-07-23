/**
 * legal-recursion-cron.ts
 *
 * Scheduled pass that re-runs Legal Benchmark eval tasks flagged for recursion.
 *
 * Strategy:
 *  1. Gate on the openlaw workspace's legalBenchmarkRecursionEnabled toggle.
 *  2. List all recursion=true EvalSets via the graph-flag service.
 *  3. For each EvalSet with a project_id, check live Stakwork status (fail-closed).
 *  4. Count running tasks; compute available = cap − running.
 *  5. For each eligible EvalSet up to available, resolve the most recent
 *     LEGAL_BENCHMARK_RUNNER run for the task and dispatch via
 *     dispatchLegalBenchmarkEvalRun with bypassRerunGuards:true.
 *  6. Write back the returned eval projectId onto the EvalSet node.
 *
 * Never throws — always returns a RecursionCronResult summary.
 */

import { db } from "@/lib/db";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";
import { logger } from "@/lib/logger";
import { isLegalBenchmarkRecursionEnabledForCron } from "@/services/janitor";
import {
  listRecursionEvalSets,
  writeBackEvalProjectId,
  setEvalSetRecursion,
  type RecursionEvalSetEntry,
} from "@/services/legal-benchmark-recursion";
import { dispatchLegalBenchmarkEvalRun } from "@/services/legal-benchmark-eval";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { kgGetSubgraph } from "@/lib/ai/kg-adapter";
import { computeAttemptStats } from "@/services/legal-recursion-attempt-stats";
import { stakworkService } from "@/lib/service-factory";
import { mapStakworkStatus } from "@/utils/conversions";
import { parseBenchmarkRunResult } from "@/types/legal";

const LOG_PREFIX = "[LegalRecursionCron]";

/** Per-status-call Stakwork timeout — keep tight to avoid stalled swarms eating the budget. */
const STATUS_TIMEOUT_MS = 8_000;

/**
 * Re-fire guard window — wider than the narrow 5-minute same-pass safety-net.
 * Chosen to bridge a full cron cadence (~6h) plus buffer so a single
 * write-back-retry failure cannot cause a budget-wasting re-dispatch on the
 * next scheduled pass.
 */
const REFIRE_GUARD_WINDOW_MS = 7 * 60 * 60 * 1000; // 7 hours

/** Default concurrency cap when PlatformConfig row is absent. */
const DEFAULT_RECURSION_CAP = 3;

/** Default max total attempts per EvalSet before recursion is auto-disabled. */
const DEFAULT_RECURSION_MAX_ATTEMPTS = 10;

/** Default plateau streak limit before recursion is auto-disabled. */
const DEFAULT_RECURSION_PLATEAU_LIMIT = 3;

/** Shared constant so the admin route reads/writes the same DB key. */
export const RECURSION_MAX_CONCURRENT_KEY = "recursionMaxConcurrent";

/** Shared constant for the per-EvalSet max-attempts cap. */
export const RECURSION_MAX_ATTEMPTS_KEY = "recursionMaxAttempts";

/** Shared constant for the plateau-streak limit cap. */
export const RECURSION_PLATEAU_LIMIT_KEY = "recursionPlateauLimit";

export interface RecursionCronResult {
  success: boolean;
  entriesProcessed: number;
  dispatched: number;
  skipped: number;
  /** Kept at 0 for backward compatibility — nothing to deactivate in this design. */
  deactivated: number;
  /** EvalSets skipped and disabled because they hit the total-attempts cap. */
  attemptCapped: number;
  /** EvalSets skipped and disabled because they hit the plateau-streak cap. */
  plateauCapped: number;
  errors: string[];
  timestamp: Date;
}

/**
 * Fetches the live Stakwork project status with a hard timeout.
 * Returns null on timeout or any error (fail-closed — null is treated as ineligible).
 */
async function getLiveProjectStatus(projectId: number | string): Promise<string | null> {
  try {
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), STATUS_TIMEOUT_MS),
    );
    const statusPromise = stakworkService()
      .getWorkflowData(String(projectId))
      .then((r) => r.status);
    const status = await Promise.race([statusPromise, timeoutPromise]);
    return status;
  } catch {
    return null;
  }
}

/**
 * Resolves the most recent LEGAL_BENCHMARK_RUNNER StakworkRun for the given
 * workspace whose parsed result has taskSlug === evalSetId.
 * Returns null if none found.
 */
async function resolveRunnerRunId(
  workspaceId: string,
  evalSetId: string,
): Promise<string | null> {
  // Fetch recent LEGAL_BENCHMARK_RUNNER runs for the workspace.
  // We take a bounded set ordered by most recent; the first match wins.
  const runs = await db.stakworkRun.findMany({
    where: {
      workspaceId,
      type: StakworkRunType.LEGAL_BENCHMARK_RUNNER,
      status: WorkflowStatus.COMPLETED,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, result: true },
  });

  for (const run of runs) {
    const parsed = parseBenchmarkRunResult(run.result);
    if (parsed?.taskSlug === evalSetId) {
      return run.id;
    }
  }
  return null;
}

/**
 * Check if a very-recent LEGAL_BENCHMARK_EVAL run already exists for the
 * given runner run (narrow safety-net for the write-back failure window).
 * This is NOT the full ACTIVE_EVAL_RUN_EXISTS check — it only looks back
 * a short window to detect a duplicate within the same pass.
 */
async function hasRecentEvalRun(workspaceId: string, runId: string): Promise<boolean> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const recent = await db.stakworkRun.findFirst({
    where: {
      workspaceId,
      type: StakworkRunType.LEGAL_BENCHMARK_EVAL,
      createdAt: { gte: fiveMinutesAgo },
    },
    select: { id: true, result: true },
  });
  if (!recent) return false;
  try {
    const parsed = recent.result
      ? (JSON.parse(recent.result) as Record<string, unknown>)
      : {};
    return parsed.sourceRunId === runId;
  } catch {
    return false;
  }
}

/**
 * Hardened re-fire guard: checks whether a LEGAL_BENCHMARK_EVAL run for the
 * given runner run is either currently active (PENDING/IN_PROGRESS) OR was
 * created within the wider REFIRE_GUARD_WINDOW_MS cadence window.
 *
 * This prevents a failed `project_id` write-back (which leaves EvalSet.projectId
 * as null) from causing the next pass to re-dispatch against the same task and
 * waste eval budget.
 *
 * Fail-closed: returns true (treat as non-fresh) on any unexpected error.
 */
async function hasActiveOrRecentEvalRun(workspaceId: string, runId: string): Promise<boolean> {
  try {
    const windowStart = new Date(Date.now() - REFIRE_GUARD_WINDOW_MS);

    const run = await db.stakworkRun.findFirst({
      where: {
        workspaceId,
        type: StakworkRunType.LEGAL_BENCHMARK_EVAL,
        OR: [
          { status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] } },
          { createdAt: { gte: windowStart } },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, result: true, status: true },
    });

    if (!run) return false;

    try {
      const parsed = run.result
        ? (JSON.parse(run.result) as Record<string, unknown>)
        : {};
      return parsed.sourceRunId === runId;
    } catch {
      // Unparseable result — fail-closed: don't re-dispatch
      return true;
    }
  } catch {
    // DB error — fail-closed: don't re-dispatch
    return true;
  }
}

/**
 * Write back the eval projectId onto the EvalSet with bounded retries.
 * Logs CRITICAL on final failure (Stakwork project already exists but ID
 * never reached the graph — next pass will re-dispatch).
 */
async function writeBackWithRetry(
  config: Parameters<typeof writeBackEvalProjectId>[0],
  refId: string,
  projectId: number | string,
  maxRetries = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await writeBackEvalProjectId(config, refId, projectId);
    if (result.ok) {
      logger.info(
        `${LOG_PREFIX} write-back succeeded refId=${refId} projectId=${projectId} attempt=${attempt}`,
        "legal",
      );
      return;
    }
    logger.warn(
      `${LOG_PREFIX} write-back failed refId=${refId} attempt=${attempt}/${maxRetries}: ${result.error}`,
      "legal",
    );
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, attempt * 500));
    }
  }
  // CRITICAL: project created on Stakwork but project_id never landed on the EvalSet.
  // Next pass will see no projectId and may re-dispatch.
  logger.error(
    `${LOG_PREFIX} CRITICAL: write-back failed after ${maxRetries} attempts refId=${refId} projectId=${projectId} — next pass may re-dispatch`,
    "legal",
    { refId, projectId, maxRetries },
  );
}

/**
 * Main entry point for the legal recursion cron pass.
 * Never throws — always returns a RecursionCronResult.
 */
export async function executeScheduledLegalBenchmarkRecursion(): Promise<RecursionCronResult> {
  const timestamp = new Date();
  const result: RecursionCronResult = {
    success: true,
    entriesProcessed: 0,
    dispatched: 0,
    skipped: 0,
    deactivated: 0,
    attemptCapped: 0,
    plateauCapped: 0,
    errors: [],
    timestamp,
  };

  // ── Toggle gate ────────────────────────────────────────────────────────────
  const enabled = await isLegalBenchmarkRecursionEnabledForCron();
  logger.info(`${LOG_PREFIX} pass starting — recursion enabled=${enabled}`, "legal");

  if (!enabled) {
    logger.info(`${LOG_PREFIX} recursion disabled — clean no-op`, "legal");
    return result;
  }

  // ── Resolve openlaw workspace ──────────────────────────────────────────────
  const openlawWorkspace = await db.workspace.findFirst({
    where: { slug: "openlaw", deleted: false },
    select: { id: true, ownerId: true },
  });

  if (!openlawWorkspace) {
    logger.warn(`${LOG_PREFIX} openlaw workspace not found — aborting pass`, "legal");
    result.success = false;
    result.errors.push("openlaw workspace not found");
    return result;
  }

  // ── Resolve swarm access (no per-user check — cron-safe) ──────────────────
  const swarmResult = await getSwarmAccessByWorkspaceId(openlawWorkspace.id);
  if (!swarmResult.success) {
    logger.warn(
      `${LOG_PREFIX} swarm access failed: ${JSON.stringify(swarmResult.error)} — aborting pass`,
      "legal",
    );
    result.success = false;
    result.errors.push(`swarm access failed: ${JSON.stringify(swarmResult.error)}`);
    return result;
  }

  const { swarmUrl, swarmSecretAlias } = swarmResult.data;

  // ── Resolve Jarvis config ──────────────────────────────────────────────────
  const jarvisConfig = await getJarvisConfigForWorkspace(openlawWorkspace.id);
  if (!jarvisConfig) {
    logger.warn(`${LOG_PREFIX} Jarvis config not found for openlaw — aborting pass`, "legal");
    result.success = false;
    result.errors.push("Jarvis config not found for openlaw workspace");
    return result;
  }

  // ── Discover recursion-enabled EvalSets ────────────────────────────────────
  const listResult = await listRecursionEvalSets(jarvisConfig);
  if (!listResult.ok || !listResult.nodes) {
    logger.warn(
      `${LOG_PREFIX} listRecursionEvalSets failed: ${listResult.error ?? "unknown"} — aborting pass`,
      "legal",
    );
    result.success = false;
    result.errors.push(`listRecursionEvalSets failed: ${listResult.error ?? "unknown"}`);
    return result;
  }

  const evalSets = listResult.nodes;
  logger.info(`${LOG_PREFIX} discovered ${evalSets.length} recursion=true EvalSet(s)`, "legal");

  if (evalSets.length === 0) {
    return result;
  }

  // ── Read config caps ──────────────────────────────────────────────────────
  const capRow = await db.platformConfig.findUnique({
    where: { key: RECURSION_MAX_CONCURRENT_KEY },
    select: { value: true },
  });
  const cap = capRow?.value ? parseInt(capRow.value, 10) : DEFAULT_RECURSION_CAP;
  const effectiveCap = isNaN(cap) || cap < 1 ? DEFAULT_RECURSION_CAP : cap;

  const maxAttemptsRow = await db.platformConfig.findUnique({
    where: { key: RECURSION_MAX_ATTEMPTS_KEY },
    select: { value: true },
  });
  const maxAttemptsParsed = maxAttemptsRow?.value ? parseInt(maxAttemptsRow.value, 10) : DEFAULT_RECURSION_MAX_ATTEMPTS;
  const effectiveMaxAttempts = isNaN(maxAttemptsParsed) || maxAttemptsParsed < 1 ? DEFAULT_RECURSION_MAX_ATTEMPTS : maxAttemptsParsed;

  const plateauLimitRow = await db.platformConfig.findUnique({
    where: { key: RECURSION_PLATEAU_LIMIT_KEY },
    select: { value: true },
  });
  const plateauLimitParsed = plateauLimitRow?.value ? parseInt(plateauLimitRow.value, 10) : DEFAULT_RECURSION_PLATEAU_LIMIT;
  const effectivePlateauLimit = isNaN(plateauLimitParsed) || plateauLimitParsed < 1 ? DEFAULT_RECURSION_PLATEAU_LIMIT : plateauLimitParsed;

  // ── Live-status gate — check each EvalSet with a projectId ────────────────
  const running: RecursionEvalSetEntry[] = [];
  const eligible: RecursionEvalSetEntry[] = [];

  for (const evalSet of evalSets) {
    result.entriesProcessed++;

    if (evalSet.projectId != null) {
      // Fetch live status — fail-closed: null/unmapped = ineligible
      const rawStatus = await getLiveProjectStatus(evalSet.projectId);
      const mappedStatus = rawStatus ? mapStakworkStatus(rawStatus) : null;

      if (mappedStatus === null) {
        logger.info(
          `${LOG_PREFIX} EvalSet ${evalSet.ref_id} status=${rawStatus ?? "unknown"} (unmapped/failed) — skipping (fail-closed)`,
          "legal",
        );
        result.skipped++;
        continue;
      }

      if (mappedStatus === WorkflowStatus.IN_PROGRESS) {
        logger.info(
          `${LOG_PREFIX} EvalSet ${evalSet.ref_id} status=IN_PROGRESS — skipping (still running)`,
          "legal",
        );
        running.push(evalSet);
        result.skipped++;
        continue;
      }

      // Terminal status (COMPLETED, FAILED, HALTED) — eligible
      eligible.push(evalSet);
    } else {
      // No projectId — could be a first run OR a failed write-back from a prior pass.
      // Resolve the runner run first so we can check against existing eval runs.
      // We defer the resolver call here to avoid redundant DB calls for the
      // common no-projectId first-run case — the eval check is only needed when
      // this might be a write-back-failure scenario.
      //
      // Strategy: eagerly check the wider re-fire guard.  If an active or
      // recent eval run exists for this task's runner run, skip it.
      // This prevents the write-back-failure budget-waste described in the
      // CRITICAL log in writeBackWithRetry.
      const earlyRunId = await resolveRunnerRunId(openlawWorkspace.id, evalSet.id);
      if (earlyRunId) {
        const isNonFresh = await hasActiveOrRecentEvalRun(openlawWorkspace.id, earlyRunId);
        if (isNonFresh) {
          logger.info(
            `${LOG_PREFIX} EvalSet ${evalSet.ref_id} has no projectId but a recent/active eval run already exists for runId=${earlyRunId} — skipping (re-fire guard)`,
            "legal",
          );
          result.skipped++;
          continue;
        }
      }

      logger.info(
        `${LOG_PREFIX} EvalSet ${evalSet.ref_id} has no projectId — eligible (first run or post-write-back-failure)`,
        "legal",
      );
      eligible.push(evalSet);
    }
  }

  const runningCount = running.length;
  let available = Math.max(0, effectiveCap - runningCount);
  logger.info(
    `${LOG_PREFIX} cap=${effectiveCap} running=${runningCount} available=${available} eligible=${eligible.length}`,
    "legal",
  );

  // ── Dispatch eligible tasks up to available ───────────────────────────────
  for (const evalSet of eligible) {
    if (available <= 0) {
      logger.info(
        `${LOG_PREFIX} cap reached (available=0) — skipping EvalSet ${evalSet.ref_id}`,
        "legal",
      );
      result.skipped++;
      continue;
    }

    // Resolve the most recent completed runner run for this task
    const runId = await resolveRunnerRunId(openlawWorkspace.id, evalSet.id);
    if (!runId) {
      logger.info(
        `${LOG_PREFIX} no LEGAL_BENCHMARK_RUNNER run found for EvalSet ${evalSet.ref_id} (id=${evalSet.id}) — skipping`,
        "legal",
      );
      result.skipped++;
      continue;
    }

    // Narrow recent-duplicate safety-net (write-back failure window guard)
    const isDuplicate = await hasRecentEvalRun(openlawWorkspace.id, runId);
    if (isDuplicate) {
      logger.info(
        `${LOG_PREFIX} recent eval run already exists for runId=${runId} (EvalSet ${evalSet.ref_id}) — skipping (safety-net)`,
        "legal",
      );
      result.skipped++;
      continue;
    }

    // ── Attempt/plateau cap gate (runs last, after cheap checks) ─────────────
    // Fetch subgraph rooted at this EvalSet and compute attempt/plateau stats.
    // Fail-open on subgraph fetch error — a transient graph hiccup must not
    // permanently block dispatch.  The only downside of skipping this gate is
    // one fewer stopping condition, not a duplicate-dispatch risk.
    const subgraphResult = await kgGetSubgraph(
      jarvisConfig.jarvisUrl,
      jarvisConfig.apiKey,
      evalSet.ref_id,
    );

    if (!subgraphResult.ok) {
      logger.warn(
        `${LOG_PREFIX} kgGetSubgraph failed for EvalSet ${evalSet.ref_id} — proceeding to dispatch (fail-open): ${subgraphResult.error}`,
        "legal",
        { refId: evalSet.ref_id, error: subgraphResult.error },
      );
    } else {
      // Resolve cutoff from the EvalSet's recursionEnabledAt property (if present)
      const recursionEnabledAtRaw = (evalSet as RecursionEvalSetEntry & { recursionEnabledAt?: number | string | null }).recursionEnabledAt;
      let cutoff: Date | undefined;
      if (recursionEnabledAtRaw != null) {
        const ts = typeof recursionEnabledAtRaw === "number"
          ? recursionEnabledAtRaw
          : parseFloat(String(recursionEnabledAtRaw));
        if (!isNaN(ts)) {
          cutoff = new Date(ts * 1000); // convert Unix seconds to ms
        }
      }

      const stats = computeAttemptStats(subgraphResult.subgraph, evalSet.ref_id, { cutoff });

      logger.info(
        `${LOG_PREFIX} EvalSet ${evalSet.ref_id} attemptCount=${stats.attemptCount} plateauStreak=${stats.plateauStreak} maxAttempts=${effectiveMaxAttempts} plateauLimit=${effectivePlateauLimit}`,
        "legal",
        { refId: evalSet.ref_id, attemptCount: stats.attemptCount, plateauStreak: stats.plateauStreak },
      );

      if (stats.attemptCount >= effectiveMaxAttempts) {
        logger.info(
          `${LOG_PREFIX} EvalSet ${evalSet.ref_id} hit attempt cap (${stats.attemptCount} >= ${effectiveMaxAttempts}) — disabling recursion`,
          "legal",
          { refId: evalSet.ref_id, attemptCount: stats.attemptCount, cap: effectiveMaxAttempts },
        );
        try {
          await setEvalSetRecursion(jarvisConfig, evalSet.ref_id, false);
        } catch (disableErr) {
          logger.error(
            `${LOG_PREFIX} setEvalSetRecursion(false) failed for EvalSet ${evalSet.ref_id} after attempt cap — will retry next pass: ${disableErr instanceof Error ? disableErr.message : String(disableErr)}`,
            "legal",
            { refId: evalSet.ref_id },
          );
        }
        result.attemptCapped++;
        continue;
      }

      if (stats.plateauStreak >= effectivePlateauLimit) {
        logger.info(
          `${LOG_PREFIX} EvalSet ${evalSet.ref_id} hit plateau cap (${stats.plateauStreak} >= ${effectivePlateauLimit}) — disabling recursion`,
          "legal",
          { refId: evalSet.ref_id, plateauStreak: stats.plateauStreak, cap: effectivePlateauLimit },
        );
        try {
          await setEvalSetRecursion(jarvisConfig, evalSet.ref_id, false);
        } catch (disableErr) {
          logger.error(
            `${LOG_PREFIX} setEvalSetRecursion(false) failed for EvalSet ${evalSet.ref_id} after plateau cap — will retry next pass: ${disableErr instanceof Error ? disableErr.message : String(disableErr)}`,
            "legal",
            { refId: evalSet.ref_id },
          );
        }
        result.plateauCapped++;
        continue;
      }
    }

    // Dispatch with bypass of rerun guards
    try {
      const dispatchResult = await dispatchLegalBenchmarkEvalRun({
        runId,
        workspaceId: openlawWorkspace.id,
        swarmUrl,
        swarmSecretAlias,
        slug: "openlaw",
        userId: openlawWorkspace.ownerId,
        bypassRerunGuards: true,
      });

      logger.info(
        `${LOG_PREFIX} dispatched eval for EvalSet ${evalSet.ref_id} runId=${runId} evalRunId=${dispatchResult.evalRunId} projectId=${dispatchResult.projectId}`,
        "legal",
      );

      result.dispatched++;
      available--; // Decrement in-pass to hold cap under status lag

      // Write back the returned projectId so the next pass sees the running project
      if (dispatchResult.projectId != null) {
        await writeBackWithRetry(jarvisConfig, evalSet.ref_id, dispatchResult.projectId);
      } else {
        logger.warn(
          `${LOG_PREFIX} dispatch returned no projectId for EvalSet ${evalSet.ref_id} — write-back skipped`,
          "legal",
        );
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errCode = (err as { code?: string }).code;

      if (errCode === "NO_FAILURES") {
        logger.info(
          `${LOG_PREFIX} EvalSet ${evalSet.ref_id} has no failures to re-evaluate — skipping`,
          "legal",
        );
        result.skipped++;
      } else {
        logger.warn(
          `${LOG_PREFIX} dispatch failed for EvalSet ${evalSet.ref_id} runId=${runId}: ${errMsg}`,
          "legal",
        );
        result.errors.push(`EvalSet ${evalSet.ref_id}: ${errMsg}`);
        result.skipped++;
      }
    }
  }

  logger.info(
    `${LOG_PREFIX} pass complete — entriesProcessed=${result.entriesProcessed} dispatched=${result.dispatched} skipped=${result.skipped} attemptCapped=${result.attemptCapped} plateauCapped=${result.plateauCapped} errors=${result.errors.length}`,
    "legal",
  );

  return result;
}
