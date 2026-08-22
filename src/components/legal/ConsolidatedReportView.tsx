"use client";

import React, { useMemo } from "react";
import type { RunReportPayload, ConsolidatedReportProjection, RubricMatrixRow, RubricDetailBlock, RunMeta } from "@/lib/run-report/types";
import { SafeMarkdown } from "@/components/run-report/SafeMarkdown";
import { PassFailBadge } from "@/components/run-report/RubricLedger";
import { CriterionMarkers } from "@/components/run-report/CriterionMarkers";
import { SectionErrorBoundary } from "@/components/run-report/chrome";

/**
 * Cross-run rubric matrix report renderer.
 *
 * Accepts a RunReportPayload whose projection is a ConsolidatedReportProjection
 * (discriminated via `consolidated: true`). Renders:
 *   1. A header with task slug, description, and source-file links.
 *   2. A failed-rubric matrix table (criteria rows × run columns).
 *   3. Per-failing-criterion detail tables with per-run verdict/reasoning.
 *
 * All text content rendered via SafeMarkdown — no dangerouslySetInnerHTML,
 * no raw HTML sinks anywhere in this component.
 */

interface ConsolidatedReportViewProps {
  payload: RunReportPayload;
  taskTitle: string;
  workspaceSlug: string;
}

/** Format epoch-ms as a short human-readable timestamp for column headers. */
function formatRunTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── ConsolidatedHeader ────────────────────────────────────────────────────────

function ConsolidatedHeader({
  taskTitle,
  projection,
}: {
  taskTitle: string;
  projection: ConsolidatedReportProjection;
}) {
  return (
    <section className="mb-8" data-testid="consolidated-header">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70 mb-1">
        <span className="text-muted-foreground/40">§ </span>
        Consolidated Report
      </div>
      <h1 className="text-2xl font-semibold tracking-tight mb-3">{taskTitle}</h1>

      {projection.taskDescription && (
        <div className="mb-4 max-w-prose" data-testid="task-description">
          <SafeMarkdown text={projection.taskDescription} />
        </div>
      )}

      {projection.sourceFileLinks.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="source-file-links">
          {projection.sourceFileLinks.map((href, i) => {
            const label = href.split("/").pop() ?? href;
            return (
              <a
                key={i}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 font-mono text-[10.5px] text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
                data-testid="source-file-link"
              >
                📄 {label}
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── FailedRubricMatrix ────────────────────────────────────────────────────────

function FailedRubricMatrix({
  rubricMatrix,
  runs,
}: {
  rubricMatrix: RubricMatrixRow[];
  runs: RunMeta[];
}) {
  // Only show criteria where at least one run failed.
  const failingRows = useMemo(
    () =>
      rubricMatrix
        .filter((row) => row.results.some((r) => !r.passed))
        .sort((a, b) => a.title.localeCompare(b.title)), // alphabetical, deterministic
    [rubricMatrix],
  );

  if (failingRows.length === 0) {
    return (
      <section className="mb-8" data-testid="rubric-matrix-section">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70 mb-2">
          <span className="text-muted-foreground/40">§ </span>
          Rubric Matrix
        </div>
        <p className="text-sm text-muted-foreground italic">All criteria passed across all runs.</p>
      </section>
    );
  }

  return (
    <section className="mb-8" data-testid="rubric-matrix-section">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70 mb-2">
        <span className="text-muted-foreground/40">§ </span>
        Rubric Matrix — {failingRows.length} criteria failing in ≥1 run
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm" data-testid="rubric-matrix-table">
          <thead>
            <tr className="border-b border-border">
              {/* Sticky criterion column */}
              <th
                className="sticky left-0 z-10 bg-black text-left font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70 px-3 py-2 min-w-[180px] max-w-[240px] whitespace-normal"
                scope="col"
              >
                Criterion
              </th>
              {runs.map((run) => (
                <th
                  key={run.runId}
                  className="text-center font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70 px-3 py-2 whitespace-nowrap"
                  scope="col"
                  title={`Run ${run.runId} · Model: ${run.model}`}
                >
                  {formatRunTimestamp(run.timestamp)}
                  <div className="text-[9px] text-muted-foreground/50 mt-0.5 font-normal normal-case tracking-normal">
                    {run.model || "—"}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {failingRows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/10 transition-colors">
                <td
                  className="sticky left-0 z-10 bg-black px-3 py-2 font-mono text-[11px] text-muted-foreground/90 align-top min-w-[180px] max-w-[240px] whitespace-normal"
                  data-testid={`matrix-criterion-${row.id}`}
                >
                  <span className="text-muted-foreground/40 mr-1">{row.id}</span>
                  {row.title}
                </td>
                {runs.map((run) => {
                  const result = row.results.find((r) => r.runId === run.runId);
                  return (
                    <td
                      key={run.runId}
                      className="text-center px-3 py-2 align-middle"
                      data-testid={`matrix-cell-${row.id}-${run.runId}`}
                    >
                      {result != null ? (
                        <PassFailBadge passed={result.passed} />
                      ) : (
                        <span className="text-muted-foreground/40 font-mono text-[11px]">—</span>
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

// ── CriterionDetailTable ──────────────────────────────────────────────────────

function CriterionDetailTable({
  criterion,
  runs,
}: {
  criterion: RubricDetailBlock;
  runs: RunMeta[];
}) {
  // Omit the Judgement Review row when all runs have an empty judgeFlagReason.
  const hasJudgeReview = criterion.perRun.some((p) => p.judgeFlagReason.trim() !== "");

  return (
    <div className="mb-8" data-testid={`criterion-detail-${criterion.id}`}>
      <div className="mb-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70 mb-1">
          <span className="text-muted-foreground/40">§ </span>
          <span className="text-muted-foreground/50">{criterion.id}</span>
        </div>
        <div className="text-[15px] font-semibold">
          <SafeMarkdown text={criterion.title} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-border rounded-lg overflow-hidden">
          <thead>
            <tr className="border-b border-border bg-muted/20">
              <th
                className="text-left font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70 px-3 py-2 min-w-[120px]"
                scope="col"
              >
                Field
              </th>
              {runs.map((run) => (
                <th
                  key={run.runId}
                  className="text-left font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70 px-3 py-2 whitespace-nowrap"
                  scope="col"
                  title={`Run ${run.runId} · Model: ${run.model}`}
                >
                  {formatRunTimestamp(run.timestamp)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {/* Match criteria — same for all runs, show once per run column */}
            <tr className="hover:bg-muted/10 transition-colors">
              <td className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70 align-top">
                Match criteria
              </td>
              {runs.map((run) => {
                const perRun = criterion.perRun.find((p) => p.runId === run.runId);
                return (
                  <td key={run.runId} className="px-3 py-2 text-[12.5px] align-top" data-testid={`detail-match-${criterion.id}-${run.runId}`}>
                    {perRun ? (
                      <SafeMarkdown text={criterion.matchCriteria} />
                    ) : (
                      <span className="text-muted-foreground/40 font-mono text-[11px]">—</span>
                    )}
                  </td>
                );
              })}
            </tr>

            {/* Verdict & reasoning */}
            <tr className="hover:bg-muted/10 transition-colors">
              <td className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70 align-top">
                Verdict & reasoning
              </td>
              {runs.map((run) => {
                const perRun = criterion.perRun.find((p) => p.runId === run.runId);
                return (
                  <td key={run.runId} className="px-3 py-2 text-[12.5px] align-top" data-testid={`detail-verdict-${criterion.id}-${run.runId}`}>
                    {perRun ? (
                      <SafeMarkdown text={`${perRun.verdict} — ${perRun.reasoning}`} />
                    ) : (
                      <span className="text-muted-foreground/40 font-mono text-[11px]">—</span>
                    )}
                  </td>
                );
              })}
            </tr>

            {/* Judgement Review — omit row if all runs have empty judgeFlagReason */}
            {hasJudgeReview && (
              <tr className="hover:bg-muted/10 transition-colors">
                <td className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70 align-top">
                  Judgement Review
                </td>
                {runs.map((run) => {
                  const perRun = criterion.perRun.find((p) => p.runId === run.runId);
                  return (
                    <td key={run.runId} className="px-3 py-2 text-[12.5px] align-top" data-testid={`detail-judge-${criterion.id}-${run.runId}`}>
                      {perRun?.judgeFlagReason ? (
                        <SafeMarkdown text={perRun.judgeFlagReason} />
                      ) : (
                        <span className="text-muted-foreground/40 font-mono text-[11px]">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            )}

            {/* Status — contested badge; disputed is run-level, not in consolidated bundle */}
            <tr className="hover:bg-muted/10 transition-colors">
              <td className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70 align-top">
                Status
              </td>
              {runs.map((run) => {
                const perRun = criterion.perRun.find((p) => p.runId === run.runId);
                return (
                  <td key={run.runId} className="px-3 py-2 align-top" data-testid={`detail-status-${criterion.id}-${run.runId}`}>
                    {perRun ? (
                      <CriterionMarkers
                        contested={perRun.criterionContested}
                        disputed={false}
                      />
                    ) : (
                      <span className="text-muted-foreground/40 font-mono text-[11px]">—</span>
                    )}
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

// ── ConsolidatedReportView ─────────────────────────────────────────────────────

export function ConsolidatedReportView({
  payload,
  taskTitle,
  workspaceSlug: _workspaceSlug,
}: ConsolidatedReportViewProps) {
  const projection = payload.projection;

  // Narrow to ConsolidatedReportProjection via the discriminant.
  if (!projection || !("consolidated" in projection) || !projection.consolidated) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        {payload.error === "unavailable"
          ? "The consolidated report could not be loaded — the bundle is unavailable."
          : payload.error === "url_rejected"
            ? "The consolidated report URL was rejected by the security guard."
            : "No consolidated report data available."}
      </div>
    );
  }

  const p = projection as ConsolidatedReportProjection;

  // Runs sorted latest-first (the projection contract; re-assert here for safety).
  const runs = useMemo(
    () => [...p.runs].sort((a, b) => b.timestamp - a.timestamp),
    [p.runs],
  );

  // rubricDetails: only criteria where at least one run failed — already
  // guaranteed by the projection contract, but filter defensively.
  const failingDetails = useMemo(
    () =>
      p.rubricDetails.filter((d) =>
        d.perRun.some((r) => r.verdict.toUpperCase() !== "PASS"),
      ),
    [p.rubricDetails],
  );

  return (
    <div data-testid="consolidated-report-view">
      <SectionErrorBoundary>
        <ConsolidatedHeader taskTitle={taskTitle} projection={p} />
      </SectionErrorBoundary>

      <SectionErrorBoundary>
        <FailedRubricMatrix rubricMatrix={p.rubricMatrix} runs={runs} />
      </SectionErrorBoundary>

      {failingDetails.map((criterion) => (
        <SectionErrorBoundary key={criterion.id}>
          <CriterionDetailTable criterion={criterion} runs={runs} />
        </SectionErrorBoundary>
      ))}
    </div>
  );
}
