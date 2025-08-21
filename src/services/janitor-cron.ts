import { db } from "@/lib/db";
import { JanitorType } from "@prisma/client";
import { createJanitorRun } from "@/services/janitor";

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
  } | null;
}>> {
  return await db.workspace.findMany({
    where: {
      deleted: false,
      janitorConfig: {
        OR: [
          { unitTestsEnabled: true },
          { integrationTestsEnabled: true }
        ]
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

      // Process unit tests janitor if enabled
      if (janitorConfig.unitTestsEnabled) {
        try {
          console.log(`[JanitorCron] Creating UNIT_TESTS run for workspace ${slug}`);
          await createJanitorRun(slug, ownerId, "unit_tests", "SCHEDULED");
          result.runsCreated++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[JanitorCron] Error creating UNIT_TESTS run for workspace ${slug}:`, errorMessage);
          result.errors.push({
            workspaceSlug: slug,
            janitorType: "UNIT_TESTS",
            error: errorMessage
          });
          result.success = false;
        }
      }

      // Process integration tests janitor if enabled
      if (janitorConfig.integrationTestsEnabled) {
        try {
          console.log(`[JanitorCron] Creating INTEGRATION_TESTS run for workspace ${slug}`);
          await createJanitorRun(slug, ownerId, "integration_tests", "SCHEDULED");
          result.runsCreated++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[JanitorCron] Error creating INTEGRATION_TESTS run for workspace ${slug}:`, errorMessage);
          result.errors.push({
            workspaceSlug: slug,
            janitorType: "INTEGRATION_TESTS",
            error: errorMessage
          });
          result.success = false;
        }
      }
    }

    console.log(`[JanitorCron] Execution completed. Runs created: ${result.runsCreated}, Errors: ${result.errors.length}`);
    
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