"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ExternalLink, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  PASS_BADGE_CLASS,
  FAIL_BADGE_CLASS,
  RUN_LIST_LIMIT,
  SUMMARY_WINDOW,
  WINDOW_OPTIONS,
  isScoredRun,
  selectWindowRows,
  type SummaryWindow,
} from "@/lib/harvey-lab/benchmark-summary";
import { BenchmarkSummaryStrip } from "@/components/legal/BenchmarkSummaryStrip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  useLegalBenchmarkRunList,
  type BenchmarkRunListRow,
} from "@/hooks/useLegalBenchmarkRunList";
import { LegalBenchmarkResults } from "@/components/legal/LegalBenchmarkResults";
import { StakworkRunLink } from "@/components/legal/StakworkRunLink";
import { HillClimbChart } from "@/components/legal/HillClimbChart";
import { WorkflowStatus } from "@prisma/client";
import type { EvalTriggerOutput } from "@/lib/harvey-lab/eval-normalizers";

export const ALL_TASKS = "all";

interface TaskOption {
  slug: string;
  title: string;
  count: number;
}

/** Unique tasks across the loaded runs, preserving most-recent-first order */
function buildTaskOptions(runs: BenchmarkRunListRow[]): TaskOption[] {
  const map = new Map<string, TaskOption>();
  for (const run of runs) {
    if (!run.taskSlug) continue;
    const existing = map.get(run.taskSlug);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(run.taskSlug, {
        slug: run.taskSlug,
        title: run.taskTitle || run.taskSlug,
        count: 1,
      });
    }
  }
  return Array.from(map.values());
}

/**
 * Map one task's scored runs (oldest → newest) into HillClimbChart input.
 * The chart's legacy path derives the monotonic best-so-far line from n_passed.
 * If n_total drifted between runs (criteria edited), the max is used as target.
 */
function toChartAttempts(taskRuns: BenchmarkRunListRow[]): EvalTriggerOutput[] {
  const scored = taskRuns
    .filter((r) => typeof r.n_passed === "number" && typeof r.n_total === "number")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const maxTotal = scored.reduce((max, r) => Math.max(max, r.n_total ?? 0), 0);

  return scored.map((r, i) => ({
    ref_id: r.id,
    attempt_number: i + 1,
    result: "",
    score: r.n_passed ?? 0,
    n_passed: r.n_passed,
    n_total: maxTotal,
    isBaseline: false,
    label: `#${i + 1}`,
  }));
}

/** Strip provider prefix for display, e.g. "anthropic/claude-sonnet-5" → "claude-sonnet-5" */
function displayModelName(value: string | undefined): string {
  if (!value) return "—";
  const slash = value.indexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

/** Unified model precedence for display */
function resolveModelDisplay(run: BenchmarkRunListRow) {
  const exec = displayModelName(run.requestedModel);
  const judge = displayModelName(run.requestedJudgeModel);
  // If both are "—" (legacy run), we show nothing to avoid cluttering the row
  const hasAny = run.requestedModel || run.requestedJudgeModel;
  return { exec, judge, hasAny };
}

export type RunListHookResult = ReturnType<typeof useLegalBenchmarkRunList>;

interface BenchmarkRunsHistoryProps {
  /** When supplied, the component uses this hook result instead of calling
   *  useLegalBenchmarkRunList internally. Pass this from the page level to
   *  share a single fetch/poll/Pusher subscription across the header strip
   *  and this table. When omitted, the component self-manages as before. */
  runList?: RunListHookResult;
  /** Deep-link token — triggers auto-scroll + expand of the target row. */
  focusRequest?: { runId: string; nonce: number } | null;
  /** Called once the focus effect has handled (or no-op'd) the request so the
   *  parent can clear the token. */
  onFocusHandled?: () => void;
}

export function BenchmarkRunsHistory({
  runList: runListProp,
  focusRequest,
  onFocusHandled,
}: BenchmarkRunsHistoryProps = {}) {
  const { workspace, isSuperAdmin } = useWorkspace();
  const workspaceId = workspace?.id;

  // When a runList prop is supplied, pass undefined to the hook so it never
  // fetches, polls, or binds Pusher — all state comes from the prop.
  const internalList = useLegalBenchmarkRunList(
    runListProp ? undefined : workspaceId,
  );
  const { runs, total, isLoading, error, setExpandedId } =
    runListProp ?? internalList;

  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<string>(ALL_TASKS);
  const [windowSize, setWindowSize] = useState<SummaryWindow>(SUMMARY_WINDOW);

  // ── Row refs for focus/scroll ────────────────────────────────────────────
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Focus effect ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!focusRequest) return;

    const { runId } = focusRequest;
    const found = runs.some((r) => r.id === runId);

    if (!found) {
      // Unknown run — clear the token so the next pip click isn't blocked.
      onFocusHandled?.();
      return;
    }

    // (a) Reset filter directly — do NOT call handleFilterChange/handleReset
    //     because handleReset calls setExpandedId(null), which triggers an
    //     unwanted refetch and would immediately collapse the row we're opening.
    setTaskFilter(ALL_TASKS);

    // (a2) The window caps which rows are rendered, so a run older than the
    //      current window has no row to expand or scroll to. Widen to the
    //      smallest option whose scored-run count reaches it — an unscored
    //      target needs one more, since the cut lands on a scored run.
    const index = runs.findIndex((r) => r.id === runId);
    const scoredThrough = runs.slice(0, index + 1).filter(isScoredRun).length;
    const needed = scoredThrough + (isScoredRun(runs[index]) ? 0 : 1);
    setWindowSize(
      (current) =>
        needed > current
          ? WINDOW_OPTIONS.find((size) => size >= needed) ??
            WINDOW_OPTIONS[WINDOW_OPTIONS.length - 1]
          : current,
    );

    // (b) Expand the target row
    setExpandedRunId(runId);

    // (c) Preserve the hook's expansion/polling contract
    setExpandedId(runId);

    // (d) Scroll + highlight
    requestAnimationFrame(() => {
      const rowEl = rowRefs.current.get(runId);
      if (rowEl) {
        rowEl.scrollIntoView({ behavior: "smooth", block: "center" });

        // Clear any previous highlight timer
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        rowEl.classList.add("ring-2", "ring-primary", "ring-inset");
        highlightTimerRef.current = setTimeout(() => {
          rowEl.classList.remove("ring-2", "ring-primary", "ring-inset");
          highlightTimerRef.current = null;
        }, 1500);
      }
    });

    // (e) Clear the token
    onFocusHandled?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest, runs]);

  // Cleanup highlight timer on unmount
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const taskOptions = useMemo(() => buildTaskOptions(runs), [runs]);

  const selectedTask =
    taskFilter === ALL_TASKS ? null : taskOptions.find((t) => t.slug === taskFilter) ?? null;

  const filteredRuns = useMemo(
    () => (selectedTask ? runs.filter((r) => r.taskSlug === selectedTask.slug) : runs),
    [runs, selectedTask],
  );

  // The window is measured in SCORED runs: the rows span back to the Nth most
  // recent completed run, carrying the PENDING/FAILED rows in between so the
  // table still shows every state. Chart and summary read from here, so what is
  // measured is always what is listed.
  const visibleRuns = useMemo(
    () => selectWindowRows(filteredRuns, windowSize),
    [filteredRuns, windowSize],
  );

  const chartAttempts = useMemo(
    () => (selectedTask ? toChartAttempts(visibleRuns) : []),
    [selectedTask, visibleRuns],
  );

  const handleToggleExpand = (runId: string) => {
    const next = expandedRunId === runId ? null : runId;
    setExpandedRunId(next);
    setExpandedId(next);
  };

  const handleReset = () => {
    setExpandedRunId(null);
    setExpandedId(null);
  };

  const handleFilterChange = (value: string) => {
    setTaskFilter(value);
    if (expandedRunId) handleReset();
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

  // colSpan: Task + Started + Runner Status + Score + Chat + Report + (Stakwork if super admin)
  const colSpan = isSuperAdmin ? 7 : 6;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={taskFilter} onValueChange={handleFilterChange}>
          <SelectTrigger className="w-[340px]" data-testid="task-filter-trigger">
            <SelectValue placeholder="Filter by task" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TASKS}>All tasks</SelectItem>
            {taskOptions.map((t) => (
              <SelectItem key={t.slug} value={t.slug}>
                {t.title} ({t.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedTask && (
          <span className="text-xs text-muted-foreground">
            {filteredRuns.length} of {runs.length} runs
          </span>
        )}
        <div className="ml-auto">
          <BenchmarkSummaryStrip
            runs={visibleRuns}
            windowSize={windowSize}
            onWindowChange={setWindowSize}
          />
        </div>
      </div>

      {selectedTask && (
        <TaskProgressCard task={selectedTask} attempts={chartAttempts} />
      )}

      {visibleRuns.length < filteredRuns.length && (
        <div
          className="text-xs text-muted-foreground bg-muted rounded-md px-3 py-2"
          data-testid="window-note"
        >
          Showing {visibleRuns.length} of {filteredRuns.length} loaded runs —
          back to the {windowSize} most recent scored runs.
          {total > RUN_LIST_LIMIT &&
            ` Only the latest ${RUN_LIST_LIMIT} of ${total} runs are loaded.`}
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
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Chat</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Report</th>
              {isSuperAdmin && (
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Stakwork</th>
              )}
            </tr>
          </thead>
          <tbody>
            {visibleRuns.map((run) => (
              <Fragment key={run.id}>
                <tr
                  ref={(el) => {
                    if (el) rowRefs.current.set(run.id, el);
                    else rowRefs.current.delete(run.id);
                  }}
                  className="border-b last:border-0 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => handleToggleExpand(run.id)}
                  data-testid={`run-row-${run.id}`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium leading-tight">
                      {run.taskTitle || "(Unknown task)"}
                    </div>
                    {run.taskSlug && (
                      <div className="text-xs text-muted-foreground mt-0.5">{run.taskSlug}</div>
                    )}
                    {(() => {
                      const { exec, judge, hasAny } = resolveModelDisplay(run);
                      if (!hasAny) return null;
                      return (
                        <div className="text-xs text-muted-foreground mt-0.5" data-testid="model-sub-line">
                          {exec} · Judge: {judge}
                        </div>
                      );
                    })()}
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
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <ChatCell run={run} />
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <ReportCell run={run} slug={workspace?.slug} />
                  </td>
                  {isSuperAdmin && (
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <StakworkRunLink projectId={run.projectId} isSuperAdmin={isSuperAdmin} />
                    </td>
                  )}
                </tr>
                {expandedRunId === run.id && (
                  <tr className="border-b last:border-0 bg-muted/10">
                    <td colSpan={colSpan} className="px-4 pb-4">
                      <LegalBenchmarkResults
                        runId={run.id}
                        isSuperAdmin={isSuperAdmin}
                        onReset={handleReset}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TaskProgressCard({
  task,
  attempts,
}: {
  task: TaskOption;
  attempts: EvalTriggerOutput[];
}) {
  const best = attempts.reduce((max, a) => Math.max(max, a.n_passed ?? 0), 0);
  const target = attempts[0]?.n_total ?? 0;

  return (
    <div className="rounded-lg border bg-card p-4" data-testid="task-progress-card">
      <div className="flex items-baseline justify-between gap-4 mb-1">
        <div className="font-medium text-sm leading-tight truncate">{task.title}</div>
        {attempts.length > 0 && (
          <div className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
            Best: {best}/{target} · {attempts.length} scored{" "}
            {attempts.length === 1 ? "run" : "runs"}
          </div>
        )}
      </div>
      {attempts.length > 0 ? (
        <HillClimbChart attempts={attempts} height={160} />
      ) : (
        <div className="text-sm text-muted-foreground py-6 text-center">
          No scored runs yet for this task.
        </div>
      )}
    </div>
  );
}

/**
 * The run report bundle — the nine-section report built from the Harvey
 * runner's S3 output. A DIFFERENT artifact from the Jamie chat next door: this
 * one is produced by the runner itself and rendered natively by Hive, while the
 * chat is an org-canvas conversation written afterwards by the canvas agent.
 *
 * `hasReport` is derived server-side from the presence of the persisted
 * projection — never from the bundle URL, which does not reach this component.
 */
function ReportCell({ run, slug }: { run: BenchmarkRunListRow; slug?: string }) {
  if (run.hasReport && slug) {
    return (
      <a
        href={`/w/${slug}/legal/benchmarks/runs/${run.id}/report`}
        className="inline-flex items-center gap-1 text-primary hover:underline whitespace-nowrap"
        data-testid="run-report-link"
      >
        View Report
        {run.reportPartial && (
          <span className="text-xs text-muted-foreground">(partial)</span>
        )}
      </a>
    );
  }

  if (run.reportSchemaUnsupported) {
    return <span className="text-xs text-muted-foreground">Unsupported</span>;
  }

  // Requested but not yet delivered — the runner is still executing, or the
  // completion webhook is fetching the bundle right now. A FAILED run can still
  // deliver a report, so it is not excluded here (unlike the chat).
  if (run.generateRunReport) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
        <Loader2 className="h-3 w-3 animate-spin" />
        Pending
      </span>
    );
  }

  return <span className="text-muted-foreground">—</span>;
}

/**
 * The Jamie chat produced by `generateBenchmarkJamieChat` — an org-canvas
 * conversation. Distinct from the run report bundle, which has its own column.
 */
function ChatCell({ run }: { run: BenchmarkRunListRow }) {
  if (run.jamieChatPath) {
    return (
      <a
        href={run.jamieChatPath}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-primary hover:underline whitespace-nowrap"
        data-testid="report-chat-link"
      >
        View Chat
        <ExternalLink className="h-3 w-3" />
      </a>
    );
  }

  if (run.jamieChatStatus === "failed") {
    return <span className="text-xs text-destructive">Failed</span>;
  }

  // Requested but not yet started/written (run still executing, or the
  // completion webhook is generating the chat right now). A FAILED run
  // never triggers a chat, so fall through to the dash instead.
  if (run.generateJamieChat && run.status !== WorkflowStatus.FAILED) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
        <Loader2 className="h-3 w-3 animate-spin" />
        Pending
      </span>
    );
  }

  return <span className="text-muted-foreground">—</span>;
}

function ScoreCell({ run }: { run: BenchmarkRunListRow }) {
  const isActive =
    run.status === WorkflowStatus.PENDING || run.status === WorkflowStatus.IN_PROGRESS;

  // Neutral placeholder for in-progress runs and terminal runs with no score data.
  if (isActive || typeof run.all_pass !== "boolean") {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div
      className={run.judgeNotes ? "flex items-center gap-2 cursor-help" : "flex items-center gap-2"}
      title={run.judgeNotes}
      aria-label={run.judgeNotes}
    >
      {run.n_passed !== undefined && run.n_total !== undefined && (
        <span className="text-sm tabular-nums">
          {run.n_passed}/{run.n_total}
        </span>
      )}
      <Badge
        variant="outline"
        className={run.all_pass ? PASS_BADGE_CLASS : FAIL_BADGE_CLASS}
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
