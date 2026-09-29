"use client";

import React, { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOpenHealthRuns } from "@/hooks/useOpenHealthRuns";
import { OPENHEALTH_DIFFICULTIES } from "@/lib/openhealth-benchmarks/constants";
import {
  openHealthClimbSeries,
  openHealthRunTasks,
  summarizeByDifficulty,
  summarizeOpenHealthRuns,
  type OpenHealthSummary,
} from "@/lib/openhealth-benchmarks/runs";
import { OpenHealthClimbChart } from "./OpenHealthClimbChart";
import { OpenHealthRunViewer } from "./OpenHealthRunViewer";
import {
  DifficultyBadge,
  formatCost,
  formatDuration,
  formatPercent,
  formatScore,
  formatWhen,
  OutcomeBadge,
} from "./format";

const COLUMNS = 11;
const ALL_TASKS = "all";

function SummaryCard({ title, summary, testId }: { title: string; summary: OpenHealthSummary; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="space-y-1 py-4">
        <p className="text-xs font-medium capitalize text-muted-foreground">{title}</p>
        <p className="text-2xl font-semibold tabular-nums">{formatScore(summary.meanF1)}</p>
        <p className="text-xs text-muted-foreground">
          mean F1 · {formatPercent(summary.successRate)} scored ({summary.succeeded}/{summary.attempts})
        </p>
      </CardContent>
    </Card>
  );
}

export function OpenHealthRunsHistory() {
  const { runs, loading, error, reload } = useOpenHealthRuns();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [expandedId, setExpandedId] = useState<string | null>(searchParams.get("run"));
  const [taskParam, setTask] = useState<string>(searchParams.get("task") ?? ALL_TASKS);

  const tasks = useMemo(() => openHealthRunTasks(runs), [runs]);
  // A linked task with no runs in the list falls back to all tasks.
  const task = tasks.some((t) => String(t.gtId) === taskParam) ? taskParam : ALL_TASKS;
  const shown = useMemo(() => (task === ALL_TASKS ? runs : runs.filter((r) => String(r.gtId) === task)), [runs, task]);
  const summary = useMemo(() => summarizeOpenHealthRuns(shown), [shown]);
  const byDifficulty = useMemo(() => summarizeByDifficulty(runs), [runs]);
  const climb = useMemo(() => openHealthClimbSeries(shown), [shown]);

  // The task filter and the open run are in the URL, so a link to the page opens the same view.
  const syncUrl = useCallback(
    (nextTask: string, nextRun: string | null) => {
      const params = new URLSearchParams({ tab: "runs" });
      if (nextTask !== ALL_TASKS) params.set("task", nextTask);
      if (nextRun) params.set("run", nextRun);
      router.replace(`${pathname}?${params}`, { scroll: false });
    },
    [router, pathname],
  );

  const toggle = useCallback(
    (id: string) => {
      const next = expandedId === id ? null : id;
      setExpandedId(next);
      syncUrl(task, next);
    },
    [expandedId, task, syncUrl],
  );

  const selectTask = useCallback(
    (next: string) => {
      setTask(next);
      const keepOpen =
        expandedId && runs.some((r) => r.id === expandedId && (next === ALL_TASKS || String(r.gtId) === next));
      if (!keepOpen) setExpandedId(null);
      syncUrl(next, keepOpen ? expandedId : null);
    },
    [expandedId, runs, syncUrl],
  );

  const openRun = useCallback(
    (id: string) => {
      setExpandedId(id);
      syncUrl(task, id);
    },
    [task, syncUrl],
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
  if (error && runs.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-sm text-destructive" data-testid="openhealth-runs-error">
          {error}
        </CardContent>
      </Card>
    );
  }
  if (runs.length === 0) {
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
      <div className="flex items-center gap-3">
        <Select value={task} onValueChange={selectTask}>
          <SelectTrigger className="w-64" data-testid="openhealth-task-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TASKS}>All tasks</SelectItem>
            {tasks.map((t) => (
              <SelectItem key={t.gtId} value={String(t.gtId)}>
                Task {t.gtId}
                {t.difficulty ? ` · ${t.difficulty}` : ""} · {t.runs} {t.runs === 1 ? "run" : "runs"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {task !== ALL_TASKS && (
          <span className="text-sm text-muted-foreground">
            Showing {shown.length} of {runs.length} runs
          </span>
        )}
      </div>

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
          <Card className="lg:col-span-3" data-testid="openhealth-climb">
            <CardContent className="space-y-2 py-4">
              <p className="text-xs font-medium text-muted-foreground">F1 over time · line is the best so far</p>
              <OpenHealthClimbChart points={climb} onSelect={openRun} />
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
            <TableHead className="text-right">F1</TableHead>
            <TableHead>Tier</TableHead>
            <TableHead className="text-right">Recall</TableHead>
            <TableHead className="text-right">Precision</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((run) => {
            const open = expandedId === run.id;
            return (
              <React.Fragment key={run.id}>
                <TableRow
                  onClick={() => toggle(run.id)}
                  aria-expanded={open}
                  className="cursor-pointer"
                  data-testid="openhealth-run-row"
                >
                  <TableCell>
                    <ChevronRight
                      className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatWhen(run.createdAt)}</TableCell>
                  <TableCell className="font-mono">{run.gtId ?? "—"}</TableCell>
                  <TableCell>
                    <DifficultyBadge difficulty={run.difficulty} />
                  </TableCell>
                  <TableCell>
                    <OutcomeBadge outcome={run.outcome} />
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatScore(run.scores?.f1)}</TableCell>
                  <TableCell>{run.scores?.tier ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatScore(run.scores?.recall)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatScore(run.scores?.precision)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCost(run.costUsd)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatDuration(run.durationMs)}</TableCell>
                </TableRow>
                {open && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={COLUMNS} className="whitespace-normal bg-muted/20 p-4">
                      <OpenHealthRunViewer runId={run.id} onSettled={reload} />
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
