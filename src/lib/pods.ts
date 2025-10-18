import { config } from "@/lib/env";

interface PodWorkspace {
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

export async function getWorkspaceFromPool(poolName: string, headers: Record<string, string>): Promise<PodWorkspace> {
  const url = `${config.POOL_MANAGER_BASE_URL}/pools/${encodeURIComponent(poolName)}/workspace`;

  const response = await fetch(url, {
    method: "GET",
    headers: headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Pool Manager API error: ${response.status} - ${errorText}`);
    throw new Error(`Failed to get workspace from pool: ${response.status}`);
  }

  const data = await response.json();
  return data.workspace as PodWorkspace;
}

async function markWorkspaceAsUsed(
  poolName: string,
  workspaceId: string,
  headers: Record<string, string>,
): Promise<void> {
  const markUsedUrl = `${config.POOL_MANAGER_BASE_URL}/pools/${encodeURIComponent(poolName)}/workspaces/${workspaceId}/mark-used`;

  const response = await fetch(markUsedUrl, {
    method: "POST",
    headers: headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Failed to mark workspace as used: ${response.status} - ${errorText}`);
    throw new Error(`Failed to mark workspace as used: ${response.status}`);
  }

  console.log(">>> Workspace marked as used");
}

async function markWorkspaceAsUnused(
  poolName: string,
  workspaceId: string,
  headers: Record<string, string>,
): Promise<void> {
  const markUnusedUrl = `${config.POOL_MANAGER_BASE_URL}/pools/${encodeURIComponent(poolName)}/workspaces/${workspaceId}/mark-unused`;

  const response = await fetch(markUnusedUrl, {
    method: "POST",
    headers: headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Failed to drop pod: ${response.status} - ${errorText}`);
    throw new Error(`Failed to drop pod: ${response.status}`);
  }

  console.log(">>> Pod dropped");
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

export async function claimPodAndGetFrontend(poolName: string, headers: Record<string, string>): Promise<string> {
  // Get workspace from pool
  const workspace = await getWorkspaceFromPool(poolName, headers);

  console.log(">>> workspace data", workspace);

  // Mark the workspace as used
  await markWorkspaceAsUsed(poolName, workspace.id, headers);

  // Get the control port URL (15552)
  const controlPortUrl = workspace.portMappings["15552"];
  if (!controlPortUrl) {
    throw new Error("Control port (15552) not found in port mappings");
  }

  // Get the process list from the control port
  const processList = await getProcessList(controlPortUrl, workspace.password);

  // Get the frontend URL from port mappings
  const frontend = getFrontendUrl(processList, workspace.portMappings);

  return frontend;
}

export async function dropPod(
  poolName: string,
  workspaceId: string,
  headers: Record<string, string>,
): Promise<void> {
  await markWorkspaceAsUnused(poolName, workspaceId, headers);
}
