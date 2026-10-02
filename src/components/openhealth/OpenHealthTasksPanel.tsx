"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOpenHealthClimbs } from "@/hooks/useOpenHealthClimbs";
import { useOpenHealthRuns } from "@/hooks/useOpenHealthRuns";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import {
  OPENHEALTH_BENCHMARKS,
  OPENHEALTH_DEFAULT_BENCHMARK,
  OPENHEALTH_DEFAULT_SPLIT,
  OPENHEALTH_DIFFICULTIES,
  OPENHEALTH_SPLITS,
  openHealthBenchmarkByKey,
  type OpenHealthBenchmarkKey,
} from "@/lib/openhealth-benchmarks/constants";
import { openHealthRunTasks, openHealthTaskStats } from "@/lib/openhealth-benchmarks/runs";
import type { OpenHealthDifficulty, OpenHealthSplit, OpenHealthTask, OpenHealthTaskList } from "@/types/openhealth";
import { ClimbStartPopover } from "./ClimbStartPopover";
import { DifficultyBadge, formatScore } from "./format";

const SPLIT_LABELS: Record<OpenHealthSplit, string> = { public: "Public", heldout: "Heldout" };

type DifficultyFilter = OpenHealthDifficulty | "all";

function demographics(task: OpenHealthTask): string {
  const age = task.age === null ? null : task.age === 0 ? "infant" : `${task.age}`;
  return [age, task.sex].filter(Boolean).join(" · ") || "—";
}

/** "Cardiology" from the catalogue's "Cardiology"; "Obstetrics/Gynecology" from "Obstetrics_Gynecology". */
const specialtyName = (specialty: string | null) => specialty?.replace(/_/g, "/") ?? "—";

export function OpenHealthTasksPanel() {
  const { workspace } = useWorkspace();
  const { canWrite } = useWorkspaceAccess();
  const router = useRouter();
  const pathname = usePathname();
  const slug = workspace?.slug;
  const { runs } = useOpenHealthRuns();
  const { climbs } = useOpenHealthClimbs();

  const [split, setSplit] = useState<OpenHealthSplit>(OPENHEALTH_DEFAULT_SPLIT);
  const [benchmarkKey, setBenchmarkKey] = useState<OpenHealthBenchmarkKey>(OPENHEALTH_DEFAULT_BENCHMARK.key);
  const benchmark = openHealthBenchmarkByKey(benchmarkKey) ?? OPENHEALTH_DEFAULT_BENCHMARK;
  const bySpecialty = benchmark.variant === "specialty_conditioned";
  const [difficulty, setDifficulty] = useState<DifficultyFilter>("all");
  const [search, setSearch] = useState("");
  const [list, setList] = useState<OpenHealthTaskList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<number | null>(null);

  useEffect(() => {
    if (!slug) return;
    let stale = false;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ split, task: benchmark.task });
    if (benchmark.variant) query.set("variant", benchmark.variant);
    fetch(`/api/workspaces/${slug}/openhealth/benchmarks/tasks?${query}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as OpenHealthTaskList & { error?: string };
        if (!response.ok) throw new Error(body.error || "Could not load tasks");
        if (!stale) setList(body);
      })
      .catch((e: unknown) => {
        if (stale) return;
        setList(null);
        setError(e instanceof Error ? e.message : "Could not load tasks");
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [slug, split, benchmark.task, benchmark.variant]);

  const stats = useMemo(() => openHealthTaskStats(runs, climbs), [runs, climbs]);
  // The tasks the Runs tab can filter to: a run or a climb of theirs is on it.
  const onRunsTab = useMemo(() => new Set(openHealthRunTasks(runs, climbs).map((t) => t.gtId)), [runs, climbs]);
  const climbing = useMemo(
    () => new Map(climbs.filter((c) => c.status === "running" && c.gtId !== null).map((c) => [c.gtId, c] as const)),
    [climbs],
  );
  // Mean cost of a task's scored runs, for the climb's estimate.
  const meanCost = useMemo(() => {
    const sums = new Map<number, { total: number; n: number }>();
    for (const run of runs) {
      if (run.gtId === null || run.outcome !== "succeeded" || run.costUsd === null) continue;
      const s = sums.get(run.gtId) ?? { total: 0, n: 0 };
      sums.set(run.gtId, { total: s.total + run.costUsd, n: s.n + 1 });
    }
    return new Map([...sums].map(([gtId, s]) => [gtId, s.total / s.n] as const));
  }, [runs]);
  const tasks = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (list?.tasks ?? []).filter(
      (task) =>
        (difficulty === "all" || task.difficulty === difficulty) &&
        (!needle ||
          String(task.gtId).includes(needle) ||
          String(task.patientId).includes(needle) ||
          specialtyName(task.specialty).toLowerCase().includes(needle)),
    );
  }, [list, difficulty, search]);

  const start = useCallback(
    async (task: OpenHealthTask) => {
      if (!slug) return;
      setStarting(task.gtId);
      try {
        const response = await fetch(`/api/workspaces/${slug}/openhealth/benchmarks/runs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gtId: task.gtId,
            split,
            task: task.task,
            ...(task.variant ? { variant: task.variant } : {}),
          }),
        });
        const body = (await response.json().catch(() => ({}))) as { runId?: string; error?: string };
        if (!response.ok || !body.runId) throw new Error(body.error || "Could not start the run");
        router.push(`${pathname}?tab=runs&run=${body.runId}`);
      } catch (e) {
        toast.error("Could not start the run", {
          description: e instanceof Error ? e.message : "Please try again.",
        });
      } finally {
        setStarting(null);
      }
    },
    [slug, split, router, pathname],
  );

  const columns = bySpecialty ? 10 : 9;

  return (
    <div className="space-y-4" data-testid="openhealth-tasks">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={benchmarkKey} onValueChange={(value) => setBenchmarkKey(value as OpenHealthBenchmarkKey)}>
          <SelectTrigger className="w-44" data-testid="openhealth-benchmark-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPENHEALTH_BENCHMARKS.map((b) => (
              <SelectItem key={b.key} value={b.key}>
                {b.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={split} onValueChange={(value) => setSplit(value as OpenHealthSplit)}>
          <SelectTrigger className="w-36" data-testid="openhealth-split">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPENHEALTH_SPLITS.map((s) => (
              <SelectItem key={s} value={s}>
                {SPLIT_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={difficulty} onValueChange={(value) => setDifficulty(value as DifficultyFilter)}>
          <SelectTrigger className="w-44" data-testid="openhealth-difficulty">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All difficulties</SelectItem>
            {OPENHEALTH_DIFFICULTIES.map((d) => (
              <SelectItem key={d} value={d} className="capitalize">
                {d}
                {list ? ` (${list.byDifficulty[d]})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={bySpecialty ? "Task, patient id or specialty" : "Task or patient id"}
          className="w-52"
          inputMode={bySpecialty ? "text" : "numeric"}
          data-testid="openhealth-task-search"
        />
        {list && (
          <span className="text-sm text-muted-foreground">
            {tasks.length} of {list.total} tasks
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground" data-testid="openhealth-benchmark-note">
        {benchmark.task === "patient_diagnosis"
          ? "A run reconstructs the patient's problem list; scored by the paper's severity-weighted, chart-neutral F1."
          : bySpecialty
            ? "A run summarizes the chart from one specialty's perspective; scored by critical-finding recall against leakage, or, where the specialty has no active problem, by whether the summary says so."
            : "A run summarizes the whole chart in 5–10 sentences; scored by recall of the answer key's must-include findings (the metric has no length penalty, so watch the word count)."}
      </p>

      {loading && (
        <Card>
          <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading tasks…
          </CardContent>
        </Card>
      )}
      {!loading && error && (
        <Card>
          <CardContent className="py-10 text-sm text-destructive" data-testid="openhealth-tasks-error">
            {error}
          </CardContent>
        </Card>
      )}
      {!loading && !error && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Patient</TableHead>
              {bySpecialty && <TableHead>Specialty</TableHead>}
              <TableHead>Difficulty</TableHead>
              <TableHead>Age · Sex</TableHead>
              <TableHead className="text-right">Encounters</TableHead>
              <TableHead className="text-right">Attempts</TableHead>
              <TableHead className="text-right">Scored</TableHead>
              <TableHead className="text-right">Best score</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => {
              const s = stats.get(task.gtId);
              const climb = climbing.get(task.gtId);
              const busy = starting === task.gtId || s?.running === true;
              return (
                <TableRow key={task.gtId} data-testid="openhealth-task-row">
                  <TableCell className="font-mono">
                    {onRunsTab.has(task.gtId) ? (
                      <Link
                        href={`${pathname}?tab=runs&task=${task.gtId}`}
                        className="hover:underline underline-offset-4"
                        data-testid="openhealth-task-link"
                      >
                        {task.gtId}
                      </Link>
                    ) : (
                      task.gtId
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">{task.patientId}</TableCell>
                  {bySpecialty && (
                    <TableCell data-testid="openhealth-task-specialty">{specialtyName(task.specialty)}</TableCell>
                  )}
                  <TableCell>
                    <DifficultyBadge difficulty={task.difficulty} />
                  </TableCell>
                  <TableCell>{demographics(task)}</TableCell>
                  <TableCell className="text-right tabular-nums">{task.numEncounters ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{s?.attempts || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{s?.attempts ? s.succeeded : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatScore(s?.bestF1)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <ClimbStartPopover
                        gtId={task.gtId}
                        split={split}
                        benchmark={{ task: task.task, variant: task.variant }}
                        meanRunCost={meanCost.get(task.gtId) ?? null}
                        disabled={!canWrite || busy || starting !== null}
                        onStarted={({ climbId }) =>
                          router.push(`${pathname}?tab=runs&task=${task.gtId}&climb=${climbId}`)
                        }
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canWrite || busy || starting !== null}
                        onClick={() => void start(task)}
                        data-testid="openhealth-task-run"
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                        {climb
                          ? climb.attempts > 0
                            ? `Climbing ${climb.attempts}/${climb.maxRuns}`
                            : "Climbing…"
                          : s?.running
                            ? "Running…"
                            : "Run"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {tasks.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns} className="py-10 text-center text-sm text-muted-foreground">
                  No tasks match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
