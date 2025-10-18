import { config } from "@/lib/env";

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
  const frontendProcess = processList.find((proc) => proc.name === "frontend");

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
): Promise<{ frontend: string; workspace: PodWorkspace }> {
  // Get workspace from pool
  const workspace = await getWorkspaceFromPool(poolName, poolApiKey);

  console.log(">>> workspace data", workspace);

  // Mark the workspace as used
  await markWorkspaceAsUsed(poolName, workspace.id, poolApiKey);

  let frontend: string;

  try {
    // Get the control port URL (15552)
    const controlPortUrl = workspace.portMappings["15552"];
    if (!controlPortUrl) {
      throw new Error("Control port (15552) not found in port mappings");
    }

    // Get the process list from the control port
    const processList = await getProcessList(controlPortUrl, workspace.password);

    // Get the frontend URL from port mappings
    frontend = getFrontendUrl(processList, workspace.portMappings);
  } catch (error) {
    console.error(">>> Failed to get frontend from process list, falling back to port 3000:", error);

    // Fallback to port 3000 if process discovery fails
    frontend = workspace.portMappings["3000"];

    if (!frontend) {
      throw new Error("Failed to discover frontend and port 3000 not found in port mappings");
    }

    console.log(">>> Using fallback frontend on port 3000:", frontend);
  }

  return { frontend, workspace };
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
