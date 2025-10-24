import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@/lib/chat";

/**
 * GET endpoint for Vercel cron execution to halt stale agent tasks
 * This runs periodically to find and halt agent tasks that have been in progress for >24 hours
 */
export async function GET() {
  try {
    // Check if cron is enabled
    const cronEnabled = process.env.HALT_STALE_TASKS_CRON_ENABLED === "true";
    if (!cronEnabled) {
      console.log("[HaltStaleTasks] Cron is disabled via HALT_STALE_TASKS_CRON_ENABLED");
      return NextResponse.json({
        success: true,
        message: "Halt stale tasks cron is disabled",
        tasksHalted: 0,
      });
    }

    console.log("[HaltStaleTasks] Starting stale task check");

    // Calculate 24 hours ago
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    // Find agent tasks that are IN_PROGRESS and started more than 24 hours ago
    const staleTasks = await db.task.findMany({
      where: {
        mode: "agent",
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        workflowStartedAt: {
          lt: twentyFourHoursAgo,
        },
        deleted: false,
      },
      select: {
        id: true,
        title: true,
        workflowStartedAt: true,
      },
    });

    console.log(`[HaltStaleTasks] Found ${staleTasks.length} stale tasks to halt`);

    // Halt each stale task
    const haltedTaskIds: string[] = [];
    const errors: Array<{ taskId: string; error: string }> = [];

    for (const task of staleTasks) {
      try {
        await db.task.update({
          where: { id: task.id },
          data: {
            workflowStatus: WorkflowStatus.HALTED,
          },
        });

        haltedTaskIds.push(task.id);
        console.log(
          `[HaltStaleTasks] Halted task ${task.id} "${task.title}" (started ${task.workflowStartedAt?.toISOString()})`,
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ taskId: task.id, error: errorMessage });
        console.error(`[HaltStaleTasks] Error halting task ${task.id}:`, errorMessage);
      }
    }

    const result = {
      success: errors.length === 0,
      tasksHalted: haltedTaskIds.length,
      haltedTaskIds,
      errorCount: errors.length,
      errors,
      timestamp: new Date().toISOString(),
    };

    console.log(`[HaltStaleTasks] Completed: halted ${result.tasksHalted} tasks with ${result.errorCount} errors`);

    return NextResponse.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[HaltStaleTasks] Fatal error:", errorMessage);

    return NextResponse.json(
      {
        success: false,
        message: "Fatal error during stale task halt execution",
        error: errorMessage,
      },
      { status: 500 },
    );
  }
}
