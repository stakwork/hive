import { WorkflowStatus, RepositoryStatus } from "@prisma/client";

function normalizeStatus(status: string): string {
  return status.toLowerCase();
}

type StatusMapping = {
  [key: string]: string[];
};


const workflowStatusMapping: StatusMapping = {
  IN_PROGRESS: ["in_progress", "running", "processing"],
  COMPLETED: ["completed", "success", "finished"],
  FAILED: ["error", "failed"],
  HALTED: ["halted", "paused", "stopped"],
};

function mapStatus<T extends string>(status: string, mapping: StatusMapping, defaultValue?: T): T | null {
  const normalized = normalizeStatus(status);

  for (const [enumValue, patterns] of Object.entries(mapping)) {
    if (patterns.some((pattern) => normalized.includes(pattern))) {
      return enumValue as T;
    }
  }

  return defaultValue || null;
}


export function mapStakworkStatus(status: string): WorkflowStatus | null {
  return mapStatus(status, workflowStatusMapping) as WorkflowStatus | null;
}


export function stakgraphToRepositoryStatus(status: string): RepositoryStatus {
  const normalized = normalizeStatus(status);

  switch (normalized) {
    case "inprogress":
      return RepositoryStatus.PENDING;
    case "complete":
      return RepositoryStatus.SYNCED;
    case "completed":
      return RepositoryStatus.SYNCED;
    case "synced":
      return RepositoryStatus.SYNCED;
    case "failed":
      return RepositoryStatus.FAILED;
    default:
      throw new Error(`Unknown stakgraph status: ${status}`);
  }
}
