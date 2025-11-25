import { db } from "@/lib/db";
import { JanitorType } from "@prisma/client";
import { createJanitorRun } from "@/services/janitor";
import { 
  createEnabledJanitorWhereConditions, 
  isJanitorEnabled 
} from "@/lib/constants/janitor";

export interface CronExecutionResult {
  success: boolean;
  workspacesProcessed: number;
  runsCreated: number;
  skipped: number;
  errors: Array<{
    workspaceSlug: string;
    janitorType: JanitorType;
    error: string;
  }>;
  timestamp: Date;
}

/**
 * Get all workspaces with enabled janitors
 */
export async function getWorkspacesWithEnabledJanitors(): Promise<Array<{
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  janitorConfig: {
    id: string;
    unitTestsEnabled: boolean;
    integrationTestsEnabled: boolean;
    e2eTestsEnabled: boolean;
    securityReviewEnabled: boolean;
  } | null;
}>> {
  return await db.workspace.findMany({
    where: {
      deleted: false,
      janitorConfig: {
        OR: createEnabledJanitorWhereConditions()
      }
    },
    select: {
      id: true,
      slug: true,
      name: true,
      ownerId: true,
      janitorConfig: {
        select: {
          id: true,
          unitTestsEnabled: true,
          integrationTestsEnabled: true,
          e2eTestsEnabled: true,
          securityReviewEnabled: true,
        }
      }
    }
  });
}

// Sequential janitor types - only one active task at a time per type
const SEQUENTIAL_JANITOR_TYPES: JanitorType[] = [JanitorType.UNIT_TESTS, JanitorType.INTEGRATION_TESTS];

/**
 * Check if a workspace has an active task for a specific janitor type.
 * Active = task from an accepted recommendation that doesn't have a merged PR yet.
 */
export async function hasActiveJanitorTask(
  workspaceId: string,
  janitorType: JanitorType
): Promise<boolean> {
  // Find ACCEPTED recommendations with a linked task for this janitor type
  const activeRecommendations = await db.janitorRecommendation.findMany({
    where: {
      workspaceId,
      status: "ACCEPTED",
      taskId: { not: null },
      janitorRun: { janitorType },
    },
    include: {
      task: {
        include: {
          chatMessages: {
            include: {
              artifacts: { where: { type: "PULL_REQUEST" } }
            },
            orderBy: { createdAt: "desc" }
          }
        }
      }
    }
  });

  for (const rec of activeRecommendations) {
    const task = rec.task;
    // Skip if task is cancelled or workflow failed - these are "discarded" tasks
    if (!task || task.status === "CANCELLED" || task.workflowStatus === "FAILED") continue;

    const prArtifacts = task.chatMessages.flatMap(m => m.artifacts);

    if (prArtifacts.length === 0) {
      // No PR yet - task is active if not manually done
      if (task.status !== "DONE") {
        console.log(`[JanitorCron] Found active task ${task.id} for ${janitorType}: no PR yet`);
        return true;
      }
    } else {
      // Has PR - check if merged or cancelled
      const latestPr = prArtifacts[0];
      const content = latestPr.content as { status?: string };
      // DONE = merged, CANCELLED = closed without merge
      // Only these two statuses allow new janitor runs
      if (content.status !== "DONE" && content.status !== "CANCELLED") {
        console.log(`[JanitorCron] Found active task ${task.id} for ${janitorType}: PR not merged/closed (status: ${content.status})`);
        return true;
      }
    }
  }

  return false;
}


/**
 * Execute scheduled janitor runs across all enabled workspaces
 */
export async function executeScheduledJanitorRuns(): Promise<CronExecutionResult> {
  const result: CronExecutionResult = {
    success: true,
    workspacesProcessed: 0,
    runsCreated: 0,
    skipped: 0,
    errors: [],
    timestamp: new Date()
  };

  console.log(`[JanitorCron] Starting scheduled janitor execution at ${result.timestamp.toISOString()}`);

  try {
    const workspaces = await getWorkspacesWithEnabledJanitors();
    console.log(`[JanitorCron] Found ${workspaces.length} workspaces with enabled janitors`);

    result.workspacesProcessed = workspaces.length;

    for (const workspace of workspaces) {
      const { id: workspaceId, slug, name, ownerId, janitorConfig } = workspace;

      if (!janitorConfig) {
        console.log(`[JanitorCron] Skipping workspace ${slug}: no janitor config`);
        continue;
      }

      console.log(`[JanitorCron] Processing workspace: ${name} (${slug})`);

      // Process all enabled janitor types
      for (const janitorType of Object.values(JanitorType)) {
        if (isJanitorEnabled(janitorConfig, janitorType)) {
          // For sequential janitor types, check if there's an active task
          if (SEQUENTIAL_JANITOR_TYPES.includes(janitorType)) {
            const hasActive = await hasActiveJanitorTask(workspaceId, janitorType);
            if (hasActive) {
              console.log(`[JanitorCron] Skipping ${janitorType} for ${slug}: active task exists`);
              result.skipped++;
              continue;
            }
          }

          try {
            console.log(`[JanitorCron] Creating ${janitorType} run for workspace ${slug}`);
            await createJanitorRun(slug, ownerId, janitorType.toLowerCase(), "SCHEDULED");
            result.runsCreated++;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[JanitorCron] Error creating ${janitorType} run for workspace ${slug}:`, errorMessage);
            result.errors.push({
              workspaceSlug: slug,
              janitorType: janitorType,
              error: errorMessage
            });
            result.success = false;
          }
        }
      }
    }

    console.log(`[JanitorCron] Execution completed. Runs created: ${result.runsCreated}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[JanitorCron] Critical error during execution:`, errorMessage);
    result.success = false;
    result.errors.push({
      workspaceSlug: "SYSTEM",
      janitorType: "UNIT_TESTS", // placeholder
      error: errorMessage
    });
  }

  return result;
}