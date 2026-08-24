"use client";

import { Fragment, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { WorkflowStatus } from "@prisma/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkflowBenchmarkRunList } from "@/hooks/useWorkflowBenchmarkRunList";
import { useWorkflowBenchmarkRubricsMap } from "@/hooks/useBenchmarkRubrics";
import { computeBenchmarkScore, formatBenchmarkScore } from "@/lib/harvey-lab/rubric-scoring";
import type { BenchmarkRunListRow } from "@/hooks/useLegalBenchmarkRunList";

// ─── Status badge ─────────────────────────────────────────────────────────────

function RunnerStatusBadge({ status }: { status: WorkflowStatus }) {
  switch (status) {
    case WorkflowStatus.PENDING:
      return (
        <Badge
          variant="outline"
          className="border-0 bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 flex items-center gap-1 w-fit"
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          PENDING
        </Badge>
      );
    case WorkflowStatus.IN_PROGRESS:
      return (
        <Badge
          variant="outline"
          className="border-0 bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 flex items-center gap-1 w-fit"
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          IN PROGRESS
        </Badge>
      );
    case WorkflowStatus.COMPLETED:
      return (
        <Badge
          variant="outline"
          className="border-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 w-fit"
        >
          COMPLETED
        </Badge>
      );
    case WorkflowStatus.FAILED:
      return (
        <Badge
          variant="outline"
          className="border-0 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 w-fit"
        >
          FAILED
        </Badge>
      );
    default:
      return (
        <Badge
          variant="outline"
          className="border-0 bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 w-fit"
        >
          {status}
        </Badge>
      );
  }
}

// ─── Score cell ───────────────────────────────────────────────────────────────

interface ScoreCellProps {
  run: BenchmarkRunListRow;
  rubrics: ReturnType<typeof useWorkflowBenchmarkRubricsMap>;
  /**
   * True when the rubrics map has not yet resolved (still loading).
   * Distinct from the rubrics map having an entry for this task — if
   * the map has no entry at all, rubrics are still in-flight.
   */
  rubricsLoading: boolean;
}

function ScoreCell({ run, rubrics, rubricsLoading }: ScoreCellProps) {
  const isActive =
    run.status === WorkflowStatus.PENDING ||
    run.status === WorkflowStatus.IN_PROGRESS;

  if (isActive) {
    return <span className="text-muted-foreground">—</span>;
  }

  // The rubrics map has the task's entry.
  const hasEntry = rubrics.has(run.taskSlug);

  // Still waiting for the rubrics fetch to resolve.
  if (!hasEntry && rubricsLoading) {
    return <span className="text-muted-foreground">—</span>;
  }

  const roster = hasEntry ? rubrics.get(run.taskSlug) ?? null : null;

  // rosterUnavailable: the rubrics API confirmed no EvalSet for this task.
  // Represented by a null entry once the map has been populated.
  // We distinguish "roster confirmed absent" (null + !rubricsLoading) from
  // "not yet loaded" (!hasEntry && rubricsLoading).
  if (hasEntry && roster === null) {
    return (
      <span className="text-xs text-muted-foreground">
        Rubric roster unavailable — score not comparable
      </span>
    );
  }

  const score = computeBenchmarkScore({
    criteriaResults: run.criteria_results,
    nPassed: run.n_passed,
    nTotal: run.n_total,
    graphRubrics: roster,
  });

  if (!score) {
    return <span className="text-muted-foreground">—</span>;
  }

  const { headline, annotation } = formatBenchmarkScore(score);

  return (
    <span
      className="text-sm tabular-nums font-medium"
      title={[run.judgeNotes, annotation].filter(Boolean).join(" · ") || undefined}
    >
      {headline}
      {annotation && (
        <span className="ml-1.5 text-xs text-violet-700 dark:text-violet-400 font-normal">
          {annotation}
        </span>
      )}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WorkflowBenchmarkRunsHistory() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id;

  const { runs, isLoading, error, setExpandedId } = useWorkflowBenchmarkRunList(workspaceId);
  const [expandedRunId, setExpandedRunIdLocal] = useState<string | null>(null);

  // Fetch rubrics for all tasks currently in the list.
  const taskSlugs = runs.map((r) => r.taskSlug).filter(Boolean);
  const rubrics = useWorkflowBenchmarkRubricsMap(taskSlugs);

  // The map is "still loading" until it has at least one entry (or the runs
  // list is empty). This keeps the score cells showing "—" rather than
  // "unavailable" while the network request is in flight.
  const rubricsLoading = taskSlugs.length > 0 && rubrics.size === 0;

  const handleToggleExpand = (runId: string) => {
    const next = expandedRunId === runId ? null : runId;
    setExpandedRunIdLocal(next);
    setExpandedId(next);
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
        No runs yet. Select a task from the Benchmark tab and press{" "}
        <strong>Run Benchmark</strong> to get started.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">
              Task
            </th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">
              Status
            </th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">
              Score
            </th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">
              Created At
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <Fragment key={run.id}>
              <tr
                className="border-b last:border-0 transition-colors cursor-pointer hover:bg-muted/30"
                onClick={() => handleToggleExpand(run.id)}
                data-testid={`wf-run-row-${run.id}`}
              >
                {/* Task */}
                <td className="px-4 py-3">
                  <div className="font-medium leading-tight">
                    {run.taskTitle || run.taskSlug || "(Unknown task)"}
                  </div>
                  {run.taskSlug && (
                    <div className="font-mono text-xs text-muted-foreground mt-0.5">
                      {run.taskSlug}
                    </div>
                  )}
                </td>

                {/* Status */}
                <td className="px-4 py-3">
                  <RunnerStatusBadge status={run.status} />
                </td>

                {/* Score */}
                <td className="px-4 py-3">
                  <ScoreCell
                    run={run}
                    rubrics={rubrics}
                    rubricsLoading={rubricsLoading}
                  />
                </td>

                {/* Created At */}
                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                  <span title={new Date(run.createdAt).toISOString()}>
                    {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                  </span>
                </td>
              </tr>

              {/* Expanded detail row — placeholder for future rubric/results panel */}
              {expandedRunId === run.id && (
                <tr className="border-b last:border-0 bg-muted/10">
                  <td colSpan={4} className="px-4 pb-4 pt-2">
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>
                        <span className="font-medium">Run ID:</span>{" "}
                        <span className="font-mono">{run.id}</span>
                      </div>
                      {run.judgeNotes && (
                        <div>
                          <span className="font-medium">Judge notes:</span>{" "}
                          {run.judgeNotes}
                        </div>
                      )}
                      {run.requestedModel && (
                        <div>
                          <span className="font-medium">Execution model:</span>{" "}
                          {run.requestedModel}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
