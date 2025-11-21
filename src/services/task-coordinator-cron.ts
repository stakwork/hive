import { db } from "@/lib/db";
import { getServiceConfig } from "@/config/services";
import { PoolManagerService } from "@/services/pool-manager";
import { startTaskWorkflow } from "@/services/task-workflow";

export interface TaskCoordinatorExecutionResult {
  success: boolean;
  workspacesProcessed: number;
  tasksCreated: number;
  errorCount: number;
  errors: Array<{
    workspaceSlug: string;
    error: string;
  }>;
  timestamp: string;
}

/**
 * Process ticket sweep - find and process eligible tasks assigned to TASK_COORDINATOR
 */
async function processTicketSweep(workspaceId: string, workspaceSlug: string, ownerId: string): Promise<boolean> {
  console.log(`[TaskCoordinator] Processing ticket sweep for workspace ${workspaceSlug}`);

  // Query for eligible tickets: TODO status, TASK_COORDINATOR assignee, no dependencies
  const eligibleTasks = await db.task.findMany({
    where: {
      workspaceId,
      status: "TODO",
      systemAssigneeType: "TASK_COORDINATOR",
      deleted: false,
      // Tasks with empty dependsOnTaskIds array (no dependencies)
      dependsOnTaskIds: {
        isEmpty: true,
      },
    },
    include: {
      feature: {
        select: {
          id: true,
          title: true,
        },
      },
      phase: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: [
      {
        priority: "desc", // CRITICAL first, then HIGH, MEDIUM, LOW
      },
      {
        createdAt: "asc", // Oldest first for same priority
      },
    ],
    take: 1, // Only process one task at a time
  });

  if (eligibleTasks.length === 0) {
    console.log(`[TaskCoordinator] No eligible tickets found for workspace ${workspaceSlug}`);
    return false;
  }

  const task = eligibleTasks[0];
  console.log(`[TaskCoordinator] Processing ticket ${task.id} (${task.priority}) for workspace ${workspaceSlug}`);

  try {
    // Start workflow for this task (automatically builds message and feature context)
    await startTaskWorkflow({
      taskId: task.id,
      userId: ownerId,
      mode: "live", // Use production workflow for automated task coordinator
    });

    console.log(`[TaskCoordinator] Successfully processed ticket ${task.id}`);
    return true;
  } catch (error) {
    console.error(`[TaskCoordinator] Error processing ticket ${task.id}:`, error);
    throw error;
  }
}

/**
 * Halt a specific task by updating its workflow status to HALTED
 * Can be called by cron job or manually
 */
export async function haltTask(taskId: string): Promise<void> {
  await db.task.update({
    where: { id: taskId },
    data: {
      workflowStatus: "HALTED",
      workflowCompletedAt: new Date(),
    },
  });
}

/**
 * Halt agent tasks that have been in IN_PROGRESS status for more than 24 hours
 */
export async function haltStaleAgentTasks(): Promise<{
  success: boolean;
  tasksHalted: number;
  errors: Array<{ taskId: string; error: string }>;
  timestamp: string;
}> {
  const errors: Array<{ taskId: string; error: string }> = [];
  let tasksHalted = 0;

  try {
    console.log("[HaltStaleAgentTasks] Starting execution");

    // Calculate the timestamp for 24 hours ago
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    // Find agent tasks that have been in IN_PROGRESS status for more than 24 hours
    const staleTasks = await db.task.findMany({
      where: {
        mode: "agent",
        status: "IN_PROGRESS",
        createdAt: {
          lt: twentyFourHoursAgo,
        },
        deleted: false,
      },
      select: {
        id: true,
        title: true,
        workspaceId: true,
        createdAt: true,
      },
    });

    console.log(`[HaltStaleAgentTasks] Found ${staleTasks.length} stale agent tasks`);

    // Update each task to HALTED status using the shared haltTask function
    for (const task of staleTasks) {
      try {
        await haltTask(task.id);

        tasksHalted++;
        console.log(`[HaltStaleAgentTasks] Halted task ${task.id} (${task.title}) - created at ${task.createdAt}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[HaltStaleAgentTasks] Error halting task ${task.id}:`, errorMessage);
        errors.push({
          taskId: task.id,
          error: errorMessage,
        });
      }
    }

    console.log(`[HaltStaleAgentTasks] Execution completed. Halted ${tasksHalted} tasks, ${errors.length} errors`);

    return {
      success: errors.length === 0,
      tasksHalted,
      errors,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[HaltStaleAgentTasks] Critical error during execution:", errorMessage);

    return {
      success: false,
      tasksHalted,
      errors: [
        ...errors,
        {
          taskId: "SYSTEM",
          error: `Critical execution error: ${errorMessage}`,
        },
      ],
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Execute Task Coordinator runs for all enabled workspaces
 */
export async function executeTaskCoordinatorRuns(): Promise<TaskCoordinatorExecutionResult> {
  const startTime = new Date();
  const errors: Array<{ workspaceSlug: string; error: string }> = [];
  let workspacesProcessed = 0;
  let tasksCreated = 0;

  try {
    console.log("[TaskCoordinator] Starting execution at", startTime.toISOString());

    // First, halt any stale agent tasks (IN_PROGRESS for >24 hours)
    try {
      const haltResult = await haltStaleAgentTasks();
      console.log(`[TaskCoordinator] Halted ${haltResult.tasksHalted} stale agent tasks`);
      if (!haltResult.success) {
        haltResult.errors.forEach((error) => {
          errors.push({
            workspaceSlug: "SYSTEM",
            error: `Failed to halt task ${error.taskId}: ${error.error}`,
          });
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[TaskCoordinator] Error halting stale tasks:", errorMessage);
      errors.push({
        workspaceSlug: "SYSTEM",
        error: `Failed to halt stale tasks: ${errorMessage}`,
      });
    }

    // Get all workspaces with either sweep enabled
    const enabledWorkspaces = await db.workspace.findMany({
      where: {
        janitorConfig: {
          OR: [{ recommendationSweepEnabled: true }, { ticketSweepEnabled: true }],
        },
      },
      include: {
        janitorConfig: true,
        swarm: true,
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    console.log(`[TaskCoordinator] Found ${enabledWorkspaces.length} workspaces with Task Coordinator Sweeps enabled`);

    for (const workspace of enabledWorkspaces) {
      try {
        workspacesProcessed++;
        console.log(`[TaskCoordinator] Processing workspace: ${workspace.slug}`);

        // Skip if no swarm or pool API key
        if (!workspace.swarm?.id || !workspace.swarm?.poolApiKey) {
          console.log(`[TaskCoordinator] Skipping workspace ${workspace.slug}: No pool configured`);
          continue;
        }

        // Check available pods
        const config = getServiceConfig("poolManager");
        const poolManagerService = new PoolManagerService(config);

        const poolStatusResponse = await poolManagerService.getPoolStatus(
          workspace.swarm.id,
          workspace.swarm.poolApiKey,
        );

        const availablePods = poolStatusResponse.status.unusedVms;
        console.log(`[TaskCoordinator] Workspace ${workspace.slug} has ${availablePods} available pods`);

        if (availablePods <= 1) {
          console.log(
            `[TaskCoordinator] Insufficient available pods for workspace ${workspace.slug} (need 2+ to reserve 1), skipping`,
          );
          continue;
        }

        let itemProcessed = false;

        // Priority 1: Ticket Sweep (if enabled)
        if (workspace.janitorConfig?.ticketSweepEnabled) {
          try {
            itemProcessed = await processTicketSweep(workspace.id, workspace.slug, workspace.owner.id);
            if (itemProcessed) {
              tasksCreated++;
              console.log(`[TaskCoordinator] Processed ticket sweep for workspace ${workspace.slug}`);
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[TaskCoordinator] Ticket sweep failed for workspace ${workspace.slug}:`, errorMessage);
            errors.push({
              workspaceSlug: workspace.slug,
              error: `Ticket sweep failed: ${errorMessage}`,
            });
          }
        }

        // Priority 2: Recommendation Sweep (if enabled and no ticket was processed)
        if (!itemProcessed && workspace.janitorConfig?.recommendationSweepEnabled) {
          try {
            // Get pending recommendations ordered by priority (CRITICAL > HIGH > MEDIUM > LOW)
            const pendingRecommendations = await db.janitorRecommendation.findMany({
              where: {
                status: "PENDING",
                janitorRun: {
                  janitorConfig: {
                    workspaceId: workspace.id,
                  },
                },
              },
              include: {
                janitorRun: {
                  include: {
                    janitorConfig: {
                      include: {
                        workspace: true,
                      },
                    },
                  },
                },
              },
              orderBy: [
                {
                  priority: "desc", // CRITICAL first, then HIGH, MEDIUM, LOW
                },
                {
                  createdAt: "asc", // Oldest first for same priority
                },
              ],
              take: 1, // Only process one recommendation at a time
            });

            console.log(
              `[TaskCoordinator] Found ${pendingRecommendations.length} pending recommendations for workspace ${workspace.slug}`,
            );

            // Accept recommendations while reserving 1 pod (only processes when 2+ pods available)
            for (const recommendation of pendingRecommendations) {
              try {
                console.log(
                  `[TaskCoordinator] Auto-accepting recommendation ${recommendation.id} (${recommendation.priority}) for workspace ${workspace.slug}`,
                );

                // Use the existing acceptJanitorRecommendation service
                const { acceptJanitorRecommendation } = await import("@/services/janitor");

                // Accept the recommendation - this will create a task with sourceType: TASK_COORDINATOR
                await acceptJanitorRecommendation(
                  recommendation.id,
                  workspace.owner.id, // Use workspace owner as the accepting user
                  {}, // No specific assignee or repository
                  "TASK_COORDINATOR", // Mark as auto-accepted by Task Coordinator
                );

                tasksCreated++;
                itemProcessed = true;
                console.log(`[TaskCoordinator] Successfully created task from recommendation ${recommendation.id}`);
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`[TaskCoordinator] Failed to accept recommendation ${recommendation.id}:`, errorMessage);
                errors.push({
                  workspaceSlug: workspace.slug,
                  error: `Failed to accept recommendation ${recommendation.id}: ${errorMessage}`,
                });
              }
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(
              `[TaskCoordinator] Recommendation sweep failed for workspace ${workspace.slug}:`,
              errorMessage,
            );
            errors.push({
              workspaceSlug: workspace.slug,
              error: `Recommendation sweep failed: ${errorMessage}`,
            });
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[TaskCoordinator] Error processing workspace ${workspace.slug}:`, errorMessage);
        errors.push({
          workspaceSlug: workspace.slug,
          error: errorMessage,
        });
      }
    }

    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();

    console.log(
      `[TaskCoordinator] Execution completed in ${duration}ms. Processed ${workspacesProcessed} workspaces, created ${tasksCreated} tasks, ${errors.length} errors`,
    );

    return {
      success: errors.length === 0,
      workspacesProcessed,
      tasksCreated,
      errorCount: errors.length,
      errors,
      timestamp: endTime.toISOString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[TaskCoordinator] Critical error during execution:", errorMessage);

    return {
      success: false,
      workspacesProcessed,
      tasksCreated,
      errorCount: errors.length + 1,
      errors: [
        ...errors,
        {
          workspaceSlug: "SYSTEM",
          error: `Critical execution error: ${errorMessage}`,
        },
      ],
      timestamp: new Date().toISOString(),
    };
  }
}
