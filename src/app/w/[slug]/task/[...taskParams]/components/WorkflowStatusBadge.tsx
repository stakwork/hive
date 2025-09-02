import { WorkflowStatus } from "@/lib/chat";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  Pause,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { LogEntry } from "@/hooks/useProjectLogWebSocket";

interface WorkflowStatusBadgeProps {
  logs?: LogEntry[] | null;
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
  logs = [],
  status,
  className,
}: WorkflowStatusBadgeProps) {
  // Default to PENDING if no status provided
  const effectiveStatus = status || WorkflowStatus.PENDING;
  const effectiveLogs = logs || [];
  const config = statusConfig[effectiveStatus];
  const [isHovered, setIsHovered] = useState(false);

  if (!config) {
    return null;
  }

  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-sm",
        config.className,
        className,
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {isHovered && effectiveLogs.length > 0 && (
        <>
          <span className="text-sm font-semibold mb-1">Logs:</span>
          <ul className="list-disc pl-4  text-gray-100 dark:text-gray-200">
            {effectiveLogs.map((log, index) => (
              <li key={index} className="py-1">
                {log.message}
              </li>
            ))}
          </ul>
        </>
      )}
      {isHovered && effectiveLogs.length <= 0 && (
        <div className="text-sm text-gray-500">No logs available</div>
      )}
      {!isHovered && (
        <>
          <Icon className={cn("h-3 w-3", config.iconClassName)} />
          <span>{config.label}</span>
        </>
      )}
    </div>
  );
}
