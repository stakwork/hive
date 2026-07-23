"use client";

import React, { useState } from "react";
import { Loader2, RefreshCw, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useEvalRunHistory } from "@/hooks/useEvalRunHistory";
import { HillClimbChart } from "@/components/legal/HillClimbChart";
import type { RecursionEntry } from "@/hooks/useLegalBenchmarkRecursionList";

// ─── ScoreBadge ──────────────────────────────────────────────────────────────

function ScoreBadge({
  isLoading,
  error,
  n_passed,
  n_total,
}: {
  isLoading: boolean;
  error: string | null;
  n_passed: number | undefined;
  n_total: number | undefined;
}) {
  if (isLoading) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="score-loading">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Loading…</span>
      </span>
    );
  }

  if (error) {
    return (
      <span className="flex items-center gap-1 text-xs text-destructive" data-testid="score-error">
        <AlertCircle className="h-3 w-3 shrink-0" />
        <span>Failed to load</span>
      </span>
    );
  }

  if (n_passed == null || n_total == null) {
    return (
      <span className="text-xs text-muted-foreground/60 italic" data-testid="score-no-runs">
        no runs yet
      </span>
    );
  }

  const pct = n_total > 0 ? Math.round((n_passed / n_total) * 100) : 0;
  const allPass = n_passed === n_total;

  return (
    <span
      className={[
        "tabular-nums text-xs font-mono font-medium",
        allPass
          ? "text-green-600 dark:text-green-400"
          : "text-foreground",
      ].join(" ")}
      data-testid="score-display"
      title={`${pct}% pass rate`}
    >
      {n_passed}/{n_total}
    </span>
  );
}

// ─── RecursionCard ────────────────────────────────────────────────────────────

interface RecursionCardProps {
  entry: RecursionEntry;
  refetch: () => Promise<void>;
}

function RecursionCard({ entry, refetch }: RecursionCardProps) {
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Use entry.refId (EvalSet ref_id) + entry.id (task slug) for eval run history.
  // refId is preferred; slug is the fallback when refId is absent.
  const { attempts, isLoading: historyLoading, error: historyError } = useEvalRunHistory({
    refId: entry.refId,
    slug: entry.id,
  });

  // Use the best score so far (highest bestPassed) so a trailing rejected
  // attempt doesn't make the badge show a lower/stale score.
  const bestAttempt = attempts.length > 0
    ? attempts.reduce((best, pt) => {
        const ptBest = pt.bestPassed ?? pt.n_passed ?? 0;
        const curBest = best.bestPassed ?? best.n_passed ?? 0;
        return ptBest >= curBest ? pt : best;
      })
    : null;
  const latest = bestAttempt;

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
        const msg = (body as { error?: string }).error ?? `Request failed (${res.status})`;
        console.error(`[RecursionCard] PATCH failed ref_id=${entry.refId} enabled=${enabled}`, msg);
        setToggleError(msg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[RecursionCard] PATCH error ref_id=${entry.refId} enabled=${enabled}`, msg);
      setToggleError(msg);
    } finally {
      setToggling(false);
    }
  };

  const canExpand = !historyLoading && !historyError && attempts.length > 0;

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* Card header row */}
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-sm font-medium truncate max-w-xs">
              {entry.name || entry.id}
            </span>
            <ScoreBadge
              isLoading={historyLoading}
              error={historyError}
              n_passed={latest?.bestPassed ?? latest?.n_passed}
              n_total={latest?.n_total}
            />
          </div>
          <span className="text-xs text-muted-foreground truncate">{entry.id}</span>
          {toggleError && (
            <span className="text-xs text-destructive mt-1">{toggleError}</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Expand toggle — only when there is data to show */}
          {canExpand && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              aria-label={expanded ? "Collapse chart" : "Expand chart"}
              data-testid="expand-toggle"
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => handleToggle(!entry.recursion)}
            disabled={toggling}
            className="shrink-0"
          >
            {toggling ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                Updating…
              </>
            ) : (
              entry.recursion ? "Disable" : "Enable"
            )}
          </Button>
        </div>
      </div>

      {/* Collapsible hill-climb chart */}
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleContent>
          {attempts.length > 0 && (
            <div className="border-t px-4 pt-3 pb-4 bg-muted/20">
              <p className="text-xs text-muted-foreground mb-2">
                Score per attempt — target: {attempts[0].n_total}
              </p>
              <HillClimbChart attempts={attempts} height={140} />
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ─── RecursionList ────────────────────────────────────────────────────────────

interface RecursionListProps {
  entries: RecursionEntry[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

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
        <p className="text-sm">No EvalSets found in this workspace.</p>
        <p className="text-xs">
          EvalSets are created automatically when a benchmark run completes.
          Run a benchmark task first to see it listed here.
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
