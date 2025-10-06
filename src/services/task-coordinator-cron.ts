import { db } from "@/lib/db";
import { getServiceConfig } from "@/config/services";
import { PoolManagerService } from "@/services/pool-manager";

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
 * Execute Task Coordinator runs for all enabled workspaces
 */
export async function executeTaskCoordinatorRuns(): Promise<TaskCoordinatorExecutionResult> {
  const startTime = new Date();
  const errors: Array<{ workspaceSlug: string; error: string }> = [];
  let workspacesProcessed = 0;
  let tasksCreated = 0;

  try {
    console.log("[TaskCoordinator] Starting execution at", startTime.toISOString());

    // Get all workspaces with Task Coordinator enabled
    const enabledWorkspaces = await db.workspace.findMany({
      where: {
        janitorConfig: {
          taskCoordinatorEnabled: true
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

    console.log(`[TaskCoordinator] Found ${enabledWorkspaces.length} workspaces with Task Coordinator enabled`);

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

        if (availablePods === 0) {
          console.log(`[TaskCoordinator] No available pods for workspace ${workspace.slug}, skipping`);
          continue;
        }

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
          take: availablePods // Only take as many as we have pods
        });

        console.log(`[TaskCoordinator] Found ${pendingRecommendations.length} pending recommendations for workspace ${workspace.slug}`);

        // Accept recommendations up to available pod count
        for (const recommendation of pendingRecommendations) {
          try {
            console.log(`[TaskCoordinator] Auto-accepting recommendation ${recommendation.id} (${recommendation.priority}) for workspace ${workspace.slug}`);

            // Use the existing acceptJanitorRecommendation service
            const { acceptJanitorRecommendation } = await import("@/services/janitor");

            // Accept the recommendation - this will create a task with sourceType: JANITOR
            await acceptJanitorRecommendation(
              recommendation.id,
              workspace.owner.id, // Use workspace owner as the accepting user
              {} // No specific assignee or repository
            );

            tasksCreated++;
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