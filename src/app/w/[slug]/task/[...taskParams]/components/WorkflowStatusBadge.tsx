"use client";

import React from "react";
import { WorkflowStatus } from "@/lib/chat";
import { cn } from "@/lib/utils";
import { AlertCircle, ExternalLink, Pause, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

interface WorkflowStatusBadgeProps {
  status: WorkflowStatus | null | undefined;
  className?: string;
  stakworkProjectId?: string | null;
  lastLogLine?: string;
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
  lastLogLine,
}: WorkflowStatusBadgeProps) {
  const effectiveStatus = status || WorkflowStatus.PENDING;
  const config = statusConfig[effectiveStatus];

  if (!config) {
    return null;
  }

  const isTerminal = effectiveStatus === WorkflowStatus.ERROR ||
    effectiveStatus === WorkflowStatus.HALTED ||
    effectiveStatus === WorkflowStatus.FAILED;

  const isInProgress = effectiveStatus === WorkflowStatus.IN_PROGRESS;

  const stakworkUrl = stakworkProjectId
    ? `https://jobs.stakwork.com/admin/projects/${stakworkProjectId}`
    : null;

  const isClickable = (isTerminal || isInProgress) && !!stakworkUrl;
  const Icon = config.icon;

  const displayLabel = isInProgress
    ? (lastLogLine || config.label)
    : config.label;

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
      {displayLabel && (
        isInProgress ? (
          <AnimatePresence mode="wait">
            <motion.span
              key={displayLabel}
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -12, opacity: 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className={cn(
                "text-xs text-muted-foreground truncate block",
                isClickable && "group-hover:text-foreground transition-colors"
              )}
            >
              {displayLabel}
            </motion.span>
          </AnimatePresence>
        ) : (
          <span className={cn(
            "text-xs text-muted-foreground",
            isClickable && "group-hover:text-foreground transition-colors"
          )}>
            {displayLabel}
          </span>
        )
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
        aria-label={`${displayLabel} — view on Stakwork`}
      >
        {content}
      </a>
    );
  }

  return (
    <div
      className={cn("flex items-center gap-1.5", className)}
      role="status"
      aria-label={displayLabel || effectiveStatus.toLowerCase().replace("_", " ")}
    >
      {content}
    </div>
  );
}
