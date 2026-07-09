"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useLegalBenchmarkRunList } from "@/hooks/useLegalBenchmarkRunList";
import { LegalBenchmarkResults } from "@/components/legal/LegalBenchmarkResults";
import { StakworkRunLink } from "@/components/legal/StakworkRunLink";
import { WorkflowStatus } from "@prisma/client";
import type { BenchmarkRunListRow } from "@/hooks/useLegalBenchmarkRunList";

export function BenchmarkRunsHistory() {
  const { workspace, isSuperAdmin } = useWorkspace();
  const workspaceId = workspace?.id;

  const { runs, total, isLoading, error, setExpandedId } = useLegalBenchmarkRunList(workspaceId);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const handleToggleExpand = (runId: string) => {
    const next = expandedRunId === runId ? null : runId;
    setExpandedRunId(next);
    setExpandedId(next);
  };

  const handleReset = () => {
    setExpandedRunId(null);
    setExpandedId(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">Loading runs…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-destructive py-6 text-center">
        Failed to load runs: {error}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-12 text-center">
        No runs yet. Select a task from the Benchmark tab to get started.
      </div>
    );
  }

  // colSpan: Task + Started + Runner Status + Score + (Stakwork if super admin)
  const colSpan = isSuperAdmin ? 5 : 4;

  return (
    <div className="space-y-3">
      {total > 100 && (
        <div className="text-xs text-muted-foreground bg-muted rounded-md px-3 py-2">
          Showing the most recent 100 runs.
        </div>
      )}

      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Task</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Started</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Runner Status</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Score</th>
              {isSuperAdmin && (
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Stakwork</th>
              )}
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <>
                <tr
                  key={run.id}
                  className="border-b last:border-0 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => handleToggleExpand(run.id)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium leading-tight">
                      {run.taskTitle || "(Unknown task)"}
                    </div>
                    {run.taskSlug && (
                      <div className="text-xs text-muted-foreground mt-0.5">{run.taskSlug}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      title={new Date(run.createdAt).toISOString()}
                      className="text-muted-foreground"
                    >
                      {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <RunnerStatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-3">
                    <ScoreCell run={run} />
                  </td>
                  {isSuperAdmin && (
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <StakworkRunLink projectId={run.projectId} isSuperAdmin={isSuperAdmin} />
                    </td>
                  )}
                </tr>
                {expandedRunId === run.id && (
                  <tr key={`${run.id}-expanded`} className="border-b last:border-0 bg-muted/10">
                    <td colSpan={colSpan} className="px-4 pb-4">
                      <LegalBenchmarkResults
                        runId={run.id}
                        isSuperAdmin={isSuperAdmin}
                        onReset={handleReset}
                      />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScoreCell({ run }: { run: BenchmarkRunListRow }) {
  const isActive =
    run.status === WorkflowStatus.PENDING || run.status === WorkflowStatus.IN_PROGRESS;

  // Neutral placeholder for in-progress runs and terminal runs with no score data.
  if (isActive || typeof run.all_pass !== "boolean") {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex items-center gap-2">
      {run.n_passed !== undefined && run.n_total !== undefined && (
        <span className="text-sm tabular-nums">
          {run.n_passed}/{run.n_total}
        </span>
      )}
      <Badge
        variant="outline"
        className={
          run.all_pass
            ? "border-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
            : "border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
        }
      >
        {run.all_pass ? "PASS" : "FAIL"}
      </Badge>
    </div>
  );
}

function RunnerStatusBadge({ status }: { status: WorkflowStatus }) {
  switch (status) {
    case WorkflowStatus.PENDING:
      return (
        <Badge variant="outline" className="border-0 bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          PENDING
        </Badge>
      );
    case WorkflowStatus.IN_PROGRESS:
      return (
        <Badge variant="outline" className="border-0 bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 flex items-center gap-1 w-fit">
          <Loader2 className="h-3 w-3 animate-spin" />
          IN PROGRESS
        </Badge>
      );
    case WorkflowStatus.COMPLETED:
      return (
        <Badge variant="outline" className="border-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
          COMPLETED
        </Badge>
      );
    case WorkflowStatus.FAILED:
      return (
        <Badge variant="outline" className="border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
          FAILED
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="border-0 bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          {status}
        </Badge>
      );
  }
}
