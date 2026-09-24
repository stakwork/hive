import { NextRequest, NextResponse } from "next/server";
import { reconcileStrutRuns } from "@/services/strut-runs";
import { logger } from "@/lib/logger";

/**
 * GET /api/cron/strut-runs-reconcile — every 10 minutes (vercel.json).
 *
 * The backstop for a strut `run.end` callback that never arrived (network
 * drop past strut's retry ladder, a hive deploy mid-delivery, a swarm
 * restart mid-run): every `StrutRun` still PENDING past the threshold is
 * asked about on the ROW's swarm — `GET {lab}/workflows/:name/runs/:runId`
 * — and settled through the same completion path the webhook uses, or
 * marked LOST when strut has no record of it. Never re-dispatches.
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
    return NextResponse.json({ success: true, stats, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("[StrutRunsReconcileCron] Unhandled error", "strut-runs-reconcile", { error: errorMessage });
    return NextResponse.json(
      { success: false, error: errorMessage, timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
