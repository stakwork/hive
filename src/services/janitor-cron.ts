import { db } from "@/lib/db";
import { JanitorType } from "@prisma/client";
import { createJanitorRun } from "@/services/janitor";
import { 
import { logger } from "@/lib/logger";
  createEnabledJanitorWhereConditions, 
  isJanitorEnabled 
} from "@/lib/constants/janitor";

export interface CronExecutionResult {
  success: boolean;
  workspacesProcessed: number;
  runsCreated: number;
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


/**
 * Execute scheduled janitor runs across all enabled workspaces
 */
export async function executeScheduledJanitorRuns(): Promise<CronExecutionResult> {
  const result: CronExecutionResult = {
    success: true,
    workspacesProcessed: 0,
    runsCreated: 0,
    errors: [],
    timestamp: new Date()
  };

  logger.debug(`[JanitorCron] Starting scheduled janitor execution at ${result.timestamp.toISOString()}`);

  try {
    const workspaces = await getWorkspacesWithEnabledJanitors();
    logger.debug(`[JanitorCron] Found ${workspaces.length} workspaces with enabled janitors`);

    result.workspacesProcessed = workspaces.length;

    for (const workspace of workspaces) {
      const { slug, name, ownerId, janitorConfig } = workspace;
      
      if (!janitorConfig) {
        logger.debug(`[JanitorCron] Skipping workspace ${slug}: no janitor config`);
        continue;
      }

      logger.debug(`[JanitorCron] Processing workspace: ${name} (${slug})`);

      // Process all enabled janitor types
      for (const janitorType of Object.values(JanitorType)) {
        if (isJanitorEnabled(janitorConfig, janitorType)) {
          try {
            logger.debug(`[JanitorCron] Creating ${janitorType} run for workspace ${slug}`);
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

    logger.debug(`[JanitorCron] Execution completed. Runs created: ${result.runsCreated}, Errors: ${result.errors.length}`, "janitor-cron");
    
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