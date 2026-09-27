"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWorkspace } from "@/hooks/useWorkspace";

const POLL_INTERVAL_MS = 15_000;

interface OpenHealthRunResult {
  runner?: string;
  task?: string;
  split?: string;
  gtId?: string;
  patientId?: string;
  difficulty?: string;
  tier?: string;
  weighted_problem_list_f1_neutral?: number;
  n_matched?: number;
  n_gt?: number;
  missedCount?: number | null;
  extraCount?: number | null;
  scoreError?: string;
  dispatchError?: string;
  gradeError?: string;
  produceError?: string;
}

interface RunRow {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  result?: string | null;
}

function parseResult(raw: string | null | undefined): OpenHealthRunResult {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as OpenHealthRunResult;
  } catch {
    return {};
  }
}

function formatScore(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
}

export function OpenHealthRunsHistory() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id;

  const [runs, setRuns] = useState<RunRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRuns = useCallback(async () => {
    if (!workspaceId) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    try {
      const res = await fetch(
        `/api/stakwork/runs?type=OPENHEALTH_BENCHMARK_RUNNER&workspaceId=${workspaceId}&includeResult=true`,
      );
      if (!res.ok) throw new Error(`Failed to fetch runs (${res.status})`);
      const data = await res.json();
      setRuns(Array.isArray(data.runs) ? data.runs : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Poll-on-read is the settle mechanism for this feature — keep polling
  // while any row is still PENDING/IN_PROGRESS and the tab is visible.
  useEffect(() => {
    const hasActive = runs.some((r) => r.status === "PENDING" || r.status === "IN_PROGRESS");
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (hasActive && typeof document !== "undefined" && document.visibilityState === "visible") {
      intervalRef.current = setInterval(fetchRuns, POLL_INTERVAL_MS);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [runs, fetchRuns]);

  return (
    <div className="flex flex-col gap-4 h-full">
      {error && <div className="text-sm text-destructive">{error}</div>}
      <div className="flex-1 min-h-0 overflow-auto border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>GT ID</TableHead>
              <TableHead>Split</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>F1</TableHead>
              <TableHead>Matched / Gold</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Missed / Extra</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8">
                  <Loader2 className="h-4 w-4 animate-spin inline-block" />
                </TableCell>
              </TableRow>
            ) : runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No runs yet
                </TableCell>
              </TableRow>
            ) : (
              runs.map((run) => {
                const result = parseResult(run.result);
                // A row with scoreError (or dispatchError) is an error state,
                // never rendered as a pass and never a blank success — do not
                // invent pass/fail from status alone.
                const isError =
                  run.status === "FAILED" ||
                  Boolean(result.scoreError) ||
                  Boolean(result.dispatchError);
                return (
                  <TableRow key={run.id}>
                    <TableCell>{result.task ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{result.gtId ?? "—"}</TableCell>
                    <TableCell>{result.split ?? "—"}</TableCell>
                    <TableCell>
                      {isError ? (
                        <Badge variant="destructive">
                          {result.scoreError ?? result.dispatchError ?? "Failed"}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">{run.status}</Badge>
                      )}
                    </TableCell>
                    <TableCell>{isError ? "—" : formatScore(result.weighted_problem_list_f1_neutral)}</TableCell>
                    <TableCell>
                      {isError || result.n_matched == null || result.n_gt == null
                        ? "—"
                        : `${result.n_matched} / ${result.n_gt}`}
                    </TableCell>
                    <TableCell>{isError ? "—" : (result.tier ?? "—")}</TableCell>
                    <TableCell>
                      {isError
                        ? "—"
                        : `${result.missedCount ?? "—"} / ${result.extraCount ?? "—"}`}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(run.createdAt).toLocaleString()}
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
