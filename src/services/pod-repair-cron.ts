import { db } from "@/lib/db";
import { WorkflowStatus, StakworkRunType, Prisma, PodState, PoolState } from "@prisma/client";
import { poolManagerService, stakworkService } from "@/lib/service-factory";
import { getBaseUrl } from "@/lib/utils";
import {
  JlistProcess,
  JlistResponseSchema,
  PodRepairCronResult,
  FAILED_STATUSES,
  IGNORED_PROCESSES,
  STAKLINK_PROXY_PROCESS,
} from "@/types/pod-repair";
import { config } from "@/config/env";
import { EncryptionService } from "@/lib/encryption";
import {
  getPodFromPool,
  checkFrontendAvailable,
  POD_PORTS,
  PROCESS_NAMES,
} from "@/lib/pods/utils";

const MAX_REPAIR_ATTEMPTS = parseInt(
  process.env.POD_REPAIR_MAX_ATTEMPTS || "10",
  10
);

const encryptionService = EncryptionService.getInstance();

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
          poolState: true,
          podState: true,
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
 * Get list of failed process names (not in ignore list)
 */
export function getFailedProcesses(jlist: JlistProcess[]): string[] {
  return jlist
    .filter(
      (proc) =>
        !IGNORED_PROCESSES.includes(
          proc.name.toLowerCase() as (typeof IGNORED_PROCESSES)[number]
        ) &&
        FAILED_STATUSES.includes(
          proc.status as (typeof FAILED_STATUSES)[number]
        )
    )
    .map((proc) => proc.name.toLowerCase());
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
 * Update podState for a workspace's swarm
 */
async function updatePodState(swarmId: string, podState: PodState): Promise<void> {
  await db.swarm.update({
    where: { id: swarmId },
    data: { podState },
  });
}

/**
 * Validate frontend via the pod's /validate_frontend endpoint
 * Returns { ok, message } indicating validation result
 */
async function validateFrontend(
  podId: string
): Promise<{ ok: boolean; message: string }> {
  const validateUrl = `https://${podId}-15552.workspaces.sphinx.chat/validate_frontend`;

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { ok: false, message: "ANTHROPIC_API_KEY not configured" };
    }

    const response = await fetch(validateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
      signal: AbortSignal.timeout(60000), // 60s timeout for AI validation
    });

    if (!response.ok) {
      return { ok: false, message: `HTTP ${response.status}` };
    }

    const data = await response.json();
    return {
      ok: data.ok === true,
      message: data.message || (data.ok ? "Validation passed" : "Validation failed"),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Validation error: ${errorMessage}` };
  }
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
  podId: string,
  podPassword: string,
  failedServices: string[],
  message?: string
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
              podPassword,
              webhookUrl,
              attemptNumber: history.length + 1,
              history,
              failedServices,
              message: message || null,
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
    staklinkRestarts: 0,
    validationsTriggered: 0,
    validationsPassed: 0,
    validationsFailedWithRepair: 0,
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

        // Check if this workspace is in onboarding (needs frontend validation)
        const isOnboarding =
          workspace.swarm.poolState === PoolState.COMPLETE &&
          workspace.swarm.podState !== PodState.COMPLETED &&
          workspace.swarm.podState !== PodState.FAILED;

        // For onboarding workspaces with running pods, validate the frontend
        if (isOnboarding && runningPods.length > 0) {
          const runningPod = runningPods[0];
          console.log(
            `[PodRepairCron] Onboarding validation for ${workspace.slug}/${runningPod.subdomain}`
          );

          // Check attempt count first
          const attemptCount = await getRepairAttemptCount(workspace.id);
          if (attemptCount >= MAX_REPAIR_ATTEMPTS) {
            console.log(
              `[PodRepairCron] Max attempts reached for ${workspace.slug}, setting podState=FAILED`
            );
            await updatePodState(workspace.swarm.id, PodState.FAILED);
            result.skipped.maxAttemptsReached++;
            continue;
          }

          // Check if repair workflow is already in progress
          if (await isRepairInProgress(workspace.id)) {
            console.log(
              `[PodRepairCron] Skipping ${workspace.slug}: repair already in progress`
            );
            result.skipped.workflowInProgress++;
            continue;
          }

          // Decrypt pool API key for direct API calls
          const decryptedPoolApiKey = encryptionService.decryptField(
            "poolApiKey",
            workspace.swarm.poolApiKey
          );

          // Fetch jlist to check process status
          const jlist = await fetchPodJlist(runningPod.subdomain);
          if (!jlist) {
            console.log(
              `[PodRepairCron] jlist not available for ${workspace.slug}/${runningPod.subdomain}`
            );
            continue;
          }

          // Check staklink-proxy
          const staklinkExists = jlist.some(
            (proc) => proc.name.toLowerCase() === STAKLINK_PROXY_PROCESS
          );
          const failedProcesses = getFailedProcesses(jlist);
          const staklinkFailed = failedProcesses.includes(STAKLINK_PROXY_PROCESS);

          if (!staklinkExists || staklinkFailed) {
            console.log(
              `[PodRepairCron] staklink-proxy not ready for ${workspace.slug}, skipping validation`
            );
            continue;
          }

          // Get pod details for frontend check
          let podWithPortMappings;
          try {
            podWithPortMappings = await getPodFromPool(
              runningPod.subdomain,
              decryptedPoolApiKey
            );
          } catch (error) {
            console.warn(
              `[PodRepairCron] Could not get pod details for ${runningPod.subdomain}:`,
              error
            );
            continue;
          }

          // Check frontend process is online
          if (podWithPortMappings?.portMappings) {
            const controlPortUrl = podWithPortMappings.portMappings[POD_PORTS.CONTROL];
            if (controlPortUrl) {
              const frontendCheck = await checkFrontendAvailable(
                jlist,
                podWithPortMappings.portMappings,
                controlPortUrl
              );

              if (!frontendCheck.available) {
                console.log(
                  `[PodRepairCron] Frontend not available for ${workspace.slug}/${runningPod.subdomain}: ${frontendCheck.error}`
                );
                // Trigger repair
                await triggerPodRepair(
                  workspace.id,
                  workspace.slug,
                  runningPod.subdomain,
                  runningPod.password || "",
                  [PROCESS_NAMES.FRONTEND],
                  frontendCheck.error || "Frontend not available"
                );
                result.repairsTriggered++;
                continue;
              }
            }
          }

          // All checks passed - now do final /validate_frontend call
          console.log(
            `[PodRepairCron] All checks passed, calling /validate_frontend for ${workspace.slug}`
          );
          await updatePodState(workspace.swarm.id, PodState.VALIDATING);
          result.validationsTriggered++;

          const validationResult = await validateFrontend(runningPod.subdomain);

          if (validationResult.ok) {
            console.log(
              `[PodRepairCron] Frontend validation passed for ${workspace.slug}`
            );
            await updatePodState(workspace.swarm.id, PodState.COMPLETED);
            result.validationsPassed++;
          } else {
            console.log(
              `[PodRepairCron] Frontend validation failed for ${workspace.slug}: ${validationResult.message}`
            );
            await triggerPodRepair(
              workspace.id,
              workspace.slug,
              runningPod.subdomain,
              runningPod.password || "",
              [PROCESS_NAMES.FRONTEND],
              validationResult.message
            );
            result.validationsFailedWithRepair++;
            result.repairsTriggered++;
          }
          continue;
        }

        // For non-onboarding workspaces, skip if there are running pods
        if (runningPods.length > 0) {
          console.log(
            `[PodRepairCron] Skipping ${workspace.slug}: has ${runningPods.length} running pods`
          );
          result.workspacesWithRunningPods++;
          continue;
        }

        // === NON-RUNNING POD REPAIR LOGIC ===
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

        // Decrypt pool API key for direct API calls
        const decryptedPoolApiKey = encryptionService.decryptField(
          "poolApiKey",
          workspace.swarm.poolApiKey
        );

        // Fetch jlist - if it fails, call staklink-start API directly
        const jlist = await fetchPodJlist(pod.subdomain);
        if (!jlist) {
          console.log(
            `[PodRepairCron] jlist not available for ${workspace.slug}/${pod.subdomain} - calling staklink-start`
          );
          try {
            const poolService = poolManagerService();
            const staklinkResult = await poolService.startStaklink(
              workspace.swarm.id,
              pod.subdomain,
              workspace.swarm.poolApiKey
            );
            if (staklinkResult.success) {
              console.log(
                `[PodRepairCron] staklink started for ${workspace.slug}/${pod.subdomain}: ${staklinkResult.message}`
              );
              result.staklinkRestarts++;
            } else {
              console.warn(
                `[PodRepairCron] staklink-start returned success=false for ${workspace.slug}/${pod.subdomain}`
              );
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(
              `[PodRepairCron] Failed to start staklink for ${workspace.slug}/${pod.subdomain}:`,
              errorMessage
            );
            result.errors.push({
              workspaceSlug: workspace.slug,
              error: `Failed to start staklink: ${errorMessage}`,
            });
          }
          continue;
        }

        // Check if staklink-proxy exists in jlist
        const staklinkExists = jlist.some(
          (proc) => proc.name.toLowerCase() === STAKLINK_PROXY_PROCESS
        );

        // Get failed processes
        const failedProcesses = getFailedProcesses(jlist);

        // Prioritize staklink-proxy: if it's failed OR missing, repair that first
        const staklinkFailed = failedProcesses.includes(STAKLINK_PROXY_PROCESS);
        const staklinkNeedsRepair = staklinkFailed || !staklinkExists;

        if (staklinkNeedsRepair) {
          console.log(
            `[PodRepairCron] staklink-proxy needs repair for ${workspace.slug}/${pod.subdomain} - calling staklink-start`
          );
          try {
            const poolService = poolManagerService();
            const staklinkResult = await poolService.startStaklink(
              workspace.swarm.id,
              pod.subdomain,
              workspace.swarm.poolApiKey
            );
            if (staklinkResult.success) {
              console.log(
                `[PodRepairCron] staklink started for ${workspace.slug}/${pod.subdomain}: ${staklinkResult.message}`
              );
              result.staklinkRestarts++;
            } else {
              console.warn(
                `[PodRepairCron] staklink-start returned success=false for ${workspace.slug}/${pod.subdomain}`
              );
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(
              `[PodRepairCron] Failed to start staklink for ${workspace.slug}/${pod.subdomain}:`,
              errorMessage
            );
            result.errors.push({
              workspaceSlug: workspace.slug,
              error: `Failed to start staklink: ${errorMessage}`,
            });
          }
          continue;
        }

        // Get full pod data with portMappings for frontend check
        let podWithPortMappings;
        try {
          podWithPortMappings = await getPodFromPool(
            pod.subdomain,
            decryptedPoolApiKey
          );
        } catch (error) {
          console.warn(
            `[PodRepairCron] Could not get pod details for ${pod.subdomain}:`,
            error
          );
          // Fall through to check failed processes without frontend check
          podWithPortMappings = null;
        }

        // Check frontend availability if we have portMappings
        let frontendNeedsRepair = false;
        if (podWithPortMappings?.portMappings) {
          const controlPortUrl = podWithPortMappings.portMappings[POD_PORTS.CONTROL];
          if (controlPortUrl) {
            const frontendCheck = await checkFrontendAvailable(
              jlist,
              podWithPortMappings.portMappings,
              controlPortUrl
            );

            if (!frontendCheck.available) {
              console.log(
                `[PodRepairCron] Frontend not available for ${workspace.slug}/${pod.subdomain}: ${frontendCheck.error}`
              );
              frontendNeedsRepair = true;
            }
          }
        }

        // Build list of services to repair
        const servicesToRepair: string[] = [];
        if (frontendNeedsRepair) {
          servicesToRepair.push(PROCESS_NAMES.FRONTEND);
        }
        // Add other failed processes (excluding frontend if already added)
        for (const proc of failedProcesses) {
          if (!servicesToRepair.includes(proc)) {
            servicesToRepair.push(proc);
          }
        }

        // If no services need repair, skip
        if (servicesToRepair.length === 0) {
          console.log(
            `[PodRepairCron] No failed processes for ${workspace.slug}`
          );
          result.skipped.noFailedProcesses++;
          continue;
        }

        console.log(
          `[PodRepairCron] Triggering repair for ${workspace.slug}/${pod.subdomain} - services: ${servicesToRepair.join(", ")}`
        );

        await triggerPodRepair(
          workspace.id,
          workspace.slug,
          pod.subdomain,
          pod.password || "",
          servicesToRepair
        );
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
