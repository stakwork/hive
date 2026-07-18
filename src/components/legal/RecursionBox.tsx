"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, RefreshCw, ChevronDown, ChevronUp, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { HillClimbChart } from "@/components/legal/HillClimbChart";
import { buildAttemptSeries } from "@/lib/harvey-lab/attempt-series";
import type { AttemptPoint, RawRunRow } from "@/lib/harvey-lab/attempt-series";
import type { RecursionEntry } from "@/hooks/useLegalBenchmarkRecursionList";
import { useWorkspace } from "@/hooks/useWorkspace";
import { StakworkRunType } from "@prisma/client";

// ── RecursionCard ─────────────────────────────────────────────────────────

interface RecursionCardProps {
  entry: RecursionEntry;
  /** Attempt series for this task (keyed by entry.id / taskSlug). Empty = no runs yet. */
  series: AttemptPoint[];
  refetch: () => Promise<void>;
  /**
   * When true, the score badge is suppressed entirely — used in the runs-fetch error
   * state to avoid conflating "score data unavailable due to error" with "no runs yet".
   */
  runsLoadError?: boolean;
}

function RecursionCard({ entry, series, refetch, runsLoadError = false }: RecursionCardProps) {
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const latestPoint = series.length > 0 ? series[series.length - 1] : null;

  const handleToggle = async (enabled: boolean) => {
    setToggling(true);
    setToggleError(null);
    try {
      const res = await fetch(
        `/api/workspaces/openlaw/legal/benchmarks/recursion/${entry.refId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        },
      );
      if (res.ok) {
        await refetch();
      } else {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body as { error?: string }).error ?? `Request failed (${res.status})`;
        setToggleError(msg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToggleError(msg);
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* ── Card header ─────────────────────────────────────────────── */}
      <div className="p-4 flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-medium truncate max-w-xs">
              {entry.name || entry.id}
            </span>
            {/* ── Latest score badge ─────────────────────────────────── */}
            {/* Only shown in the loaded state. Suppressed entirely in the error state
                to avoid conflating "data unavailable due to error" with "no runs yet". */}
            {!runsLoadError && (
              latestPoint !== null ? (
                <span
                  className="text-xs font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground tabular-nums shrink-0"
                  title={`Latest: ${latestPoint.n_passed}/${latestPoint.n_total} criteria passed`}
                >
                  {latestPoint.n_passed}/{latestPoint.n_total}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground/60 italic shrink-0">
                  no runs yet
                </span>
              )
            )}
          </div>
          <span className="text-xs text-muted-foreground truncate">{entry.id}</span>
          {toggleError && (
            <span className="text-xs text-destructive mt-1">{toggleError}</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* ── Expand toggle (only when series has data) ───────────── */}
          {series.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Collapse chart" : "Expand chart"}
              className="h-8 w-8 p-0"
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => handleToggle(false)}
            disabled={toggling}
            className="shrink-0"
          >
            {toggling ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                Updating…
              </>
            ) : (
              "Disable"
            )}
          </Button>
        </div>
      </div>

      {/* ── Expandable hill-climb chart ──────────────────────────────── */}
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleContent>
          {series.length > 0 && (
            <div className="border-t px-4 py-4 bg-muted/20">
              <div className="mb-2 flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Score climb · {series.length} attempt{series.length !== 1 ? "s" : ""}
                </span>
              </div>
              <HillClimbChart
                series={series}
                label={`Hill-climb chart for ${entry.name || entry.id}`}
              />
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ── RecursionList ─────────────────────────────────────────────────────────

interface RecursionListProps {
  entries: RecursionEntry[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * RecursionList renders the list of enrolled recursion tasks.
 * It fetches benchmark run data **once** for the entire tab (not per card)
 * to avoid N+1 requests, and passes each card its relevant AttemptPoint[].
 *
 * Three distinct states for the runs fetch:
 *   loading  — skeleton/spinner (not the same as the recursion-list loading state)
 *   error    — inline retry; cards are NOT rendered as if scoreless
 *   loaded   — cards rendered; empty series = "no runs yet" per card
 */
export function RecursionList({
  entries,
  isLoading,
  error,
  refetch,
}: RecursionListProps) {
  const { id: workspaceId } = useWorkspace();

  // ── Single shared runs fetch ─────────────────────────────────────────
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [seriesMap, setSeriesMap] = useState<Map<string, AttemptPoint[]>>(new Map());
  const fetchedRef = useRef(false);

  const fetchRuns = useCallback(async () => {
    if (!workspaceId) return;
    setRunsLoading(true);
    setRunsError(null);
    try {
      const res = await fetch(
        `/api/stakwork/runs?type=${StakworkRunType.LEGAL_BENCHMARK_RUNNER}&workspaceId=${workspaceId}&limit=100&includeResult=true`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `Failed to fetch runs (${res.status})`,
        );
      }
      const data = await res.json();
      const rawRows: RawRunRow[] = (data.runs ?? []).map(
        (r: { id: string; workspaceId: string; status: string; projectId: number | null; result: string | null; createdAt: string }) => ({
          id: r.id,
          workspaceId: r.workspaceId,
          status: r.status,
          projectId: r.projectId,
          result: r.result,
          createdAt: r.createdAt,
        }),
      );
      setSeriesMap(buildAttemptSeries(rawRows));
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRunsLoading(false);
    }
  }, [workspaceId]);

  // Fetch once on mount (and whenever workspaceId changes, which is never
  // in practice since the tab is openlaw-only).
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetchRuns();
  }, [fetchRuns]);

  // ── Recursion-list loading / error states ────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={refetch}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Retry
        </Button>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
        <p className="text-sm">No tasks enrolled in recursion.</p>
        <p className="text-xs">
          Open a completed benchmark run with failing criteria and click{" "}
          <strong>Recursion</strong> to enroll a task — this toggles the recursion
          flag on the task&apos;s EvalSet rather than creating a row.
        </p>
      </div>
    );
  }

  // ── Runs-fetch error state (structurally distinct from "no runs yet") ──
  if (runsError) {
    return (
      <div className="flex flex-col gap-3">
        {/* Show the task names so the user isn't blocked, but surface the
            fetch failure clearly with a retry — never silently render as scoreless. */}
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-destructive">
              Could not load score data
            </p>
            <p className="text-xs text-muted-foreground">{runsError}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchedRef.current = false;
              fetchRuns();
            }}
            className="shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Retry
          </Button>
        </div>
        {/* Render cards without score data so they remain actionable */}
        {entries.map((entry) => (
          <RecursionCard
            key={entry.refId}
            entry={entry}
            series={[]}
            runsLoadError={true}
            refetch={refetch}
          />
        ))}
      </div>
    );
  }

  // ── Runs still loading — render cards with loading skeleton scores ────
  if (runsLoading) {
    return (
      <div className="flex flex-col gap-3">
        {entries.map((entry) => (
          <div key={entry.refId} className="rounded-lg border bg-card p-4 flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5 min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-medium truncate max-w-xs">
                  {entry.name || entry.id}
                </span>
                <span className="h-4 w-12 rounded bg-muted animate-pulse inline-block" />
              </div>
              <span className="text-xs text-muted-foreground truncate">{entry.id}</span>
            </div>
            <Button variant="outline" size="sm" disabled className="shrink-0">
              Disable
            </Button>
          </div>
        ))}
      </div>
    );
  }

  // ── Loaded: pass each card its matching series slice ─────────────────
  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry) => (
        <RecursionCard
          key={entry.refId}
          entry={entry}
          // The recursion list uses entry.id as the taskSlug.
          series={seriesMap.get(entry.id) ?? []}
          refetch={refetch}
        />
      ))}
    </div>
  );
}
