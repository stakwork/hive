import { db } from "@/lib/db";
import { WorkflowStatus, StakworkRunType } from "@prisma/client";
import { stakworkService } from "@/lib/service-factory";
import { getBaseUrl } from "@/lib/utils";
import { config } from "@/config/env";
import { PodLaunchFailureWebhookPayload } from "@/types/pool-manager";
import { EncryptionService } from "@/lib/encryption";
import { getWorkspaceRunHistory } from "@/services/stakwork-run";

const MAX_LAUNCH_FAILURE_ATTEMPTS = parseInt(
  process.env.POD_LAUNCH_FAILURE_MAX_ATTEMPTS || "5",
  10
);


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
          swarmPassword: true,
          containerFiles: true,
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

  // Get history and check attempt count to prevent infinite loops
  const history = await getWorkspaceRunHistory(workspace.id, StakworkRunType.POD_LAUNCH_FAILURE);
  if (history.length >= MAX_LAUNCH_FAILURE_ATTEMPTS) {
    console.log(
      `[PodLaunchFailure] Max attempts (${history.length}) reached for ${workspace.slug}`
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

  // Extract Dockerfile and docker-compose from containerFiles
  const containerFiles = workspace.swarm?.containerFiles as Record<string, string> | null;
  const dockerfile = containerFiles?.["Dockerfile"] || "";
  const dockerCompose = containerFiles?.["docker-compose.yml"] || "";

  // Decrypt swarm password if available
  const encryptionService = EncryptionService.getInstance();
  let podPassword = "";
  if (workspace.swarm?.swarmPassword) {
    try {
      podPassword = encryptionService.decryptField(
        "swarmPassword",
        workspace.swarm.swarmPassword
      );
    } catch {
      console.warn(`[PodLaunchFailure] Failed to decrypt swarm password`);
    }
  }

  // Trigger the repair workflow
  try {
    const { runId, projectId } = await triggerLaunchFailureRepair(
      workspace.id,
      workspace.slug,
      podId,
      podPassword,
      history,
      dockerfile,
      dockerCompose,
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
  podPassword: string,
  history: Awaited<ReturnType<typeof getWorkspaceRunHistory>>,
  dockerfile: string,
  dockerCompose: string,
  eventMessage: string,
  reason: string,
  containers: import("@/types/pool-manager").ContainerStatus[]
): Promise<{ runId: string; projectId: number | null }> {
  const baseUrl = getBaseUrl();
  const webhookUrl = `${baseUrl}/api/webhook/stakwork/response?type=POD_LAUNCH_FAILURE&workspace_id=${workspaceId}`;

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
      workflow_params: {
        set_var: {
          attributes: {
            vars: {
              runId: run.id,
              workspaceId,
              workspaceSlug,
              podId,
              podPassword,
              webhookUrl,
              attemptNumber: history.length + 1,
              history,
              dockerfile,
              dockerCompose,
              message: JSON.stringify({
                eventMessage,
                reason,
                containers,
              }),
              failureType: "LAUNCH", // Distinguishes from runtime failures
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
