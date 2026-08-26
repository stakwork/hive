"use client";

import { Fragment, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { WorkflowStatus } from "@prisma/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkflowBenchmarkRunList } from "@/hooks/useWorkflowBenchmarkRunList";
import { useWorkflowBenchmarkRubricsMap } from "@/hooks/useBenchmarkRubrics";
import {
  computeBenchmarkScore,
  formatBenchmarkScore,
  criterionStatus,
  buildContestedIndex,
  rubricBreakdown,
  type GraphRubric,
} from "@/lib/harvey-lab/rubric-scoring";
import { RubricBreakdownStrip } from "@/components/harvey-lab/RubricBreakdownStrip";
import {
  PASS_BADGE_CLASS,
  FAIL_BADGE_CLASS,
} from "@/lib/harvey-lab/benchmark-summary";
import { StakworkRunLink } from "@/components/legal/StakworkRunLink";
import { SafeMarkdown } from "@/components/run-report/SafeMarkdown";
import type { BenchmarkRunListRow } from "@/hooks/useLegalBenchmarkRunList";
import type { BenchmarkRunResult } from "@/types/legal";

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

  // Roster confirmed absent (graph has no EvalSet for this task). Use amber
  // so this state is visually distinct from "no score yet" (plain dash) and
  // "still loading" (dash + spinner).
  if (hasEntry && roster === null) {
    return (
      <span className="text-xs text-amber-600 dark:text-amber-400">
        No rubric roster — score not comparable
      </span>
    );
  }

  const score = computeBenchmarkScore({
    criteriaResults: run.criteria_results,
    nPassed: run.n_passed,
    nTotal: run.n_total,
    graphRubrics: roster,
  });

  // Run completed but the runner never posted any score data. Use a dash
  // (distinct from the "roster absent" amber) — this means "judging didn't
  // land yet, or this is a legacy row."
  if (!score) {
    return <span className="text-muted-foreground">—</span>;
  }

  const { headline } = formatBenchmarkScore(score);
  const bd = rubricBreakdown({ score, criteria: run.criteria_results, graphRubrics: roster });

  return (
    <div
      className={run.judgeNotes ? "flex items-center gap-2 cursor-help" : "flex items-center gap-2"}
      title={run.judgeNotes}
    >
      <span className="text-sm tabular-nums font-medium">{headline}</span>
      {score.allPass && (
        <Badge variant="outline" className={PASS_BADGE_CLASS}>
          PASS
        </Badge>
      )}
      <RubricBreakdownStrip breakdown={bd} variant="compact" />
    </div>
  );
}

// ─── Expanded row: per-criterion rubric details ───────────────────────────────

interface CriteriaDetailsPanelProps {
  run: BenchmarkRunListRow;
  roster: GraphRubric[] | null;
}

function CriteriaDetailsPanel({ run, roster }: CriteriaDetailsPanelProps) {
  const criteria = run.criteria_results;

  // Metadata: run ID, model, judge notes — always shown.
  const meta = (
    <div className="text-xs text-muted-foreground space-y-1 mb-3">
      <div>
        <span className="font-medium">Run ID:</span>{" "}
        <span className="font-mono">{run.id}</span>
      </div>
      {run.judgeNotes && (
        <div>
          <span className="font-medium">Judge notes:</span>
          {/* LLM-authored — escaped markdown only, no HTML sinks */}
          <SafeMarkdown text={run.judgeNotes} className="text-xs" />
        </div>
      )}
      {run.requestedModel && (
        <div>
          <span className="font-medium">Execution model:</span>{" "}
          {run.requestedModel}
        </div>
      )}
    </div>
  );

  if (!criteria || criteria.length === 0) {
    return (
      <div>
        {meta}
        <p className="text-xs text-muted-foreground italic">
          No per-criterion results — the runner did not post rubric detail for
          this run.
        </p>
      </div>
    );
  }

  const contestedIndex = buildContestedIndex(roster);

  type StatusGroup = {
    FAIL: typeof criteria;
    CONTESTED: typeof criteria;
    PASS: typeof criteria;
  };

  // Partition into FAIL / CONTESTED / PASS; failures first.
  const groups: StatusGroup = { FAIL: [], CONTESTED: [], PASS: [] };
  for (const criterion of criteria) {
    const status = criterionStatus(criterion, contestedIndex);
    groups[status].push(criterion);
  }

  const ordered = [...groups.FAIL, ...groups.CONTESTED, ...groups.PASS];

  return (
    <div>
      {meta}
      <div className="space-y-2">
        {ordered.map((c, idx) => {
          const status = criterionStatus(c, contestedIndex);
          const badgeClass =
            status === "PASS"
              ? PASS_BADGE_CLASS
              : status === "CONTESTED"
                ? "border-0 bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300"
                : FAIL_BADGE_CLASS;

          return (
            <div
              key={c.id ?? c.title ?? idx}
              className="rounded-md border bg-background px-3 py-2 space-y-1"
            >
              <div className="flex items-start gap-2">
                <Badge
                  variant="outline"
                  className={`${badgeClass} shrink-0 text-[10px] leading-none py-0.5`}
                >
                  {status}
                </Badge>
                <span className="text-xs font-medium leading-tight">
                  {c.title ?? c.id ?? `Criterion ${idx + 1}`}
                </span>
              </div>
              {/* reasoning is the core signal — why did it fail? */}
              {c.reasoning && (
                <p className="text-xs text-muted-foreground pl-1 leading-snug">
                  {c.reasoning}
                </p>
              )}
              {/* cause_summary: root-cause field annotated by the eval webhook */}
              {!c.reasoning && c.cause_summary && (
                <p className="text-xs text-muted-foreground pl-1 leading-snug">
                  {c.cause_summary}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WorkflowBenchmarkRunsHistory() {
  const { workspace, isSuperAdmin } = useWorkspace();
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

  // Task + Status + Score + Created At + (Stakwork if super admin)
  // Report and Chat are not produced by this pipeline — omitted intentionally.
  const colSpan = isSuperAdmin ? 5 : 4;

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
            {isSuperAdmin && (
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                {/* Stakwork admin link — super-admin only */}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const isExpanded = expandedRunId === run.id;
            const roster = rubrics.get(run.taskSlug) ?? null;

            return (
              <Fragment key={run.id}>
                <tr
                  className="border-b last:border-0 transition-colors cursor-pointer hover:bg-muted/30"
                  onClick={() => handleToggleExpand(run.id)}
                  data-testid={`wf-run-row-${run.id}`}
                >
                  {/* Task */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                      <div>
                        <div className="font-medium leading-tight">
                          {run.taskTitle || run.taskSlug || "(Unknown task)"}
                        </div>
                        {run.taskSlug && (
                          <div className="font-mono text-xs text-muted-foreground mt-0.5">
                            {run.taskSlug}
                          </div>
                        )}
                      </div>
                    </div>
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

                  {/* Stakwork admin link — super-admin only */}
                  {isSuperAdmin && (
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <StakworkRunLink
                        projectId={run.projectId}
                        isSuperAdmin={isSuperAdmin}
                      />
                    </td>
                  )}
                </tr>

                {/* Expanded detail row: per-criterion rubric results */}
                {isExpanded && (
                  <tr className="border-b last:border-0 bg-muted/10">
                    <td colSpan={colSpan} className="px-4 pb-4 pt-2">
                      <CriteriaDetailsPanel run={run} roster={roster} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
