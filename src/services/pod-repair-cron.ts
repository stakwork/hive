import { db } from "@/lib/db";
import { WorkflowStatus, StakworkRunType, Prisma } from "@prisma/client";
import { poolManagerService, stakworkService } from "@/lib/service-factory";
import { getBaseUrl } from "@/lib/utils";
import {
  JlistProcess,
  JlistResponseSchema,
  PodRepairCronResult,
  FAILED_STATUSES,
  IGNORED_PROCESSES,
} from "@/types/pod-repair";
import { config } from "@/config/env";

const MAX_REPAIR_ATTEMPTS = parseInt(
  process.env.POD_REPAIR_MAX_ATTEMPTS || "10",
  10
);

/**
 * Get workspaces eligible for pod repair check:
 * - Has containerFiles set (services agent ran)
 * - Has pool configuration
 */
export async function getEligibleWorkspaces() {
  return await db.workspace.findMany({
    where: {
      deleted: false,
      swarm: {
        containerFiles: { not: Prisma.DbNull },
        containerFilesSetUp: true,
        poolApiKey: { not: null },
      },
    },
    select: {
      id: true,
      slug: true,
      swarm: {
        select: {
          id: true,
          poolApiKey: true,
        },
      },
    },
  });
}

/**
 * Fetch jlist from a pod's control endpoint
 */
export async function fetchPodJlist(
  podId: string
): Promise<JlistProcess[] | null> {
  const jlistUrl = `https://${podId}-15552.workspaces.sphinx.chat/jlist`;

  try {
    const response = await fetch(jlistUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn(
        `[PodRepairCron] jlist request failed for ${podId}: ${response.status}`
      );
      return null;
    }

    const data = await response.json();
    const parsed = JlistResponseSchema.safeParse(data);

    if (!parsed.success) {
      console.warn(
        `[PodRepairCron] Invalid jlist response for ${podId}:`,
        parsed.error.message
      );
      return null;
    }

    return parsed.data as JlistProcess[];
  } catch (error) {
    console.error(`[PodRepairCron] Error fetching jlist for ${podId}:`, error);
    return null;
  }
}

/**
 * Check if any processes have failed status (not in ignore list)
 */
export function hasFailedProcesses(jlist: JlistProcess[]): boolean {
  return jlist.some(
    (proc) =>
      !IGNORED_PROCESSES.includes(
        proc.name.toLowerCase() as (typeof IGNORED_PROCESSES)[number]
      ) &&
      FAILED_STATUSES.includes(proc.status as (typeof FAILED_STATUSES)[number])
  );
}

/**
 * Check if there's an active repair workflow for this workspace
 * Returns true if there's an IN_PROGRESS run with a running Stakwork project
 */
async function isRepairInProgress(workspaceId: string): Promise<boolean> {
  const inProgressRun = await db.stakworkRun.findFirst({
    where: {
      workspaceId,
      type: StakworkRunType.POD_REPAIR,
      status: WorkflowStatus.IN_PROGRESS,
      projectId: { not: null },
    },
    select: { projectId: true },
  });

  if (!inProgressRun?.projectId) {
    return false;
  }

  // Check actual Stakwork project status
  try {
    const { status } = await stakworkService().getWorkflowData(
      String(inProgressRun.projectId)
    );
    const normalizedStatus = status?.toLowerCase();
    return (
      normalizedStatus === "in_progress" ||
      normalizedStatus === "running" ||
      normalizedStatus === "processing"
    );
  } catch {
    // If we can't check status, assume it's done
    return false;
  }
}

/**
 * Count previous repair attempts for a workspace
 */
async function getRepairAttemptCount(workspaceId: string): Promise<number> {
  return await db.stakworkRun.count({
    where: {
      workspaceId,
      type: StakworkRunType.POD_REPAIR,
    },
  });
}

/**
 * Get history of previous repair attempts for a workspace
 * Returns result + feedback for each run (similar to getFeatureRunHistory pattern)
 */
async function getRepairHistory(workspaceId: string) {
  const previousRuns = await db.stakworkRun.findMany({
    where: {
      workspaceId,
      type: StakworkRunType.POD_REPAIR,
    },
    select: {
      id: true,
      status: true,
      result: true,
      feedback: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return previousRuns.map((run) => ({
    runId: run.id,
    status: run.status,
    result: run.result,
    feedback: run.feedback,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  }));
}

/**
 * Create a pod repair StakworkRun and trigger the workflow
 */
async function triggerPodRepair(
  workspaceId: string,
  workspaceSlug: string,
  podId: string
): Promise<{ runId: string; projectId: number | null }> {
  const baseUrl = getBaseUrl();
  const webhookUrl = `${baseUrl}/api/webhook/stakwork/response?type=POD_REPAIR&workspace_id=${workspaceId}`;

  // Get history of previous repair attempts
  const history = await getRepairHistory(workspaceId);

  // Create StakworkRun record
  const run = await db.stakworkRun.create({
    data: {
      type: StakworkRunType.POD_REPAIR,
      workspaceId,
      status: WorkflowStatus.PENDING,
      webhookUrl,
    },
  });

  // Get pod repair workflow ID
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
      name: `pod-repair-${workspaceSlug}-${Date.now()}`,
      workflow_id: parseInt(workflowId, 10),
      workflow_params: {
        set_var: {
          attributes: {
            vars: {
              runId: run.id,
              workspaceId,
              workspaceSlug,
              podId,
              webhookUrl,
              attemptNumber: history.length + 1,
              history,
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

/**
 * Main execution function for the pod repair cron
 */
export async function executePodRepairRuns(): Promise<PodRepairCronResult> {
  const result: PodRepairCronResult = {
    success: true,
    workspacesProcessed: 0,
    workspacesWithRunningPods: 0,
    repairsTriggered: 0,
    skipped: {
      maxAttemptsReached: 0,
      workflowInProgress: 0,
      noFailedProcesses: 0,
    },
    errors: [],
    timestamp: new Date().toISOString(),
  };

  console.log(`[PodRepairCron] Starting execution at ${result.timestamp}`);

  try {
    const workspaces = await getEligibleWorkspaces();
    console.log(
      `[PodRepairCron] Found ${workspaces.length} eligible workspaces`
    );

    for (const workspace of workspaces) {
      result.workspacesProcessed++;

      if (!workspace.swarm?.poolApiKey) {
        continue;
      }

      try {
        // Get pods for this workspace
        const poolService = poolManagerService();
        const poolData = await poolService.getPoolWorkspaces(
          workspace.swarm.id,
          workspace.swarm.poolApiKey
        );

        // Check if there are any running pods
        const runningPods = poolData.workspaces.filter(
          (vm) => vm.state.toLowerCase() === "running"
        );

        // Only proceed if there are NO running pods
        if (runningPods.length > 0) {
          console.log(
            `[PodRepairCron] Skipping ${workspace.slug}: has ${runningPods.length} running pods`
          );
          result.workspacesWithRunningPods++;
          continue;
        }

        // Pick first non-running pod
        const pod = poolData.workspaces.find(
          (vm) => vm.state.toLowerCase() !== "running"
        );

        if (!pod) {
          continue;
        }

        console.log(
          `[PodRepairCron] Workspace ${workspace.slug}: checking pod ${pod.subdomain}`
        );

        // Check if repair workflow is already in progress
        if (await isRepairInProgress(workspace.id)) {
          console.log(
            `[PodRepairCron] Skipping ${workspace.slug}: repair already in progress`
          );
          result.skipped.workflowInProgress++;
          continue;
        }

        // Check attempt count
        const attemptCount = await getRepairAttemptCount(workspace.id);
        if (attemptCount >= MAX_REPAIR_ATTEMPTS) {
          console.log(
            `[PodRepairCron] Skipping ${workspace.slug}: max attempts (${attemptCount}) reached`
          );
          result.skipped.maxAttemptsReached++;
          continue;
        }

        // Fetch jlist
        const jlist = await fetchPodJlist(pod.subdomain);
        if (!jlist) {
          continue;
        }

        // Check for failed processes
        if (!hasFailedProcesses(jlist)) {
          console.log(
            `[PodRepairCron] No failed processes for ${workspace.slug}`
          );
          result.skipped.noFailedProcesses++;
          continue;
        }

        console.log(
          `[PodRepairCron] Triggering repair for ${workspace.slug}/${pod.subdomain}`
        );

        await triggerPodRepair(workspace.id, workspace.slug, pod.subdomain);
        result.repairsTriggered++;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(
          `[PodRepairCron] Error processing workspace ${workspace.slug}:`,
          errorMessage
        );
        result.errors.push({
          workspaceSlug: workspace.slug,
          error: errorMessage,
        });
      }
    }

    console.log(
      `[PodRepairCron] Completed. Repairs triggered: ${result.repairsTriggered}`
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error(`[PodRepairCron] Critical error:`, errorMessage);
    result.success = false;
    result.errors.push({
      workspaceSlug: "SYSTEM",
      error: errorMessage,
    });
  }

  return result;
}
