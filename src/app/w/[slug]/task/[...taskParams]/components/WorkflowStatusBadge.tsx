import { WorkflowStatus, ChatMessage } from "@/lib/chat";
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
  messages?: ChatMessage[];
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
  messages = [],
  className,
}: WorkflowStatusBadgeProps) {
  // Default to PENDING if no status provided
  const effectiveStatus = status || WorkflowStatus.PENDING;
  const effectiveLogs = logs || [];
  const config = statusConfig[effectiveStatus as keyof typeof statusConfig];
  const [isHovered, setIsHovered] = useState(false);

  // Check if waiting for input: latest message has FORM artifacts AND status is IN_PROGRESS or PENDING
  const isWaitingForInput = messages.length > 0 &&
    (effectiveStatus === WorkflowStatus.IN_PROGRESS || effectiveStatus === WorkflowStatus.PENDING) &&
    messages[messages.length - 1]?.artifacts?.some(artifact => artifact.type === 'FORM');

  if (!config) {
    return null;
  }

  // Override icon and styling if waiting for input
  const Icon = isWaitingForInput ? AlertCircle : config.icon;
  const displayClassName = isWaitingForInput ? "text-amber-600" : config.className;
  const iconClassName = isWaitingForInput ? "" : config.iconClassName;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-sm",
        displayClassName,
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
          <span>Workflow |</span>
          <Icon className={cn("h-3 w-3", iconClassName)} />
          {isWaitingForInput && <span>Waiting for input</span>}
        </>
      )}
    </div>
  );
}
