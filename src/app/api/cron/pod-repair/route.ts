import { executePodRepairRuns } from "@/services/pod-repair-cron";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET endpoint for Vercel cron execution
 * Monitors workspaces for failed pod processes and triggers repair workflows
 */
export async function GET(request: NextRequest) {

  if (process.env.SKIP_POD_REPAIR_CRON === "true") {
    return NextResponse.json({ success: true, message: "Pod repair cron is skipped" });
  }

  try {
    // Verify Vercel cron secret
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if pod repair cron is enabled
    const cronEnabled = process.env.POD_REPAIR_CRON_ENABLED === "true";
    if (!cronEnabled) {
      console.log(
        "[PodRepairCron] Pod repair cron is disabled via POD_REPAIR_CRON_ENABLED"
      );
      return NextResponse.json({
        success: true,
        message: "Pod repair cron is disabled",
        workspacesProcessed: 0,
        repairsTriggered: 0,
      });
    }

    console.log("[PodRepairCron] Starting pod repair execution");

    const result = await executePodRepairRuns();

    if (result.success) {
      console.log(
        `[PodRepairCron] Completed. Processed ${result.workspacesProcessed} workspaces, triggered ${result.repairsTriggered} repairs`
      );
    } else {
      console.error(
        `[PodRepairCron] Completed with errors: ${result.errors.length}`
      );
      result.errors.forEach((error, index) => {
        console.error(
          `[PodRepairCron] Error ${index + 1}: ${error.workspaceSlug} - ${error.error}`
        );
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error("[PodRepairCron] Unhandled error:", errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
