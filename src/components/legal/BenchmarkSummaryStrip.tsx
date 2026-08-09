"use client";

import {
  summarize,
  WINDOW_OPTIONS,
  type SummaryWindow,
} from "@/lib/harvey-lab/benchmark-summary";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BenchmarkRunListRow } from "@/hooks/useLegalBenchmarkRunList";

interface BenchmarkSummaryStripProps {
  /** The rows the table is currently showing — the summary measures these only. */
  runs: BenchmarkRunListRow[];
  windowSize: SummaryWindow;
  onWindowChange: (size: SummaryWindow) => void;
}

function formatPercent(value: number | null): string {
  return value !== null ? `${Math.round(value * 100)}%` : "—";
}

export function BenchmarkSummaryStrip({
  runs,
  windowSize,
  onWindowChange,
}: BenchmarkSummaryStripProps) {
  const { passRate, passCount, averagePassRate, scoredCount, ratedCount } =
    summarize(runs);

  return (
    <div
      className="flex items-center gap-2 text-xs"
      data-testid="benchmark-strip"
    >
      <Select
        value={String(windowSize)}
        onValueChange={(v) => onWindowChange(Number(v) as SummaryWindow)}
      >
        <SelectTrigger
          className="h-8 w-[110px] text-xs"
          aria-label="Number of runs to show"
          data-testid="summary-window-trigger"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WINDOW_OPTIONS.map((size) => (
            <SelectItem key={size} value={String(size)} className="text-xs">
              Last {size}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {scoredCount === 0 ? (
        <span className="text-muted-foreground" data-testid="benchmark-strip-empty">
          No scored runs in view
        </span>
      ) : (
        <>
          <span
            className="text-sm font-semibold tabular-nums"
            data-testid="strip-pass-rate"
          >
            {formatPercent(passRate)}
          </span>
          <span className="text-muted-foreground">rolling pass rate</span>
          <span
            className="text-muted-foreground tabular-nums"
            data-testid="strip-sub-label"
          >
            · {passCount}/{scoredCount} scored runs passed
            {ratedCount > 0 && ` · ${formatPercent(averagePassRate)} avg criteria`}
          </span>
        </>
      )}
    </div>
  );
}
