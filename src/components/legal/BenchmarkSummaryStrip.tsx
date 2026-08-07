"use client";

import { AlertCircle } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { LEGAL_SLUGS } from "@/lib/eval-capture-slugs";
import { isDevelopmentMode } from "@/lib/runtime";
import {
  summarize,
  SUMMARY_WINDOW,
  PASS_BADGE_CLASS,
  FAIL_BADGE_CLASS,
} from "@/lib/harvey-lab/benchmark-summary";
import type { BenchmarkRunListRow } from "@/hooks/useLegalBenchmarkRunList";
import { formatDistanceToNow } from "date-fns";

interface BenchmarkSummaryStripProps {
  runs: BenchmarkRunListRow[];
  isLoading: boolean;
  error: string | null;
  onSelectRun: (runId: string) => void;
  onRetry?: () => void;
}

function pipLabel(run: BenchmarkRunListRow): string {
  const title = run.taskTitle || run.taskSlug || "Unknown task";
  const score =
    typeof run.n_passed === "number" && typeof run.n_total === "number"
      ? ` · ${run.n_passed}/${run.n_total}`
      : "";
  const date = run.createdAt
    ? ` · ${formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}`
    : "";
  return `${title}${score}${date}`;
}

export function BenchmarkSummaryStrip({
  runs,
  isLoading,
  error,
  onSelectRun,
  onRetry,
}: BenchmarkSummaryStripProps) {
  const { workspace } = useWorkspace();

  const isAllowed =
    LEGAL_SLUGS.includes(workspace?.slug ?? "") || isDevelopmentMode();

  if (!isAllowed) return null;

  // ── Skeleton while first load ────────────────────────────────────────────
  if (isLoading && runs.length === 0) {
    return (
      <div
        className="flex items-center gap-3 min-w-0"
        data-testid="benchmark-strip-skeleton"
        aria-label="Loading benchmark summary"
      >
        <div className="flex gap-1">
          {Array.from({ length: SUMMARY_WINDOW }).map((_, i) => (
            <div
              key={i}
              className="h-5 w-5 rounded-sm bg-muted animate-pulse"
              aria-hidden="true"
            />
          ))}
        </div>
        <div className="h-4 w-16 rounded bg-muted animate-pulse" aria-hidden="true" />
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────
  if (error && !isLoading) {
    return (
      <div
        className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0"
        data-testid="benchmark-strip-error"
      >
        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
        <span>Could not load benchmark summary</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="underline hover:text-foreground transition-colors"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  const { pips, averagePassRate, scoredCount, ratedCount } = summarize(runs);

  // ── Empty state ──────────────────────────────────────────────────────────
  if (scoredCount === 0) {
    return (
      <div
        className="text-xs text-muted-foreground min-w-0"
        data-testid="benchmark-strip-empty"
      >
        No scored runs yet
      </div>
    );
  }

  const avgDisplay =
    averagePassRate !== null
      ? `${Math.round(averagePassRate * 100)}%`
      : "—";

  return (
    <div
      className="flex items-center gap-3 min-w-0 overflow-x-auto"
      data-testid="benchmark-strip"
    >
      {/* Pip strip */}
      <div className="flex gap-1 shrink-0" role="group" aria-label="Recent benchmark runs">
        {pips.map((run) => {
          const label = pipLabel(run);
          const passClass = run.all_pass ? PASS_BADGE_CLASS : FAIL_BADGE_CLASS;
          return (
            <button
              key={run.id}
              onClick={() => onSelectRun(run.id)}
              title={label}
              aria-label={label}
              className={[
                "h-5 w-5 rounded-sm text-[9px] font-bold transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1",
                passClass,
              ].join(" ")}
              data-testid={`pip-${run.id}`}
            >
              {run.all_pass ? "P" : "F"}
            </button>
          );
        })}
        {/* Ghost pips to keep fixed width when fewer than SUMMARY_WINDOW scored runs */}
        {Array.from({ length: SUMMARY_WINDOW - pips.length }).map((_, i) => (
          <div
            key={`ghost-${i}`}
            className="h-5 w-5 rounded-sm bg-muted/30"
            aria-hidden="true"
          />
        ))}
      </div>

      {/* Average + sub-label */}
      <div className="shrink-0 text-right">
        <div className="text-sm font-semibold tabular-nums leading-none">
          {avgDisplay}
        </div>
        <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
          avg criteria pass rate
        </div>
        <div
          className="text-[10px] text-muted-foreground leading-tight"
          data-testid="strip-sub-label"
        >
          {scoredCount} scored · {ratedCount} rated
        </div>
      </div>
    </div>
  );
}
