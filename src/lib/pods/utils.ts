import { config } from "@/config/env";
import { parsePM2Content } from "@/utils/devContainerUtils";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

const encryptionService = EncryptionService.getInstance();

// Re-export constants for external use
export { POD_PORTS, PROCESS_NAMES, GOOSE_CONFIG } from "./constants";

// Import for internal use
import { POD_PORTS, PROCESS_NAMES, GOOSE_CONFIG } from "./constants";

// Get the Pool Manager base URL (already resolved for mock mode in env.ts)
function getBaseUrl(): string {
  return config.POOL_MANAGER_BASE_URL;
}

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

export async function getWorkspaceFromPool(poolName: string, poolApiKey: string): Promise<PodWorkspace> {
  const url = `${getBaseUrl()}/pools/${encodeURIComponent(poolName)}/workspace`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${poolApiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Pool Manager API error: ${response.status} - ${errorText}`);
    throw new Error(`Failed to get workspace from pool: ${response.status}`);
  }

  const data = await response.json();
  return data.workspace as PodWorkspace;
}

export async function getPodFromPool(podId: string, poolApiKey: string): Promise<PodWorkspace> {
  const url = `${getBaseUrl()}/workspaces/${podId}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${poolApiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Pool Manager API error: ${response.status} - ${errorText}`);
    throw new Error(`Failed to get workspace from pool: ${response.status}`);
  }

  const data = await response.json();
  return data as PodWorkspace;
}

async function markWorkspaceAsUsed(
  poolName: string,
  workspaceId: string,
  poolApiKey: string,
  userInfo?: string,
): Promise<void> {
  const markUsedUrl = `${getBaseUrl()}/pools/${encodeURIComponent(poolName)}/workspaces/${workspaceId}/mark-used`;

  console.log(`>>> Marking workspace as used: POST ${markUsedUrl}`);

  const response = await fetch(markUsedUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${poolApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(userInfo ? { user_info: userInfo } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Failed to mark workspace as used: ${response.status} - ${errorText}`);
    throw new Error(`Failed to mark workspace as used: ${response.status}`);
  }

  const responseData = await response.text();
  console.log(`>>> Workspace marked as used successfully (${response.status}):`, responseData || "No response body");
}

async function markWorkspaceAsUnused(poolName: string, workspaceId: string, poolApiKey: string): Promise<void> {
  const markUnusedUrl = `${getBaseUrl()}/pools/${encodeURIComponent(poolName)}/workspaces/${workspaceId}/mark-unused`;

  console.log(`>>> Marking workspace as unused: POST ${markUnusedUrl}`);

  const response = await fetch(markUnusedUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${poolApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Failed to drop pod: ${response.status} - ${errorText}`);
    throw new Error(`Failed to drop pod: ${response.status}`);
  }

  const responseData = await response.text();
  console.log(`>>> Pod dropped successfully (${response.status}):`, responseData || "No response body");
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
  poolName: string,
  poolApiKey: string,
  services?: ServiceInfo[],
  userInfo?: string,
): Promise<{ frontend: string; workspace: PodWorkspace; processList?: ProcessInfo[] }> {
  // Get workspace from pool
  const workspace = await getWorkspaceFromPool(poolName, poolApiKey);

  console.log(">>> workspace data", workspace);

  // Mark the workspace as used (pass userInfo for tracking, e.g. taskId in agent mode)
  await markWorkspaceAsUsed(poolName, workspace.id, poolApiKey, userInfo);

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

export async function dropPod(poolName: string, workspaceId: string, poolApiKey: string): Promise<void> {
  await markWorkspaceAsUnused(poolName, workspaceId, poolApiKey);
}

export interface PodUsage {
  usage_status: "used" | "unused";
  user_info: string | null;
  workspace_id: string;
}

export async function getPodUsage(poolName: string, podId: string, poolApiKey: string): Promise<PodUsage> {
  const url = `${getBaseUrl()}/pools/${encodeURIComponent(poolName)}/workspaces/${podId}/usage`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${poolApiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Failed to get pod usage: ${response.status} - ${errorText}`);
    throw new Error(`Failed to get pod usage: ${response.status}`);
  }

  const data = await response.json();
  return data as PodUsage;
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
 * Check if Goose service is running by checking the process list
 * Returns true if goose process is found, false otherwise
 */
export function checkGooseRunning(processList: ProcessInfo[]): boolean {
  const gooseProcess = processList.find((proc) => proc.name === PROCESS_NAMES.GOOSE);
  return !!gooseProcess;
}

/**
 * Start the Goose service via the control port
 * Returns the goose URL if startup succeeded, or null if startup failed
 */
export async function startGoose(
  controlPortUrl: string,
  password: string,
  repoName: string,
  anthropicApiKey: string,
  // portMappings: Record<string, string>,
): Promise<string | null> {
  console.log(`🚀 Starting Goose service via control port (${POD_PORTS.CONTROL})...`);

  try {
    // Start goose_web service via control port
    const startGooseResponse = await fetch(`${controlPortUrl}/goose_web`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${password}`,
      },
      body: JSON.stringify({
        repoName,
        apiKey: anthropicApiKey,
      }),
    });

    if (!startGooseResponse.ok) {
      const errorText = await startGooseResponse.text();
      console.error("Failed to start goose service:", startGooseResponse.status, errorText);
      return null;
    }

    console.log("✅ Goose service start request sent successfully");

    // Poll to check if goose process is running
    for (let attempt = 1; attempt <= GOOSE_CONFIG.MAX_STARTUP_ATTEMPTS; attempt++) {
      console.log(`🔍 Polling for Goose process (attempt ${attempt}/${GOOSE_CONFIG.MAX_STARTUP_ATTEMPTS})...`);

      await new Promise((resolve) => setTimeout(resolve, GOOSE_CONFIG.POLLING_INTERVAL_MS));

      // Check if goose process is running
      try {
        const processList = await getProcessList(controlPortUrl, password);
        if (checkGooseRunning(processList)) {
          // Goose is always on the designated port - replace control port with goose port in controlPortUrl
          const gooseUrl = controlPortUrl.replace(POD_PORTS.CONTROL, POD_PORTS.GOOSE);
          console.log(
            `✅ Goose service is now available on port ${POD_PORTS.GOOSE} after ${attempt} attempt(s):`,
            gooseUrl,
          );
          return gooseUrl;
        }
      } catch (error) {
        console.error(`Error checking process list on attempt ${attempt}:`, error);
      }
    }

    console.warn(`⚠️ Goose service did not start after ${GOOSE_CONFIG.MAX_STARTUP_ATTEMPTS} attempts`);
    return null;
  } catch (error) {
    console.error("Error starting goose service:", error);
    return null;
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
 * 1. Fetch workspace with swarm config
 * 2. Decrypt pool API key
 * 3. Verify pod ownership (optional)
 * 4. Reset repositories (optional)
 * 5. Drop pod (mark as unused)
 * 6. Clear task pod fields (optional)
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

  // Helper to build task update data - only includes workflowStatus if not null
  const buildTaskUpdateData = () => ({
    podId: null,
    agentUrl: null,
    agentPassword: null,
    ...(newWorkflowStatus && { workflowStatus: newWorkflowStatus }),
    ...(newWorkflowStatus === "HALTED" && { workflowCompletedAt: new Date() }),
  });

  try {
    console.log(`[releaseTaskPod] Starting release for task ${taskId}, pod ${podId}`);

    // Skip actual API calls in mock environment
    if (process.env.MOCK_BROWSER_URL) {
      console.log("[releaseTaskPod] Mock environment detected, skipping pod release");
      if (clearTaskFields) {
        await db.task.update({
          where: { id: taskId },
          data: buildTaskUpdateData(),
        });
        result.taskCleared = true;
      }
      result.success = true;
      result.podDropped = true;
      return result;
    }

    // Fetch workspace with swarm config
    const workspace = await db.workspace.findFirst({
      where: { id: workspaceId },
      include: {
        swarm: true,
        repositories: true,
      },
    });

    if (!workspace) {
      result.error = "Workspace not found";
      console.error(`[releaseTaskPod] ${result.error}`);
      return result;
    }

    if (!workspace.swarm?.id || !workspace.swarm?.poolApiKey) {
      console.log(`[releaseTaskPod] No pool config for workspace ${workspaceId}, skipping pod drop`);
      // Still clear task fields even if we can't drop the pod
      if (clearTaskFields) {
        await db.task.update({
          where: { id: taskId },
          data: buildTaskUpdateData(),
        });
        result.taskCleared = true;
      }
      result.success = true;
      return result;
    }

    const poolId = workspace.swarm.id;
    const poolApiKeyPlain = encryptionService.decryptField("poolApiKey", workspace.swarm.poolApiKey);

    // Verify pod ownership if requested
    if (verifyOwnership) {
      try {
        const podUsage = await getPodUsage(poolId, podId, poolApiKeyPlain);

        if (podUsage.user_info !== taskId) {
          console.log(
            `[releaseTaskPod] Pod ${podId} user_info (${podUsage.user_info}) does not match taskId (${taskId})`
          );
          result.reassigned = true;

          // Clear stale reference from this task (but don't drop the pod - it belongs to another task)
          if (clearTaskFields) {
            await db.task.update({
              where: { id: taskId },
              data: buildTaskUpdateData(),
            });
            result.taskCleared = true;
          }
          result.success = true;
          return result;
        }

        console.log(`[releaseTaskPod] Pod ${podId} ownership verified for task ${taskId}`);
      } catch (error) {
        console.error("[releaseTaskPod] Error verifying pod ownership:", error);
        result.error = "Failed to verify pod ownership";
        // Still try to clear task fields
        if (clearTaskFields) {
          try {
            await db.task.update({
              where: { id: taskId },
              data: buildTaskUpdateData(),
            });
            result.taskCleared = true;
          } catch (updateError) {
            console.error("[releaseTaskPod] Error clearing task fields:", updateError);
          }
        }
        return result;
      }
    }

    // Reset repositories if requested
    if (resetRepositories) {
      try {
        const podWorkspace = await getPodFromPool(podId, poolApiKeyPlain);
        const controlPortUrl = podWorkspace.portMappings[POD_PORTS.CONTROL];

        if (controlPortUrl) {
          const repositories = workspace.repositories.map((repo) => ({ url: repo.repositoryUrl }));
          if (repositories.length > 0) {
            await updatePodRepositories(controlPortUrl, podWorkspace.password, repositories);
            console.log("[releaseTaskPod] Pod repositories reset");
          }
        } else {
          console.log(`[releaseTaskPod] Control port not found, skipping repository reset`);
        }
      } catch (error) {
        console.error("[releaseTaskPod] Error resetting pod repositories:", error);
        // Continue with pod drop even if repository reset fails
      }
    }

    // Drop the pod
    try {
      await dropPod(poolId, podId, poolApiKeyPlain);
      result.podDropped = true;
      console.log(`[releaseTaskPod] Pod ${podId} dropped successfully`);
    } catch (error) {
      console.error("[releaseTaskPod] Error dropping pod:", error);
      result.error = "Failed to drop pod";
      // Still try to clear task fields
    }

    // Clear task pod fields
    if (clearTaskFields) {
      try {
        await db.task.update({
          where: { id: taskId },
          data: buildTaskUpdateData(),
        });
        result.taskCleared = true;
        console.log(
          `[releaseTaskPod] Task ${taskId} pod fields cleared` +
          (newWorkflowStatus ? `, workflowStatus set to ${newWorkflowStatus}` : "")
        );
      } catch (error) {
        console.error("[releaseTaskPod] Error clearing task pod fields:", error);
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
