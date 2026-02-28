import { WorkflowStatus } from "@/lib/chat";
import { cn } from "@/lib/utils";
import { AlertCircle, ExternalLink, Pause, XCircle } from "lucide-react";

interface WorkflowStatusBadgeProps {
  status: WorkflowStatus | null | undefined;
  className?: string;
  stakworkProjectId?: string | null;
}

const statusConfig: Record<string, {
  color?: string;
  label?: string;
  pulse?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  iconColor?: string;
}> = {
  [WorkflowStatus.PENDING]: {
    color: "bg-zinc-400 dark:bg-zinc-500",
  },
  [WorkflowStatus.IN_PROGRESS]: {
    color: "bg-blue-500",
    label: "Working...",
    pulse: true,
  },
  [WorkflowStatus.COMPLETED]: {
    color: "bg-emerald-500",
  },
  [WorkflowStatus.ERROR]: {
    icon: AlertCircle,
    iconColor: "text-amber-500",
    label: "Error",
  },
  [WorkflowStatus.HALTED]: {
    icon: Pause,
    iconColor: "text-amber-500",
    label: "Halted",
  },
  [WorkflowStatus.FAILED]: {
    icon: XCircle,
    iconColor: "text-amber-500",
    label: "Failed",
  },
};

export function WorkflowStatusBadge({
  status,
  className,
  stakworkProjectId,
}: WorkflowStatusBadgeProps) {
  const effectiveStatus = status || WorkflowStatus.PENDING;
  const config = statusConfig[effectiveStatus];

  if (!config) {
    return null;
  }

  const isTerminal = effectiveStatus === WorkflowStatus.ERROR ||
    effectiveStatus === WorkflowStatus.HALTED ||
    effectiveStatus === WorkflowStatus.FAILED;

  const stakworkUrl = stakworkProjectId
    ? `https://jobs.stakwork.com/admin/projects/${stakworkProjectId}`
    : null;

  const isClickable = isTerminal && stakworkUrl;
  const Icon = config.icon;

  const content = (
    <>
      {Icon ? (
        <Icon className={cn("h-3.5 w-3.5 shrink-0", config.iconColor)} />
      ) : (
        <span className={cn("relative h-2 w-2 rounded-full shrink-0", config.color)}>
          {config.pulse && (
            <span className={cn("absolute inset-0 rounded-full animate-ping opacity-75", config.color)} />
          )}
        </span>
      )}
      {config.label && (
        <span className={cn(
          "text-xs leading-none text-muted-foreground",
          isClickable && "group-hover:text-foreground transition-colors"
        )}>
          {config.label}
        </span>
      )}
      {isClickable && (
        <ExternalLink className="h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground transition-all" />
      )}
    </>
  );

  if (isClickable) {
    return (
      <a
        href={stakworkUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cn("group flex items-center gap-1.5 cursor-pointer", className)}
        role="status"
        aria-label={`${config.label} — view on Stakwork`}
      >
        {content}
      </a>
    );
  }

  return (
    <div
      className={cn("flex items-center gap-1.5", className)}
      role="status"
      aria-label={config.label || effectiveStatus.toLowerCase().replace("_", " ")}
    >
      {content}
    </div>
  );
}
