"use client";

import React, { useState, useCallback } from "react";
import { toast } from "sonner";
import { Play, Loader2, CheckCircle, XCircle, Clock, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import {
  useWorkflowBenchmarkRunList,
  type WorkflowBenchmarkRunListRow,
} from "@/hooks/useWorkflowBenchmarkRunList";
import { WORKFLOW_BENCHMARK_TASKS, WORKFLOW_BENCHMARK_TOTAL } from "@/lib/workflow-benchmark/corpus";
import { WorkflowStatus } from "@prisma/client";
import { formatDistanceToNow } from "date-fns";
import { StakworkRunLink } from "@/components/legal/StakworkRunLink";

/** Strip provider prefix, e.g. "anthropic/claude-sonnet-5" → "claude-sonnet-5" */
function displayModelName(value: string | undefined): string {
  if (!value) return "—";
  const slash = value.indexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

function StatusBadge({ status }: { status: WorkflowStatus }) {
  if (status === WorkflowStatus.COMPLETED) {
    return (
      <Badge className="gap-1 border-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
        <CheckCircle className="h-3 w-3" />
        Complete
      </Badge>
    );
  }
  if (status === WorkflowStatus.FAILED || status === WorkflowStatus.HALTED) {
    return (
      <Badge className="gap-1 border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
        <XCircle className="h-3 w-3" />
        {status === WorkflowStatus.HALTED ? "Halted" : "Failed"}
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 border-0 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
      <Clock className="h-3 w-3 animate-pulse" />
      Running
    </Badge>
  );
}

function ScoreBadge({ run }: { run: WorkflowBenchmarkRunListRow }) {
  if (run.status !== WorkflowStatus.COMPLETED) return null;
  if (run.n_passed == null || run.n_total == null) return null;
  const isPass = run.all_pass === true;
  return (
    <Badge
      className={
        isPass
          ? "border-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
          : "border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
      }
    >
      {run.n_passed}/{run.n_total}
    </Badge>
  );
}

function RunRow({
  run,
  isSuperAdmin,
}: {
  run: WorkflowBenchmarkRunListRow;
  isSuperAdmin: boolean;
}) {
  const model = run.requestedModel;
  const judgeModel = run.requestedJudgeModel;

  return (
    <div className="flex items-center gap-3 py-3 border-b last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{run.taskTitle || run.taskSlug}</div>
        <div className="text-xs text-muted-foreground truncate">
          {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
          {model && <span className="ml-2">· {displayModelName(model)}</span>}
          {judgeModel && <span className="ml-1">/ {displayModelName(judgeModel)}</span>}
        </div>
      </div>
      <ScoreBadge run={run} />
      <StatusBadge status={run.status} />
      <StakworkRunLink projectId={run.projectId} isSuperAdmin={isSuperAdmin} />
    </div>
  );
}

/** Main Workflow Benchmarks panel. */
export function WorkflowBenchmarksPanel() {
  const { workspace, isSuperAdmin } = useWorkspace();
  const { canWrite } = useWorkspaceAccess();
  const slug = workspace?.slug ?? "";

  const { runs, isLoading, error, refetch } = useWorkflowBenchmarkRunList(workspace?.id);

  const [runningSlug, setRunningSlug] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const handleRun = useCallback(
    async (taskSlug: string) => {
      if (!slug || !canWrite) return;
      setRunningSlug(taskSlug);
      try {
        const res = await fetch(`/api/workspaces/${slug}/workflow-benchmarks/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskSlug }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Failed to start run");
          return;
        }
        setActiveRunId(data.run_id);
        toast.success("Run started");
        await refetch();
      } catch {
        toast.error("Failed to start run");
      } finally {
        setRunningSlug(null);
      }
    },
    [slug, canWrite, refetch],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-4 h-full overflow-auto">
      {/* Task Browser */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center justify-between">
            Benchmark Tasks
            <Badge variant="secondary">{WORKFLOW_BENCHMARK_TOTAL}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {WORKFLOW_BENCHMARK_TASKS.map((task) => {
            const isRunning = runningSlug === task.slug;
            const activeRun = runs.find(
              (r) =>
                r.taskSlug === task.slug &&
                (r.status === WorkflowStatus.PENDING || r.status === WorkflowStatus.IN_PROGRESS),
            );
            return (
              <div
                key={task.slug}
                className="flex items-start gap-3 p-3 border rounded-lg bg-card hover:bg-muted/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{task.title}</div>
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {task.description}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono mt-1">{task.slug}</div>
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {task.criteria.map((c) => (
                      <Badge key={c.id} variant="outline" className="text-xs">
                        {c.id}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={!canWrite || isRunning || !!activeRun}
                  onClick={() => handleRun(task.slug)}
                  className="shrink-0"
                >
                  {isRunning || activeRun ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {activeRun ? "Running…" : "Run"}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Run History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center justify-between">
            Run History
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              Refresh
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading runs…
            </div>
          ) : error ? (
            <div className="text-sm text-destructive py-4">{error}</div>
          ) : runs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No runs yet. Select a task above and click Run.
            </div>
          ) : (
            <div>
              {runs.map((run) => (
                <RunRow key={run.id} run={run} isSuperAdmin={isSuperAdmin ?? false} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
