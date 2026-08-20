"use client";

import { formatDistanceToNow } from "date-fns";
import { FileText, Loader2, Repeat } from "lucide-react";
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
const STATUS_STYLES: Record<string, { dot: string; text: string; label: string; wordy?: boolean }> = {
  PENDING: { dot: "bg-gray-400", text: "text-muted-foreground", label: "pending" },
  IN_PROGRESS: { dot: "bg-blue-500", text: "text-blue-700 dark:text-blue-300", label: "running" },
  COMPLETED: { dot: "bg-green-600", text: "text-green-700 dark:text-green-400", label: "completed" },
  // Exceptional states keep their word — a red dot alone under-sells a failure.
  ERROR: { dot: "bg-red-500", text: "text-red-700 dark:text-red-400", label: "error", wordy: true },
  FAILED: { dot: "bg-red-500", text: "text-red-700 dark:text-red-400", label: "failed", wordy: true },
  HALTED: { dot: "bg-gray-400", text: "text-muted-foreground", label: "halted" },
};

/**
 * Icons carry the state: spinner = running, colored dot = terminal, em dash =
 * graph-only. The word rides in the tooltip; only failure states spell it out.
 */
function RowStatus({ row }: { row: AttemptRailRow }) {
  if (!row.status) {
    return (
      <span
        className="text-xs text-muted-foreground/60"
        title="No StakworkRun recorded for this attempt — it exists in the graph only."
        data-testid={`rail-status-${row.key}`}
        data-status="none"
      >
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
      title={style.label}
      data-testid={`rail-status-${row.key}`}
      data-status={row.status}
    >
      {row.inFlight ? (
        <Loader2 className="h-3 w-3 animate-spin shrink-0" aria-label={style.label} />
      ) : (
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${style.dot}`} aria-label={style.label} />
      )}
      {style.wordy && style.label}
    </span>
  );
}

/**
 * Row identity: the chart label when charted; the recursion-loop icon for
 * run-only rows (in-flight pipeline work with no dot yet) — the stage name
 * rides in the tooltip rather than cluttering the rail.
 */
function RowLabel({ row }: { row: AttemptRailRow }) {
  if (row.label) {
    return (
      <span className="font-mono text-xs font-medium tabular-nums">{row.label}</span>
    );
  }
  const stage =
    row.runType === "recursion"
      ? "recursion loop — fix proposal"
      : row.runType === "eval"
        ? "recursion loop — failure analysis"
        : "run";
  return (
    <span title={stage} data-testid={`rail-pipeline-${row.key}`}>
      <Repeat className="h-3 w-3 text-teal-700 dark:text-teal-400" aria-label={stage} />
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
  // Graph-node fallback: the eval workflow writes report_url onto the
  // EvalTriggerOutput node itself, so recursion attempts that never joined a
  // StakworkRun row (em-dash status) still get their report link.
  if (row.reportUrl) {
    return (
      <a
        href={row.reportUrl}
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
        {/* One shared grid template so every column lines up across rows:
            label | status icon | relative time | trailing links + score. */}
        {rows.map((row) => (
          <div
            key={row.key}
            role="listitem"
            className="grid grid-cols-[2.75rem_3.5rem_minmax(0,1fr)_auto] items-center gap-x-2 py-1 border-b border-border/40 last:border-0"
            data-testid={`rail-row-${row.key}`}
          >
            <RowLabel row={row} />
            <RowStatus row={row} />
            <span
              className="text-xs text-muted-foreground whitespace-nowrap truncate"
              title={row.timestamp ?? undefined}
            >
              {row.timestamp
                ? formatDistanceToNow(new Date(row.timestamp), { addSuffix: true })
                : "—"}
            </span>
            <span className="flex items-center gap-2 justify-end">
              <RowReport row={row} workspaceSlug={workspaceSlug} />
              {row.score && (
                <span className="font-mono text-xs tabular-nums whitespace-nowrap">
                  {row.score.passed}/{row.score.total}
                </span>
              )}
              <StakworkRunLink projectId={row.projectId} isSuperAdmin={isSuperAdmin} />
            </span>
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
