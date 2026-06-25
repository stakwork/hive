"use client";

import React from "react";
import { formatInUserTz } from "@/lib/date-utils";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { Activity, Zap, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkflowRunStats } from "@/hooks/useWorkflowRunStats";

interface WorkflowStatsPanelProps {
  slug: string;
  workflowId: number;
}

export function WorkflowStatsPanel({ slug, workflowId }: WorkflowStatsPanelProps) {
  const { timezone } = useUserTimezone();
  const { stats, isLoading } = useWorkflowRunStats(slug, workflowId);

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 divide-x border-b">
        {[0, 1, 2].map((i) => (
          <div key={i} className="px-4 py-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-6 w-12" />
          </div>
        ))}
      </div>
    );
  }

  if (!stats || stats.available === false) {
    return (
      <p className="border-b p-4 text-sm text-muted-foreground">
        Run statistics unavailable — the Stakwork stats service is not yet configured.
      </p>
    );
  }

  const totalRuns = stats.total_runs ?? 0;
  const activeRuns = stats.active_runs ?? 0;

  if (totalRuns === 0 && activeRuns === 0) {
    return (
      <p className="border-b p-4 text-sm text-muted-foreground">
        No runs recorded yet for this workflow.
      </p>
    );
  }

  const errorRate = typeof stats.error_rate === "number" ? stats.error_rate : null;
  const errorRateValue = errorRate !== null ? `${(errorRate * 100).toFixed(1)}%` : "—";
  const errorRateHigh = errorRate !== null && errorRate > 0.1;
  const errorRateAccent =
    errorRate === null
      ? ""
      : errorRateHigh
        ? "text-rose-600 dark:text-rose-400"
        : "text-emerald-600 dark:text-emerald-400";

  const lastRunFormatted = stats.last_run_at
    ? formatInUserTz(new Date(stats.last_run_at), timezone, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : "—";

  const cells = [
    { label: "Total Runs", icon: Activity, value: totalRuns.toLocaleString(), accent: "" },
    {
      label: "Active",
      icon: Zap,
      value: activeRuns.toLocaleString(),
      accent: activeRuns > 0 ? "text-sky-600 dark:text-sky-400" : "",
    },
    { label: "Error Rate", icon: AlertTriangle, value: errorRateValue, accent: errorRateAccent },
  ];

  return (
    <div className="border-b">
      <div className="grid grid-cols-3 divide-x">
        {cells.map((c) => (
          <div key={c.label} className="px-4 py-3">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <c.icon className="h-3 w-3" />
              {c.label}
            </div>
            <div className={`mt-1 text-xl font-semibold tabular-nums ${c.accent}`}>{c.value}</div>
          </div>
        ))}
      </div>
      <div className="px-4 py-2 text-xs text-muted-foreground">
        Last run · <span className="text-foreground">{lastRunFormatted}</span>
      </div>
    </div>
  );
}
