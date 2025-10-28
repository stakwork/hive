import { config } from "@/lib/env";

// Re-export constants for external use
export { POD_PORTS, PROCESS_NAMES, GOOSE_CONFIG } from "./constants";

// Import for internal use
import { POD_PORTS, PROCESS_NAMES, GOOSE_CONFIG } from "./constants";

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
  const url = `${config.POOL_MANAGER_BASE_URL}/pools/${encodeURIComponent(poolName)}/workspace`;

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
  const url = `${config.POOL_MANAGER_BASE_URL}/workspaces/${podId}`;

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

async function markWorkspaceAsUsed(poolName: string, workspaceId: string, poolApiKey: string): Promise<void> {
  const markUsedUrl = `${config.POOL_MANAGER_BASE_URL}/pools/${encodeURIComponent(poolName)}/workspaces/${workspaceId}/mark-used`;

  console.log(`>>> Marking workspace as used: POST ${markUsedUrl}`);

  const response = await fetch(markUsedUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${poolApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
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
  const markUnusedUrl = `${config.POOL_MANAGER_BASE_URL}/pools/${encodeURIComponent(poolName)}/workspaces/${workspaceId}/mark-unused`;

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

export async function claimPodAndGetFrontend(
  poolName: string,
  poolApiKey: string,
): Promise<{ frontend: string; workspace: PodWorkspace; processList?: ProcessInfo[] }> {
  // Get workspace from pool
  const workspace = await getWorkspaceFromPool(poolName, poolApiKey);

  console.log(">>> workspace data", workspace);

  // Mark the workspace as used
  await markWorkspaceAsUsed(poolName, workspace.id, poolApiKey);

  let frontend: string;
  let processList: ProcessInfo[] | undefined;

  const controlPortUrl = workspace.portMappings[POD_PORTS.CONTROL];
  if (!controlPortUrl) {
    throw new Error(`Control port (${POD_PORTS.CONTROL}) not found in port mappings`);
  }
  try {
    // Get the process list from the control port
    processList = await getProcessList(controlPortUrl, workspace.password);

    // Get the frontend URL from port mappings
    frontend = getFrontendUrl(processList, workspace.portMappings);
  } catch (error) {
    console.error(
      `>>> Failed to get frontend from process list, falling back to port ${POD_PORTS.FRONTEND_FALLBACK}:`,
      error,
    );

    // Fallback to port 3000 if process discovery fails
    frontend = workspace.portMappings[POD_PORTS.FRONTEND_FALLBACK];

    if (!frontend) {
      // Final fallback: replace control port (15552) with frontend port (3000) in controlPortUrl
      frontend = controlPortUrl.replace(POD_PORTS.CONTROL, POD_PORTS.FRONTEND_FALLBACK);
      console.log(
        `>>> Using final fallback - replacing port ${POD_PORTS.CONTROL} with ${POD_PORTS.FRONTEND_FALLBACK} in controlPortUrl:`,
        frontend,
      );
    } else {
      console.log(`>>> Using fallback frontend on port ${POD_PORTS.FRONTEND_FALLBACK}:`, frontend);
    }

    if (!frontend) {
      throw new Error(`Failed to discover frontend and port ${POD_PORTS.FRONTEND_FALLBACK} not found in port mappings`);
    }

    console.log(`>>> Using fallback frontend on port ${POD_PORTS.FRONTEND_FALLBACK}:`, frontend);
  }

  return { frontend, workspace, processList };
}

export async function dropPod(poolName: string, workspaceId: string, poolApiKey: string): Promise<void> {
  await markWorkspaceAsUnused(poolName, workspaceId, poolApiKey);
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
