import { StepStatus, WorkflowStatus } from "@prisma/client";

function normalizeStatus(status: string): string {
  return status.toLowerCase();
}

type StatusMapping = {
  [key: string]: string[];
};

const stepStatusMapping: StatusMapping = {
  PROCESSING: ["inprogress", "in_progress", "running"],
  COMPLETED: ["complete", "completed", "success"],
  FAILED: ["fail", "error"],
};

const workflowStatusMapping: StatusMapping = {
  IN_PROGRESS: ["in_progress", "running", "processing"],
  COMPLETED: ["completed", "success", "finished"],
  FAILED: ["error", "failed"],
  HALTED: ["halted", "paused", "stopped"],
};

function mapStatus<T extends string>(
  status: string,
  mapping: StatusMapping,
  defaultValue?: T,
): T | null {
  const normalized = normalizeStatus(status);

  for (const [enumValue, patterns] of Object.entries(mapping)) {
    if (patterns.some((pattern) => normalized.includes(pattern))) {
      return enumValue as T;
    }
  }

  return defaultValue || null;
}

export function mapStatusToStepStatus(status: string): StepStatus {
  return mapStatus(status, stepStatusMapping, "PROCESSING") as StepStatus;
}

export function mapStakworkStatus(status: string): WorkflowStatus | null {
  return mapStatus(status, workflowStatusMapping) as WorkflowStatus | null;
}
