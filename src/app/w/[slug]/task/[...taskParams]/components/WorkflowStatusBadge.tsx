import { WorkflowStatus } from "@/lib/chat";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  Pause,
  XCircle
} from "lucide-react";

interface WorkflowStatusBadgeProps {
  status: WorkflowStatus | null | undefined;
  className?: string;
}

const statusConfig = {
  [WorkflowStatus.PENDING]: {
    label: "Pending",
    icon: Clock,
    className: "text-muted-foreground",
    iconClassName: "",
  },
  [WorkflowStatus.IN_PROGRESS]: {
    label: "Running",
    icon: Loader2,
    className: "text-blue-600",
    iconClassName: "animate-spin",
  },
  [WorkflowStatus.COMPLETED]: {
    label: "Completed",
    icon: CheckCircle,
    className: "text-green-600",
    iconClassName: "",
  },
  [WorkflowStatus.ERROR]: {
    label: "Error",
    icon: AlertCircle,
    className: "text-red-600",
    iconClassName: "",
  },
  [WorkflowStatus.HALTED]: {
    label: "Halted",
    icon: Pause,
    className: "text-orange-600",
    iconClassName: "",
  },
  [WorkflowStatus.FAILED]: {
    label: "Failed",
    icon: XCircle,
    className: "text-red-600",
    iconClassName: "",
  },
};

export function WorkflowStatusBadge({
  status,
  className,
}: WorkflowStatusBadgeProps) {
  // Default to PENDING if no status provided
  const effectiveStatus = status || WorkflowStatus.PENDING;
  const config = statusConfig[effectiveStatus];

  if (!config) {
    return null;
  }

  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-sm",
        config.className,
        className
      )}
    >
      <Icon className={cn("h-3 w-3", config.iconClassName)} />
      <span>{config.label}</span>
    </div>
  );
}