import { db } from "@/lib/db";
import { getServiceConfig } from "@/config/services";
import { PoolManagerService } from "@/services/pool-manager";
import { startTaskWorkflow } from "@/services/task-workflow";
import { releaseTaskPod } from "@/lib/pods";

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
 * Check if all task dependencies are satisfied (completed)
 *
 * Dependency satisfaction logic:
 * 1. If task has NO PR artifacts: Check task.status === "DONE" (manual completion)
 * 2. If task has PR artifacts: Check latest PR artifact status === "DONE" (merged)
 *    - Ignores task.status when PR exists (PR merge is source of truth)
 */
export async function areDependenciesSatisfied(
  dependsOnTaskIds: string[]
): Promise<boolean> {
  if (dependsOnTaskIds.length === 0) {
    return true; // No dependencies = always satisfied
  }

  // Batch fetch all dependency tasks with their PR artifacts
  const dependencyTasks = await db.task.findMany({
    where: {
      id: {
        in: dependsOnTaskIds,
      },
    },
    include: {
      chatMessages: {
        include: {
          artifacts: {
            where: {
              type: "PULL_REQUEST",
            },
          },
        },
        orderBy: {
          createdAt: "desc", // Latest messages first for finding latest PR
        },
      },
    },
  });

  // Detect circular or missing dependencies
  if (dependencyTasks.length !== dependsOnTaskIds.length) {
    console.warn(
      `[TaskCoordinator] Dependency validation warning: Expected ${dependsOnTaskIds.length} dependencies, found ${dependencyTasks.length}`
    );
    return false; // Missing dependencies = not satisfied
  }

  // Check if each dependency is satisfied
  for (const depTask of dependencyTasks) {
    // Collect all PR artifacts from chat messages
    const prArtifacts = depTask.chatMessages.flatMap((message) => message.artifacts);

    let isDependencySatisfied = false;

    if (prArtifacts.length === 0) {
      // No PR artifacts - check manual status
      isDependencySatisfied = depTask.status === "DONE";

      if (!isDependencySatisfied) {
        console.log(
          `[TaskCoordinator] Dependency ${depTask.id} not satisfied - no PR artifact, status: ${depTask.status}`
        );
      }
    } else {
      // Has PR artifacts - find latest and check if merged
      // Sort by createdAt to get most recent
      const sortedArtifacts = [...prArtifacts].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      const latestPrArtifact = sortedArtifacts[0];
      const content = latestPrArtifact.content as { status?: string; url?: string } | null;

      isDependencySatisfied = content?.status === "DONE";

      if (!isDependencySatisfied) {
        console.log(
          `[TaskCoordinator] Dependency ${depTask.id} not satisfied - has PR artifact (${content?.url || 'unknown'}), latest status: ${content?.status || 'unknown'}`
        );
      }
    }

    if (!isDependencySatisfied) {
      return false;
    }
  }

  return true; // All dependencies satisfied
}

/**
 * Process ticket sweep - find and process eligible tasks assigned to TASK_COORDINATOR
 */
async function processTicketSweep(
  workspaceId: string,
  workspaceSlug: string
): Promise<boolean> {
  console.log(`[TaskCoordinator] Processing ticket sweep for workspace ${workspaceSlug}`);

  // Query for candidate tickets: TODO status, TASK_COORDINATOR assignee
  // We fetch more tasks to filter by dependency satisfaction
  const candidateTasks = await db.task.findMany({
    where: {
      workspaceId,
      status: "TODO",
      systemAssigneeType: "TASK_COORDINATOR",
      deleted: false,
    },
    include: {
      feature: {
        select: {
          id: true,
          title: true,
          createdById: true,
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
    take: 20, // Fetch more candidates to filter through
  });

  if (candidateTasks.length === 0) {
    console.log(`[TaskCoordinator] No candidate tickets found for workspace ${workspaceSlug}`);
    return false;
  }

  console.log(`[TaskCoordinator] Found ${candidateTasks.length} candidate tickets, checking dependencies...`);

  // Filter tasks by dependency satisfaction
  let task = null;
  for (const candidateTask of candidateTasks) {
    const dependenciesSatisfied = await areDependenciesSatisfied(
      candidateTask.dependsOnTaskIds
    );

    if (dependenciesSatisfied) {
      task = candidateTask;
      console.log(
        `[TaskCoordinator] Found eligible task ${task.id} with ${task.dependsOnTaskIds.length} satisfied dependencies`
      );
      break;
    } else {
      console.log(
        `[TaskCoordinator] Skipping task ${candidateTask.id} - dependencies not satisfied`
      );
    }
  }

  if (!task) {
    console.log(
      `[TaskCoordinator] No tickets with satisfied dependencies found for workspace ${workspaceSlug}`
    );
    return false;
  }
  console.log(`[TaskCoordinator] Processing ticket ${task.id} (${task.priority}) for workspace ${workspaceSlug}`);

  try {
    // Assign to task creator, fall back to feature creator if needed
    const userId = task.createdById ?? task.feature?.createdById;

    // Start workflow for this task (automatically builds message and feature context)
    await startTaskWorkflow({
      taskId: task.id,
      userId,
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
 * @param taskId - The task ID to halt
 * @param clearPodFields - If true, also clears podId, agentUrl, agentPassword
 */
export async function haltTask(taskId: string, clearPodFields = false): Promise<void> {
  await db.task.update({
    where: { id: taskId },
    data: {
      workflowStatus: "HALTED",
      workflowCompletedAt: new Date(),
      ...(clearPodFields && {
        podId: null,
        agentUrl: null,
        agentPassword: null,
      }),
    },
  });
}

/**
 * Release stale pods and halt stale IN_PROGRESS tasks
 *
 * Two concerns handled:
 * 1. Release pods: ANY task with podId that's been idle for STALE_TASK_HOURS gets pod released
 * 2. Halt tasks: Stale IN_PROGRESS tasks get their workflowStatus set to HALTED (with or without pods)
 *
 * This catches "leaked" pods from tasks that completed/failed but didn't release their pod
 */
export async function releaseStaleTaskPods(): Promise<{
  success: boolean;
  tasksHalted: number;
  podsReleased: number;
  errors: Array<{ taskId: string; error: string }>;
  timestamp: string;
}> {
  const errors: Array<{ taskId: string; error: string }> = [];
  let tasksHalted = 0;
  let podsReleased = 0;

  try {
    // Configurable stale task threshold (default: 24 hours)
    const staleHours = parseInt(process.env.STALE_TASK_HOURS || "24", 10);
    console.log(`[ReleaseStaleTaskPods] Starting execution (threshold: ${staleHours} hours)`);

    // Calculate the threshold timestamp
    const staleThreshold = new Date();
    staleThreshold.setHours(staleThreshold.getHours() - staleHours);

    // Find stale tasks that either:
    // 1. Have a pod (any status) - need to release the pod
    // 2. Are IN_PROGRESS without a pod - need to halt them
    const staleTasks = await db.task.findMany({
      where: {
        updatedAt: {
          lt: staleThreshold,
        },
        deleted: false,
        OR: [
          // Tasks with pods (any status) - release pod
          { podId: { not: null } },
          // IN_PROGRESS tasks without pods - just halt
          {
            status: "IN_PROGRESS",
            workflowStatus: { not: "HALTED" },
          },
        ],
      },
      select: {
        id: true,
        title: true,
        workspaceId: true,
        updatedAt: true,
        podId: true,
        status: true,
        workflowStatus: true,
        chatMessages: {
          select: {
            artifacts: {
              where: { type: "PULL_REQUEST" },
              select: {
                content: true,
              },
            },
          },
        },
      },
    });

    console.log(`[ReleaseStaleTaskPods] Found ${staleTasks.length} stale tasks to process`);

    // Process all stale tasks
    for (const task of staleTasks) {
      try {
        // Check if task has an open PR - don't halt if PR is pending review/merge
        const prArtifacts = task.chatMessages?.flatMap((m) => m.artifacts) || [];
        const hasOpenPr = prArtifacts.some((pr) => {
          const content = pr.content as { status?: string } | null;
          // PR is open if it has a status that's not DONE (merged) or CANCELLED
          return content?.status && content.status !== "DONE" && content.status !== "CANCELLED";
        });

        if (hasOpenPr) {
          console.log(
            `[ReleaseStaleTaskPods] Skipping halt for task ${task.id} - has open PR`
          );
        }

        // Determine if this task should be halted (only IN_PROGRESS tasks not already halted, and no open PR)
        const shouldHalt = task.status === "IN_PROGRESS" && task.workflowStatus !== "HALTED" && !hasOpenPr;

        if (task.podId) {
          // Task has a pod - use releaseTaskPod to release it
          // If should halt: set to HALTED
          // If already done/failed/etc: pass null to preserve original workflowStatus
          const newWorkflowStatus = shouldHalt ? "HALTED" : null;

          const result = await releaseTaskPod({
            taskId: task.id,
            podId: task.podId,
            workspaceId: task.workspaceId,
            verifyOwnership: true,
            resetRepositories: false,
            clearTaskFields: true,
            newWorkflowStatus,
          });

          if (result.podDropped) {
            podsReleased++;
          }

          if (shouldHalt && (result.success || result.taskCleared)) {
            tasksHalted++;
          }

          console.log(
            `[ReleaseStaleTaskPods] Processed task ${task.id} (status: ${task.status}, workflowStatus: ${task.workflowStatus}): ` +
            `pod released: ${result.podDropped}, halted: ${shouldHalt}, reassigned: ${result.reassigned || false}` +
            (hasOpenPr ? `, skipped halt due to open PR` : "")
          );

          if (!result.success && result.error) {
            throw new Error(result.error);
          }
        } else if (shouldHalt) {
          // Task has no pod but is stale IN_PROGRESS - just halt it
          await haltTask(task.id, false);
          tasksHalted++;

          console.log(
            `[ReleaseStaleTaskPods] Halted stale IN_PROGRESS task ${task.id} (no pod)`
          );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[ReleaseStaleTaskPods] Error processing task ${task.id}:`, errorMessage);
        errors.push({
          taskId: task.id,
          error: errorMessage,
        });
      }
    }

    console.log(
      `[ReleaseStaleTaskPods] Execution completed. Released ${podsReleased} pods, halted ${tasksHalted} IN_PROGRESS tasks, ${errors.length} errors`
    );

    return {
      success: errors.length === 0,
      tasksHalted,
      podsReleased,
      errors,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[ReleaseStaleTaskPods] Critical error during execution:", errorMessage);

    return {
      success: false,
      tasksHalted,
      podsReleased,
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

    // First, release stale pods and halt any stuck IN_PROGRESS tasks
    try {
      const haltResult = await releaseStaleTaskPods();
      console.log(`[TaskCoordinator] Released ${haltResult.podsReleased} stale pods, halted ${haltResult.tasksHalted} tasks`);
      if (!haltResult.success) {
        haltResult.errors.forEach(error => {
          errors.push({
            workspaceSlug: "SYSTEM",
            error: `Failed to halt task ${error.taskId}: ${error.error}`
          });
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[TaskCoordinator] Error halting stale tasks:", errorMessage);
      errors.push({
        workspaceSlug: "SYSTEM",
        error: `Failed to halt stale tasks: ${errorMessage}`
      });
    }

    // Get all workspaces with either sweep enabled
    const enabledWorkspaces = await db.workspace.findMany({
      where: {
        janitorConfig: {
          OR: [
            { recommendationSweepEnabled: true },
            { ticketSweepEnabled: true }
          ]
        }
      },
      include: {
        janitorConfig: true,
        swarm: true,
        owner: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
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
          workspace.swarm.poolApiKey
        );

        const availablePods = poolStatusResponse.status.unusedVms;
        console.log(`[TaskCoordinator] Workspace ${workspace.slug} has ${availablePods} available pods`);

        if (availablePods <= 1) {
          console.log(`[TaskCoordinator] Insufficient available pods for workspace ${workspace.slug} (need 2+ to reserve 1), skipping`);
          continue;
        }

        let itemProcessed = false;

        // Priority 1: Ticket Sweep (if enabled)
        if (workspace.janitorConfig?.ticketSweepEnabled) {
          try {
            itemProcessed = await processTicketSweep(
              workspace.id,
              workspace.slug
            );
            if (itemProcessed) {
              tasksCreated++;
              console.log(`[TaskCoordinator] Processed ticket sweep for workspace ${workspace.slug}`);
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[TaskCoordinator] Ticket sweep failed for workspace ${workspace.slug}:`, errorMessage);
            errors.push({
              workspaceSlug: workspace.slug,
              error: `Ticket sweep failed: ${errorMessage}`
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
                    workspaceId: workspace.id
                  }
                }
              },
              include: {
                janitorRun: {
                  include: {
                    janitorConfig: {
                      include: {
                        workspace: true
                      }
                    }
                  }
                }
              },
              orderBy: [
                {
                  priority: "desc" // CRITICAL first, then HIGH, MEDIUM, LOW
                },
                {
                  createdAt: "asc" // Oldest first for same priority
                }
              ],
              take: 1 // Only process one recommendation at a time
            });

            console.log(`[TaskCoordinator] Found ${pendingRecommendations.length} pending recommendations for workspace ${workspace.slug}`);

            // Accept recommendations while reserving 1 pod (only processes when 2+ pods available)
            for (const recommendation of pendingRecommendations) {
              try {
                console.log(`[TaskCoordinator] Auto-accepting recommendation ${recommendation.id} (${recommendation.priority}) for workspace ${workspace.slug}`);

                // Use the existing acceptJanitorRecommendation service
                const { acceptJanitorRecommendation } = await import("@/services/janitor");

                // Accept the recommendation - this will create a task with sourceType: TASK_COORDINATOR
                await acceptJanitorRecommendation(
                  recommendation.id,
                  workspace.owner.id, // Use workspace owner as the accepting user
                  {}, // No specific assignee or repository
                  "TASK_COORDINATOR" // Mark as auto-accepted by Task Coordinator
                );

                tasksCreated++;
                itemProcessed = true;
                console.log(`[TaskCoordinator] Successfully created task from recommendation ${recommendation.id}`);

              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`[TaskCoordinator] Failed to accept recommendation ${recommendation.id}:`, errorMessage);
                errors.push({
                  workspaceSlug: workspace.slug,
                  error: `Failed to accept recommendation ${recommendation.id}: ${errorMessage}`
                });
              }
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[TaskCoordinator] Recommendation sweep failed for workspace ${workspace.slug}:`, errorMessage);
            errors.push({
              workspaceSlug: workspace.slug,
              error: `Recommendation sweep failed: ${errorMessage}`
            });
          }
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[TaskCoordinator] Error processing workspace ${workspace.slug}:`, errorMessage);
        errors.push({
          workspaceSlug: workspace.slug,
          error: errorMessage
        });
      }
    }

    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();

    console.log(`[TaskCoordinator] Execution completed in ${duration}ms. Processed ${workspacesProcessed} workspaces, created ${tasksCreated} tasks, ${errors.length} errors`);

    return {
      success: errors.length === 0,
      workspacesProcessed,
      tasksCreated,
      errorCount: errors.length,
      errors,
      timestamp: endTime.toISOString()
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
          error: `Critical execution error: ${errorMessage}`
        }
      ],
      timestamp: new Date().toISOString()
    };
  }
}
