"use client";

import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkflowRunStats } from "@/hooks/useWorkflowRunStats";

interface WorkflowStatsPanelProps {
  slug: string;
  workflowId: number;
}

export function WorkflowStatsPanel({ slug, workflowId }: WorkflowStatsPanelProps) {
  const { stats, isLoading } = useWorkflowRunStats(slug, workflowId);

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (!stats || stats.available === false) {
    return (
      <p className="text-sm text-muted-foreground p-4">
        Run statistics unavailable — the Stakwork stats service is not yet configured.
      </p>
    );
  }

  if (stats.total_runs === 0 && (stats.active_runs ?? 0) === 0) {
    return (
      <p className="text-sm text-muted-foreground p-4">
        No runs recorded yet for this workflow.
      </p>
    );
  }

  const lastRunFormatted = stats.last_run_at
    ? `${new Date(stats.last_run_at).toLocaleDateString()} ${new Date(stats.last_run_at).toLocaleTimeString()}`
    : "—";

  const errorRateValue = typeof stats.error_rate === "number"
    ? `${(stats.error_rate * 100).toFixed(1)}%`
    : "—";

  const errorRateHigh = typeof stats.error_rate === "number" && stats.error_rate > 0.1;

  return (
    <div className="grid grid-cols-1 gap-3 p-4">
      <div className="border rounded-lg p-3">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Last Run</p>
        <p className="text-sm font-semibold mt-1">{lastRunFormatted}</p>
      </div>
      <div className="border rounded-lg p-3">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total Runs</p>
        <p className="text-sm font-semibold mt-1">{stats.total_runs}</p>
      </div>
      <div className="border rounded-lg p-3">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Error Rate</p>
        <p className={`text-sm font-semibold mt-1 ${errorRateHigh ? "text-red-500" : ""}`}>
          {errorRateValue}
        </p>
      </div>
    </div>
  );
}
