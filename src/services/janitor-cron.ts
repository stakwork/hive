import { db } from "@/lib/db";
import { JanitorType } from "@prisma/client";
import { createJanitorRun } from "@/services/janitor";
import { createEnabledJanitorWhereConditions, isJanitorEnabled } from "@/lib/constants/janitor";

export interface CronExecutionResult {
  success: boolean;
  workspacesProcessed: number;
  runsCreated: number;
  skipped: number;
  errors: Array<{
    workspaceSlug: string;
    janitorType: JanitorType;
    repositoryId?: string;
    error: string;
  }>;
  timestamp: Date;
}

/**
 * Get all workspaces with enabled janitors
 */
export async function getWorkspacesWithEnabledJanitors(): Promise<
  Array<{
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
      mockGenerationEnabled: boolean;
      generalRefactoringEnabled: boolean;
    } | null;
    repositories: Array<{
      id: string;
      repositoryUrl: string | null;
      branch: string | null;
      ignoreDirs: string | null;
    }>;
  }>
> {
  return await db.workspace.findMany({
    where: {
      deleted: false,
      janitorConfig: {
        OR: createEnabledJanitorWhereConditions(),
      },
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
          mockGenerationEnabled: true,
          generalRefactoringEnabled: true,
        },
      },
      repositories: {
        select: {
          id: true,
          repositoryUrl: true,
          branch: true,
          ignoreDirs: true,
        },
      },
    },
  });
}

// Stale janitor run threshold (2 hours)
const STALE_JANITOR_RUN_HOURS = 2;

// Sequential janitor types - only one active task at a time per type
const SEQUENTIAL_JANITOR_TYPES: JanitorType[] = [
  JanitorType.UNIT_TESTS,
  JanitorType.INTEGRATION_TESTS,
  JanitorType.E2E_TESTS,
  JanitorType.SECURITY_REVIEW,
  JanitorType.MOCK_GENERATION,
  JanitorType.GENERAL_REFACTORING,
];

/**
 * Cleanup stale janitor runs that have been stuck in PENDING or RUNNING for too long.
 * Marks them as FAILED so new runs can be created.
 */
export async function cleanupStaleJanitorRuns(): Promise<{
  cleaned: number;
  errors: Array<{ runId: string; error: string }>;
}> {
  const staleThreshold = new Date();
  staleThreshold.setHours(staleThreshold.getHours() - STALE_JANITOR_RUN_HOURS);

  // Find runs stuck in PENDING or RUNNING for > 2 hours
  const staleRuns = await db.janitorRun.findMany({
    where: {
      status: { in: ["PENDING", "RUNNING"] },
      createdAt: { lt: staleThreshold },
    },
  });

  let cleaned = 0;
  const errors: Array<{ runId: string; error: string }> = [];

  for (const run of staleRuns) {
    try {
      await db.janitorRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          error: `Janitor run timed out after ${STALE_JANITOR_RUN_HOURS} hour(s) in ${run.status} status`,
        },
      });
      cleaned++;
      console.log(`[JanitorCron] Cleaned up stale run ${run.id} (${run.janitorType}, was ${run.status})`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[JanitorCron] Failed to cleanup stale run ${run.id}:`, errorMessage);
      errors.push({ runId: run.id, error: errorMessage });
    }
  }

  return { cleaned, errors };
}

/**
 * Check if a janitor run should be skipped for a workspace/type/repository.
 * Skip if there's an in-progress run, pending recommendation, OR an active task.
 */
export async function shouldSkipJanitorRun(
  workspaceId: string,
  janitorType: JanitorType,
  repositoryId: string,
): Promise<boolean> {
  // Check for in-progress janitor run (PENDING or RUNNING)
  const inProgressRun = await db.janitorRun.findFirst({
    where: {
      janitorConfig: { workspaceId },
      janitorType,
      repositoryId,
      status: { in: ["PENDING", "RUNNING"] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (inProgressRun) {
    console.log(
      `[JanitorCron] Skipping ${janitorType} for repo ${repositoryId}: run ${inProgressRun.id} already in progress (status: ${inProgressRun.status})`,
    );
    return true;
  }

  // Check for pending recommendations for this specific repo
  const pendingRecommendation = await db.janitorRecommendation.findFirst({
    where: {
      workspaceId,
      status: "PENDING",
      repositoryId,
      janitorRun: {
        janitorType,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (pendingRecommendation) {
    console.log(`[JanitorCron] Skipping ${janitorType}: pending recommendation ${pendingRecommendation.id} exists`);
    return true;
  }

  // Find the most recent task with this janitor type and repository
  const task = await db.task.findFirst({
    where: {
      workspaceId,
      janitorType,
      repositoryId,
      deleted: false,
    },
    include: {
      chatMessages: {
        include: {
          artifacts: { where: { type: "PULL_REQUEST" } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!task) {
    return false;
  }

  // Discarded tasks (cancelled, failed, or halted workflow) don't block
  if (task.status === "CANCELLED" || task.workflowStatus === "FAILED" || task.workflowStatus === "HALTED") {
    console.log(
      `[JanitorCron] Most recent ${janitorType} task ${task.id} is discarded (status: ${task.status}, workflow: ${task.workflowStatus})`,
    );
    return false;
  }

  const prArtifacts = task.chatMessages.flatMap((m) => m.artifacts);

  if (prArtifacts.length === 0) {
    // No PR yet - task is active if not manually done
    if (task.status !== "DONE") {
      console.log(`[JanitorCron] Active ${janitorType} task ${task.id}: no PR yet`);
      return true;
    }
    return false;
  }

  // Has PR - check if merged or closed
  const latestPr = prArtifacts[0];
  const content = latestPr.content as { status?: string };

  // DONE = merged, CANCELLED = closed without merge - both allow new runs
  if (content.status === "DONE" || content.status === "CANCELLED") {
    console.log(`[JanitorCron] Most recent ${janitorType} task ${task.id} PR is resolved (status: ${content.status})`);
    return false;
  }

  console.log(`[JanitorCron] Active ${janitorType} task ${task.id}: PR not merged/closed (status: ${content.status})`);
  return true;
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
    timestamp: new Date(),
  };

  console.log(`[JanitorCron] Starting scheduled janitor execution at ${result.timestamp.toISOString()}`);

  // Cleanup stale janitor runs first
  try {
    const cleanupResult = await cleanupStaleJanitorRuns();
    if (cleanupResult.cleaned > 0) {
      console.log(`[JanitorCron] Cleaned up ${cleanupResult.cleaned} stale janitor runs`);
    }
    if (cleanupResult.errors.length > 0) {
      console.error(`[JanitorCron] ${cleanupResult.errors.length} errors during stale run cleanup`);
    }
  } catch (error) {
    console.error("[JanitorCron] Error cleaning up stale runs:", error);
  }

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
          if (workspace.repositories.length === 0) {
            console.warn(`[JanitorCron] Workspace ${slug} has no repositories — skipping ${janitorType}`);
            result.skipped++;
            continue;
          }

          for (const repository of workspace.repositories) {
            if (!repository.repositoryUrl || repository.repositoryUrl.trim() === "") {
              console.warn(
                `[JanitorCron] Skipping repo ${repository.id} in workspace ${slug}: no repositoryUrl`,
              );
              result.skipped++;
              continue;
            }

            if (SEQUENTIAL_JANITOR_TYPES.includes(janitorType)) {
              const shouldSkip = await shouldSkipJanitorRun(workspaceId, janitorType, repository.id);
              if (shouldSkip) {
                result.skipped++;
                continue;
              }
            }

            try {
              console.log(`[JanitorCron] Creating ${janitorType} run for workspace ${slug}, repo ${repository.id}`);
              await createJanitorRun(slug, ownerId, janitorType.toLowerCase(), "SCHEDULED", repository.id);
              result.runsCreated++;
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              console.error(
                `[JanitorCron] Error creating ${janitorType} run for workspace ${slug}, repo ${repository.id}:`,
                errorMessage,
              );
              result.errors.push({
                workspaceSlug: slug,
                janitorType,
                repositoryId: repository.id,
                error: errorMessage,
              });
              result.success = false;
            }
          }
        }
      }
    }

    console.log(
      `[JanitorCron] Execution completed. Runs created: ${result.runsCreated}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[JanitorCron] Critical error during execution:`, errorMessage);
    result.success = false;
    result.errors.push({
      workspaceSlug: "SYSTEM",
      janitorType: "UNIT_TESTS", // placeholder
      error: errorMessage,
    });
  }

  return result;
}
