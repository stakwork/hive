import { db } from "@/lib/db";
import { JanitorType, JanitorTrigger } from "@prisma/client";
import { createJanitorRun } from "@/services/janitor";
import * as cron from "node-cron";

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
 * Check if there are any pending or running janitor runs for a workspace
 */
export async function hasActiveJanitorRuns(
  janitorConfigId: string, 
  janitorType: JanitorType
): Promise<boolean> {
  const activeRun = await db.janitorRun.findFirst({
    where: {
      janitorConfigId,
      janitorType,
      status: { in: ["PENDING", "RUNNING"] }
    }
  });

  return !!activeRun;
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
          const hasActive = await hasActiveJanitorRuns(janitorConfig.id, "UNIT_TESTS");
          
          if (!hasActive) {
            console.log(`[JanitorCron] Creating UNIT_TESTS run for workspace ${slug}`);
            await createJanitorRun(slug, ownerId, "unit_tests", "SCHEDULED");
            result.runsCreated++;
          } else {
            console.log(`[JanitorCron] Skipping UNIT_TESTS for workspace ${slug}: run already active`);
          }
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
          const hasActive = await hasActiveJanitorRuns(janitorConfig.id, "INTEGRATION_TESTS");
          
          if (!hasActive) {
            console.log(`[JanitorCron] Creating INTEGRATION_TESTS run for workspace ${slug}`);
            await createJanitorRun(slug, ownerId, "integration_tests", "SCHEDULED");
            result.runsCreated++;
          } else {
            console.log(`[JanitorCron] Skipping INTEGRATION_TESTS for workspace ${slug}: run already active`);
          }
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

/**
 * Validate cron expression using node-cron
 */
export function validateCronExpression(expression: string): boolean {
  return cron.validate(expression);
}

/**
 * Get human-readable description of cron schedule
 */
export function describeCronSchedule(expression: string): string {
  if (!validateCronExpression(expression)) {
    return "Invalid cron expression";
  }

  // Common patterns
  const patterns = [
    { pattern: "0 * * * *", description: "Every hour" },
    { pattern: "0 */2 * * *", description: "Every 2 hours" },
    { pattern: "0 */6 * * *", description: "Every 6 hours" },
    { pattern: "0 */12 * * *", description: "Every 12 hours" },
    { pattern: "0 0 * * *", description: "Daily at midnight" },
    { pattern: "0 2 * * *", description: "Daily at 2:00 AM" },
    { pattern: "0 9 * * 1", description: "Every Monday at 9:00 AM" },
    { pattern: "0 0 * * 0", description: "Every Sunday at midnight" }
  ];

  const match = patterns.find(p => p.pattern === expression);
  if (match) {
    return match.description;
  }

  // Parse the expression parts
  const parts = expression.split(" ");
  if (parts.length !== 5) {
    return "Custom schedule";
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  
  if (minute === "0" && hour.startsWith("*/")) {
    const interval = hour.slice(2);
    return `Every ${interval} hours`;
  }

  return "Custom schedule";
}