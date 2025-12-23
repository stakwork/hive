import { db } from "@/lib/db";
import { PoolState } from "@prisma/client";

export interface AutoLaunchPodsResult {
  success: boolean;
  workspacesProcessed: number;
  launchesTriggered: number;
  errors: Array<{
    workspaceSlug: string;
    error: string;
  }>;
  timestamp: Date;
}

/**
 * Executes auto-launch pods for all eligible workspaces
 * Queries workspaces where containerFilesSetUp=true, poolState=NOT_STARTED, and services array is not empty
 */
export async function executeAutoLaunchPods(): Promise<AutoLaunchPodsResult> {
  const errors: Array<{ workspaceSlug: string; error: string }> = [];
  let workspacesProcessed = 0;
  let launchesTriggered = 0;

  try {
    // Query eligible workspaces
    const workspaces = await getEligibleWorkspaces();

    // Filter out workspaces with empty services array (Prisma JSON filter limitation)
    const eligibleWorkspaces = workspaces.filter(
      (workspace) =>
        Array.isArray(workspace.swarm?.services) &&
        workspace.swarm.services.length > 0
    );

    console.log(
      `[AutoLaunchPodsCron] Found ${eligibleWorkspaces.length} eligible workspaces`
    );

    for (const workspace of eligibleWorkspaces) {
      workspacesProcessed++;

      try {
        console.log(
          `[AutoLaunchPodsCron] Processing workspace: ${workspace.slug}`
        );

        // Pool creation logic will be implemented in next phase
        // This placeholder ensures the service structure is in place
        console.log(
          `[AutoLaunchPodsCron] Pool creation for ${workspace.slug} - implementation pending`
        );

        launchesTriggered++;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(
          `[AutoLaunchPodsCron] Error processing workspace ${workspace.slug}:`,
          errorMessage
        );
        errors.push({
          workspaceSlug: workspace.slug,
          error: errorMessage,
        });
      }
    }

    return {
      success: errors.length === 0,
      workspacesProcessed,
      launchesTriggered,
      errors,
      timestamp: new Date(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      "[AutoLaunchPodsCron] Fatal error during execution:",
      errorMessage
    );

    return {
      success: false,
      workspacesProcessed,
      launchesTriggered,
      errors: [
        ...errors,
        {
          workspaceSlug: "SYSTEM",
          error: errorMessage,
        },
      ],
      timestamp: new Date(),
    };
  }
}

/**
 * Queries database for workspaces eligible for auto pool launch
 * Criteria: containerFilesSetUp=true, poolState=NOT_STARTED, services array not empty
 */
async function getEligibleWorkspaces() {
  return db.workspace.findMany({
    where: {
      swarm: {
        containerFilesSetUp: true,
        poolState: PoolState.NOT_STARTED,
        services: {
          not: {
            equals: [],
          },
        },
      },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      swarm: {
        select: {
          id: true,
          name: true,
          containerFiles: true,
          services: true,
          poolState: true,
          containerFilesSetUp: true,
        },
      },
    },
  });
}
