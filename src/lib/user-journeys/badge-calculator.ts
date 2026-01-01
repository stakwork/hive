import { TaskStatus, WorkflowStatus } from "@prisma/client";

export interface BadgeMetadata {
  type: "PR" | "WORKFLOW" | "LIVE";
  text: string;
  url?: string;
  color: string;
  borderColor: string;
  icon?: "GitPullRequest" | "GitMerge" | "GitPullRequestClosed" | null;
  hasExternalLink?: boolean;
}

export function calculateBadge(
  task: {
    status: TaskStatus;
    workflowStatus: WorkflowStatus | null;
  },
  prArtifact?: {
    content: {
      url: string;
      status: "IN_PROGRESS" | "DONE" | "CANCELLED";
    };
  } | null,
): BadgeMetadata {
  // Check if deployed to graph first (highest priority)
  if (task.status === TaskStatus.DONE && task.workflowStatus === WorkflowStatus.COMPLETED) {
    return {
      type: "LIVE",
      text: "Live",
      color: "#10b981",
      borderColor: "#10b981",
      icon: null,
      hasExternalLink: false,
    };
  }

  // Check PR artifact (second priority)
  if (prArtifact?.content) {
    const prStatus = prArtifact.content.status;
    const prUrl = prArtifact.content.url;

    if (prStatus === "IN_PROGRESS") {
      return {
        type: "PR",
        text: "Open",
        url: prUrl,
        color: "#238636",
        borderColor: "#238636",
        icon: "GitPullRequest",
        hasExternalLink: true,
      };
    }

    if (prStatus === "CANCELLED") {
      return {
        type: "PR",
        text: "Closed",
        url: prUrl,
        color: "#6e7681",
        borderColor: "#6e7681",
        icon: "GitPullRequestClosed",
        hasExternalLink: true,
      };
    }

    if (prStatus === "DONE") {
      return {
        type: "PR",
        text: "Merged",
        url: prUrl,
        color: "#8957e5",
        borderColor: "#8957e5",
        icon: "GitMerge",
        hasExternalLink: true,
      };
    }
  }

  // Fallback to workflow status
  const workflowStatus = task.workflowStatus;

  if (
    workflowStatus === WorkflowStatus.FAILED ||
    workflowStatus === WorkflowStatus.ERROR ||
    workflowStatus === WorkflowStatus.HALTED
  ) {
    return {
      type: "WORKFLOW",
      text: "Failed",
      color: "#dc2626",
      borderColor: "#dc2626",
      icon: null,
      hasExternalLink: false,
    };
  }

  if (workflowStatus === WorkflowStatus.IN_PROGRESS || workflowStatus === WorkflowStatus.PENDING) {
    return {
      type: "WORKFLOW",
      text: "In Progress",
      color: "#ca8a04",
      borderColor: "#ca8a04",
      icon: null,
      hasExternalLink: false,
    };
  }

  if (workflowStatus === WorkflowStatus.COMPLETED) {
    return {
      type: "WORKFLOW",
      text: "Completed",
      color: "#16a34a",
      borderColor: "#16a34a",
      icon: null,
      hasExternalLink: false,
    };
  }

  // Default: Pending
  return {
    type: "WORKFLOW",
    text: "Pending",
    color: "#6b7280",
    borderColor: "#6b7280",
    icon: null,
    hasExternalLink: false,
  };
}
