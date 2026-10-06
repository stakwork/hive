"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown, FileText, Loader2, Repeat } from "lucide-react";
import { StakworkRunLink } from "@/components/legal/StakworkRunLink";
import { FixSnapshotDiffControl } from "@/components/legal/FixSnapshotPanel";
import { useWorkspace } from "@/hooks/useWorkspace";
import { canReadRunReport } from "@/lib/run-report/types";
import type { AttemptRailRow } from "@/hooks/useEvalRunHistory";

interface RecursionActivityRailProps {
  rows: AttemptRailRow[];
  /** The graph walk was truncated — the list may be missing attempts. */
  partial: boolean;
  /** Task slug of the card's EvalSet — carried on attempt-report links for title/rubrics. */
  taskSlug?: string;
  /** Chart-driven highlight: the row whose attemptIndex matches lights up. */
  activeAttemptIndex?: number | null;
  /** Fires with a hovered row's attemptIndex (null on leave) for chart sync. */
  onAttemptHover?: (index: number | null) => void;
}

/**
 * Resolve one rail row's report link — the run-report page when a StakworkRun
 * joined, else the attempt-report page off the graph node's report ref (role
 * gated, and always routed through a viewer page, never the raw bundle URL).
 * Shared with the hill-climb chart so a dot and its rail row open the same
 * place. Null = no report to open.
 */
export function attemptReportHref(
  row: AttemptRailRow,
  workspaceSlug: string,
  taskSlug: string | undefined,
  canReadReports: boolean,
): string | null {
  if (!workspaceSlug) return null;
  if (row.hasReport && row.runId) {
    return `/w/${workspaceSlug}/legal/benchmarks/runs/${row.runId}/report`;
  }
  if (row.graphReportRef && canReadReports) {
    const taskParam = taskSlug ? `?task=${encodeURIComponent(taskSlug)}` : "";
    return `/w/${workspaceSlug}/legal/benchmarks/attempts/${encodeURIComponent(row.graphReportRef)}/report${taskParam}`;
  }
  return null;
}

/**
 * Status rendering: a small dot + text, deliberately more compact than the
 * Runs tab's RunnerStatusBadge — the rail is one-third of a card, so every
 * row must stay on one line. A null status is a graph-only row (the attempt
 * exists in Jarvis but no StakworkRun matched) and renders as an em dash
 * rather than pretending to know.
 */
const STATUS_STYLES: Record<string, { text: string; label: string; wordy?: boolean }> = {
  PENDING: { text: "text-muted-foreground", label: "pending" },
  IN_PROGRESS: { text: "text-blue-700 dark:text-blue-300", label: "running" },
  COMPLETED: { text: "text-green-700 dark:text-green-400", label: "completed" },
  // Exceptional states keep their word — a quiet row under-sells a failure.
  ERROR: { text: "text-red-700 dark:text-red-400", label: "error", wordy: true },
  FAILED: { text: "text-red-700 dark:text-red-400", label: "failed", wordy: true },
  HALTED: { text: "text-muted-foreground", label: "halted" },
};

/**
 * Row identity with status folded in — the dedicated status column earned its
 * width badly: a green dot next to a score and report link said nothing, and
 * graph-only rows got a confusing em dash. Now the label slot carries the only
 * markers that are informative: an inline spinner while the attempt runs, the
 * word (in red) on ERROR/FAILED, and "which pipeline ran this" in the tooltip.
 * A completed or graph-only row is just its label.
 */
function RowIdentity({ row }: { row: AttemptRailRow }) {
  const style = row.status
    ? (STATUS_STYLES[row.status] ?? {
        text: "text-muted-foreground",
        label: row.status.toLowerCase(),
      })
    : null;
  const statusTitle = style
    ? row.runType
      ? `${style.label} · ${row.runType} pipeline`
      : style.label
    : undefined;

  if (row.label) {
    return (
      <span className="flex items-center gap-1.5 min-w-0" title={statusTitle}>
        <span className="font-mono text-xs font-medium tabular-nums">{row.label}</span>
        {row.inFlight && style && (
          <Loader2
            className="h-3 w-3 animate-spin shrink-0 text-blue-600 dark:text-blue-400"
            aria-label={style.label}
            data-testid={`rail-status-${row.key}`}
          />
        )}
        {!row.inFlight && style?.wordy && (
          <span
            className={`text-[10.5px] ${style.text}`}
            data-testid={`rail-status-${row.key}`}
            data-status={row.status}
          >
            {style.label}
          </span>
        )}
      </span>
    );
  }
  const stage =
    row.runType === "recursion"
      ? "recursion loop — fix proposal"
      : row.runType === "eval"
        ? "recursion loop — failure analysis"
        : "run";
  // Run-only rows are in-flight by construction — the loop glyph itself spins
  // so "the recursion pipeline is working right now" reads without a column.
  return (
    <span title={`${stage}${statusTitle ? ` — ${statusTitle}` : ""}`} data-testid={`rail-pipeline-${row.key}`}>
      <Repeat
        className={`h-3 w-3 text-teal-700 dark:text-teal-400 ${row.inFlight ? "animate-spin" : ""}`}
        aria-label={stage}
      />
    </span>
  );
}

function RowReport({
  row,
  workspaceSlug,
  taskSlug,
  canReadReports,
}: {
  row: AttemptRailRow;
  workspaceSlug: string;
  taskSlug?: string;
  canReadReports: boolean;
}) {
  // Run-report link when a StakworkRun joined; graph-node fallback otherwise —
  // the eval workflow writes report_url onto the EvalTriggerOutput node, so
  // recursion attempts that never joined a run row (em-dash status) still link
  // the attempt-report page. Resolution lives in attemptReportHref (shared
  // with the chart's clickable dots); both paths route through a viewer page,
  // never the raw S3 URL, and the graph fallback is role-gated so viewer-tier
  // members don't get a link that 404s.
  const href = attemptReportHref(row, workspaceSlug, taskSlug, canReadReports);
  if (href) {
    return (
      <a
        href={href}
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
export function RecursionActivityRail({
  rows,
  partial,
  taskSlug,
  activeAttemptIndex,
  onAttemptHover,
}: RecursionActivityRailProps) {
  const { workspace, role, isSuperAdmin } = useWorkspace();
  const workspaceSlug = workspace?.slug ?? "";
  const canReadReports = canReadRunReport(role ?? "");

  // Overflow cue: a long series scrolls inside the capped rail, and a hard
  // clip at the last visible row reads as "that's all of them". Track whether
  // rows are hidden below the fold and render a fade + chevron over the clip
  // edge until the reader scrolls to the bottom.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  const updateOverflow = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }, []);
  useEffect(() => {
    updateOverflow();
  }, [rows.length, updateOverflow]);

  if (rows.length === 0) {
    return (
      <div className="text-xs text-muted-foreground/60 italic py-2" data-testid="activity-rail-empty">
        No recorded runs for this task yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0" data-testid="activity-rail">
      <div className="relative min-h-0">
        <div
          ref={scrollerRef}
          onScroll={updateOverflow}
          className="overflow-y-auto max-h-[176px] pr-1"
          role="list"
          aria-label="Attempt activity"
        >
        {/* One shared grid template so every column lines up across rows:
            identity (label + inline status) | relative time | trailing links. */}
        {rows.map((row) => (
          <div
            key={row.key}
            role="listitem"
            className={[
              "grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-2 py-1 px-1 -mx-1 rounded-sm border-b border-border/40 last:border-0 transition-colors",
              // Chart-hover sync: the hovered dot's row lights up here.
              row.attemptIndex != null && row.attemptIndex === activeAttemptIndex
                ? "bg-muted/60"
                : "",
            ].join(" ")}
            onMouseEnter={
              onAttemptHover && row.attemptIndex != null
                ? () => onAttemptHover(row.attemptIndex)
                : undefined
            }
            onMouseLeave={onAttemptHover ? () => onAttemptHover(null) : undefined}
            data-testid={`rail-row-${row.key}`}
          >
            <RowIdentity row={row} />
            <span
              className="text-xs text-muted-foreground whitespace-nowrap truncate"
              title={row.timestamp ?? undefined}
            >
              {row.timestamp
                ? formatDistanceToNow(new Date(row.timestamp), { addSuffix: true })
                : "—"}
            </span>
            <span className="flex items-center gap-2 justify-end">
              {/* Sibling diffs: render one icon per sibling, cap at 3 then show +K */}
              {row.fixSnapshots.length > 0 && (() => {
                const MAX_VISIBLE = 3;
                const visible = row.fixSnapshots.slice(0, MAX_VISIBLE);
                const overflow = row.fixSnapshots.length - MAX_VISIBLE;
                const siblingLabel = row.siblingCount > 1 ? `${row.siblingCount} fixes` : null;
                return (
                  <>
                    {siblingLabel && (
                      <span className="text-[10px] text-muted-foreground/70 whitespace-nowrap" data-testid={`rail-sibling-label-${row.key}`}>
                        {siblingLabel}
                      </span>
                    )}
                    {visible.map((snapshot, i) => (
                      <FixSnapshotDiffControl
                        key={snapshot.ref_id ?? i}
                        fix={snapshot}
                        workspaceSlug={workspaceSlug || null}
                        testId={row.fixSnapshots.length === 1 ? `rail-fix-snapshot-${row.key}` : `rail-fix-snapshot-${row.key}-${i}`}
                      />
                    ))}
                    {overflow > 0 && (
                      <span className="text-[10px] text-muted-foreground/70 tabular-nums whitespace-nowrap" data-testid={`rail-fix-overflow-${row.key}`}>
                        +{overflow}
                      </span>
                    )}
                  </>
                );
              })()}
              <RowReport
                row={row}
                workspaceSlug={workspaceSlug}
                taskSlug={taskSlug}
                canReadReports={canReadReports}
              />
              {row.score && (
                <span className="font-mono text-xs tabular-nums whitespace-nowrap">
                  {row.score.passed}/{row.score.total}
                </span>
              )}
              <StakworkRunLink projectId={row.projectId} isSuperAdmin={isSuperAdmin} showForAll={row.projectId != null} />
            </span>
          </div>
        ))}
        </div>
        {/* Fade + chevron over the clip edge while rows hide below the fold —
            decorative (aria-hidden): the scrollbar and scroll behavior are the
            functional affordance; this makes the cut-off visible. */}
        {moreBelow && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 flex h-8 items-end justify-center bg-gradient-to-t from-card to-transparent"
            aria-hidden="true"
            data-testid="rail-more-below"
          >
            <ChevronDown className="h-3.5 w-3.5 mb-0.5 text-muted-foreground/70" />
          </div>
        )}
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
