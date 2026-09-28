"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { OpenHealthOutcome, ProjectedRunSummary } from "@/lib/openhealth-benchmarks/run-summary";

interface RunsSummary {
  successRate: number | null;
  meanF1: number | null;
  succeeded: number;
  failed: number;
  cancelled: number;
  running: number;
  total: number;
}

const OUTCOME_VARIANT: Record<OpenHealthOutcome, "default" | "destructive" | "secondary" | "outline"> = {
  success: "default",
  failed: "destructive",
  cancelled: "outline",
  running: "secondary",
};

function formatScore(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
}

function formatPercent(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(0)}%` : "—";
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${minutes}m ${rem}s`;
}

export function OpenHealthRunsHistory() {
  const { workspace } = useWorkspace();
  const slug = workspace?.slug;

  const [runs, setRuns] = useState<ProjectedRunSummary[]>([]);
  const [summary, setSummary] = useState<RunsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    if (!slug) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/workspaces/${slug}/openhealth/benchmarks/runs`);
      if (!res.ok) throw new Error(`Failed to fetch runs (${res.status})`);
      const data = await res.json();
      setRuns(Array.isArray(data.runs) ? data.runs : []);
      setSummary(data.summary ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="grid grid-cols-2 gap-4 max-w-md">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Success rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{formatPercent(summary?.successRate ?? null)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Mean F1</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{formatScore(summary?.meanF1 ?? null)}</div>
          </CardContent>
        </Card>
      </div>

      <div>
        <Button size="sm" variant="outline" onClick={fetchRuns} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <RefreshCw className="h-3 w-3 mr-2" />}
          Refresh
        </Button>
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}

      <div className="flex-1 min-h-0 overflow-auto border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>GT ID</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>F1</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <Loader2 className="h-4 w-4 animate-spin inline-block" />
                </TableCell>
              </TableRow>
            ) : runs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No runs yet
                </TableCell>
              </TableRow>
            ) : (
              runs.map((run) => (
                <TableRow key={run.runId}>
                  <TableCell className="text-xs text-muted-foreground">
                    {run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {slug ? (
                      <Link
                        className="underline"
                        href={`/w/${slug}/openhealth/benchmarks/runs/${run.runId}`}
                      >
                        {run.gtId ?? run.runId}
                      </Link>
                    ) : (
                      run.gtId ?? run.runId
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={OUTCOME_VARIANT[run.outcome]}>{run.outcome}</Badge>
                  </TableCell>
                  <TableCell>{formatScore(run.f1)}</TableCell>
                  <TableCell>{run.tier ?? "—"}</TableCell>
                  <TableCell>{run.cost > 0 ? `$${run.cost.toFixed(2)}` : "—"}</TableCell>
                  <TableCell>{formatDuration(run.durationMs)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
