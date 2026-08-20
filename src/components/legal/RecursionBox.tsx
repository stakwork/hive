"use client";

import React, { useMemo, useState } from "react";
import { Loader2, RefreshCw, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useEvalRunHistory } from "@/hooks/useEvalRunHistory";
import { RecursionActivityRail } from "@/components/legal/RecursionActivityRail";
import { useBenchmarkRubrics } from "@/hooks/useBenchmarkRubrics";
import { rosterSummary, type RosterSummary } from "@/lib/harvey-lab/rubric-scoring";
import { HillClimbChart } from "@/components/legal/HillClimbChart";
import type { EvalTriggerOutput } from "@/lib/harvey-lab/eval-normalizers";
import type { RecursionEntry } from "@/hooks/useLegalBenchmarkRecursionList";

// ─── ScoreBadge ──────────────────────────────────────────────────────────────

function ScoreBadge({
  isLoading,
  error,
  n_passed,
  n_total,
  roster,
}: {
  isLoading: boolean;
  error: string | null;
  n_passed: number | undefined;
  n_total: number | undefined;
  /** Graph roster summary — enables the "+N contested" annotation. */
  roster: RosterSummary | null;
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
  const allPass = n_total > 0 && n_passed === n_total;

  return (
    <span className="flex items-center gap-1.5">
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
      {roster && roster.contested > 0 && (
        <span
          className="text-xs text-violet-700 dark:text-violet-400 whitespace-nowrap"
          data-testid="score-contested-annotation"
          title={`${roster.contested} contested criteria excluded from the score · ${roster.total} total in the rubric roster`}
        >
          +{roster.contested} contested
        </span>
      )}
    </span>
  );
}

/**
 * Clamp hill-climb attempt counts to the graph roster's contested-excluded
 * denominator. Attempts carry only aggregate n_passed/n_total (no
 * per-criterion data), so — mirroring computeBenchmarkScore's flat-count
 * rule — the denominator is replaced and passes are clamped rather than
 * guessed. No roster → attempts pass through untouched.
 */
function adjustAttemptsToRoster(
  attempts: EvalTriggerOutput[],
  roster: RosterSummary | null,
): EvalTriggerOutput[] {
  if (!roster) return attempts;
  const clamp = (v: number | null | undefined) =>
    typeof v === "number" ? Math.min(v, roster.denominator) : v;
  return attempts.map((a) => ({
    ...a,
    n_total: roster.denominator,
    n_passed: clamp(a.n_passed) as number | undefined,
    bestPassed: clamp(a.bestPassed) as number | undefined,
    actualPassed: clamp(a.actualPassed) as number | null | undefined,
  }));
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
  const {
    attempts: rawAttempts,
    attemptRows,
    partial,
    isLoading: historyLoading,
    error: historyError,
  } = useEvalRunHistory({
    refId: entry.refId,
    slug: entry.id,
  });

  // Graph-first denominator: the task's EvalRequirement roster minus contested
  // definitions. Null (no roster / loading) leaves attempt counts untouched.
  const { rubrics: graphRubrics } = useBenchmarkRubrics(entry.id);
  const roster = useMemo(() => rosterSummary(graphRubrics), [graphRubrics]);
  const attempts = useMemo(
    () => adjustAttemptsToRoster(rawAttempts, roster),
    [rawAttempts, roster],
  );

  // Headline number: the best score so far (highest bestPassed). Both series
  // builders now emit a monotonic bestPassed — the chart's line only climbs or
  // holds, regressions render as hollow "ignored" dots — so the badge always
  // matches the level the line ends at.
  const latest = useMemo(() => {
    if (attempts.length === 0) return null;
    return attempts.reduce((best, pt) => {
      const ptBest = pt.bestPassed ?? pt.n_passed ?? 0;
      const curBest = best.bestPassed ?? best.n_passed ?? 0;
      return ptBest >= curBest ? pt : best;
    });
  }, [attempts]);

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
              roster={roster}
            />
            {/* A truncated graph walk must be loud: a capped walk renders a
                flat-looking chart that is indistinguishable from a real
                plateau, so the warning sits in the always-visible header, not
                only inside the collapsed chart. */}
            {partial && !historyLoading && !historyError && (
              <span
                className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
                data-testid="partial-warning"
                title="The graph walk hit a safety cap before finishing — runs may be missing and the chart below may under-report progress."
              >
                <AlertCircle className="h-3 w-3 shrink-0" />
                <span>incomplete data</span>
              </span>
            )}
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

      {/* Collapsible hill-climb chart */}
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleContent>
          {attempts.length > 0 && (
            <div className="border-t px-4 pt-3 pb-4 bg-muted/20">
              <p className="text-xs text-muted-foreground mb-2">
                Score per attempt — target: {attempts[0].n_total}
                {roster && roster.contested > 0 && (
                  <span
                    className="text-violet-700 dark:text-violet-400"
                    data-testid="chart-contested-note"
                  >
                    {" "}
                    (+{roster.contested} contested excluded · {roster.total} total)
                  </span>
                )}
                {partial && (
                  <span
                    className="text-amber-600 dark:text-amber-400"
                    data-testid="chart-partial-note"
                  >
                    {" "}
                    · chart may be incomplete
                  </span>
                )}
              </p>
              {/* Chart ~2/3, activity rail ~1/3; stacked on small screens */}
              <div className="flex flex-col md:flex-row gap-4">
                <div className="md:basis-2/3 min-w-0">
                  <HillClimbChart attempts={attempts} height={176} />
                </div>
                <div className="md:basis-1/3 min-w-0">
                  <RecursionActivityRail rows={attemptRows} partial={partial} taskSlug={entry.id} />
                </div>
              </div>
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
