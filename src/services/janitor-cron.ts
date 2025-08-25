import { db } from "@/lib/db";
import { JanitorType, RecommendationStatus } from "@prisma/client";
import { createJanitorRun } from "@/services/janitor";
import { 
  createEnabledJanitorWhereConditions, 
  isJanitorEnabled 
} from "@/lib/constants/janitor";

export interface CronExecutionResult {
  success: boolean;
  workspacesProcessed: number;
  runsCreated: number;
  runsSkipped: number;
  errors: Array<{
    workspaceSlug: string;
    janitorType: JanitorType;
    error: string;
  }>;
  timestamp: Date;
}

/**
 * Check if there are too many pending recommendations for a specific janitor type and workspace
 */
async function hasTooManyPendingRecommendations(
  janitorConfigId: string, 
  janitorType: JanitorType,
  maxPendingRecommendations: number = 5
): Promise<boolean> {
  // First get all run IDs for this config and type
  const runs = await db.janitorRun.findMany({
    where: {
      janitorConfigId,
      janitorType
    },
    select: { id: true }
  });
  
  if (runs.length === 0) {
    console.log(`[JanitorCron] No previous runs for ${janitorType} in config ${janitorConfigId}`);
    return false;
  }
  
  // Then count pending recommendations for those runs
  const pendingCount = await db.janitorRecommendation.count({
    where: {
      janitorRunId: { in: runs.map(r => r.id) },
      status: RecommendationStatus.PENDING
    }
  });
  
  console.log(`[JanitorCron] Pending recommendations for ${janitorType} in config ${janitorConfigId}: ${pendingCount} (from ${runs.length} runs)`);
  
  return pendingCount >= maxPendingRecommendations;
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
        }
      }
    }
  });
}


/**
 * Execute scheduled janitor runs across all enabled workspaces
 */
export async function executeScheduledJanitorRuns(): Promise<CronExecutionResult> {
  const result: CronExecutionResult = {
    success: true,
    workspacesProcessed: 0,
    runsCreated: 0,
    runsSkipped: 0,
    errors: [],
    timestamp: new Date()
  };

  console.log(`[JanitorCron] Starting scheduled janitor execution at ${result.timestamp.toISOString()}`);

  try {
    const workspaces = await getWorkspacesWithEnabledJanitors();
    console.log(`[JanitorCron] Found ${workspaces.length} workspaces with enabled janitors`);

    result.workspacesProcessed = workspaces.length;

    for (const workspace of workspaces) {
      const { slug, name, ownerId, janitorConfig } = workspace;
      
      if (!janitorConfig) {
        console.log(`[JanitorCron] Skipping workspace ${slug}: no janitor config`);
        continue;
      }

      console.log(`[JanitorCron] Processing workspace: ${name} (${slug})`);

      // Process all enabled janitor types
      for (const janitorType of Object.values(JanitorType)) {
        if (isJanitorEnabled(janitorConfig, janitorType)) {
          console.log(`[JanitorCron] Checking ${janitorType} for workspace ${slug} (config: ${janitorConfig.id})`);
          
          try {
            // Check if there are too many pending recommendations for this janitor type
            const tooManyPending = await hasTooManyPendingRecommendations(janitorConfig.id, janitorType);
            
            if (tooManyPending) {
              console.log(`[JanitorCron] Skipping ${janitorType} for workspace ${slug}: too many pending recommendations (5+)`);
              result.runsSkipped++;
              continue;
            }
            
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

    console.log(`[JanitorCron] Execution completed. Runs created: ${result.runsCreated}, Skipped: ${result.runsSkipped}, Errors: ${result.errors.length}`);
    
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