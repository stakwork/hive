import { NextRequest, NextResponse } from "next/server";
import { executeScheduledJanitorRuns, validateCronExpression } from "@/services/janitor-cron";

/**
 * Cron endpoint for automated janitor execution
 * Protected by CRON_SECRET environment variable
 */
export async function POST(request: NextRequest) {
  try {
    // Security: Verify cron secret
    const authHeader = request.headers.get("authorization");
    const expectedSecret = process.env.CRON_SECRET;
    
    if (!expectedSecret) {
      console.error("[CronAPI] CRON_SECRET not configured");
      return NextResponse.json(
        { error: "Cron functionality not configured" },
        { status: 503 }
      );
    }

    if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
      console.error("[CronAPI] Invalid or missing authorization");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
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

    // Validate cron schedule (for logging purposes)
    const cronSchedule = process.env.JANITOR_CRON_SCHEDULE;
    if (cronSchedule && !validateCronExpression(cronSchedule)) {
      console.warn(`[CronAPI] Invalid cron schedule configured: ${cronSchedule}`);
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

/**
 * GET endpoint for health check and configuration info
 */
export async function GET(request: NextRequest) {
  try {
    // Security: Verify cron secret for GET as well
    const authHeader = request.headers.get("authorization");
    const expectedSecret = process.env.CRON_SECRET;
    
    if (!expectedSecret) {
      return NextResponse.json(
        { error: "Cron functionality not configured" },
        { status: 503 }
      );
    }

    if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const cronEnabled = process.env.JANITOR_CRON_ENABLED === "true";
    const cronSchedule = process.env.JANITOR_CRON_SCHEDULE || "Not configured";
    const isValidSchedule = cronSchedule !== "Not configured" ? validateCronExpression(cronSchedule) : false;

    return NextResponse.json({
      enabled: cronEnabled,
      schedule: cronSchedule,
      scheduleValid: isValidSchedule,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[CronAPI] Health check error:", errorMessage);
    
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}