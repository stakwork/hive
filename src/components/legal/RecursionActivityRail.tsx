"use client";

import { formatDistanceToNow } from "date-fns";
import { FileText, Loader2 } from "lucide-react";
import { StakworkRunLink } from "@/components/legal/StakworkRunLink";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { AttemptRailRow } from "@/hooks/useEvalRunHistory";

interface RecursionActivityRailProps {
  rows: AttemptRailRow[];
  /** The graph walk was truncated — the list may be missing attempts. */
  partial: boolean;
}

/**
 * Status rendering: a small dot + text, deliberately more compact than the
 * Runs tab's RunnerStatusBadge — the rail is one-third of a card, so every
 * row must stay on one line. A null status is a graph-only row (the attempt
 * exists in Jarvis but no StakworkRun matched) and renders as an em dash
 * rather than pretending to know.
 */
const STATUS_STYLES: Record<string, { dot: string; text: string; label: string }> = {
  PENDING: { dot: "bg-gray-400", text: "text-muted-foreground", label: "pending" },
  IN_PROGRESS: { dot: "bg-blue-500", text: "text-blue-700 dark:text-blue-300", label: "running" },
  COMPLETED: { dot: "bg-green-600", text: "text-green-700 dark:text-green-400", label: "completed" },
  ERROR: { dot: "bg-red-500", text: "text-red-700 dark:text-red-400", label: "error" },
  FAILED: { dot: "bg-red-500", text: "text-red-700 dark:text-red-400", label: "failed" },
  HALTED: { dot: "bg-gray-400", text: "text-muted-foreground", label: "halted" },
};

function RowStatus({ row }: { row: AttemptRailRow }) {
  if (!row.status) {
    return (
      <span className="text-xs text-muted-foreground/60" data-testid={`rail-status-${row.key}`}>
        —
      </span>
    );
  }
  const style = STATUS_STYLES[row.status] ?? {
    dot: "bg-gray-400",
    text: "text-muted-foreground",
    label: row.status.toLowerCase(),
  };
  return (
    <span
      className={`flex items-center gap-1.5 text-xs whitespace-nowrap ${style.text}`}
      data-testid={`rail-status-${row.key}`}
    >
      {row.inFlight ? (
        <Loader2 className="h-3 w-3 animate-spin shrink-0" />
      ) : (
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${style.dot}`} />
      )}
      {style.label}
    </span>
  );
}

/** Row identity chip: the chart label when charted, else the pipeline name. */
function RowLabel({ row }: { row: AttemptRailRow }) {
  if (row.label) {
    return (
      <span className="font-mono text-xs font-medium w-9 shrink-0 tabular-nums">{row.label}</span>
    );
  }
  // Pipeline names, not internal jargon: LEGAL_BENCHMARK_RECURSION drives the
  // loop ("recursion"); LEGAL_BENCHMARK_EVAL is failure analysis — its webhook
  // writes cause annotations, never a score ("analysis").
  return (
    <span className="text-xs italic text-muted-foreground shrink-0">
      {row.runType === "recursion" ? "recursion" : row.runType === "eval" ? "analysis" : "run"}
    </span>
  );
}

function RowReport({ row, workspaceSlug }: { row: AttemptRailRow; workspaceSlug: string }) {
  if (row.hasReport && row.runId && workspaceSlug) {
    return (
      <a
        href={`/w/${workspaceSlug}/legal/benchmarks/runs/${row.runId}/report`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline whitespace-nowrap"
        aria-label="View report (opens in new tab)"
        data-testid={`rail-report-${row.key}`}
      >
        <FileText className="h-3 w-3 shrink-0" />
        report
      </a>
    );
  }
  if (row.reportPending) {
    // The bundle is written asynchronously after the run completes — a
    // legitimate transient state, distinct from "no report requested".
    return (
      <span
        className="text-xs italic text-muted-foreground/60 whitespace-nowrap"
        title="The run completed with a report requested; the bundle hasn't landed yet."
        data-testid={`rail-report-pending-${row.key}`}
      >
        report…
      </span>
    );
  }
  return null;
}

/**
 * Compact per-attempt activity rail beside the hill-climb chart: every attempt
 * gets identity (chart label), timestamp, score, real run status, report
 * state, and the super-admin Stakwork link — the chart shows THAT the score
 * moved; this shows WHICH attempt moved it and where to open it.
 */
export function RecursionActivityRail({ rows, partial }: RecursionActivityRailProps) {
  const { workspace, isSuperAdmin } = useWorkspace();
  const workspaceSlug = workspace?.slug ?? "";

  if (rows.length === 0) {
    return (
      <div className="text-xs text-muted-foreground/60 italic py-2" data-testid="activity-rail-empty">
        No recorded runs for this task yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0" data-testid="activity-rail">
      <div className="flex-1 overflow-y-auto max-h-[176px] pr-1" role="list" aria-label="Attempt activity">
        {rows.map((row) => (
          <div
            key={row.key}
            role="listitem"
            className="flex items-center gap-2 py-1 border-b border-border/40 last:border-0"
            data-testid={`rail-row-${row.key}`}
          >
            <RowLabel row={row} />
            <RowStatus row={row} />
            <span
              className="text-xs text-muted-foreground whitespace-nowrap truncate min-w-0 flex-1"
              title={row.timestamp ?? undefined}
            >
              {row.timestamp
                ? formatDistanceToNow(new Date(row.timestamp), { addSuffix: true })
                : "—"}
            </span>
            <RowReport row={row} workspaceSlug={workspaceSlug} />
            {row.score && (
              <span className="font-mono text-xs tabular-nums whitespace-nowrap">
                {row.score.passed}/{row.score.total}
              </span>
            )}
            <StakworkRunLink projectId={row.projectId} isSuperAdmin={isSuperAdmin} />
          </div>
        ))}
      </div>
      {partial && (
        <div
          className="text-xs text-amber-600 dark:text-amber-400 pt-1.5"
          data-testid="rail-partial-note"
        >
          list may be incomplete
        </div>
      )}
    </div>
  );
}
