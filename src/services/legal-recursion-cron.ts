/**
 * legal-recursion-cron.ts
 *
 * Cron service for the OpenLaw Recursion Janitor.
 * Processes all ACTIVE LegalBenchmarkRecursion entries, re-dispatching
 * failing evals until all rubrics pass. Runs every 6 hours.
 *
 * Log prefix: [LegalRecursionCron]
 */

import { db } from "@/lib/db";
import { RecursionStatus, StakworkRunType, WorkflowStatus } from "@prisma/client";
import { parseBenchmarkRunResult } from "@/types/legal";
import { dispatchLegalBenchmarkEvalRun } from "@/services/legal-benchmark-eval";

export interface RecursionCronResult {
  success: boolean;
  entriesProcessed: number;
  dispatched: number;
  skipped: number;
  deactivated: number;
  errors: string[];
  timestamp: Date;
}

export async function executeScheduledLegalBenchmarkRecursion(): Promise<RecursionCronResult> {
  const result: RecursionCronResult = {
    success: true,
    entriesProcessed: 0,
    dispatched: 0,
    skipped: 0,
    deactivated: 0,
    errors: [],
    timestamp: new Date(),
  };

  // ── Step 1: Resolve openlaw workspace ───────────────────────────────────
  // CRITICAL: swarmUrl and swarmSecretAlias live on the related Swarm model.
  // Omitting include: { swarm: true } returns undefined for both fields and
  // silently breaks every dispatch.
  const openlawWorkspace = await db.workspace.findUnique({
    where: { slug: "openlaw" },
    select: {
      id: true,
      ownerId: true,
      swarm: {
        select: {
          swarmUrl: true,
          swarmSecretAlias: true,
        },
      },
    },
  });

  if (!openlawWorkspace) {
    console.error("[LegalRecursionCron] openlaw workspace not found — aborting");
    return { ...result, success: false, errors: ["openlaw workspace not found"] };
  }

  if (!openlawWorkspace.swarm) {
    console.error("[LegalRecursionCron] openlaw workspace has no swarm configured — aborting");
    return { ...result, success: false, errors: ["openlaw workspace swarm not configured"] };
  }

  const openlawId = openlawWorkspace.id;
  const ownerId = openlawWorkspace.ownerId;
  const swarmUrl = openlawWorkspace.swarm.swarmUrl ?? "";
  const swarmSecretAlias = openlawWorkspace.swarm.swarmSecretAlias ?? null;

  if (!swarmUrl) {
    console.error("[LegalRecursionCron] openlaw swarm URL is empty — aborting");
    return { ...result, success: false, errors: ["openlaw swarm URL is empty"] };
  }

  // ── Step 2: Fetch all ACTIVE recursion entries ───────────────────────────
  const activeEntries = await db.legalBenchmarkRecursion.findMany({
    where: { workspaceId: openlawId, status: RecursionStatus.ACTIVE },
  });

  console.log(`[LegalRecursionCron] Processing ${activeEntries.length} ACTIVE entries`);

  // ── Step 3: Fetch all in-flight eval runs once (for in-flight guard) ─────
  // StakworkRun has no indexed taskSlug column — task identity is stored in
  // the JSON result field as result.sourceRunId.
  const inFlightEvalRuns = await db.stakworkRun.findMany({
    where: {
      workspaceId: openlawId,
      type: StakworkRunType.LEGAL_BENCHMARK_EVAL,
      status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] },
    },
    select: { result: true },
  });

  // Parse sourceRunId from each in-flight eval
  const inFlightSourceRunIds = new Set<string>();
  for (const run of inFlightEvalRuns) {
    try {
      if (run.result) {
        const parsed = JSON.parse(run.result) as Record<string, unknown>;
        if (typeof parsed.sourceRunId === "string") {
          inFlightSourceRunIds.add(parsed.sourceRunId);
        }
      }
    } catch {
      // Ignore parse errors — can't determine sourceRunId, won't skip
    }
  }

  // ── Step 4: Per-entry processing loop ────────────────────────────────────
  for (const entry of activeEntries) {
    result.entriesProcessed++;

    try {
      const targetRunId = entry.lastRunId ?? entry.runId;

      // ── a. In-flight guard ─────────────────────────────────────────────
      if (inFlightSourceRunIds.has(targetRunId)) {
        console.log(
          `[LegalRecursionCron] SKIP taskSlug=${entry.taskSlug} (eval in-flight)`,
        );
        result.skipped++;
        continue;
      }

      // ── b. All-pass check ──────────────────────────────────────────────
      // IDOR: include workspaceId constraint on every StakworkRun lookup.
      const run = await db.stakworkRun.findUnique({
        where: { id: targetRunId, workspaceId: openlawId },
      });

      const runResult = parseBenchmarkRunResult(run?.result);
      const criteriaResults = runResult?.criteria_results ?? [];
      const failingCount = criteriaResults.filter(
        (c) => c.verdict?.toLowerCase() !== "pass",
      ).length;
      const lastScore = runResult
        ? `${runResult.n_passed ?? 0}/${runResult.n_total ?? 0}`
        : null;

      if (runResult?.all_pass === true || (criteriaResults.length > 0 && failingCount === 0)) {
        await db.legalBenchmarkRecursion.update({
          where: { id: entry.id },
          data: {
            status: RecursionStatus.INACTIVE,
            lastScore,
          },
        });
        console.log(
          `[LegalRecursionCron] INACTIVE taskSlug=${entry.taskSlug}`,
        );
        result.deactivated++;
        continue;
      }

      // ── c. Dispatch ────────────────────────────────────────────────────
      // Derive lastScore from the CURRENT run result BEFORE dispatching —
      // the freshly created eval run is PENDING and carries no result.
      const { evalRunId } = await dispatchLegalBenchmarkEvalRun({
        runId: targetRunId,
        workspaceId: openlawId,
        swarmUrl,
        swarmSecretAlias,
        slug: "openlaw",
        userId: ownerId,
      });

      await db.legalBenchmarkRecursion.update({
        where: { id: entry.id },
        data: {
          lastRunId: evalRunId,
          lastRunAt: new Date(),
          lastScore,
        },
      });

      console.log(
        `[LegalRecursionCron] DISPATCH taskSlug=${entry.taskSlug} evalRunId=${evalRunId}`,
      );
      result.dispatched++;
    } catch (err) {
      // Error isolation: per-entry errors must not halt remaining entries.
      // NEVER log JSON.stringify(err) or the full error object —
      // dispatch payloads contain apiKey, swarm_secret_alias, and Bifrost headers.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[LegalRecursionCron] ERROR taskSlug=${entry.taskSlug}: ${msg}`,
      );
      result.errors.push(`${entry.taskSlug}: ${msg}`);
      result.success = false;
    }
  }

  console.log(
    `[LegalRecursionCron] Done — processed=${result.entriesProcessed} dispatched=${result.dispatched} skipped=${result.skipped} deactivated=${result.deactivated} errors=${result.errors.length}`,
  );

  return result;
}
