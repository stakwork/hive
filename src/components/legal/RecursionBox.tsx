"use client";

import React, { useState } from "react";
import { Loader2, RefreshCw, ChevronUp, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { HillClimbChart } from "@/components/legal/HillClimbChart";
import { buildAttemptPointSeries } from "@/lib/harvey-lab/attempt-series";
import type { AttemptPoint } from "@/lib/harvey-lab/attempt-series";
import { useEvalRunHistory } from "@/hooks/useEvalRunHistory";
import type { RecursionEntry } from "@/hooks/useLegalBenchmarkRecursionList";

// ── RecursionCard ─────────────────────────────────────────────────────────────

interface RecursionCardProps {
  entry: RecursionEntry;
  refetch: () => Promise<void>;
}

function RecursionCard({ entry, refetch }: RecursionCardProps) {
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Per-card fetch of EvalTriggerOutput nodes for this task slug.
  // Acceptable given few enrolled tasks (Recursion tab is openlaw-only and
  // the enrolled set is expected to remain small).
  const { attempts, isLoading: attemptsLoading } = useEvalRunHistory(entry.id);

  // Build the AttemptPoint series from the sorted EvalTriggerOutput nodes
  const series: AttemptPoint[] = buildAttemptPointSeries(attempts);

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
            {attemptsLoading ? (
              <span className="h-4 w-12 rounded bg-muted animate-pulse inline-block" />
            ) : latestPoint !== null ? (
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

// ── RecursionList ─────────────────────────────────────────────────────────────

interface RecursionListProps {
  entries: RecursionEntry[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * RecursionList renders the list of enrolled recursion tasks.
 * Each card independently fetches its EvalTriggerOutput series via
 * useEvalRunHistory — per-card fetching is acceptable since the enrolled
 * set is small and this avoids an N+1 bulk-fetch of the wrong data source.
 */
export function RecursionList({
  entries,
  isLoading,
  error,
  refetch,
}: RecursionListProps) {
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

  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry) => (
        <RecursionCard key={entry.refId} entry={entry} refetch={refetch} />
      ))}
    </div>
  );
}
