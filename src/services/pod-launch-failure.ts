import { db } from "@/lib/db";
import { WorkflowStatus, StakworkRunType, PodState } from "@prisma/client";
import { stakworkService } from "@/lib/service-factory";
import { getBaseUrl } from "@/lib/utils";
import { config } from "@/config/env";
import {
  PodLaunchFailureWebhookPayload,
  ContainerStatus,
  getNextMemoryTier,
  PoolMemoryTier,
} from "@/types/pool-manager";
import { syncPoolManagerSettings } from "@/services/pool-manager/sync";
import { getSwarmContainerConfig } from "@/services/swarm/db";

const MAX_LAUNCH_FAILURE_ATTEMPTS = parseInt(
  process.env.POD_LAUNCH_FAILURE_MAX_ATTEMPTS || "5",
  10
);

/**
 * Check if any container has OOMKilled as the reason for failure
 */
function hasOOMKilled(containers: ContainerStatus[]): boolean {
  return containers.some(
    (c) => c.lastReason === "OOMKilled" || c.reason === "OOMKilled"
  );
}

/**
 * Count launch failure attempts for a workspace
 * Isolated function for easy future time-windowing
 */
async function getLaunchFailureAttemptCount(
  workspaceId: string
): Promise<number> {
  return await db.stakworkRun.count({
    where: {
      workspaceId,
      type: StakworkRunType.POD_LAUNCH_FAILURE,
      // Future: add createdAt filter for time-windowing
      // createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    },
  });
}

interface WorkspaceWithSwarm {
  id: string;
  slug: string;
  swarm: {
    id: string;
    poolName: string | null;
    poolApiKey: string | null;
    poolCpu: string | null;
    poolMemory: string | null;
    podState: string;
  } | null;
}

/**
 * Bump pool memory to the next tier
 * Updates the database and syncs to Pool Manager
 */
async function bumpPoolMemory(
  workspace: WorkspaceWithSwarm,
  newMemory: PoolMemoryTier
): Promise<{ success: boolean; error?: string }> {
  if (!workspace.swarm) {
    return { success: false, error: "No swarm configuration found" };
  }

  if (!workspace.swarm.poolApiKey) {
    return { success: false, error: "No pool API key found for swarm" };
  }

  try {
    // Update pool memory in database
    await db.swarm.update({
      where: { id: workspace.swarm.id },
      data: { poolMemory: newMemory },
    });

    console.log(
      `[PodLaunchFailure] Updated poolMemory to ${newMemory} for workspace ${workspace.slug}`
    );

    // Sync to Pool Manager
    const syncResult = await syncPoolManagerSettings({
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      swarmId: workspace.swarm.id,
      poolApiKey: workspace.swarm.poolApiKey,
      poolCpu: workspace.swarm.poolCpu,
      poolMemory: newMemory,
      // No userId - webhook context doesn't have user session
    });

    if (!syncResult.success) {
      console.error(
        `[PodLaunchFailure] Failed to sync to Pool Manager for ${workspace.slug}: ${syncResult.error}`
      );
      // Return success since database was updated - Pool Manager sync is best effort
    } else {
      console.log(
        `[PodLaunchFailure] Synced memory bump to Pool Manager for ${workspace.slug}`
      );
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `[PodLaunchFailure] Failed to update poolMemory for ${workspace.slug}:`,
      errorMessage
    );
    return { success: false, error: errorMessage };
  }
}

export interface PodLaunchFailureResult {
  success: boolean;
  workspaceSlug: string | null;
  runId: string | null;
  projectId: number | null;
  error?: string;
}

/**
 * Process a pod launch failure webhook from Pool Manager
 * Finds workspace by poolName and triggers Stakwork repair workflow
 */
export async function processPodLaunchFailure(
  payload: PodLaunchFailureWebhookPayload
): Promise<PodLaunchFailureResult> {
  const { poolName, podId, eventMessage, reason, containers } = payload;

  console.log(
    `[PodLaunchFailure] Received launch failure for pool ${poolName}, pod ${podId}`
  );

  // Find workspace by swarm ID (poolName maps to Swarm.id)
  const workspace = await db.workspace.findFirst({
    where: {
      deleted: false,
      swarm: { id: poolName },
    },
    select: {
      id: true,
      slug: true,
      swarm: {
        select: {
          id: true,
          poolName: true,
          poolApiKey: true,
          poolCpu: true,
          poolMemory: true,
          podState: true,
        },
      },
    },
  });

  if (!workspace) {
    console.warn(
      `[PodLaunchFailure] No workspace found for poolName: ${poolName}`
    );
    return {
      success: false,
      workspaceSlug: null,
      runId: null,
      projectId: null,
      error: `No workspace found for poolName: ${poolName}`,
    };
  }

  // Check attempt count to prevent infinite loops
  const attemptCount = await getLaunchFailureAttemptCount(workspace.id);
  if (attemptCount >= MAX_LAUNCH_FAILURE_ATTEMPTS) {
    console.log(
      `[PodLaunchFailure] Max attempts (${attemptCount}) reached for ${workspace.slug}`
    );
    return {
      success: false,
      workspaceSlug: workspace.slug,
      runId: null,
      projectId: null,
      error: `Max launch failure attempts (${MAX_LAUNCH_FAILURE_ATTEMPTS}) reached`,
    };
  }

  // Check for in-progress repair (prevent duplicates)
  const inProgress = await db.stakworkRun.findFirst({
    where: {
      workspaceId: workspace.id,
      type: StakworkRunType.POD_LAUNCH_FAILURE,
      status: WorkflowStatus.IN_PROGRESS,
    },
  });

  if (inProgress) {
    console.log(
      `[PodLaunchFailure] Repair already in progress for ${workspace.slug}`
    );
    return {
      success: false,
      workspaceSlug: workspace.slug,
      runId: null,
      projectId: null,
      error: "Launch failure repair already in progress",
    };
  }

  // Check for OOMKilled - handle by bumping memory instead of Stakwork workflow
  if (hasOOMKilled(containers)) {
    console.log(
      `[PodLaunchFailure] OOMKilled detected for ${workspace.slug}, attempting memory bump`
    );

    const currentMemory = workspace.swarm?.poolMemory;
    const nextMemory = getNextMemoryTier(currentMemory);

    if (!nextMemory) {
      // Already at max memory (16Gi), mark pod as failed
      console.log(
        `[PodLaunchFailure] Already at max memory (${currentMemory}) for ${workspace.slug}, marking pod as FAILED`
      );

      if (workspace.swarm) {
        await db.swarm.update({
          where: { id: workspace.swarm.id },
          data: { podState: PodState.FAILED },
        });
      }

      return {
        success: false,
        workspaceSlug: workspace.slug,
        runId: null,
        projectId: null,
        error: `OOMKilled at max memory (${currentMemory}), pod marked as FAILED`,
      };
    }

    // Bump memory to next tier
    const bumpResult = await bumpPoolMemory(workspace, nextMemory);

    if (bumpResult.success) {
      console.log(
        `[PodLaunchFailure] Memory bumped from ${currentMemory} to ${nextMemory} for ${workspace.slug}`
      );
      return {
        success: true,
        workspaceSlug: workspace.slug,
        runId: null,
        projectId: null,
      };
    } else {
      console.error(
        `[PodLaunchFailure] Failed to bump memory for ${workspace.slug}: ${bumpResult.error}`
      );
      // Fall through to Stakwork workflow if memory bump fails
    }
  }

  // Trigger the repair workflow
  try {
    const { runId, projectId } = await triggerLaunchFailureRepair(
      workspace.id,
      workspace.slug,
      podId,
      eventMessage,
      reason,
      containers
    );

    console.log(
      `[PodLaunchFailure] Triggered repair for ${workspace.slug}, runId: ${runId}, projectId: ${projectId}`
    );

    return {
      success: true,
      workspaceSlug: workspace.slug,
      runId,
      projectId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `[PodLaunchFailure] Failed to trigger repair for ${workspace.slug}:`,
      errorMessage
    );
    return {
      success: false,
      workspaceSlug: workspace.slug,
      runId: null,
      projectId: null,
      error: errorMessage,
    };
  }
}

/**
 * Trigger a Stakwork repair workflow for pod launch failure
 * Uses POD_LAUNCH_FAILURE type with structured container data for Stakwork to fix container files
 */
async function triggerLaunchFailureRepair(
  workspaceId: string,
  workspaceSlug: string,
  podId: string,
  eventMessage: string,
  reason: string,
  containers: import("@/types/pool-manager").ContainerStatus[]
): Promise<{ runId: string; projectId: number | null }> {
  const baseUrl = getBaseUrl();
  const webhookUrl = `${baseUrl}/api/webhook/stakwork/response?type=POD_LAUNCH_FAILURE&workspace_id=${workspaceId}`;

  // Get container configuration
  const containerConfig = await getSwarmContainerConfig(workspaceId);

  // Create StakworkRun record
  const run = await db.stakworkRun.create({
    data: {
      type: StakworkRunType.POD_LAUNCH_FAILURE,
      workspaceId,
      status: WorkflowStatus.PENDING,
      webhookUrl,
    },
  });

  // Get pod repair workflow ID (reuses existing workflow)
  const workflowId = config.STAKWORK_POD_REPAIR_WORKFLOW_ID;
  if (!workflowId) {
    await db.stakworkRun.update({
      where: { id: run.id },
      data: { status: WorkflowStatus.FAILED },
    });
    throw new Error("STAKWORK_POD_REPAIR_WORKFLOW_ID not configured");
  }

  try {
    const stakworkPayload = {
      name: `pod-launch-failure-${workspaceSlug}-${Date.now()}`,
      workflow_id: parseInt(workflowId, 10),
      webhook_url: webhookUrl,
      workflow_params: {
        set_var: {
          attributes: {
            vars: {
              runId: run.id,
              workspaceId,
              workspaceSlug,
              podId,
              webhookUrl,
              message: JSON.stringify({
                eventMessage,
                reason,
                containers,
              }),
              failureType: "LAUNCH", // Distinguishes from runtime failures
              containerFiles: containerConfig?.containerFiles || null,
            },
          },
        },
      },
    };

    const response = await stakworkService().stakworkRequest<{
      success: boolean;
      data: { project_id: number };
    }>("/projects", stakworkPayload);

    const projectId = response?.data?.project_id;

    await db.stakworkRun.update({
      where: { id: run.id },
      data: {
        projectId,
        status: WorkflowStatus.IN_PROGRESS,
      },
    });

    return { runId: run.id, projectId: projectId || null };
  } catch (error) {
    await db.stakworkRun.update({
      where: { id: run.id },
      data: { status: WorkflowStatus.FAILED },
    });
    throw error;
  }
}
