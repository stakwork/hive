import { executeTaskCoordinatorRuns } from "@/services/task-coordinator-cron";
import { checkAndUpdateMergedPRs } from "@/services/pr-tracking-cron";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET endpoint for Vercel cron execution and health check
 * Vercel cron jobs trigger GET requests, not POST
 */
export async function GET(request: NextRequest) {
  console.log("Task Coordinator GET called");
  console.log(request);

  try {
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

    // Execute PR tracking as a separate function
    console.log("[TaskCoordinatorCron] Starting PR tracking check");
    const prResult = await checkAndUpdateMergedPRs();
    
    // Log PR tracking results
    if (prResult.success) {
      console.log(`[TaskCoordinatorCron] PR tracking completed successfully. Checked ${prResult.tasksChecked} tasks, updated ${prResult.tasksUpdated} tasks`);
    } else {
      console.error(`[TaskCoordinatorCron] PR tracking completed with errors. Checked ${prResult.tasksChecked} tasks, updated ${prResult.tasksUpdated} tasks, ${prResult.errors.length} errors`);
      
      // Log individual errors
      prResult.errors.forEach((error, index) => {
        console.error(`[TaskCoordinatorCron] PR Error ${index + 1}: Task ${error.taskId} - ${error.error}`);
      });
    }

    return NextResponse.json({
      success: result.success && prResult.success,
      taskCoordinator: {
        workspacesProcessed: result.workspacesProcessed,
        tasksCreated: result.tasksCreated,
        errorCount: result.errors.length,
        errors: result.errors,
      },
      prTracking: {
        tasksChecked: prResult.tasksChecked,
        tasksUpdated: prResult.tasksUpdated,
        errorCount: prResult.errors.length,
        errors: prResult.errors,
      },
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