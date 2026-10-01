import { NextRequest, NextResponse } from "next/server";
import { reconcileStrutRuns } from "@/services/strut-runs";
import { sweepOpenHealthClimbs } from "@/services/strut-runs/openhealth-climb";
import { logger } from "@/lib/logger";

/**
 * GET /api/cron/strut-runs-reconcile — every 10 minutes (vercel.json).
 *
 * The backstop for a strut `run.end` callback that never arrived (network
 * drop past strut's retry ladder, a hive deploy mid-delivery, a swarm
 * restart mid-run): every `StrutRun` still PENDING past the threshold is
 * asked about on the ROW's swarm — `GET {lab}/workflows/:name/runs/:runId`
 * — and settled through the same completion path the webhook uses, or
 * marked LOST when strut has no record of it, or reports it `stale` twice
 * ten seconds apart (strut restarted and did not resume it). Never
 * re-dispatches.
 *
 * Then the OpenHealth climbs: a climb left RUNNING with a settled step is
 * advanced again (`sweepOpenHealthClimbs`), which may launch its next step.
 *
 * Enabled by default; `STRUT_RUNS_RECONCILE_CRON_ENABLED=false` disables
 * it (a safety net — opt-out, not opt-in).
 */
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (process.env.STRUT_RUNS_RECONCILE_CRON_ENABLED === "false") {
      return NextResponse.json({
        success: true,
        message: "Strut runs reconcile cron is disabled",
        stats: { swept: 0, settled: 0, lost: 0, running: 0, unavailable: 0, retry: 0 },
      });
    }

    const stats = await reconcileStrutRuns();
    const climbs = await sweepOpenHealthClimbs().catch((error: unknown) => {
      logger.error("[StrutRunsReconcileCron] climb sweep failed", "strut-runs-reconcile", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
    return NextResponse.json({ success: true, stats, climbs, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("[StrutRunsReconcileCron] Unhandled error", "strut-runs-reconcile", { error: errorMessage });
    return NextResponse.json(
      { success: false, error: errorMessage, timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
