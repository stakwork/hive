import { StepStatus, WorkflowStatus } from "@prisma/client";

export function mapStatusToStepStatus(status: string): StepStatus {
  const s = status.toLowerCase();
  if (s.includes("inprogress") || s.includes("in_progress") || s === "running")
    return "PROCESSING";
  if (
    s.includes("complete") ||
    s.includes("completed") ||
    s.includes("success")
  )
    return "COMPLETED";
  if (s.includes("fail") || s.includes("error")) return "FAILED";
  return "PROCESSING";
}

export function mapAsyncStatusToStepStatus(
  status: string | undefined,
): StepStatus | undefined {
  if (!status) return undefined;
  const normalized = status.toLowerCase();
  if (normalized.includes("inprogress") || normalized.includes("in_progress")) {
    return "PROCESSING";
  }
  if (
    normalized.includes("complete") ||
    normalized.includes("completed") ||
    normalized.includes("success")
  ) {
    return "COMPLETED";
  }
  if (normalized.includes("fail") || normalized.includes("error")) {
    return "FAILED";
  }
  return undefined;
}

export const mapStakworkStatus = (status: string): WorkflowStatus | null => {
  switch (status.toLowerCase()) {
    case "in_progress":
    case "running":
    case "processing":
      return WorkflowStatus.IN_PROGRESS;
    case "completed":
    case "success":
    case "finished":
      return WorkflowStatus.COMPLETED;
    case "error":
    case "failed":
      return WorkflowStatus.FAILED;
    case "halted":
    case "paused":
    case "stopped":
      return WorkflowStatus.HALTED;
    default:
      console.warn(
        `Unknown Stakwork status: ${status}, keeping existing status`,
      );
      return null;
  }
};
