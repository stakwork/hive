import { NextRequest, NextResponse } from "next/server";
import { executeTaskCoordinatorRuns } from "@/services/task-coordinator-cron";

/**
 * Cron endpoint for automated Task Coordinator execution
 * Protected by CRON_SECRET environment variable
 */
export async function POST(request: NextRequest) {
  try {
    // Security: Verify cron secret
    const authHeader = request.headers.get("authorization");
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret) {
      console.error("[TaskCoordinatorCron] CRON_SECRET not configured");
      return NextResponse.json(
        { error: "Cron functionality not configured" },
        { status: 503 }
      );
    }

    if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
      console.error("[TaskCoordinatorCron] Invalid or missing authorization");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Check if task coordinator is enabled
    const taskCoordinatorEnabled = process.env.TASK_COORDINATOR_ENABLED === "true";
    if (!taskCoordinatorEnabled) {
      console.log("[TaskCoordinatorCron] Task Coordinator is disabled via TASK_COORDINATOR_ENABLED");
      return NextResponse.json({
        success: true,
        message: "Task Coordinator is disabled",
        workspacesProcessed: 0,
        tasksCreated: 0,
        errors: []
      });
    }

    console.log("[TaskCoordinatorCron] Starting Task Coordinator execution");

    // Execute the task coordinator runs
    const result = await executeTaskCoordinatorRuns();

    // Log execution results
    if (result.success) {
      console.log(`[TaskCoordinatorCron] Execution completed successfully. Processed ${result.workspacesProcessed} workspaces, created ${result.tasksCreated} tasks`);
    } else {
      console.error(`[TaskCoordinatorCron] Execution completed with errors. Processed ${result.workspacesProcessed} workspaces, created ${result.tasksCreated} tasks, ${result.errors.length} errors`);

      // Log individual errors
      result.errors.forEach((error, index) => {
        console.error(`[TaskCoordinatorCron] Error ${index + 1}: ${error.workspaceSlug} - ${error.error}`);
      });
    }

    return NextResponse.json({
      success: result.success,
      workspacesProcessed: result.workspacesProcessed,
      tasksCreated: result.tasksCreated,
      errorCount: result.errors.length,
      errors: result.errors,
      timestamp: result.timestamp
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[TaskCoordinatorCron] Unhandled error:", errorMessage);

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

    const taskCoordinatorEnabled = process.env.TASK_COORDINATOR_ENABLED === "true";

    return NextResponse.json({
      enabled: taskCoordinatorEnabled,
      schedule: "* * * * *", // Every minute
      scheduleSource: "vercel.json",
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[TaskCoordinatorCron] Health check error:", errorMessage);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}