import { config } from "@/config/env";
import { parsePM2Content } from "@/utils/devContainerUtils";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { JlistProcess } from "@/types/pod-repair";
import { claimAvailablePod, getPodDetails, releasePodById, getPodUsageStatus, buildPodUrl } from "./queries";
import type { Pod } from "@prisma/client";

const encryptionService = EncryptionService.getInstance();

// Re-export constants for external use
export { POD_PORTS, PROCESS_NAMES } from "./constants";

// Import for internal use
import { POD_PORTS, PROCESS_NAMES } from "./constants";

export interface PodWorkspace {
  branches: string[];
  created: string;
  customImage: boolean;
  flagged_for_recreation: boolean;
  fqdn: string;
  id: string;
  image: string;
  marked_at: string;
  password: string;
  portMappings: Record<string, string>;
  primaryRepo: string;
  repoName: string;
  repositories: string[];
  state: string;
  subdomain: string;
  url: string;
  usage_status: string;
  useDevContainer: boolean;
}

interface ProcessInfo {
  pid: number;
  name: string;
  status: string;
  pm_uptime: number;
  port?: string;
  cwd?: string;
}

async function getProcessList(controlPortUrl: string, password: string): Promise<ProcessInfo[]> {
  // In mock mode, return fake process list (no real pod to call)
  if (process.env.USE_MOCKS === "true" && process.env.NODE_ENV !== "test") {
    return [
      { pid: 12345, name: "goose", status: "online", port: "15551", pm_uptime: 123456, cwd: "/home/jovyan/workspace" },
      {
        pid: 12346,
        name: "frontend",
        status: "online",
        port: "3000",
        pm_uptime: 123456,
        cwd: "/home/jovyan/workspace",
      },
    ];
  }

  const jlistUrl = `${controlPortUrl}/jlist`;
  const response = await fetch(jlistUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${password}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Failed to get process list: ${response.status} - ${errorText}`);
    throw new Error(`Failed to get process list: ${response.status}`);
  }

  const processList: ProcessInfo[] = await response.json();
  console.log(">>> Process list", processList);

  return processList;
}

function getFrontendUrl(processList: ProcessInfo[], portMappings: Record<string, string>): string {
  const frontendProcess = processList.find((proc) => proc.name === PROCESS_NAMES.FRONTEND);

  if (!frontendProcess || !frontendProcess.port) {
    throw new Error("Frontend process not found or has no port");
  }

  console.log(">>> Frontend process", frontendProcess);

  const frontend = portMappings[frontendProcess.port];

  if (!frontend) {
    throw new Error(`Frontend port ${frontendProcess.port} not found in port mappings`);
  }

  console.log(">>> frontend", frontend);

  return frontend;
}

interface ServiceInfo {
  name: string;
  port: number;
  scripts?: {
    start?: string;
    install?: string;
    build?: string;
    test?: string;
    [key: string]: string | undefined;
  };
}

export async function claimPodAndGetFrontend(
  swarmId: string,
  userInfo?: string,
  services?: ServiceInfo[],
): Promise<{ frontend: string; workspace: PodWorkspace; processList?: ProcessInfo[] }> {
  // Claim a pod from the database atomically
  const pod = await claimAvailablePod(swarmId, userInfo);

  if (!pod) {
    throw new Error(`No available pods for swarm: ${swarmId}`);
  }

  console.log(">>> claimed pod", pod.podId);

  // Decrypt password
  if (!pod.password) {
    throw new Error("Pod password not found");
  }
  const password = encryptionService.decryptField("swarmPassword", pod.password);

  // Convert port array to port mappings dictionary
  const portArray = (pod.portMappings as number[] | null) || [];
  const portMappings: Record<string, string> = {};
  for (const port of portArray) {
    portMappings[port.toString()] = buildPodUrl(pod.podId, port);
  }

  // Convert database pod to PodWorkspace format for compatibility
  const workspace: PodWorkspace = {
    id: pod.podId,
    password,
    portMappings,
    state: pod.status,
    usage_status: pod.usageStatus,
    marked_at: pod.usageStatusMarkedAt?.toISOString() || "",
    // Legacy fields - not used but kept for type compatibility
    branches: [],
    created: pod.createdAt.toISOString(),
    customImage: false,
    flagged_for_recreation: pod.flaggedForRecreation,
    fqdn: "",
    image: "",
    primaryRepo: "",
    repoName: "",
    repositories: [],
    subdomain: pod.podId,
    url: "",
    useDevContainer: false,
  };

  console.log(">>> workspace data", workspace);

  let frontend: string | undefined;
  let processList: ProcessInfo[] | undefined;

  const controlPortUrl = workspace.portMappings[POD_PORTS.CONTROL];

  // Always try to fetch process list if control port exists
  if (controlPortUrl) {
    try {
      processList = await getProcessList(controlPortUrl, workspace.password);
      console.log(`>>> Successfully fetched process list with ${processList.length} processes`);
    } catch (error) {
      console.error(">>> Failed to fetch process list:", error);
    }
  }

  // FIRST: Try to get frontend port from services array if provided
  if (services && services.length > 0) {
    try {
      const frontendService = services.find((svc) => svc.name === "frontend");

      if (frontendService?.port) {
        console.log(`>>> Found frontend port ${frontendService.port} from services array`);

        // Try to find the port in port mappings
        frontend = workspace.portMappings[frontendService.port.toString()];

        if (frontend) {
          console.log(`>>> Using frontend from services array on port ${frontendService.port}:`, frontend);
          return { frontend, workspace, processList };
        } else {
          console.log(`>>> Port ${frontendService.port} from services not found in port mappings, trying fallbacks`);
        }
      } else {
        console.log(">>> No frontend service found in services array, trying fallbacks");
      }
    } catch (error) {
      console.error(">>> Error getting port from services array, trying fallbacks:", error);
    }
  }

  // SECOND: Try to get frontend from process discovery if we have process list
  if (processList) {
    try {
      // Get the frontend URL from port mappings
      frontend = getFrontendUrl(processList, workspace.portMappings);
    } catch (error) {
      console.error(
        `>>> Failed to get frontend from process list, falling back to port ${POD_PORTS.FRONTEND_FALLBACK}:`,
        error,
      );
      // frontend remains undefined, will try fallback below
    }
  } else if (!controlPortUrl) {
    // Control port not available, will try fallback
    console.error(
      `>>> Control port (${POD_PORTS.CONTROL}) not found in port mappings, falling back to port ${POD_PORTS.FRONTEND_FALLBACK}`,
    );
  }

  // If frontend not found via process discovery, use fallback
  if (!frontend) {
    // Fallback to port 3000 if process discovery failed or control port was missing
    frontend = workspace.portMappings[POD_PORTS.FRONTEND_FALLBACK];

    if (!frontend && controlPortUrl) {
      // Final fallback: try to find frontend port from process list if we have it
      let frontendPort = POD_PORTS.FRONTEND_FALLBACK as string; // default to 3000 if we can't find it

      if (processList) {
        const frontendProcess = processList.find((proc) => proc.name === PROCESS_NAMES.FRONTEND);
        if (frontendProcess?.port) {
          frontendPort = frontendProcess.port;
          console.log(`>>> Found frontend process on port ${frontendPort} from process list`);
        }
      }

      // Replace control port with dynamically discovered frontend port in controlPortUrl
      frontend = controlPortUrl.replace(POD_PORTS.CONTROL, frontendPort);
      console.log(
        `>>> Using final fallback - replacing port ${POD_PORTS.CONTROL} with ${frontendPort} in controlPortUrl:`,
        frontend,
      );
    } else if (frontend) {
      console.log(`>>> Using fallback frontend on port ${POD_PORTS.FRONTEND_FALLBACK}:`, frontend);
    }

    if (!frontend) {
      throw new Error(`Failed to discover frontend and port ${POD_PORTS.FRONTEND_FALLBACK} not found in port mappings`);
    }
  }

  return { frontend, workspace, processList };
}

/**
 * Drop a pod by releasing it back to the available pool
 * @deprecated Use releasePodById() directly instead
 */
export async function dropPod(podId: string): Promise<void> {
  const released = await releasePodById(podId);
  if (!released) {
    throw new Error(`Failed to release pod: ${podId} not found`);
  }
  console.log(`>>> Pod ${podId} released successfully`);
}

export interface PodUsage {
  usage_status: "used" | "unused";
  user_info: string | null;
  workspace_id: string;
}

/**
 * Get pod usage status from database
 * @deprecated Use getPodUsageStatus() directly instead
 */
export async function getPodUsage(podId: string): Promise<PodUsage> {
  const status = await getPodUsageStatus(podId);

  if (!status) {
    throw new Error(`Pod ${podId} not found`);
  }

  return {
    usage_status: status.usageStatus === "USED" ? "used" : "unused",
    user_info: status.usageStatusMarkedBy,
    workspace_id: podId,
  };
}

export async function updatePodRepositories(
  controlPortUrl: string,
  password: string,
  repositories: Array<{ url: string }>,
): Promise<void> {
  const updateUrl = `${controlPortUrl}/latest`;

  const response = await fetch(updateUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${password}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ repos: repositories }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Failed to update pod repositories: ${response.status} - ${errorText}`);
    throw new Error(`Failed to update pod repositories: ${response.status}`);
  }

  console.log(">>> Pod repositories updated");
}

/**
 * Result of frontend availability check
 */
export interface FrontendCheckResult {
  available: boolean;
  frontendUrl: string | null;
  error?: string;
}

/**
 * Check if frontend is available by verifying:
 * 1. Frontend process exists in jlist
 * 2. Frontend URL is accessible (HTTP health check)
 *
 * Uses same URL resolution logic as claimPodAndGetFrontend with fallbacks.
 */
export async function checkFrontendAvailable(
  jlist: JlistProcess[],
  portMappings: number[],
  podId: string,
): Promise<FrontendCheckResult> {
  // 1. Find frontend process in jlist
  const frontendProcess = jlist.find((proc) => proc.name === PROCESS_NAMES.FRONTEND);

  if (!frontendProcess) {
    return { available: false, frontendUrl: null, error: "Frontend process not found in jlist" };
  }

  // 2. Resolve frontend URL using same fallback logic as claimPodAndGetFrontend
  let frontendUrl: string | null = null;
  const frontendPort = frontendProcess.port ? parseInt(frontendProcess.port, 10) : null;
  const fallbackPort = parseInt(POD_PORTS.FRONTEND_FALLBACK, 10);

  if (frontendPort && portMappings.includes(frontendPort)) {
    frontendUrl = buildPodUrl(podId, frontendPort);
  } else if (portMappings.includes(fallbackPort)) {
    frontendUrl = buildPodUrl(podId, fallbackPort);
  } else if (frontendPort) {
    // Use discovered frontend port even if not in mappings
    frontendUrl = buildPodUrl(podId, frontendPort);
  } else {
    // Final fallback to default frontend port
    frontendUrl = buildPodUrl(podId, POD_PORTS.FRONTEND_FALLBACK);
  }

  // 3. HTTP health check to frontend (5s timeout)
  try {
    const response = await fetch(frontendUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
    return { available: response.ok, frontendUrl };
  } catch {
    return { available: false, frontendUrl, error: "Frontend URL not responding" };
  }
}

/**
 * Get the port for a service from the PM2 config
 * @param pm2ConfigContent - The PM2 config file content (plain text or base64)
 * @param serviceName - The name of the service to find (default: "frontend")
 * @returns The port number for the service, or null if not found
 */
export function getPortFromPM2Config(pm2ConfigContent: string | undefined, serviceName = "frontend"): number | null {
  if (!pm2ConfigContent) {
    console.error("No PM2 config content provided");
    return null;
  }

  try {
    const services = parsePM2Content(pm2ConfigContent);
    console.log(">>> services", JSON.stringify(services, null, 2));
    const service = services.find((svc) => svc.name === serviceName);

    if (!service) {
      console.error(`Service "${serviceName}" not found in PM2 config`);
      return null;
    }

    return service.port;
  } catch (error) {
    console.error("Error parsing PM2 config:", error);
    return null;
  }
}

export interface ReleaseTaskPodOptions {
  taskId: string;
  podId: string;
  workspaceId: string;
  verifyOwnership?: boolean;
  resetRepositories?: boolean;
  clearTaskFields?: boolean;
  newWorkflowStatus?: "COMPLETED" | "HALTED" | null; // null = don't change workflowStatus
}

export interface ReleaseTaskPodResult {
  success: boolean;
  podDropped: boolean;
  taskCleared: boolean;
  reassigned?: boolean;
  error?: string;
}

/**
 * Release a pod from a task - handles full cleanup flow:
 * 1. Verify pod ownership (optional)
 * 2. Reset repositories (optional)
 * 3. Release pod via database (mark as unused, clear task associations)
 */
export async function releaseTaskPod(options: ReleaseTaskPodOptions): Promise<ReleaseTaskPodResult> {
  const {
    taskId,
    podId,
    workspaceId,
    verifyOwnership = true,
    resetRepositories = false,
    clearTaskFields = true,
    newWorkflowStatus = "COMPLETED", // null = don't change workflowStatus
  } = options;

  const result: ReleaseTaskPodResult = {
    success: false,
    podDropped: false,
    taskCleared: false,
  };

  try {
    console.log(`[releaseTaskPod] Starting release for task ${taskId}, pod ${podId}`);

    // Skip actual operations in mock environment
    if (process.env.MOCK_BROWSER_URL) {
      console.log("[releaseTaskPod] Mock environment detected, skipping pod release");
      result.success = true;
      result.podDropped = true;
      result.taskCleared = true;
      return result;
    }

    // Fetch workspace for repository reset if needed
    const workspace = resetRepositories
      ? await db.workspace.findFirst({
          where: { id: workspaceId },
          include: {
            repositories: true,
          },
        })
      : null;

    // Verify pod ownership if requested (check if pod is assigned to this task)
    if (verifyOwnership) {
      try {
        const podUsage = await getPodUsageStatus(podId);

        if (!podUsage) {
          result.error = "Pod not found";
          console.error(`[releaseTaskPod] ${result.error}`);
          return result;
        }

        // Check if pod is assigned to a different task
        const task = await db.task.findFirst({
          where: { podId },
        });

        if (task && task.id !== taskId) {
          console.log(
            `[releaseTaskPod] Pod ${podId} is assigned to different task (${task.id}) not this task (${taskId})`,
          );
          result.reassigned = true;
          result.success = true;
          return result;
        }

        console.log(`[releaseTaskPod] Pod ${podId} ownership verified for task ${taskId}`);
      } catch (error) {
        console.error("[releaseTaskPod] Error verifying pod ownership:", error);
        result.error = "Failed to verify pod ownership";
        return result;
      }
    }

    // Reset repositories if requested (uses Pool Manager API for container operations)
    if (resetRepositories && workspace) {
      try {
        const podDetails = await getPodDetails(podId);

        if (podDetails && podDetails.portMappings) {
          const controlPort = parseInt(POD_PORTS.CONTROL, 10);
          const hasControlPort = podDetails.portMappings.includes(controlPort);
          const password = podDetails.password;

          if (hasControlPort && password) {
            const controlPortUrl = buildPodUrl(podDetails.podId, POD_PORTS.CONTROL);
            const repositories = workspace.repositories.map((repo) => ({ url: repo.repositoryUrl }));
            if (repositories.length > 0) {
              await updatePodRepositories(controlPortUrl, password, repositories);
              console.log("[releaseTaskPod] Pod repositories reset");
            }
          } else {
            console.log(`[releaseTaskPod] Control port or password not found, skipping repository reset`);
          }
        }
      } catch (error) {
        console.error("[releaseTaskPod] Error resetting pod repositories:", error);
        // Continue with pod release even if repository reset fails
      }
    }

    // Release the pod via database (atomically clears task associations)
    try {
      const released = await releasePodById(podId);

      if (released) {
        result.podDropped = true;
        result.taskCleared = true; // releasePodById clears task associations atomically
        console.log(`[releaseTaskPod] Pod ${podId} released successfully`);
      } else {
        console.log(`[releaseTaskPod] Pod ${podId} not found in database`);
        result.error = "Pod not found";
      }
    } catch (error) {
      console.error("[releaseTaskPod] Error releasing pod:", error);
      result.error = "Failed to release pod";
    }

    // Update task workflow status if needed
    if (clearTaskFields && newWorkflowStatus && result.taskCleared) {
      try {
        await db.task.update({
          where: { id: taskId },
          data: {
            workflowStatus: newWorkflowStatus,
            ...(newWorkflowStatus === "HALTED" && { workflowCompletedAt: new Date() }),
          },
        });
        console.log(`[releaseTaskPod] Task ${taskId} workflowStatus set to ${newWorkflowStatus}`);
      } catch (error) {
        console.error("[releaseTaskPod] Error updating task workflow status:", error);
      }
    }

    result.success = result.podDropped || result.taskCleared;
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[releaseTaskPod] Unexpected error:`, errorMessage);
    result.error = errorMessage;
    return result;
  }
}
