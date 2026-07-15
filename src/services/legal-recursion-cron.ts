/**
 * legal-recursion-cron.ts
 *
 * Cron service for the OpenLaw Recursion Janitor.
 * Processes all ACTIVE LegalBenchmarkRecursion entries, re-dispatching
 * the recursion workflow (57456) until all rubrics pass. Runs every 6 hours.
 *
 * Log prefix: [LegalRecursionCron]
 */

import { db } from "@/lib/db";
import { RecursionStatus, StakworkRunType, WorkflowStatus } from "@prisma/client";
import { parseBenchmarkRunResult } from "@/types/legal";
import { dispatchLegalBenchmarkRecursionRun } from "@/services/legal-benchmark-eval";

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
  const openlawWorkspace = await db.workspace.findUnique({
    where: { slug: "openlaw" },
    select: {
      id: true,
    },
  });

  if (!openlawWorkspace) {
    console.error("[LegalRecursionCron] openlaw workspace not found — aborting");
    return { ...result, success: false, errors: ["openlaw workspace not found"] };
  }

  const openlawId = openlawWorkspace.id;

  // ── Step 2: Fetch all ACTIVE recursion entries ───────────────────────────
  const activeEntries = await db.legalBenchmarkRecursion.findMany({
    where: { workspaceId: openlawId, status: RecursionStatus.ACTIVE },
  });

  console.log(`[LegalRecursionCron] Processing ${activeEntries.length} ACTIVE entries`);

  // ── Step 3: Fetch all in-flight recursion runs (for in-flight guard) ─────
  // Query LEGAL_BENCHMARK_RECURSION rows in PENDING/IN_PROGRESS state and
  // extract their originating recursionId from the result JSON.
  const inFlightRecursionRuns = await db.stakworkRun.findMany({
    where: {
      workspaceId: openlawId,
      type: StakworkRunType.LEGAL_BENCHMARK_RECURSION,
      status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] },
    },
    select: { result: true },
  });

  const inFlightRecursionIds = new Set<string>();
  for (const run of inFlightRecursionRuns) {
    try {
      if (run.result) {
        const parsed = JSON.parse(run.result) as Record<string, unknown>;
        if (typeof parsed.recursionId === "string") {
          inFlightRecursionIds.add(parsed.recursionId);
        }
      }
    } catch {
      // Ignore parse errors — can't determine recursionId, won't skip
    }
  }

  // ── Step 4: Per-entry processing loop ────────────────────────────────────
  for (const entry of activeEntries) {
    result.entriesProcessed++;

    try {
      const targetRunId = entry.lastRunId ?? entry.runId;

      // ── a. In-flight guard ─────────────────────────────────────────────
      if (inFlightRecursionIds.has(entry.id)) {
        console.log(
          `[LegalRecursionCron] SKIP taskSlug=${entry.taskSlug} (recursion in-flight)`,
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
      const { recursionRunId } = await dispatchLegalBenchmarkRecursionRun({
        runId: targetRunId,
        taskSlug: entry.taskSlug,
        workspaceId: openlawId,
        recursionId: entry.id,
      });

      await db.legalBenchmarkRecursion.update({
        where: { id: entry.id },
        data: {
          lastRunId: recursionRunId,
          lastRunAt: new Date(),
          lastScore,
        },
      });

      console.log(
        `[LegalRecursionCron] DISPATCH taskSlug=${entry.taskSlug} recursionRunId=${recursionRunId}`,
      );
      result.dispatched++;
    } catch (err) {
      // Error isolation: per-entry errors must not halt remaining entries.
      // NEVER log JSON.stringify(err) or the full error object —
      // dispatch payloads contain hive_api_token.
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
