"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ExternalLink, Loader2, Repeat } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  PASS_BADGE_CLASS,
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
  type BenchmarkRunType,
} from "@/hooks/useLegalBenchmarkRunList";
import { useLegalBenchmarkRecursionList } from "@/hooks/useLegalBenchmarkRecursionList";
import { useBenchmarkRubricsMap } from "@/hooks/useBenchmarkRubrics";
import { useBenchmarkGraphScoresMap, type GraphScoreRequest } from "@/hooks/useBenchmarkGraphScores";
import { computeBenchmarkScore, rubricBreakdown } from "@/lib/harvey-lab/rubric-scoring";
import { resolveGraphOutputForRun } from "@/lib/harvey-lab/graph-run-score";
import { LegalBenchmarkResults } from "@/components/legal/LegalBenchmarkResults";
import { BenchmarkRunAgentLogs } from "@/components/legal/BenchmarkRunAgentLogs";
import { BenchmarkRunCascade } from "@/components/legal/RunCascade";
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

/**
 * A run row after graph-first score adjustment: n_passed/n_total/all_pass are
 * rewritten to the contested-excluded score (denominator = graph roster minus
 * contested definitions), with the exclusions carried alongside for display.
 */
type AdjustedRun = BenchmarkRunListRow & {
  /** Contested criteria excluded from this row's score. */
  n_contested?: number;
  /** Full rubric roster size before contested exclusion. */
  roster_total?: number;
  /**
   * The task's roster is still in flight, so Total is unknown rather than
   * absent — the cell spins instead of showing a dash it would hold for a
   * second. Only ever true for rows that carry the score inputs a Total
   * needs; an unscored row keeps its dash however the roster resolves.
   */
  roster_pending?: boolean;
  /**
   * Where the score came from:
   *  - "output-ref" — the row's stored EvalTriggerOutput pointer: the node is
   *                   authoritative for numerator AND denominator, verbatim
   *  - "criteria"   — per-criterion verdicts in the run's result JSON
   *  - "graph"      — an EvalTriggerOutput joined by trigger/project (numerator only)
   *  - "result"     — flat counts echoed into the result JSON (fallback)
   */
  score_source?: "output-ref" | "criteria" | "graph" | "result";
  /**
   * Number of failed criteria derived from `rubricBreakdown`. `null` when the
   * breakdown is not computable (output-ref path, bail-out paths). Never `0`
   * when the breakdown was not run — renders as "unknown" in the UI.
   */
  n_failed: number | null;
  /**
   * Number of disputed (judge-flagged) criteria derived from `rubricBreakdown`.
   * `null` when unknowable — either the breakdown was not run, or the run never
   * went through the judge-dispute stage (per-criterion flag keys absent).
   */
  n_disputed: number | null;
};

/**
 * Verbatim score from a row's own EvalTriggerOutput node, used when the row
 * stores an exact `evalOutputRef` pointer: numerator AND denominator come
 * from the node as written at scoring time — no roster overlay, no contested
 * annotation. Rows without a pointer keep the roster-adjusted path.
 */
function pointerAdjustedRun(
  run: BenchmarkRunListRow,
  output: { n_passed?: number; n_total?: number; judge_notes?: string },
): AdjustedRun {
  const scored =
    output.n_passed != null && output.n_total != null && output.n_total > 0;
  return {
    ...run,
    n_passed: output.n_passed,
    n_total: output.n_total,
    all_pass: scored ? output.n_passed === output.n_total : run.all_pass,
    judgeNotes: run.judgeNotes ?? output.judge_notes,
    score_source: "output-ref",
    // output-ref: roster_total is undefined and n_total is the node's own
    // verbatim denominator — Total is unknown; never fall back to n_total.
    n_failed: null,
    n_disputed: null,
  };
}

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
  const workspaceSlug = workspace?.slug;

  // When a runList prop is supplied, pass undefined to the hook so it never
  // fetches, polls, or binds Pusher — all state comes from the prop.
  const internalList = useLegalBenchmarkRunList(
    runListProp ? undefined : workspaceId,
  );
  const { runs, total, isLoading, error, setExpandedId } =
    runListProp ?? internalList;

  // Recursion-enrolled task slugs — same source the Recursion tab renders
  // from, so the badge and that tab can never disagree. Non-openlaw
  // workspaces 404 the endpoint, the set stays empty, and no badges render.
  const { entries: recursionEntries } = useLegalBenchmarkRecursionList();
  const recursionSlugs = useMemo(
    () => new Map(recursionEntries.map((e) => [e.id, e.reason])),
    [recursionEntries],
  );

  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<string>(ALL_TASKS);
  // One merged chronological list by default; the Type column header carries a
  // dropdown to narrow to one pipeline. The summary strip stays pinned to
  // manual runs regardless, so filtering never moves the headline pass-rate.
  const [typeFilter, setTypeFilter] = useState<"all" | "manual" | "recursion">("all");
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

    // (a) Reset filters directly — do NOT call handleFilterChange/handleReset
    //     because handleReset calls setExpandedId(null), which triggers an
    //     unwanted refetch and would immediately collapse the row we're opening.
    //     The type filter must reset too: a focus target is a manual run, which
    //     has no row while the Type dropdown is narrowed to Recursion.
    setTaskFilter(ALL_TASKS);
    setTypeFilter("all");

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

  // Everything metric-bearing — task options/titles, the scored-run window,
  // the summary strip, the per-task chart — is pinned to MANUAL runs. The
  // analysis/recursion pipelines never score, so letting them into these
  // derivations could only distort the numbers, and pinning guarantees the
  // headline pass-rate cannot move when the type filter changes.
  const manualRuns = useMemo(() => runs.filter((r) => r.runType === "manual"), [runs]);

  const taskOptions = useMemo(() => buildTaskOptions(manualRuns), [manualRuns]);

  const selectedTask =
    taskFilter === ALL_TASKS ? null : taskOptions.find((t) => t.slug === taskFilter) ?? null;

  const filteredRuns = useMemo(
    () => (selectedTask ? manualRuns.filter((r) => r.taskSlug === selectedTask.slug) : manualRuns),
    [manualRuns, selectedTask],
  );

  // Cron-pipeline rows shown alongside (or instead of) the manual window when
  // the type filter asks for them. Operational only — no scores, no windowing.
  // Explicit allow-list (rather than `!== "manual"`) so only eval/recursion-
  // pipeline rows are eligible here: manual rows go through their own path
  // above, and "consolidated" rows are deliberately excluded — they flow
  // through the merged `runs` list solely for the Recursion tab's Pusher
  // tracking and must never render as their own row in this table.
  const secondaryRows = useMemo(
    () =>
      runs.filter(
        (r) =>
          r.runType === "recursion" &&
          (!selectedTask || r.taskSlug === selectedTask.slug),
      ),
    [runs, selectedTask],
  );

  // Task titles for secondary rows — their result JSON carries only the slug.
  const titleBySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of manualRuns) {
      if (r.taskSlug && r.taskTitle && !map.has(r.taskSlug)) map.set(r.taskSlug, r.taskTitle);
    }
    return map;
  }, [manualRuns]);

  // The window is measured in SCORED runs: the rows span back to the Nth most
  // recent completed run, carrying the PENDING/FAILED rows in between so the
  // table still shows every state. Chart and summary read from here, so what is
  // measured is always what is listed.
  const visibleRuns = useMemo(
    () => selectWindowRows(filteredRuns, windowSize),
    [filteredRuns, windowSize],
  );

  // Graph-first scoring: read each task's rubric roster from the graph and
  // rewrite row scores so contested criteria are dropped from both sides.
  // Every consumer below (table, summary strip, hill-climb chart) reads the
  // adjusted rows, so the denominator is the graph everywhere.
  // Secondary (recursion-loop) rows are included: their re-scored attempts
  // also live graph-side and must score against the same roster.
  const taskSlugsInView = useMemo(
    () => [...visibleRuns, ...secondaryRows].map((r) => r.taskSlug),
    [visibleRuns, secondaryRows],
  );
  const rosters = useBenchmarkRubricsMap(taskSlugsInView);

  // Graph-first NUMERATORS: per task, the EvalTriggerOutput nodes reachable
  // from the EvalSet's trigger chain plus each visible manual row's own
  // evalTriggerRef (manual triggers hang off an EvalRequirement, which the
  // EvalSet expand cannot reach — the row ref is the direct path).
  const graphScoreRequests = useMemo<GraphScoreRequest[]>(() => {
    const byTask = new Map<string, { triggerRefs: Set<string>; outputRefs: Set<string> }>();
    for (const run of [...visibleRuns, ...secondaryRows]) {
      if (!run.taskSlug) continue;
      if (!byTask.has(run.taskSlug)) {
        byTask.set(run.taskSlug, { triggerRefs: new Set(), outputRefs: new Set() });
      }
      const entry = byTask.get(run.taskSlug)!;
      if (run.evalTriggerRef) entry.triggerRefs.add(run.evalTriggerRef);
      if (run.evalOutputRef) entry.outputRefs.add(run.evalOutputRef);
    }
    return [...byTask].map(([taskSlug, refs]) => ({
      taskSlug,
      triggerRefs: [...refs.triggerRefs],
      outputRefs: [...refs.outputRefs],
    }));
  }, [visibleRuns, secondaryRows]);
  const graphOutputs = useBenchmarkGraphScoresMap(graphScoreRequests);

  const adjustedRuns = useMemo<AdjustedRun[]>(
    () =>
      visibleRuns.map((run) => {
        const roster = rosters.get(run.taskSlug) ?? null;
        // Absent key = not resolved yet (the map fills in per task); a
        // resolved-but-empty roster is `null` and must not keep spinning.
        const rosterLoading = Boolean(run.taskSlug) && !rosters.has(run.taskSlug);
        const match = resolveGraphOutputForRun(run, graphOutputs.get(run.taskSlug));
        // A stored evalOutputRef pointer is authoritative for BOTH numbers —
        // the node is used verbatim, no roster overlay.
        if (match?.matchedBy === "output-ref") {
          return pointerAdjustedRun(run, match.output);
        }
        // Numerator preference: the run's EvalTriggerOutput node beats the
        // flat counts echoed into the result column. Per-criterion verdicts
        // (criteria_results) still outrank both inside computeBenchmarkScore —
        // they are the only source that can exclude contested PASSES.
        const graphOut = match?.output ?? null;
        const nPassed = graphOut?.n_passed ?? run.n_passed;
        const nTotal = graphOut?.n_total ?? run.n_total;
        // A Total can only ever land for a row that carries score inputs, so
        // only those rows are allowed to spin while the roster loads.
        const rosterPending =
          rosterLoading &&
          (Boolean(run.criteria_results?.length) ||
            (typeof nPassed === "number" && typeof nTotal === "number"));
        // Without a roster, per-criterion results, or a graph output there is
        // nothing to adjust FROM — leave the run's own numbers untouched.
        if (!roster && !run.criteria_results?.length && !graphOut)
          return { ...run, roster_pending: rosterPending, n_failed: null, n_disputed: null };
        const score = computeBenchmarkScore({
          criteriaResults: run.criteria_results,
          nPassed,
          nTotal,
          graphRubrics: roster,
        });
        if (!score) return { ...run, roster_pending: rosterPending, n_failed: null, n_disputed: null };
        const usedCriteria = (run.criteria_results?.length ?? 0) > 0;
        const bd = rubricBreakdown({ score, criteria: run.criteria_results, graphRubrics: roster });
        return {
          ...run,
          n_passed: score.passed,
          n_total: score.denominator,
          // Rewrite all_pass for runs that were actually judged — either the
          // webhook marked them (boolean present) or the graph scored them.
          all_pass:
            typeof run.all_pass === "boolean" || graphOut ? score.allPass : run.all_pass,
          n_contested: score.contested,
          // Total only ever reflects a real graph rubric roster — never the
          // scorable-denominator/criteria-length fallback computeBenchmarkScore
          // uses when no roster was loaded.
          roster_total: Array.isArray(roster) && roster.length > 0 ? score.total : undefined,
          roster_pending: rosterPending,
          judgeNotes: run.judgeNotes ?? graphOut?.judge_notes,
          score_source: usedCriteria ? "criteria" : graphOut ? "graph" : "result",
          n_failed: bd?.fail ?? null,
          n_disputed: bd?.disputed ?? null,
        };
      }),
    [visibleRuns, rosters, graphOutputs],
  );

  const chartAttempts = useMemo(
    () => (selectedTask ? toChartAttempts(adjustedRuns) : []),
    [selectedTask, adjustedRuns],
  );

  // Secondary (recursion-loop) rows score graph-first: the re-score workflow
  // writes the attempt's EvalTriggerOutput into the graph with an id suffixed
  // by its Stakwork project (`--<project_id>`), which is the row's only join
  // key — these rows carry no evalTriggerRef. The result-column fields the
  // webhook echoes remain the fallback so older rows keep their score, and
  // either numerator is put through the same roster adjustment as manual rows.
  const adjustedSecondaryRows = useMemo<AdjustedRun[]>(
    () =>
      secondaryRows.map((run) => {
        const roster = rosters.get(run.taskSlug) ?? null;
        const rosterLoading = Boolean(run.taskSlug) && !rosters.has(run.taskSlug);
        const match = resolveGraphOutputForRun(run, graphOutputs.get(run.taskSlug));
        if (match?.matchedBy === "output-ref") {
          return pointerAdjustedRun(run, match.output);
        }
        const graphOut = match?.output ?? null;
        const nPassed = graphOut?.n_passed ?? run.n_passed;
        const nTotal = graphOut?.n_total ?? run.n_total;
        // Most loop rows (analysis, fix-proposal) never score — leave them be.
        if (nPassed == null || nTotal == null) return { ...run, n_failed: null, n_disputed: null };
        const score = computeBenchmarkScore({ nPassed, nTotal, graphRubrics: roster });
        if (!score) return { ...run, roster_pending: rosterLoading, n_failed: null, n_disputed: null };
        // Pass run.criteria_results into rubricBreakdown so secondary rows report
        // a real Disputed count when available — but do NOT add criteriaResults to
        // the computeBenchmarkScore call above, since that would change scores.
        const bd = rubricBreakdown({ score, criteria: run.criteria_results, graphRubrics: roster });
        return {
          ...run,
          n_passed: score.passed,
          n_total: score.denominator,
          all_pass:
            typeof run.all_pass === "boolean" || graphOut ? score.allPass : run.all_pass,
          n_contested: score.contested,
          // Total only ever reflects a real graph rubric roster — see the
          // matching comment in adjustedRuns above.
          roster_total: Array.isArray(roster) && roster.length > 0 ? score.total : undefined,
          roster_pending: rosterLoading,
          judgeNotes: run.judgeNotes ?? graphOut?.judge_notes,
          score_source: graphOut ? "graph" : "result",
          n_failed: bd?.fail ?? null,
          n_disputed: bd?.disputed ?? null,
        };
      }),
    [secondaryRows, rosters, graphOutputs],
  );

  // What the table body renders. Manual rows keep the scored-run windowing +
  // roster adjustment; secondary rows join chronologically when opted in.
  const displayRows = useMemo<AdjustedRun[]>(() => {
    if (typeFilter === "manual") return adjustedRuns;
    if (typeFilter === "all") {
      return [...adjustedRuns, ...adjustedSecondaryRows].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    }
    // "recursion" = the whole loop: analysis + fix-proposal rows.
    return adjustedSecondaryRows;
  }, [typeFilter, adjustedRuns, adjustedSecondaryRows]);

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

  // colSpan: Task + Type + Started + Runner Status + Pass + Fail + Contested +
  // Disputed + Total + Report + (Stakwork if super admin)
  const colSpan = isSuperAdmin ? 11 : 10;

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
            {filteredRuns.length} of {manualRuns.length} runs
          </span>
        )}
        <div className="ml-auto">
          <BenchmarkSummaryStrip
            runs={adjustedRuns}
            windowSize={windowSize}
            onWindowChange={setWindowSize}
          />
        </div>
      </div>

      {selectedTask && (
        <TaskProgressCard
          task={selectedTask}
          attempts={chartAttempts}
          recursionEnabled={recursionSlugs.get(selectedTask.slug) === "active"}
          workspaceSlug={workspaceSlug ?? ""}
        />
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
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                {/* Column-header micro-filter: a native select keeps the header
                    one line tall and dodges portal/overlay complexity inside a
                    table head. Default "all" shows every pipeline merged. */}
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as "all" | "manual" | "recursion")}
                  className="bg-transparent font-medium text-muted-foreground text-sm cursor-pointer focus:outline-none hover:text-foreground [&>option]:bg-popover [&>option]:text-popover-foreground"
                  aria-label="Filter by run type"
                  data-testid="type-filter"
                >
                  <option value="all">All types</option>
                  <option value="manual">Manual</option>
                  <option value="recursion">Recursion</option>
                </select>
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Started</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Runner Status</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Pass</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                <span
                  className="cursor-help"
                  title="Criteria scored and not passed. Contested definitions are excluded from this count."
                >
                  Fail
                </span>
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                <span
                  className="cursor-help"
                  title="Criteria whose definition is flagged as broken. They are excluded from the PASS identity; Total still shows the full rubric roster."
                >
                  Contested
                </span>
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                <span
                  className="cursor-help"
                  title="Verdicts the judge itself flagged for review. Always non-passing criteria — each one is potential score upside."
                >
                  Disputed
                </span>
              </th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Total</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Report</th>
              {isSuperAdmin && (
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Stakwork</th>
              )}
            </tr>
          </thead>
          <tbody>
            {displayRows.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid="type-filter-empty">
                  No {typeFilter === "all" ? "" : `${typeFilter} `}runs recorded here.
                  {typeFilter === "recursion" &&
                    " Concept-driven attempts often exist only in the graph — see the Recursion tab for per-attempt history."}
                </td>
              </tr>
            )}
            {displayRows.map((run) => (
              <Fragment key={run.id}>
                <tr
                  ref={(el) => {
                    if (el) rowRefs.current.set(run.id, el);
                    else rowRefs.current.delete(run.id);
                  }}
                  className={[
                    "border-b last:border-0 transition-colors",
                    // All rows are expandable: manual rows show the full rubric
                    // panel; non-manual rows show Agents + Traces only.
                    "cursor-pointer hover:bg-muted/30",
                  ].join(" ")}
                  onClick={() => handleToggleExpand(run.id)}
                  data-testid={`run-row-${run.id}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-medium leading-tight">
                        {run.taskTitle || titleBySlug.get(run.taskSlug) || run.taskSlug || "(Unknown task)"}
                      </div>
                      {run.taskSlug && recursionSlugs.get(run.taskSlug) === "active" && workspaceSlug && (
                        <RecursionEnabledBadge workspaceSlug={workspaceSlug} />
                      )}
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
                  <td className="px-4 py-3">
                    <RunTypeBadge runType={run.runType} />
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
                    {/* Recursion re-runs now report post-fix scores back onto
                        their run row; PassCell renders its own dash when no
                        score landed (older rows, fix-proposal stage). */}
                    <PassCell run={run} />
                  </td>
                  <td className="px-4 py-3">
                    <FailCell run={run} />
                  </td>
                  <td className="px-4 py-3">
                    <ContestedCountCell run={run} />
                  </td>
                  <td className="px-4 py-3">
                    <DisputedCountCell run={run} />
                  </td>
                  <td className="px-4 py-3">
                    <TotalCell run={run} />
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {/* Report bundles land on recursion rows too (reportUrl
                        column via webhook) — ReportCell self-handles absence. */}
                    <ReportCell run={run} slug={workspace?.slug} />
                  </td>
                  {isSuperAdmin && (
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {run.projectId != null && (
                        <a
                          href={`https://jobs.stakwork.com/admin/projects/${run.projectId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View on Stakwork (admin)"
                          aria-label="View on Stakwork (admin)"
                          className="inline-flex items-center text-muted-foreground hover:text-foreground"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </td>
                  )}
                </tr>
                {expandedRunId === run.id && (
                  <tr className="border-b last:border-0 bg-muted/10">
                    <td colSpan={colSpan} className="px-4 pb-4">
                      {run.runType === "manual" ? (
                        <LegalBenchmarkResults
                          runId={run.id}
                          isSuperAdmin={isSuperAdmin}
                          onReset={handleReset}
                        />
                      ) : (
                        <div className="flex flex-wrap items-start gap-2 empty:hidden">
                          <BenchmarkRunAgentLogs runId={run.id} />
                          <BenchmarkRunCascade runId={run.id} runStatus={run.status} />
                        </div>
                      )}
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
  recursionEnabled,
  workspaceSlug,
}: {
  task: TaskOption;
  attempts: EvalTriggerOutput[];
  recursionEnabled: boolean;
  workspaceSlug: string;
}) {
  const best = attempts.reduce((max, a) => Math.max(max, a.n_passed ?? 0), 0);
  const target = attempts[0]?.n_total ?? 0;

  return (
    <div className="rounded-lg border bg-card p-4" data-testid="task-progress-card">
      <div className="flex items-baseline justify-between gap-4 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <div className="font-medium text-sm leading-tight truncate">{task.title}</div>
          {recursionEnabled && workspaceSlug && (
            <RecursionEnabledBadge workspaceSlug={workspaceSlug} />
          )}
        </div>
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
 * runner's S3 output. Produced by the runner itself and rendered natively by
 * Hive. (The Jamie chat — an org-canvas conversation written afterwards by
 * the canvas agent — is a separate artifact; its data is still generated and
 * fetched, but this table no longer renders a column for it.)
 *
 * `hasReport` is derived server-side from the presence of the persisted
 * projection — never from the bundle URL, which does not reach this component.
 */
function ReportCell({ run, slug }: { run: BenchmarkRunListRow; slug?: string }) {
  if (run.hasReport && slug) {
    return (
      <a
        href={`/w/${slug}/legal/benchmarks/runs/${run.id}/report`}
        className="inline-flex items-center gap-1 text-primary whitespace-nowrap"
        data-testid="run-report-link"
        target="_blank"
        rel="noopener noreferrer"
        title="View Report (opens in new tab)"
        aria-label="View Report (opens in new tab)"
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    );
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

function hasScoreData(run: AdjustedRun): boolean {
  const isActive =
    run.status === WorkflowStatus.PENDING || run.status === WorkflowStatus.IN_PROGRESS;
  return !isActive && typeof run.all_pass === "boolean";
}

/**
 * PASS identity derived strictly from the graph rubric roster — never from
 * `run.all_pass` (which can be stale/runner-echoed). A row passes iff its
 * passed count exactly fills the roster minus contested (broken-definition)
 * criteria, and that remainder is greater than zero — a fully contested
 * roster is never PASS. An unknown (`n/a`) contested count blocks the badge
 * rather than being treated as zero; disputed count never factors in.
 */
function isRosterPass(run: AdjustedRun): boolean {
  if (
    typeof run.roster_total !== "number" ||
    typeof run.n_passed !== "number" ||
    typeof run.n_contested !== "number"
  ) {
    return false;
  }
  const remaining = run.roster_total - run.n_contested;
  if (remaining <= 0) return false;
  return run.n_passed === remaining;
}

function PassCell({ run }: { run: AdjustedRun }) {
  if (!hasScoreData(run) || typeof run.n_passed !== "number") {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div
      className={run.judgeNotes ? "flex items-center gap-2 cursor-help" : "flex items-center gap-2"}
      title={run.judgeNotes}
      aria-label={run.judgeNotes}
      data-score-source={run.score_source}
      {...(run.n_contested ? { "data-testid": "score-cell-contested" } : {})}
    >
      <span className="text-sm tabular-nums">{run.n_passed}</span>
      {isRosterPass(run) && (
        <Badge variant="outline" className={PASS_BADGE_CLASS}>
          PASS
        </Badge>
      )}
    </div>
  );
}

/**
 * Failed-criteria count, threaded straight from `AdjustedRun.n_failed`
 * (computed once in `rubricBreakdown`, never recomputed here). Two accepted
 * divergences from neighbouring cells, left as-is deliberately:
 *  (a) The visible columns need not sum to Total. `n_failed` is
 *      `scorable − pass` against a TRUE UNION of contested criteria, while
 *      `ContestedCountCell` renders `score.contested` =
 *      `Math.max(rosterContested, contestedInRun)` — a strictly smaller set
 *      on some rows (rubric-scoring.ts). Pass + Fail + Contested can land
 *      short of Total.
 *  (b) On rows where `rubricBreakdown` clamps `pass` to `scorable`
 *      (rubric-scoring.ts), Fail shows `0` while `PassCell` renders the
 *      *unclamped* `run.n_passed` — so Pass can visibly exceed
 *      `Total − Contested`. `PassCell` is intentionally left alone here;
 *      changing what Pass renders would alter displayed scores, which is out
 *      of scope. Reconciling the two contested sets is a follow-up in
 *      rubric-scoring.ts, not part of this cell.
 */
function FailCell({ run }: { run: AdjustedRun }) {
  if (!hasScoreData(run)) {
    return <span className="text-muted-foreground/60">—</span>;
  }
  if (typeof run.n_failed !== "number") {
    return (
      <span
        className="text-xs text-muted-foreground/60 cursor-help"
        title="Failure count is unknown for this run — its score was recorded without a rubric breakdown."
        data-testid="fail-cell-unknown"
      >
        n/a
      </span>
    );
  }
  return (
    <span className="text-sm tabular-nums" data-testid="fail-cell-count">
      {run.n_failed}
    </span>
  );
}

/**
 * The full graph rubric roster size. Independent of `hasScoreData`/`all_pass`
 * — an in-progress run with an already-loaded roster still shows its Total
 * while Pass stays a dash. Never falls back to `n_total` (which can be a
 * verbatim node total or a scorable-denominator fallback, not the roster).
 *
 * The roster is a separate graph read that lands after the rows do, so a
 * score-bearing row spins until its own task resolves — the dash is reserved
 * for "resolved, no roster".
 */
function TotalCell({ run }: { run: AdjustedRun }) {
  if (typeof run.roster_total !== "number") {
    if (run.roster_pending) {
      return (
        <span
          className="inline-flex text-muted-foreground"
          title="Loading rubric roster…"
          aria-label="Loading rubric roster"
          data-testid="total-cell-loading"
        >
          <Loader2 className="h-3 w-3 animate-spin" />
        </span>
      );
    }
    return <span className="text-muted-foreground">—</span>;
  }
  return <span className="text-sm tabular-nums">{run.roster_total}</span>;
}

/** `n_contested` is undefined on output-ref/bail-out rows — unknown, not zero. */
function ContestedCountCell({ run }: { run: AdjustedRun }) {
  if (!hasScoreData(run)) {
    return <span className="text-muted-foreground/60">—</span>;
  }
  if (run.n_contested === undefined) {
    return (
      <span
        className="text-xs text-muted-foreground/60 cursor-help"
        title="Contested exclusions are unknown for this run — its score was recorded without roster adjustment."
        data-testid="contested-cell-unknown"
      >
        n/a
      </span>
    );
  }
  if (run.n_contested === 0) {
    return (
      <span className="text-muted-foreground/60" data-testid="contested-cell-zero">
        —
      </span>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-0 bg-violet-500/15 text-violet-700 dark:text-violet-400 cursor-help tabular-nums"
      title={
        run.roster_total != null
          ? `Contested criterion definitions: ${run.n_contested} of ${run.roster_total}. Excluded from the PASS identity.`
          : `Contested criterion definitions: ${run.n_contested}.`
      }
      data-testid="contested-cell-count"
    >
      {run.n_contested}
    </Badge>
  );
}

/** `n_disputed` is null when the run never went through judge-dispute — unknown, not zero. */
function DisputedCountCell({ run }: { run: AdjustedRun }) {
  if (!hasScoreData(run)) {
    return <span className="text-muted-foreground/60">—</span>;
  }
  if (run.n_disputed === null) {
    return (
      <span
        className="text-xs text-muted-foreground/60 cursor-help"
        title="Disputes were never evaluated for this run — unknown, not zero."
        data-testid="disputed-cell-unknown"
      >
        n/a
      </span>
    );
  }
  if (run.n_disputed === 0) {
    return (
      <span className="text-muted-foreground/60" data-testid="disputed-cell-zero">
        —
      </span>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-0 bg-amber-500/15 text-amber-700 dark:text-amber-400 cursor-help tabular-nums"
      title={`Judge-disputed verdicts: ${run.n_disputed}. All non-passing — the score could rise by up to ${run.n_disputed} if they resolve to pass.`}
      data-testid="disputed-cell-count"
    >
      {run.n_disputed}
    </Badge>
  );
}

/**
 * Small badge marking a run whose task's EvalSet has recursion enabled.
 * Links to the Recursion tab (same page, `?tab=recursion`) — clicks must not
 * toggle the row expansion, hence the stopPropagation.
 * Teal: the existing badge vocabulary is taken (runner status gray/blue/
 * green/red, violet contested, amber incomplete-data).
 */
function RecursionEnabledBadge({ workspaceSlug }: { workspaceSlug: string }) {
  return (
    <Link
      href={`/w/${workspaceSlug}/legal/benchmarks?tab=recursion`}
      onClick={(e) => e.stopPropagation()}
      className="w-fit"
      title="Recursion is enabled for this task — open the Recursion tab"
      data-testid="recursion-badge"
    >
      <Badge
        variant="outline"
        className="border-0 bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300 flex items-center gap-1 w-fit hover:bg-teal-200 dark:hover:bg-teal-900/50 transition-colors"
      >
        <Repeat className="h-3 w-3" />
        recursion
      </Badge>
    </Link>
  );
}

/**
 * Pipeline badge for the Type column. Teal echoes the recursion-enrolled task
 * badge (same feature family); indigo is new to the vocabulary (gray/blue/
 * green/red are runner statuses, violet contested, amber incomplete-data).
 */
function RunTypeBadge({ runType }: { runType: BenchmarkRunType }) {
  if (runType === "recursion") {
    return (
      <Badge
        variant="outline"
        className="border-0 bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300 flex items-center gap-1 w-fit"
        data-testid="run-type-recursion"
      >
        <Repeat className="h-3 w-3" />
        recursion
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground w-fit" data-testid="run-type-manual">
      manual
    </Badge>
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
