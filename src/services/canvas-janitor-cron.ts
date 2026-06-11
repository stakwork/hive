/**
 * Canvas Janitor — Cron Scheduler
 *
 * Runs on a configurable per-org schedule, triggering `runCanvasJanitorForOrg`
 * when the org's interval has elapsed. Also cleans up stale runs stuck in
 * PENDING/RUNNING for more than 2 hours.
 */

import { db } from "@/lib/db";
import { JanitorStatus } from "@prisma/client";
import { runCanvasJanitorForOrg } from "@/services/canvas-janitor";

export interface CanvasCronResult {
  success: boolean;
  orgsProcessed: number;
  runsCreated: number;
  skipped: number;
  errors: Array<{ orgId: string; githubLogin: string; error: string }>;
}

export async function executeScheduledCanvasJanitorRuns(): Promise<CanvasCronResult> {
  const result: CanvasCronResult = {
    success: true,
    orgsProcessed: 0,
    runsCreated: 0,
    skipped: 0,
    errors: [],
  };

  // Cleanup stale runs first (stuck in PENDING/RUNNING > 2 hours)
  try {
    const staleThreshold = new Date(Date.now() - 2 * 3600_000);
    const cleaned = await db.canvasJanitorRun.updateMany({
      where: {
        status: { in: [JanitorStatus.PENDING, JanitorStatus.RUNNING] },
        startedAt: { lt: staleThreshold },
      },
      data: { status: JanitorStatus.FAILED },
    });
    if (cleaned.count > 0) {
      console.log(`[CanvasJanitorCron] Cleaned up ${cleaned.count} stale runs`);
    }
  } catch (err) {
    console.error("[CanvasJanitorCron] Stale run cleanup failed:", err);
  }

  // Fetch all enabled configs
  const configs = await db.canvasJanitorConfig.findMany({
    where: { enabled: true },
    include: {
      org: { select: { id: true, githubLogin: true } },
    },
  });

  console.log(`[CanvasJanitorCron] Found ${configs.length} enabled org configs`);

  for (const config of configs) {
    const { org } = config;
    const now = Date.now();
    const intervalMs = config.scheduleIntervalDays * 86_400_000;
    const lastRun = config.lastRunAt ? config.lastRunAt.getTime() : 0;

    if (lastRun > 0 && now - lastRun < intervalMs) {
      console.log(
        `[CanvasJanitorCron] Skipping org=${org.githubLogin} — within interval`,
      );
      result.skipped++;
      continue;
    }

    try {
      console.log(`[CanvasJanitorCron] Running janitor for org=${org.githubLogin}`);
      await runCanvasJanitorForOrg(org.id, config.id, undefined, "SCHEDULED");
      result.runsCreated++;
      result.orgsProcessed++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[CanvasJanitorCron] Error for org=${org.githubLogin}: ${errorMessage}`,
      );
      result.errors.push({
        orgId: org.id,
        githubLogin: org.githubLogin,
        error: errorMessage,
      });
      result.success = false;
    }
  }

  console.log(
    `[CanvasJanitorCron] Done — orgsProcessed=${result.orgsProcessed} runsCreated=${result.runsCreated} skipped=${result.skipped} errors=${result.errors.length}`,
  );

  return result;
}
