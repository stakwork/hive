"use client";

import React, { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOpenHealthClimbs } from "@/hooks/useOpenHealthClimbs";
import { useOpenHealthRuns } from "@/hooks/useOpenHealthRuns";
import {
  OPENHEALTH_BENCHMARKS,
  OPENHEALTH_DIFFICULTIES,
  openHealthBenchmarkByKey,
  openHealthBenchmarkKey,
  type OpenHealthBenchmarkKey,
} from "@/lib/openhealth-benchmarks/constants";
import {
  openHealthClimbSeries,
  openHealthRunTasks,
  summarizeByDifficulty,
  summarizeOpenHealthRuns,
  type OpenHealthClimbPoint,
  type OpenHealthSummary,
} from "@/lib/openhealth-benchmarks/runs";
import type { OpenHealthClimb, OpenHealthRun } from "@/types/openhealth";
import { OpenHealthClimbChart } from "./OpenHealthClimbChart";
import { OpenHealthClimbStrip } from "./OpenHealthClimbStrip";
import { OpenHealthClimbViewer } from "./OpenHealthClimbViewer";
import { OpenHealthRunViewer } from "./OpenHealthRunViewer";
import { CONTESTED_TEXT, contestedLabel, ScoreCell } from "./parts";
import {
  BenchmarkBadge,
  ClimbStatusBadge,
  DifficultyBadge,
  formatBenchmark,
  formatCost,
  formatDuration,
  formatPercent,
  formatScore,
  formatWhen,
  OutcomeBadge,
} from "./format";

const COLUMNS = 11;
const ALL_TASKS = "all";
const ALL_BENCHMARKS = "all";

type BenchmarkFilter = OpenHealthBenchmarkKey | typeof ALL_BENCHMARKS;

const benchmarkKeyOf = (row: { task: OpenHealthRun["task"]; variant: OpenHealthRun["variant"] }) =>
  openHealthBenchmarkKey({ task: row.task, variant: row.variant });

/** The open row: a run, or a climb (with the step to show, as an index into its steps). */
type Expanded = { kind: "run"; id: string } | { kind: "climb"; id: string; step: number | null } | null;

/** A row of the history: a run of its own, or a climb. Newest first. */
type HistoryRow = { kind: "run"; run: OpenHealthRun } | { kind: "climb"; climb: OpenHealthClimb };

function SummaryCard({ title, summary, testId }: { title: string; summary: OpenHealthSummary; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="space-y-1 py-4">
        <p className="text-xs font-medium capitalize text-muted-foreground">{title}</p>
        <p className="text-2xl font-semibold tabular-nums">{formatScore(summary.meanF1)}</p>
        <p className="text-xs text-muted-foreground">
          mean score · {formatPercent(summary.successRate)} scored ({summary.succeeded}/{summary.attempts})
        </p>
        {summary.contested > 0 && (
          <p
            className={`text-xs ${CONTESTED_TEXT}`}
            title={`${summary.contested} of the scored runs exclude contested answer-key items; the mean is over those adjusted scores`}
            data-testid="openhealth-summary-contested"
          >
            {contestedLabel(summary.contested)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const rowCreatedAt = (row: HistoryRow) => (row.kind === "run" ? row.run.createdAt : row.climb.createdAt);

/** The index, among a climb's steps, of the benchmark run of an iteration. */
function stepIndexOf(climb: OpenHealthClimb | undefined, iteration: number): number | null {
  const index = climb?.steps.findIndex((s) => s.kind === "benchmark" && s.iteration === iteration) ?? -1;
  return index >= 0 ? index : null;
}

export function OpenHealthRunsHistory() {
  const { runs, loading, error, reload } = useOpenHealthRuns();
  const { climbs, reload: reloadClimbs } = useOpenHealthClimbs();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [expanded, setExpanded] = useState<Expanded>(() => {
    const run = searchParams.get("run");
    const climb = searchParams.get("climb");
    return run ? { kind: "run", id: run } : climb ? { kind: "climb", id: climb, step: null } : null;
  });
  const [taskParam, setTask] = useState<string>(searchParams.get("task") ?? ALL_TASKS);
  // The benchmark filter: a mean over diagnoses and summaries together would mean nothing.
  const [benchmark, setBenchmark] = useState<BenchmarkFilter>(() => {
    const key = searchParams.get("benchmark");
    return openHealthBenchmarkByKey(key) ? (key as OpenHealthBenchmarkKey) : ALL_BENCHMARKS;
  });

  const benchmarkRuns = useMemo(
    () => (benchmark === ALL_BENCHMARKS ? runs : runs.filter((r) => benchmarkKeyOf(r) === benchmark)),
    [runs, benchmark],
  );
  const benchmarkClimbs = useMemo(
    () => (benchmark === ALL_BENCHMARKS ? climbs : climbs.filter((c) => benchmarkKeyOf(c) === benchmark)),
    [climbs, benchmark],
  );
  const tasks = useMemo(() => openHealthRunTasks(benchmarkRuns, benchmarkClimbs), [benchmarkRuns, benchmarkClimbs]);
  // A linked task with nothing in the list falls back to all tasks.
  const task = tasks.some((t) => String(t.gtId) === taskParam) ? taskParam : ALL_TASKS;
  const shownRuns = useMemo(
    () => (task === ALL_TASKS ? benchmarkRuns : benchmarkRuns.filter((r) => String(r.gtId) === task)),
    [benchmarkRuns, task],
  );
  const shownClimbs = useMemo(
    () => (task === ALL_TASKS ? benchmarkClimbs : benchmarkClimbs.filter((c) => String(c.gtId) === task)),
    [benchmarkClimbs, task],
  );
  const rows = useMemo(
    () =>
      [
        ...shownRuns.map((run): HistoryRow => ({ kind: "run", run })),
        ...shownClimbs.map((climb): HistoryRow => ({ kind: "climb", climb })),
      ].sort((a, b) => rowCreatedAt(b).localeCompare(rowCreatedAt(a))),
    [shownRuns, shownClimbs],
  );
  const summary = useMemo(() => summarizeOpenHealthRuns(shownRuns, shownClimbs), [shownRuns, shownClimbs]);
  const byDifficulty = useMemo(
    () => summarizeByDifficulty(benchmarkRuns, benchmarkClimbs),
    [benchmarkRuns, benchmarkClimbs],
  );
  const series = useMemo(() => openHealthClimbSeries(shownRuns, shownClimbs), [shownRuns, shownClimbs]);
  // The task's newest climb (any state) in the task view; the climbs in flight in the all-tasks view.
  const taskClimb = task === ALL_TASKS ? null : (shownClimbs[0] ?? null);
  const runningClimbs = useMemo(() => benchmarkClimbs.filter((c) => c.status === "running"), [benchmarkClimbs]);
  // A climb whose row is open shows its strip there: one strip per climb on the page.
  const openClimbId = expanded?.kind === "climb" ? expanded.id : null;
  const climbKeys = useMemo(
    () =>
      new Set(
        taskClimb?.steps.filter((s) => s.kind === "benchmark").map((s) => `${taskClimb.id}#${s.iteration}`) ?? [],
      ),
    [taskClimb],
  );

  // The filters and the open row are in the URL, so a link to the page opens the same view.
  const syncUrl = useCallback(
    (nextTask: string, next: Expanded, nextBenchmark: BenchmarkFilter = benchmark) => {
      const params = new URLSearchParams({ tab: "runs" });
      if (nextBenchmark !== ALL_BENCHMARKS) params.set("benchmark", nextBenchmark);
      if (nextTask !== ALL_TASKS) params.set("task", nextTask);
      if (next) params.set(next.kind, next.id);
      router.replace(`${pathname}?${params}`, { scroll: false });
    },
    [router, pathname, benchmark],
  );

  // Switching benchmarks drops a task or open row of another benchmark.
  const selectBenchmark = useCallback(
    (next: string) => {
      const nextBenchmark = openHealthBenchmarkByKey(next) ? (next as OpenHealthBenchmarkKey) : ALL_BENCHMARKS;
      setBenchmark(nextBenchmark);
      const fits = (row: { task: OpenHealthRun["task"]; variant: OpenHealthRun["variant"] }) =>
        nextBenchmark === ALL_BENCHMARKS || benchmarkKeyOf(row) === nextBenchmark;
      const keepTask = task !== ALL_TASKS && runs.some((r) => String(r.gtId) === task && fits(r));
      const keepTaskByClimb = task !== ALL_TASKS && climbs.some((c) => String(c.gtId) === task && fits(c));
      const nextTask = keepTask || keepTaskByClimb ? task : ALL_TASKS;
      const keepOpen =
        expanded &&
        (expanded.kind === "run"
          ? runs.some((r) => r.id === expanded.id && fits(r) && (nextTask === ALL_TASKS || String(r.gtId) === nextTask))
          : climbs.some(
              (c) => c.id === expanded.id && fits(c) && (nextTask === ALL_TASKS || String(c.gtId) === nextTask),
            ));
      if (nextTask !== task) setTask(nextTask);
      if (!keepOpen) setExpanded(null);
      syncUrl(nextTask, keepOpen ? expanded : null, nextBenchmark);
    },
    [task, runs, climbs, expanded, syncUrl],
  );

  const open = useCallback(
    (next: Expanded) => {
      setExpanded(next);
      syncUrl(task, next);
    },
    [task, syncUrl],
  );

  const toggleRun = useCallback(
    (id: string) => open(expanded?.kind === "run" && expanded.id === id ? null : { kind: "run", id }),
    [expanded, open],
  );
  const toggleClimb = useCallback(
    (id: string) => open(expanded?.kind === "climb" && expanded.id === id ? null : { kind: "climb", id, step: null }),
    [expanded, open],
  );
  const openRun = useCallback((id: string) => open({ kind: "run", id }), [open]);
  const openClimb = useCallback((id: string, step: number | null) => open({ kind: "climb", id, step }), [open]);
  // A chip picked in an open climb's own strip: the step changes, the row stays.
  const selectClimbStep = useCallback(
    (id: string, step: number) =>
      setExpanded((prev) => (prev?.kind === "climb" && prev.id === id ? { ...prev, step } : prev)),
    [],
  );

  const selectTask = useCallback(
    (next: string) => {
      setTask(next);
      const keepOpen =
        expanded &&
        (expanded.kind === "run"
          ? runs.some((r) => r.id === expanded.id && (next === ALL_TASKS || String(r.gtId) === next))
          : climbs.some((c) => c.id === expanded.id && (next === ALL_TASKS || String(c.gtId) === next)));
      if (!keepOpen) setExpanded(null);
      syncUrl(next, keepOpen ? expanded : null);
    },
    [expanded, runs, climbs, syncUrl],
  );

  const selectPoint = useCallback(
    (point: OpenHealthClimbPoint) => {
      if (point.runId) openRun(point.runId);
      else if (point.climb) {
        openClimb(
          point.climb.id,
          stepIndexOf(
            climbs.find((c) => c.id === point.climb?.id),
            point.climb.iteration,
          ),
        );
      }
    },
    [climbs, openRun, openClimb],
  );

  const onSettled = useCallback(() => {
    void reload();
    void reloadClimbs();
  }, [reload, reloadClimbs]);

  // A climb started from this page: show its task, open it.
  const onClimbStarted = useCallback(
    (gtId: number | null, started: { climbId: string }) => {
      const next = gtId === null ? task : String(gtId);
      setTask(next);
      const row: Expanded = { kind: "climb", id: started.climbId, step: null };
      setExpanded(row);
      syncUrl(next, row);
      void reloadClimbs();
    },
    [task, syncUrl, reloadClimbs],
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading runs…
        </CardContent>
      </Card>
    );
  }
  if (error && runs.length === 0 && climbs.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-sm text-destructive" data-testid="openhealth-runs-error">
          {error}
        </CardContent>
      </Card>
    );
  }
  if (runs.length === 0 && climbs.length === 0) {
    return (
      <Card data-testid="openhealth-runs-empty">
        <CardContent className="py-10 text-sm text-muted-foreground">
          No runs yet. Pick a task on the Tasks tab to start one.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="openhealth-runs">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={benchmark} onValueChange={selectBenchmark}>
          <SelectTrigger className="w-44" data-testid="openhealth-benchmark-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_BENCHMARKS}>All benchmarks</SelectItem>
            {OPENHEALTH_BENCHMARKS.map((b) => (
              <SelectItem key={b.key} value={b.key}>
                {b.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={task} onValueChange={selectTask}>
          <SelectTrigger className="w-72" data-testid="openhealth-task-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TASKS}>All tasks</SelectItem>
            {tasks.map((t) => (
              <SelectItem key={t.gtId} value={String(t.gtId)}>
                Task {t.gtId}
                {benchmark === ALL_BENCHMARKS || t.task !== "patient_diagnosis"
                  ? ` · ${formatBenchmark({ task: t.task, variant: t.variant }, t.specialty)}`
                  : ""}
                {t.difficulty ? ` · ${t.difficulty}` : ""} · {t.runs} {t.runs === 1 ? "run" : "runs"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(task !== ALL_TASKS || benchmark !== ALL_BENCHMARKS) && (
          <span className="text-sm text-muted-foreground">
            Showing {rows.length} of {runs.length + climbs.length} rows
          </span>
        )}
      </div>

      {task === ALL_TASKS
        ? runningClimbs
            .filter((c) => c.id !== openClimbId)
            .map((c) => (
              <OpenHealthClimbStrip
                key={c.id}
                climb={c}
                onSelectStep={(step) => openClimb(c.id, step)}
                onChanged={reloadClimbs}
                onClimbStarted={(started) => onClimbStarted(c.gtId, started)}
              />
            ))
        : taskClimb &&
          taskClimb.id !== openClimbId && (
            <OpenHealthClimbStrip
              climb={taskClimb}
              onSelectStep={(step) => openClimb(taskClimb.id, step)}
              onChanged={reloadClimbs}
              onClimbStarted={(started) => onClimbStarted(taskClimb.gtId, started)}
            />
          )}

      {task === ALL_TASKS ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard title="All runs" summary={summary} testId="openhealth-summary-all" />
          {OPENHEALTH_DIFFICULTIES.map((d) => (
            <SummaryCard key={d} title={d} summary={byDifficulty[d]} testId={`openhealth-summary-${d}`} />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-4">
          <SummaryCard title={`Task ${task}`} summary={summary} testId="openhealth-summary-all" />
          <Card className="lg:col-span-3" data-testid="openhealth-climb-card">
            <CardContent className="space-y-2 py-4">
              <p className="text-xs font-medium text-muted-foreground">Score over time · line is the best so far</p>
              <OpenHealthClimbChart
                points={series}
                onSelect={selectPoint}
                target={taskClimb?.targetF1 ?? null}
                highlight={climbKeys}
              />
            </CardContent>
          </Card>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Started</TableHead>
            <TableHead>Task</TableHead>
            <TableHead>Difficulty</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead>Tier</TableHead>
            <TableHead className="text-right">Recall</TableHead>
            <TableHead className="text-right">Precision</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) =>
            row.kind === "run" ? (
              <RunRows
                key={`run-${row.run.id}`}
                run={row.run}
                open={expanded?.kind === "run" && expanded.id === row.run.id}
                onToggle={toggleRun}
                onSettled={onSettled}
              />
            ) : (
              <ClimbRows
                key={`climb-${row.climb.id}`}
                climb={row.climb}
                open={expanded?.kind === "climb" && expanded.id === row.climb.id ? expanded : null}
                onToggle={toggleClimb}
                onSelectStep={selectClimbStep}
                onSettled={onSettled}
                onClimbStarted={(started) => onClimbStarted(row.climb.gtId, started)}
              />
            ),
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />;
}

function RunRows({
  run,
  open,
  onToggle,
  onSettled,
}: {
  run: OpenHealthRun;
  open: boolean;
  onToggle: (id: string) => void;
  onSettled: () => void;
}) {
  return (
    <>
      <TableRow
        onClick={() => onToggle(run.id)}
        aria-expanded={open}
        className="cursor-pointer"
        data-testid="openhealth-run-row"
      >
        <TableCell>
          <Chevron open={open} />
        </TableCell>
        <TableCell className="text-muted-foreground">{formatWhen(run.createdAt)}</TableCell>
        <TableCell className="font-mono">
          {run.gtId ?? "—"}
          {run.task !== "patient_diagnosis" && (
            <span className="ml-2">
              <BenchmarkBadge benchmark={{ task: run.task, variant: run.variant }} specialty={run.specialty} />
            </span>
          )}
        </TableCell>
        <TableCell>
          <DifficultyBadge difficulty={run.difficulty} />
        </TableCell>
        <TableCell>
          <OutcomeBadge outcome={run.outcome} />
        </TableCell>
        <TableCell className="text-right font-medium tabular-nums">
          <ScoreCell
            value={formatScore(run.scores?.f1)}
            official={run.scores?.official ?? null}
            contested={run.scores?.contested ?? 0}
          />
        </TableCell>
        <TableCell>{run.scores?.tier ?? "—"}</TableCell>
        <TableCell className="text-right tabular-nums">{formatScore(run.scores?.recall)}</TableCell>
        <TableCell className="text-right tabular-nums">{formatScore(run.scores?.precision)}</TableCell>
        <TableCell className="text-right tabular-nums">{formatCost(run.costUsd)}</TableCell>
        <TableCell className="text-right tabular-nums">{formatDuration(run.durationMs)}</TableCell>
      </TableRow>
      {open && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={COLUMNS} className="whitespace-normal bg-muted/20 p-4">
            <OpenHealthRunViewer runId={run.id} onSettled={onSettled} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function ClimbRows({
  climb,
  open,
  onToggle,
  onSelectStep,
  onSettled,
  onClimbStarted,
}: {
  climb: OpenHealthClimb;
  open: { step: number | null } | null;
  onToggle: (id: string) => void;
  onSelectStep: (id: string, step: number) => void;
  onSettled: () => void;
  onClimbStarted: (started: { climbId: string }) => void;
}) {
  const span =
    climb.startF1 !== null && climb.bestF1 !== null && climb.startF1 !== climb.bestF1
      ? `${formatScore(climb.startF1)} → ${formatScore(climb.bestF1)}`
      : formatScore(climb.bestF1);
  return (
    <>
      <TableRow
        onClick={() => onToggle(climb.id)}
        aria-expanded={open !== null}
        className="cursor-pointer"
        data-testid="openhealth-climb-row"
      >
        <TableCell>
          <Chevron open={open !== null} />
        </TableCell>
        <TableCell className="text-muted-foreground">{formatWhen(climb.createdAt)}</TableCell>
        <TableCell className="font-mono">
          {climb.gtId ?? "—"}
          {climb.task !== "patient_diagnosis" && (
            <span className="ml-2">
              <BenchmarkBadge benchmark={{ task: climb.task, variant: climb.variant }} specialty={climb.specialty} />
            </span>
          )}
          <Badge variant="outline" className="ml-2 font-sans" data-testid="openhealth-climb-badge">
            climb · {climb.attempts} {climb.attempts === 1 ? "run" : "runs"}
          </Badge>
        </TableCell>
        <TableCell>
          <DifficultyBadge difficulty={climb.difficulty} />
        </TableCell>
        <TableCell>
          <ClimbStatusBadge status={climb.status} />
        </TableCell>
        <TableCell className="text-right font-medium tabular-nums">
          <ScoreCell value={span} official={climb.bestF1Official} contested={climb.contested.length} />
        </TableCell>
        <TableCell>—</TableCell>
        <TableCell className="text-right tabular-nums">{formatScore(climb.bestRecall)}</TableCell>
        <TableCell className="text-right tabular-nums">{formatScore(climb.bestPrecision)}</TableCell>
        <TableCell className="text-right tabular-nums">{formatCost(climb.costUsd)}</TableCell>
        <TableCell className="text-right tabular-nums">{formatDuration(climb.durationMs)}</TableCell>
      </TableRow>
      {open && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={COLUMNS} className="whitespace-normal bg-muted/20 p-4">
            <OpenHealthClimbViewer
              climbId={climb.id}
              selected={open.step}
              onSelectStep={(step) => onSelectStep(climb.id, step)}
              onSettled={onSettled}
              onClimbStarted={onClimbStarted}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
