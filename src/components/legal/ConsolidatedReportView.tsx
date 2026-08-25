"use client";

import React from "react";
import { ExternalLink } from "lucide-react";
import type { ConsolidatedReportProjection, RunReportPayload } from "@/lib/run-report/types";
import { PassFailBadge } from "@/components/run-report/RubricLedger";
import { SafeMarkdown } from "@/components/run-report/SafeMarkdown";
import { CriterionMarkers } from "@/components/run-report/CriterionMarkers";
import { SectionErrorBoundary, Kicker, EmptyPanel } from "@/components/run-report/chrome";
import { resolveContested, resolveContestReason } from "@/lib/harvey-lab/eval-normalizers";
import {
  contestedOriginIndex,
  contestedOrigin,
  contestedOriginToken,
  type GraphRubric,
} from "@/lib/harvey-lab/rubric-scoring";

/**
 * Consolidated cross-run report renderer.
 *
 * Renders a rubric-first matrix view comparing pass/fail outcomes across
 * multiple completed runs for the same task. Three sections:
 *
 * 1. Header — task slug, description (SafeMarkdown), source-file link chips
 * 2. Failed-rubric matrix — table: criteria rows × run columns, pass/fail badges
 *    - Only criteria where at least one run failed appear (already filtered server-side)
 *    - Criteria sorted alphabetically (deterministic — done server-side in projectConsolidatedBundle)
 *    - Runs ordered latest-first (timestamp header)
 *    - Sticky first column for horizontal scroll on small screens
 * 3. Per-failing-criterion detail tables — columns per run, rows for matchCriteria,
 *    verdict+reasoning, judgeFlagReason (omitted when all runs have empty string),
 *    and contested/disputed markers
 *
 * SAFETY RULE (matches the rest of this directory):
 *   No dangerouslySetInnerHTML. No raw HTML sinks. All rubric text goes through
 *   SafeMarkdown only.
 */

interface ConsolidatedReportViewProps {
  /**
   * The raw payload from `loadRunReport`. Used to surface load errors.
   */
  payload: RunReportPayload;
  /**
   * The narrowed `ConsolidatedReportProjection` from `payload.projection`.
   * Null when the bundle failed to load or project.
   */
  projection: ConsolidatedReportProjection | null;
  /** Task slug — displayed in the header. */
  taskSlug: string;
  /** Workspace slug — reserved for future authed graph node fetches. */
  workspaceSlug?: string | null;
  /**
   * Graph rubric roster for the task (EvalSet → EvalRequirement).
   * When provided, enables origin-aware contested chip rendering
   * (CONTESTED vs PRIOR CONTEST) in the per-criterion detail tables.
   * Null when the roster is unavailable or hasn't loaded yet.
   */
  graphRubrics?: GraphRubric[] | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRunTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Header section ────────────────────────────────────────────────────────────

function ConsolidatedHeader({
  taskSlug,
  projection,
  slug,
}: {
  taskSlug: string;
  projection: ConsolidatedReportProjection;
  slug?: string | null;
}) {
  return (
    <section className="mb-8" data-testid="consolidated-header">
      <Kicker>Consolidated Report</Kicker>
      <h1 className="text-2xl font-semibold tracking-tight mb-1">
        Cross-run rubric comparison
      </h1>
      <p className="font-mono text-xs text-muted-foreground/70 mb-4">
        {taskSlug}
      </p>

      {projection.taskDescription && (
        <div className="mb-4 max-w-[80ch]">
          <SafeMarkdown text={projection.taskDescription} />
        </div>
      )}

      {projection.sourceFileLinks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {projection.sourceFileLinks.map((url) => {
            // Display just the filename from the URL path for readability.
            const label = url.split("/").pop() ?? url;
            const isDocx = label.toLowerCase().endsWith(".docx");
            return (
              <React.Fragment key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 font-mono text-[10.5px] text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
                  data-testid="source-file-link"
                >
                  📄 {label}
                </a>
                {isDocx && slug && (
                  <a
                    href={`/w/${slug}/documents?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(label)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in Document Editor"
                    className="inline-flex items-center gap-1 rounded-full border border-primary/40 px-2.5 py-0.5 font-mono text-[10.5px] text-primary hover:bg-primary/10 transition-colors"
                    data-testid="open-docx-in-editor"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Edit
                  </a>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Failed-rubric matrix ──────────────────────────────────────────────────────

function FailedRubricMatrix({
  projection,
}: {
  projection: ConsolidatedReportProjection;
}) {
  // Runs are already latest-first from projectConsolidatedBundle.
  const runs = projection.runs;
  // Rubric matrix rows already filtered to "at least one run failed" server-side.
  // Sorted alphabetically by title server-side; trust that order here.
  const rows = projection.rubricMatrix;

  if (rows.length === 0) {
    return (
      <section className="mb-8" data-testid="consolidated-matrix-empty">
        <Kicker>Rubric matrix</Kicker>
        <EmptyPanel label="All criteria passed across all runs — no failures to display." />
      </section>
    );
  }

  return (
    <section className="mb-8" data-testid="consolidated-matrix">
      <Kicker>Failed rubrics</Kicker>
      <h2 className="text-xl font-semibold tracking-tight mb-3">
        Pass / fail matrix
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        {rows.length} criteria with at least one failure across {runs.length} runs.
        Criteria sorted alphabetically; runs ordered latest first.
      </p>
      {/* Horizontal scroll container */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full text-sm" data-testid="rubric-matrix-table">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {/* Sticky criterion column */}
              <th
                className="sticky left-0 z-10 bg-muted/30 text-left px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70 min-w-[220px] border-r border-border"
                scope="col"
              >
                Criterion
              </th>
              {runs.map((run) => (
                <th
                  key={run.runId}
                  className="text-left px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70 min-w-[100px] whitespace-nowrap"
                  scope="col"
                >
                  {formatRunTimestamp(run.timestamp)}
                  <br />
                  <span className="text-[9px] text-muted-foreground/50 normal-case tracking-normal">
                    {run.model}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/10 transition-colors" data-testid="matrix-row">
                {/* Sticky criterion cell */}
                <td
                  className="sticky left-0 z-10 bg-card border-r border-border px-4 py-3 font-mono text-[11px] text-foreground align-top"
                  data-testid="matrix-criterion-title"
                >
                  {row.title}
                </td>
                {runs.map((run) => {
                  const result = row.results.find((r) => r.runId === run.runId);
                  return (
                    <td key={run.runId} className="px-4 py-3 align-top" data-testid="matrix-cell">
                      {result != null ? (
                        <PassFailBadge pass={result.passed} />
                      ) : (
                        <span className="text-muted-foreground/40 font-mono text-[10px]">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Per-criterion detail tables ───────────────────────────────────────────────

function CriterionDetailTable({
  detail,
  runs,
  graphRubrics,
}: {
  detail: ConsolidatedReportProjection["rubricDetails"][number];
  runs: ConsolidatedReportProjection["runs"];
  graphRubrics?: GraphRubric[] | null;
}) {
  // Omit the "Judgement Review" row entirely when all runs have empty judgeFlagReason.
  const hasAnyFlag = detail.perRun.some((p) => p.judgeFlagReason.trim().length > 0);

  // Build the origin index once for all perRun entries in this criterion.
  // When graphRubrics is null/absent, originIndex.available = false → tokens
  // degrade to "unknown" (today's undifferentiated CONTESTED chip), never
  // falsely claiming a roster was consulted.
  const originIdx = contestedOriginIndex(graphRubrics);

  return (
    <div
      className="mb-6 rounded-lg border border-border overflow-hidden"
      data-testid={`criterion-detail-${detail.id}`}
    >
      {/* Criterion heading */}
      <div className="px-4 py-3 border-b border-border bg-muted/20">
        <span className="font-mono text-[10px] text-muted-foreground/60 mr-2">{detail.id}</span>
        <span className="text-[13px] font-semibold">
          <SafeMarkdown text={detail.title} />
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm" data-testid={`criterion-table-${detail.id}`}>
          <thead>
            <tr className="border-b border-border/60 bg-muted/10">
              <th className="sticky left-0 z-10 bg-muted/10 text-left px-4 py-2 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60 min-w-[160px] border-r border-border/60">
                &nbsp;
              </th>
              {runs.map((run) => (
                <th
                  key={run.runId}
                  className="text-left px-4 py-2 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60 min-w-[200px] whitespace-nowrap"
                >
                  {formatRunTimestamp(run.timestamp)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {/* Row 1: Match criteria (same for all runs, shown in first data cell) */}
            <tr data-testid="detail-row-criteria">
              <td className="sticky left-0 z-10 bg-card border-r border-border/60 px-4 py-3 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60 align-top whitespace-nowrap">
                Match criteria
              </td>
              {runs.map((run, i) => (
                <td key={run.runId} className="px-4 py-3 align-top text-[12px] text-muted-foreground">
                  {/* matchCriteria is the same per criterion regardless of run — show in first column only */}
                  {i === 0 ? <SafeMarkdown text={detail.matchCriteria} /> : null}
                </td>
              ))}
            </tr>

            {/* Row 2: Verdict + reasoning per run */}
            <tr data-testid="detail-row-verdict">
              <td className="sticky left-0 z-10 bg-card border-r border-border/60 px-4 py-3 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60 align-top whitespace-nowrap">
                Verdict
              </td>
              {runs.map((run) => {
                const perRun = detail.perRun.find((p) => p.runId === run.runId);
                if (!perRun) {
                  return (
                    <td key={run.runId} className="px-4 py-3 align-top text-muted-foreground/40 font-mono text-[10px]">
                      —
                    </td>
                  );
                }
                return (
                  <td key={run.runId} className="px-4 py-3 align-top">
                    <div className="text-[12px]">
                      <SafeMarkdown
                        text={
                          perRun.reasoning
                            ? `**${perRun.verdict}** — ${perRun.reasoning}`
                            : perRun.verdict
                        }
                      />
                    </div>
                  </td>
                );
              })}
            </tr>

            {/* Row 3: Judgement Review — omitted when all runs have empty judgeFlagReason */}
            {hasAnyFlag && (
              <tr data-testid="detail-row-flag">
                <td className="sticky left-0 z-10 bg-card border-r border-border/60 px-4 py-3 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60 align-top whitespace-nowrap">
                  Judgement Review
                </td>
                {runs.map((run) => {
                  const perRun = detail.perRun.find((p) => p.runId === run.runId);
                  const flagText = perRun?.judgeFlagReason ?? "";
                  return (
                    <td key={run.runId} className="px-4 py-3 align-top text-[12px]">
                      {flagText ? <SafeMarkdown text={flagText} /> : (
                        <span className="text-muted-foreground/40 font-mono text-[10px]">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            )}

            {/* Row 4: Status markers (contested only; disputed is run-level, not in consolidated bundle) */}
            <tr data-testid="detail-row-status">
              <td className="sticky left-0 z-10 bg-card border-r border-border/60 px-4 py-3 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60 align-top whitespace-nowrap">
                Status
              </td>
              {runs.map((run) => {
                const perRun = detail.perRun.find((p) => p.runId === run.runId);
                if (!perRun) {
                  return (
                    <td key={run.runId} className="px-4 py-3 align-top">
                      <span className="text-muted-foreground/40 font-mono text-[10px]">—</span>
                    </td>
                  );
                }
                // Narrow the wire value through resolveContested to get a clean
                // boolean, then build a minimal ScorableCriterion-shaped object
                // so contestedOrigin can derive provenance.
                const isContested = resolveContested({ contested: perRun.criterionContested });
                const fakeScorableCriterion = {
                  id: detail.id,
                  title: detail.title,
                  contested: isContested,
                  verdict: perRun.verdict,
                };
                const originInfo = isContested
                  ? contestedOrigin(fakeScorableCriterion, originIdx)
                  : null;
                const token = originInfo ? contestedOriginToken(originInfo) : null;
                return (
                  <td key={run.runId} className="px-4 py-3 align-top">
                    <CriterionMarkers
                      contested={isContested}
                      disputed={false}
                      contestedOrigin={token ?? undefined}
                      contestedReason={resolveContestReason(fakeScorableCriterion)}
                      contestedVerdict={perRun.verdict}
                      contestedMatchedBy={originInfo?.matchedBy}
                    />
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export function ConsolidatedReportView({
  payload,
  projection,
  taskSlug,
  workspaceSlug,
  graphRubrics,
}: ConsolidatedReportViewProps) {
  // Handle load / projection errors.
  if (!payload.hasReport) {
    return (
      <div className="py-16 text-center" data-testid="consolidated-no-report">
        <p className="text-muted-foreground text-sm">No report bundle available for this run.</p>
      </div>
    );
  }

  if (payload.error || !projection) {
    return (
      <div className="py-16 text-center" data-testid="consolidated-error">
        <p className="text-destructive text-sm">
          {payload.error === "url_rejected"
            ? "Report URL was rejected by the security guard."
            : "The consolidated report could not be loaded. It may still be generating."}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto" data-testid="consolidated-report-view">
      {/* Section 1: Header */}
      <SectionErrorBoundary>
        <ConsolidatedHeader taskSlug={taskSlug} projection={projection} slug={workspaceSlug} />
      </SectionErrorBoundary>

      {/* Section 2: Failed-rubric matrix */}
      <SectionErrorBoundary>
        <FailedRubricMatrix projection={projection} />
      </SectionErrorBoundary>

      {/* Section 3: Per-criterion detail tables */}
      {projection.rubricDetails.length > 0 && (
        <>
          <Kicker>Per-criterion detail</Kicker>
          <h2 className="text-xl font-semibold tracking-tight mb-4">
            Criterion breakdown
          </h2>
          {projection.rubricDetails.map((detail) => (
            <SectionErrorBoundary key={detail.id}>
              <CriterionDetailTable
                detail={detail}
                runs={projection.runs}
                graphRubrics={graphRubrics}
              />
            </SectionErrorBoundary>
          ))}
        </>
      )}
    </div>
  );
}
