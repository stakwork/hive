import { executePodScalerRuns } from "@/services/pod-scaler-cron";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET endpoint for Vercel cron execution
 * Auto-scales minimum_vms based on over-queued task demand (runs every 5 minutes).
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (process.env.POD_SCALER_CRON_ENABLED !== "true") {
      console.log("[PodScalerCron] Pod scaler cron is disabled via POD_SCALER_CRON_ENABLED");
      return NextResponse.json({
        success: true,
        message: "Pod scaler cron is disabled",
      });
    }

    console.log("[PodScalerCron] Starting pod scaler execution");
    const result = await executePodScalerRuns();

    if (result.success) {
      console.log(
        `[PodScalerCron] Completed. Processed ${result.swarmsProcessed} swarms, scaled ${result.swarmsScaled}`
      );
    } else {
      console.error(
        `[PodScalerCron] Completed with errors: ${result.errors.length}`
      );
      result.errors.forEach((err, i) => {
        console.error(`[PodScalerCron] Error ${i + 1}: ${err.swarmId} - ${err.error}`);
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[PodScalerCron] Unhandled error:", errorMessage);
    return NextResponse.json(
      { success: false, error: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
