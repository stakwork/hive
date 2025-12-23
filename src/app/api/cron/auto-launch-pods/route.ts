import { executeAutoLaunchPods } from "@/services/auto-launch-pods-cron";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET endpoint for Vercel cron execution
 * Automatically triggers pool creation when services and container files are ready
 */
export async function GET(request: NextRequest) {
  try {
    // Verify Vercel cron secret
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if auto-launch pods cron is enabled
    const cronEnabled = process.env.AUTO_LAUNCH_PODS_ENABLED === "true";
    if (!cronEnabled) {
      console.log(
        "[AutoLaunchPodsCron] Auto-launch pods cron is disabled via AUTO_LAUNCH_PODS_ENABLED"
      );
      return NextResponse.json({
        success: true,
        message: "Auto-launch pods cron is disabled",
        workspacesProcessed: 0,
        launchesTriggered: 0,
      });
    }

    console.log("[AutoLaunchPodsCron] Starting auto-launch pods execution");

    const result = await executeAutoLaunchPods();

    if (result.success) {
      console.log(
        `[AutoLaunchPodsCron] Completed. Processed ${result.workspacesProcessed} workspaces, triggered ${result.launchesTriggered} launches`
      );
    } else {
      console.error(
        `[AutoLaunchPodsCron] Completed with errors: ${result.errors.length}`
      );
      result.errors.forEach((error, index) => {
        console.error(
          `[AutoLaunchPodsCron] Error ${index + 1}: ${error.workspaceSlug} - ${error.error}`
        );
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error("[AutoLaunchPodsCron] Unhandled error:", errorMessage);

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