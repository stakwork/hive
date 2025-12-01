import { executeScheduledJanitorRuns } from "@/services/janitor-cron";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET endpoint for Vercel cron execution and health check
 * Vercel cron jobs trigger GET requests, not POST
 */
export async function GET(request: NextRequest) {
  try {
    // Verify Vercel cron secret
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if cron is enabled
    const cronEnabled = process.env.JANITOR_CRON_ENABLED === "true";
    if (!cronEnabled) {
      console.log("[CronAPI] Janitor cron is disabled via JANITOR_CRON_ENABLED");
      return NextResponse.json({
        success: true,
        message: "Janitor cron is disabled",
        workspacesProcessed: 0,
        runsCreated: 0,
        errors: []
      });
    }

    console.log("[CronAPI] Starting scheduled janitor execution");

    // Execute the janitor runs
    const result = await executeScheduledJanitorRuns();

    // Log execution results
    if (result.success) {
      console.log(`[CronAPI] Execution completed successfully. Processed ${result.workspacesProcessed} workspaces, created ${result.runsCreated} runs`);
    } else {
      console.error(`[CronAPI] Execution completed with errors. Processed ${result.workspacesProcessed} workspaces, created ${result.runsCreated} runs, ${result.errors.length} errors`);

      // Log individual errors
      result.errors.forEach((error, index) => {
        console.error(`[CronAPI] Error ${index + 1}: ${error.workspaceSlug}/${error.janitorType} - ${error.error}`);
      });
    }

    return NextResponse.json({
      success: result.success,
      workspacesProcessed: result.workspacesProcessed,
      runsCreated: result.runsCreated,
      errorCount: result.errors.length,
      errors: result.errors,
      timestamp: result.timestamp.toISOString()
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[CronAPI] Unhandled error:", errorMessage);

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
