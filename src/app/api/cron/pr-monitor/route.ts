import { monitorOpenPRs } from "@/lib/github/pr-monitor";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET endpoint for Vercel cron execution
 * Monitors open PRs for merge conflicts and CI failures
 */
export async function GET(request: NextRequest) {
  try {
    // Verify Vercel cron secret
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if cron is enabled
    const cronEnabled = process.env.PR_MONITOR_CRON_ENABLED === "true";
    if (!cronEnabled) {
      console.log("[PRMonitorCron] PR monitor cron is disabled via PR_MONITOR_CRON_ENABLED");
      return NextResponse.json({
        success: true,
        message: "PR monitor cron is disabled",
        stats: {
          checked: 0,
          conflicts: 0,
          ciFailures: 0,
          healthy: 0,
          errors: 0,
          agentTriggered: 0,
          notified: 0,
        },
      });
    }

    console.log("[PRMonitorCron] Starting PR monitoring run");

    // Execute the PR monitoring
    // Default to checking 10 PRs per run to stay within rate limits
    const maxPRs = parseInt(process.env.PR_MONITOR_MAX_PRS || "10", 10);
    const stats = await monitorOpenPRs(maxPRs);

    console.log("[PRMonitorCron] Monitoring run completed", stats);

    return NextResponse.json({
      success: true,
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[PRMonitorCron] Unhandled error:", errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
