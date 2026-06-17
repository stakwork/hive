"use client";

import React from "react";
import type { WorkflowRun } from "@/hooks/useWorkflowRuns";

export type RunStatus = WorkflowRun["status"];

export interface RunStatusMeta {
  label: string;
  /** solid dot background */
  dot: string;
  /** foreground text accent */
  text: string;
  /** soft tinted pill (bg + text + ring) */
  soft: string;
  /** solid accent bar / fill */
  bar: string;
  /** whether the dot should pulse (in-flight states) */
  pulse: boolean;
}

const META: Record<RunStatus, RunStatusMeta> = {
  active: {
    label: "Active",
    dot: "bg-sky-500",
    text: "text-sky-600 dark:text-sky-400",
    soft: "bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-sky-500/20",
    bar: "bg-sky-500",
    pulse: true,
  },
  finished: {
    label: "Finished",
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    soft: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20",
    bar: "bg-emerald-500",
    pulse: false,
  },
  completed: {
    label: "Completed",
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    soft: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20",
    bar: "bg-emerald-500",
    pulse: false,
  },
  error: {
    label: "Error",
    dot: "bg-rose-500",
    text: "text-rose-600 dark:text-rose-400",
    soft: "bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-rose-500/20",
    bar: "bg-rose-500",
    pulse: false,
  },
  halted: {
    label: "Halted",
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-500",
    soft: "bg-amber-500/10 text-amber-600 dark:text-amber-500 ring-amber-500/20",
    bar: "bg-amber-500",
    pulse: false,
  },
};

export function runStatusMeta(status: RunStatus): RunStatusMeta {
  return META[status] ?? META.finished;
}

export function RunStatusDot({
  status,
  withPulse = true,
  className = "",
}: {
  status: RunStatus;
  withPulse?: boolean;
  className?: string;
}) {
  const m = runStatusMeta(status);
  return (
    <span className={`relative flex h-2 w-2 shrink-0 ${className}`}>
      {withPulse && m.pulse && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${m.dot} opacity-60`} />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${m.dot}`} />
    </span>
  );
}

export function RunStatusPill({ status }: { status: RunStatus }) {
  const m = runStatusMeta(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${m.soft}`}
    >
      <RunStatusDot status={status} />
      {m.label}
    </span>
  );
}
