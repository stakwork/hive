"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import type { FeatureStatus, PhaseStatus, TaskStatus } from "@prisma/client";
import {
  AlertCircle,
  Calendar,
  CheckCircle,
  Circle,
  Inbox,
  Loader2,
  XCircle
} from "lucide-react";

type StatusType = "feature" | "phase" | "task";

interface StatusConfig {
  icon: React.ReactNode;
  label: string;
  className: string;
}

const FEATURE_STATUS_CONFIG: Record<FeatureStatus, StatusConfig> = {
  BACKLOG: {
    icon: <Inbox className="h-3 w-3" />,
    label: "Backlog",
    className: "bg-gray-100 text-gray-700 border-gray-200",
  },
  PLANNED: {
    icon: <Calendar className="h-3 w-3" />,
    label: "Planned",
    className: "bg-purple-50 text-purple-700 border-purple-200",
  },
  IN_PROGRESS: {
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    label: "In Progress",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  COMPLETED: {
    icon: <CheckCircle className="h-3 w-3" />,
    label: "Completed",
    className: "bg-green-50 text-green-700 border-green-200",
  },
  CANCELLED: {
    icon: <XCircle className="h-3 w-3" />,
    label: "Cancelled",
    className: "bg-red-50 text-red-700 border-red-200",
  },
  ERROR: {
    icon: <XCircle className="h-3 w-3" />,
    label: "Error",
    className: "bg-red-50 text-red-700 border-red-200",
  },
  BLOCKED: {
    icon: <AlertCircle className="h-3 w-3" />,
    label: "Blocked",
    className: "bg-orange-50 text-orange-700 border-orange-200",
  },

};

const PHASE_STATUS_CONFIG: Record<PhaseStatus, StatusConfig> = {
  NOT_STARTED: {
    icon: <Circle className="h-3 w-3" />,
    label: "Not Started",
    className: "bg-gray-100 text-gray-700 border-gray-200",
  },
  IN_PROGRESS: {
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    label: "In Progress",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  DONE: {
    icon: <CheckCircle className="h-3 w-3" />,
    label: "Done",
    className: "bg-green-50 text-green-700 border-green-200",
  },
  BLOCKED: {
    icon: <AlertCircle className="h-3 w-3" />,
    label: "Blocked",
    className: "bg-red-50 text-red-700 border-red-200",
  },
};

const TASK_STATUS_CONFIG: Record<TaskStatus, StatusConfig> = {
  TODO: {
    icon: <Circle className="h-3 w-3" />,
    label: "To Do",
    className: "bg-gray-100 text-gray-700 border-gray-200",
  },
  IN_PROGRESS: {
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    label: "In Progress",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  DONE: {
    icon: <CheckCircle className="h-3 w-3" />,
    label: "Done",
    className: "bg-green-50 text-green-700 border-green-200",
  },
  BLOCKED: {
    icon: <AlertCircle className="h-3 w-3" />,
    label: "Blocked",
    className: "bg-red-50 text-red-700 border-red-200",
  },
  CANCELLED: {
    icon: <XCircle className="h-3 w-3" />,
    label: "Cancelled",
    className: "bg-slate-100 text-slate-700 border-slate-200",
  },
};

interface StatusBadgeProps {
  statusType: StatusType;
  status: FeatureStatus | PhaseStatus | TaskStatus;
  className?: string;
}

export function StatusBadge({ statusType, status, className }: StatusBadgeProps) {
  let config: StatusConfig;

  switch (statusType) {
    case "feature":
      config = FEATURE_STATUS_CONFIG[status as FeatureStatus];
      break;
    case "phase":
      config = PHASE_STATUS_CONFIG[status as PhaseStatus];
      break;
    case "task":
      config = TASK_STATUS_CONFIG[status as TaskStatus];
      break;
  }

  if (!config) {
    return null;
  }

  return (
    <Badge className={`${config.className} ${className || ""}`}>
      <span className="flex items-center gap-1.5">
        {config.icon}
        {config.label}
      </span>
    </Badge>
  );
}

export function getStatusConfig(statusType: StatusType, status: string): StatusConfig | null {
  switch (statusType) {
    case "feature":
      return FEATURE_STATUS_CONFIG[status as FeatureStatus] || null;
    case "phase":
      return PHASE_STATUS_CONFIG[status as PhaseStatus] || null;
    case "task":
      return TASK_STATUS_CONFIG[status as TaskStatus] || null;
    default:
      return null;
  }
}

export function getAllStatusOptions(statusType: StatusType): string[] {
  switch (statusType) {
    case "feature":
      return Object.keys(FEATURE_STATUS_CONFIG) as FeatureStatus[];
    case "phase":
      return Object.keys(PHASE_STATUS_CONFIG) as PhaseStatus[];
    case "task":
      return Object.keys(TASK_STATUS_CONFIG) as TaskStatus[];
    default:
      return [];
  }
}
