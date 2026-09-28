"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWorkspace } from "@/hooks/useWorkspace";
import { OPENHEALTH_DEFAULT_SPLIT, OPENHEALTH_SPLITS, type OpenHealthSplit } from "@/lib/openhealth-benchmarks/constants";
import type { OpenHealthTaskRow } from "@/lib/openhealth-benchmarks/run-summary";

const SPLIT_LABELS: Record<OpenHealthSplit, string> = {
  public: "Public",
  heldout: "Heldout",
};

const POLL_INTERVAL_MS = 5_000;

interface TaskStat {
  attempts: number;
  bestF1: number | null;
}

function cell(value: unknown): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function formatF1(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
}

export function OpenHealthTasksPanel() {
  const { workspace, role } = useWorkspace();
  const router = useRouter();
  const slug = workspace?.slug;
  const canWrite = role ? ["OWNER", "ADMIN", "PM", "DEVELOPER"].includes(role) : false;

  const [split, setSplit] = useState<OpenHealthSplit>(OPENHEALTH_DEFAULT_SPLIT);
  const [difficultyFilter, setDifficultyFilter] = useState<string>("all");
  const [tasks, setTasks] = useState<OpenHealthTaskRow[]>([]);
  const [sourceRunId, setSourceRunId] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [startingKey, setStartingKey] = useState<string | null>(null);
  const [stats, setStats] = useState<Map<string, TaskStat>>(new Map());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTasks = useCallback(async () => {
    if (!slug) return null;
    try {
      const res = await fetch(`/api/workspaces/${slug}/openhealth/benchmarks/tasks?split=${split}`);
      if (!res.ok) throw new Error(`Failed to load tasks (${res.status})`);
      const data = await res.json();
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      setSourceRunId(data.sourceRunId ?? null);
      setFetchedAt(data.fetchedAt ?? null);
      setError(null);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [slug, split]);

  const fetchStats = useCallback(async () => {
    if (!slug) return;
    try {
      const res = await fetch(`/api/workspaces/${slug}/openhealth/benchmarks/runs`);
      if (!res.ok) return;
      const data = await res.json();
      const map = new Map<string, TaskStat>();
      for (const run of Array.isArray(data.runs) ? data.runs : []) {
        if (!run.gtId) continue;
        const entry = map.get(run.gtId) ?? { attempts: 0, bestF1: null };
        entry.attempts += 1;
        if (run.outcome === "success" && typeof run.f1 === "number") {
          if (entry.bestF1 === null || run.f1 > entry.bestF1) entry.bestF1 = run.f1;
        }
        map.set(run.gtId, entry);
      }
      setStats(map);
    } catch {
      // best-effort — attempts/best F1 simply show "—"
    }
  }, [slug]);

  useEffect(() => {
    setIsLoading(true);
    fetchTasks();
    fetchStats();
  }, [fetchTasks, fetchStats]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startRefresh = useCallback(async () => {
    if (!slug) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/workspaces/${slug}/openhealth/benchmarks/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ split }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Failed to start refresh (${res.status})`);
      }
      const priorSourceRunId = sourceRunId;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        const data = await fetchTasks();
        if (!data) return;
        if (data.sourceRunId !== priorSourceRunId || !data.refreshing) {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          setRefreshing(false);
          await fetchStats();
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start refresh");
      setRefreshing(false);
    }
  }, [slug, split, sourceRunId, fetchTasks, fetchStats]);

  const startRun = useCallback(
    async (row: OpenHealthTaskRow) => {
      if (!slug) return;
      setStartingKey(row.gtId);
      try {
        const res = await fetch(`/api/workspaces/${slug}/openhealth/benchmarks/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gtId: row.gtId }),
        });
        if (res.status === 409) {
          toast.error("A run is already in progress for this case");
          return;
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Failed to start run (${res.status})`);
        }
        const data = await res.json();
        toast.success("Run started");
        if (data.runId) {
          router.push(`/w/${slug}/openhealth/benchmarks/runs/${data.runId}`);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to start run");
      } finally {
        setStartingKey(null);
      }
    },
    [slug, router],
  );

  const difficulties = Array.from(new Set(tasks.map((t) => t.difficulty).filter(Boolean))) as string[];
  const filteredTasks =
    difficultyFilter === "all" ? tasks : tasks.filter((t) => t.difficulty === difficultyFilter);

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={split} onValueChange={(v) => setSplit(v as OpenHealthSplit)}>
          <SelectTrigger className="w-[160px]">
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

        <Select value={difficultyFilter} onValueChange={setDifficultyFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All difficulties" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All difficulties</SelectItem>
            {difficulties.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canWrite && (
          <Button size="sm" variant="outline" disabled={refreshing} onClick={startRefresh}>
            {refreshing ? (
              <Loader2 className="h-3 w-3 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-2" />
            )}
            Refresh
          </Button>
        )}

        {fetchedAt && (
          <span className="text-xs text-muted-foreground">
            Fetched {new Date(fetchedAt).toLocaleString()}
          </span>
        )}
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="flex-1 min-h-0 overflow-auto border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>GT ID</TableHead>
              <TableHead>Patient ID</TableHead>
              <TableHead>Difficulty</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Best F1</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  <Loader2 className="h-4 w-4 animate-spin inline-block" />
                </TableCell>
              </TableRow>
            ) : filteredTasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  {tasks.length === 0 ? (
                    <div className="flex flex-col items-center gap-2">
                      <span>No task list yet</span>
                      {canWrite ? (
                        <span className="text-xs">Click Refresh above to load one.</span>
                      ) : (
                        <span className="text-xs">Ask an editor to refresh.</span>
                      )}
                    </div>
                  ) : (
                    "No tasks match this filter"
                  )}
                </TableCell>
              </TableRow>
            ) : (
              filteredTasks.map((row) => {
                const stat = stats.get(row.gtId);
                return (
                  <TableRow key={row.gtId}>
                    <TableCell className="font-mono text-xs">{cell(row.gtId)}</TableCell>
                    <TableCell className="font-mono text-xs">{cell(row.patientId)}</TableCell>
                    <TableCell>{cell(row.difficulty)}</TableCell>
                    <TableCell>{stat?.attempts ?? 0}</TableCell>
                    <TableCell>{formatF1(stat?.bestF1 ?? null)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canWrite || startingKey === row.gtId}
                        onClick={() => startRun(row)}
                      >
                        {startingKey === row.gtId ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Run"
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
