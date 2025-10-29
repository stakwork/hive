import { executePRTracking } from "@/services/pr-tracking-cron";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET endpoint for Vercel cron execution and health check
 * Vercel cron jobs trigger GET requests, not POST
 * 
 * This endpoint checks agent mode tasks with open PRs and marks them
 * as completed when their PRs are merged.
 */
export async function GET(request: NextRequest) {
  console.log("PR Tracking GET called");
  console.log(request);

  try {
    // Check if PR tracking is enabled
    const prTrackingEnabled = process.env.PR_TRACKING_ENABLED !== "false"; // Default to true
    if (!prTrackingEnabled) {
      console.log("[PRTrackingCron] PR Tracking is disabled via PR_TRACKING_ENABLED");
      return NextResponse.json({
        success: true,
        message: "PR Tracking is disabled",
        tasksProcessed: 0,
        tasksCompleted: 0,
        errors: []
      });
    }

    console.log("[PRTrackingCron] Starting PR Tracking execution");

    // Execute the PR tracking
    const result = await executePRTracking();

    // Log execution results
    if (result.success) {
      console.log(
        `[PRTrackingCron] Execution completed successfully. Processed ${result.tasksProcessed} tasks, completed ${result.tasksCompleted} tasks`
      );
    } else {
      console.error(
        `[PRTrackingCron] Execution completed with errors. Processed ${result.tasksProcessed} tasks, completed ${result.tasksCompleted} tasks, ${result.errors.length} errors`
      );

      // Log individual errors
      result.errors.forEach((error, index) => {
        console.error(`[PRTrackingCron] Error ${index + 1}: ${error.taskId} - ${error.error}`);
      });
    }

    return NextResponse.json({
      success: result.success,
      tasksProcessed: result.tasksProcessed,
      tasksCompleted: result.tasksCompleted,
      errorCount: result.errors.length,
      errors: result.errors,
      timestamp: result.timestamp
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[PRTrackingCron] Unhandled error:", errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
