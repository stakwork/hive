/**
 * Offline SSR renderer for the export routes.
 *
 * Produces self-contained static markup by rendering the existing report
 * view components through `renderToStaticMarkup` with offline-safe adapter
 * props that replace every server-dependent leaf:
 *
 *   - RunReportView   → used for RUNNER/EVAL/RECURSION runs AND attempt reports
 *   - ConsolidatedReportView → used for CONSOLIDATED runs
 *
 * The adapters live in offline-adapters.tsx. This module wires them in as
 * component-prop overrides rather than monkey-patching imports, so the live
 * components ship UNMODIFIED.
 *
 * Two client-component hooks cannot fire during SSR (`useUserTimezone`,
 * `useState`). We supply a UTC fallback timezone and pre-compute values that
 * the hooks would have derived so the render is deterministic and zero-error.
 *
 * renderToStaticMarkup is called inside a try/catch — any rendering exception
 * produces a minimal fallback HTML fragment with the error message so the ZIP
 * is always a valid file even when the SSR step fails.
 */

import React from "react";
import { escapeForInlineScript } from "./json-escape";
import { OfflineViewInGraphLink, OfflineSourceFileLink } from "./offline-adapters";
import type { OfflineRenderContext } from "./offline-adapters";
import type { RunReportPayload, RunReportProjection, ConsolidatedReportProjection } from "@/lib/run-report/types";
import type { GraphRubric } from "@/lib/harvey-lab/rubric-scoring";
import type { FixSnapshotEntry } from "@/types/legal";
import { buildChainModel } from "@/lib/run-report/chain";
import { computeBenchmarkScore, rubricBreakdown, contestedOriginIndex, contestedOrigin, contestedOriginToken } from "@/lib/harvey-lab/rubric-scoring";
import { scorableFromRubricRow } from "@/lib/run-report/rubric-adapter";
import { RubricBreakdownStrip } from "@/components/harvey-lab/RubricBreakdownStrip";
import { contestedNotice } from "@/lib/harvey-lab/contested-copy";
import { resolveContested, resolveContestReason } from "@/lib/harvey-lab/eval-normalizers";
import type { PackedDocument } from "./pack-documents";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RenderRunOfflineOpts {
  payload: RunReportPayload;
  taskTitle: string;
  graphRubrics?: GraphRubric[] | null;
  fixSnapshots?: FixSnapshotEntry[] | null;
  context: OfflineRenderContext;
}

export interface RenderConsolidatedOfflineOpts {
  payload: RunReportPayload;
  taskSlug: string;
  packedDocuments: PackedDocument[];
  context: OfflineRenderContext;
}

export interface OfflineRenderResult {
  /** SSR'd HTML fragment (no <html>/<head>/<body> wrapper). */
  markup: string;
  /** Whether the render succeeded or fell back to the error fragment. */
  ok: boolean;
}

// ── Internal static components ────────────────────────────────────────────────

/**
 * Offline StateNotice — mirrors the live RunReportView's StateNotice exactly
 * but as a plain static element (no hooks, no client). We reproduce it here
 * rather than importing from RunReportView because that file has `"use client"`.
 */
function OfflineStateNotice({
  title,
  body,
  testId,
}: {
  title: string;
  body: string;
  testId: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-10 text-center"
      data-testid={testId}
    >
      <div className="text-sm font-medium">{title}</div>
      <p className="text-sm text-muted-foreground max-w-md">{body}</p>
    </div>
  );
}

// ── Run / attempt report renderer ─────────────────────────────────────────────

/**
 * Renders a RUNNER/EVAL/RECURSION or attempt report for offline export.
 *
 * Because RunReportView is a client component with hooks, we re-implement the
 * static view inline here using the same components but without the hooks that
 * require a browser environment (useState, useUserTimezone). All data that
 * the live component would derive from hooks is passed in or computed here.
 */
export async function renderRunOffline(opts: RenderRunOfflineOpts): Promise<OfflineRenderResult> {
  const { payload, taskTitle, graphRubrics, fixSnapshots, context } = opts;
  // Dynamic import keeps react-dom/server out of the static webpack graph so
  // Next.js does not reject the module when bundling API routes.
  const { renderToStaticMarkup } = await import("react-dom/server");

  try {
    const markup = renderToStaticMarkup(
      <OfflineRunReportDocument
        payload={payload}
        taskTitle={taskTitle}
        graphRubrics={graphRubrics ?? null}
        fixSnapshots={fixSnapshots ?? null}
        context={context}
      />,
    );
    return { markup, ok: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const fallback = renderToStaticMarkup(
      <div className="p-8 text-center" data-testid="run-report-render-error">
        <p className="text-sm font-medium">Report rendering encountered an error</p>
        <p className="text-xs text-muted-foreground mt-1">
          The report data is available in bundle.json in this archive.
        </p>
        <pre className="text-xs text-muted-foreground mt-2 text-left overflow-auto max-w-lg mx-auto">
          {errMsg}
        </pre>
      </div>,
    );
    return { markup: fallback, ok: false };
  }
}

// ── Consolidated report renderer ──────────────────────────────────────────────

/**
 * Renders a CONSOLIDATED report for offline export.
 *
 * ConsolidatedReportView is a client component. We re-implement the static
 * view inline with the same structure but offline-adapted source file links.
 */
export async function renderConsolidatedOffline(
  opts: RenderConsolidatedOfflineOpts,
): Promise<OfflineRenderResult> {
  const { payload, taskSlug, packedDocuments, context } = opts;
  const { renderToStaticMarkup } = await import("react-dom/server");

  // Build packed URL → entry name map for link rewriting.
  const packedByUrl = new Map(packedDocuments.map((d) => [d.url, d.entryName]));
  const mergedContext: OfflineRenderContext = {
    ...context,
    packedDocsByUrl: packedByUrl,
  };

  try {
    const markup = renderToStaticMarkup(
      <OfflineConsolidatedDocument
        payload={payload}
        taskSlug={taskSlug}
        context={mergedContext}
      />,
    );
    return { markup, ok: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const fallback = renderToStaticMarkup(
      <div className="p-8 text-center" data-testid="consolidated-render-error">
        <p className="text-sm font-medium">Report rendering encountered an error</p>
        <p className="text-xs text-muted-foreground mt-1">
          The report data is available in bundle.json in this archive.
        </p>
        <pre className="text-xs text-muted-foreground mt-2 text-left overflow-auto max-w-lg mx-auto">
          {errMsg}
        </pre>
      </div>,
    );
    return { markup: fallback, ok: false };
  }
}

// ── Offline run report document ───────────────────────────────────────────────

/**
 * Static re-implementation of RunReportView for offline SSR.
 *
 * Key differences from the live component:
 *   - No hooks (useState, useUserTimezone) — UTC timezone, no open doc state
 *   - Concept chips are static text (no click handlers that fire fetch)
 *   - ViewInGraphLink → OfflineViewInGraphLink (static chip)
 *   - DocumentViewerModal omitted (no dialog state)
 *   - Node peek containers rendered from prefetched map (or omitted)
 */
function OfflineRunReportDocument({
  payload,
  taskTitle,
  graphRubrics,
  fixSnapshots: _fixSnapshots,
  context,
}: {
  payload: RunReportPayload;
  taskTitle: string;
  graphRubrics: GraphRubric[] | null;
  fixSnapshots: FixSnapshotEntry[] | null;
  context: OfflineRenderContext;
}) {
  // ── Error / no-report states ─────────────────────────────────────────────
  if (payload.error === "unavailable") {
    return (
      <div className="max-w-[1080px] mx-auto">
        <OfflineStateNotice
          title="Report couldn't be loaded"
          body="The report bundle exists for this run but couldn't be fetched from storage. It may have been moved or deleted."
          testId="run-report-state-unavailable"
        />
      </div>
    );
  }

  if (payload.error === "url_rejected") {
    return (
      <OfflineStateNotice
        title="Report location not permitted"
        body="The report bundle for this run is stored at a location that is not permitted by this deployment's security policy."
        testId="run-report-state-url-rejected"
      />
    );
  }

  const runProjection =
    payload.projection && !("consolidated" in payload.projection && payload.projection.consolidated)
      ? (payload.projection as RunReportProjection)
      : null;

  if (!payload.hasReport || !runProjection) {
    return (
      <OfflineStateNotice
        title="No report for this run"
        body="This run didn't produce a report bundle."
        testId="run-report-state-absent"
      />
    );
  }

  const chain = buildChainModel(runProjection);
  // Use scorableFromRubricRow to carry judge-dispute fields through to
  // rubricBreakdown (same adapter used by the live ReportHeader).
  const scorableCriteria = runProjection.rubricRows.map(scorableFromRubricRow);
  const score = computeBenchmarkScore({
    criteriaResults: scorableCriteria,
    graphRubrics,
  });
  const breakdown = rubricBreakdown({ score, criteria: scorableCriteria, graphRubrics });

  const passCount = score ? score.passed : runProjection.stats.passCount;
  const denominator = score ? score.denominator : runProjection.stats.rubricCount;
  const allPassed = score
    ? score.allPass
    : runProjection.stats.failCount === 0 && runProjection.stats.passCount !== null;

  const cfg = runProjection.pageData.config as Record<string, unknown>;
  const slug = typeof cfg.task_slug === "string" ? cfg.task_slug : "—";
  const goal = typeof cfg.task_goal === "string" ? cfg.task_goal : null;

  return (
    <div className="max-w-[1080px] mx-auto" data-testid="run-report-view">
      <main className="min-w-0 pb-24">
        {/* ── Header ── */}
        <header className="pb-8 border-b border-border mb-8" data-testid="run-report-header">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70 mb-2">
            <span className="text-muted-foreground/40">§ </span>Run report
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{taskTitle}</h1>
          <div className="flex flex-wrap gap-2 mt-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              slug <b className="font-medium text-foreground">{slug}</b>
            </span>
          </div>

          <div className="flex flex-wrap items-end gap-8 mt-5">
            <div>
              <div className="text-[56px] leading-none font-semibold tracking-tight tabular-nums" data-testid="run-report-score">
                {passCount ?? "—"}
                <span className="text-2xl text-muted-foreground/60 font-normal"> / {denominator}</span>
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70 mt-1.5">
                criteria passed
              </div>
              {breakdown && (
                <RubricBreakdownStrip breakdown={breakdown} />
              )}
            </div>
            <div className="flex-1 min-w-[260px]">
              {passCount !== null && allPassed && (
                <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.08em] border-emerald-500/40 bg-emerald-500/10 text-emerald-500">
                  All criteria passed
                </span>
              )}
              {goal && (
                <p className="text-[14px] text-muted-foreground max-w-[72ch] mt-2">{goal}</p>
              )}
            </div>
          </div>

          {/* Offline notice */}
          <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3">
            <p className="font-mono text-[10.5px] text-amber-600 dark:text-amber-400">
              Offline export — interactive features (graph links, document viewer, concept peeks) are available only in the online report.
            </p>
          </div>

          {/* Graph link → offline chip */}
          <div className="mt-3">
            <OfflineViewInGraphLink />
          </div>
        </header>

        {/* ── Rubric Ledger (static) ── */}
        <section className="scroll-mt-6 pt-14 first:pt-2" id="rubric-ledger" data-testid="run-report-section-rubric-ledger">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70 mb-2">
            <span className="text-muted-foreground/40">§ </span>Rubric
          </div>
          <h2 className="text-2xl font-semibold tracking-tight mb-2">Rubric ledger</h2>
          <div className="space-y-2 mt-4">
            {runProjection.rubricRows.map((row) => (
              <div
                key={row.id}
                className={[
                  "rounded-lg border p-4",
                  row.passed ? "border-emerald-500/20 bg-emerald-500/5" : "border-destructive/25 bg-destructive/[0.04]",
                ].join(" ")}
                data-testid={`rubric-row-${row.id}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={[
                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.07em] border",
                      row.passed
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40"
                        : "bg-destructive/15 text-destructive border-destructive/45",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "h-1.5 w-1.5 rounded-full",
                        row.passed ? "bg-emerald-500/70" : "bg-destructive",
                      ].join(" ")}
                    />
                    {row.passed ? "pass" : "fail"}
                  </span>
                  <span className="font-mono text-[10.5px] text-muted-foreground/70">{row.id}</span>
                  <span className="text-[13px] font-medium flex-1">{row.title}</span>
                </div>
                {row.verdict && (
                  <p className="text-[12.5px] text-muted-foreground mt-1">{row.verdict}</p>
                )}
                {row.reasoning && (
                  <p className="text-[12px] text-muted-foreground/80 mt-1">{row.reasoning}</p>
                )}
              </div>
            ))}
            {runProjection.rubricRows.length === 0 && (
              <div className="rounded-lg border border-border p-4">
                <p className="text-sm text-muted-foreground italic">No rubric rows in this bundle.</p>
              </div>
            )}
          </div>
        </section>

        {/* ── Checklist (static) ── */}
        {chain.checklist && (
          <section className="scroll-mt-6 pt-14" id="checklist" data-testid="run-report-section-checklist">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70 mb-2">
              <span className="text-muted-foreground/40">§ </span>Coverage
            </div>
            <h2 className="text-2xl font-semibold tracking-tight mb-2">Checklist coverage</h2>
            <pre className="text-[12px] text-muted-foreground mt-3 whitespace-pre-wrap">
              {chain.checklist.text}
            </pre>
          </section>
        )}

        {/* ── Source docs (static) ── */}
        {runProjection.sourceDocs.length > 0 && (
          <section className="scroll-mt-6 pt-14" id="sources" data-testid="run-report-section-sources">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70 mb-2">
              <span className="text-muted-foreground/40">§ </span>Sources
            </div>
            <h2 className="text-2xl font-semibold tracking-tight mb-2">Source documents</h2>
            <ul className="space-y-1 mt-3">
              {runProjection.sourceDocs.map((doc) => (
                <li
                  key={doc.id}
                  className="font-mono text-[11px] text-muted-foreground"
                  data-testid={`source-doc-${doc.id}`}
                >
                  {doc.title}
                  <span className="ml-2 text-muted-foreground/50 text-[10px]">(available in online report)</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

// ── Offline consolidated document ─────────────────────────────────────────────

function OfflineConsolidatedDocument({
  payload,
  taskSlug,
  context,
}: {
  payload: RunReportPayload;
  taskSlug: string;
  context: OfflineRenderContext;
}) {
  if (!payload.hasReport) {
    return (
      <div className="py-16 text-center" data-testid="consolidated-no-report">
        <p className="text-muted-foreground text-sm">No report bundle available for this run.</p>
      </div>
    );
  }

  if (payload.error || !payload.projection) {
    return (
      <div className="py-16 text-center" data-testid="consolidated-error">
        <p className="text-destructive text-sm">
          {payload.error === "url_rejected"
            ? "Report URL was rejected by the security guard."
            : "The consolidated report could not be loaded."}
        </p>
      </div>
    );
  }

  const projection =
    "consolidated" in payload.projection && payload.projection.consolidated
      ? (payload.projection as ConsolidatedReportProjection)
      : null;

  if (!projection) {
    return (
      <div className="py-16 text-center" data-testid="consolidated-error">
        <p className="text-destructive text-sm">Invalid consolidated report projection.</p>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto" data-testid="consolidated-report-view">
      {/* Header */}
      <section className="mb-8" data-testid="consolidated-header">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70 mb-2">
          <span className="text-muted-foreground/40">§ </span>Consolidated Report
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mb-1">
          Cross-run rubric comparison
        </h1>
        <p className="font-mono text-xs text-muted-foreground/70 mb-4">{taskSlug}</p>

        {projection.taskDescription && (
          <p className="mb-4 max-w-[80ch] text-sm text-muted-foreground">
            {projection.taskDescription}
          </p>
        )}

        {/* Offline notice */}
        <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <p className="font-mono text-[10.5px] text-amber-600 dark:text-amber-400">
            Offline export — source file links below are local copies where available.
          </p>
        </div>

        {projection.sourceFileLinks.length > 0 && (
          <div className="flex flex-wrap gap-2" data-testid="source-file-links-section">
            {projection.sourceFileLinks.map((url) => {
              const entryName = context.packedDocsByUrl.get(url) ?? null;
              return (
                <OfflineSourceFileLink key={url} url={url} packedEntryName={entryName} />
              );
            })}
          </div>
        )}
      </section>

      {/* Failed-rubric matrix */}
      <section className="mb-8" data-testid="consolidated-matrix">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70 mb-2">
          <span className="text-muted-foreground/40">§ </span>Failed rubrics
        </div>
        <h2 className="text-xl font-semibold tracking-tight mb-3">Pass / fail matrix</h2>
        {projection.rubricMatrix.length === 0 ? (
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground italic">All criteria passed across all runs.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-sm" data-testid="rubric-matrix-table">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="sticky left-0 z-10 bg-muted/30 text-left px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70 min-w-[220px] border-r border-border">
                    Criterion
                  </th>
                  {projection.runs.map((run) => (
                    <th
                      key={run.runId}
                      className="text-left px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70 min-w-[100px] whitespace-nowrap"
                    >
                      {new Date(run.timestamp).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      <br />
                      <span className="text-[9px] text-muted-foreground/50 normal-case tracking-normal">
                        {run.model}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {projection.rubricMatrix.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/10 transition-colors" data-testid="matrix-row">
                    <td className="sticky left-0 z-10 bg-card border-r border-border px-4 py-3 font-mono text-[11px] text-foreground align-top" data-testid="matrix-criterion-title">
                      {row.title}
                    </td>
                    {projection.runs.map((run) => {
                      const result = row.results.find((r) => r.runId === run.runId);
                      return (
                        <td key={run.runId} className="px-4 py-3 align-top" data-testid="matrix-cell">
                          {result != null ? (
                            <span
                              className={[
                                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.07em] border",
                                result.passed
                                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40"
                                  : "bg-destructive/15 text-destructive border-destructive/45",
                              ].join(" ")}
                            >
                              {result.passed ? "pass" : "fail"}
                            </span>
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
        )}
      </section>

      {/* Per-criterion detail */}
      {projection.rubricDetails.length > 0 && (
        <section data-testid="rubric-details-section">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70 mb-2">
            <span className="text-muted-foreground/40">§ </span>Per-criterion detail
          </div>
          <h2 className="text-xl font-semibold tracking-tight mb-4">Criterion breakdown</h2>
          {projection.rubricDetails.map((detail) => (
            <div
              key={detail.id}
              className="mb-6 rounded-lg border border-border overflow-hidden"
              data-testid={`criterion-detail-${detail.id}`}
            >
              <div className="px-4 py-3 border-b border-border bg-muted/20">
                <span className="font-mono text-[10px] text-muted-foreground/60 mr-2">{detail.id}</span>
                <span className="text-[13px] font-semibold">{detail.title}</span>
              </div>
              {detail.perRun.map((perRun) => {
                const run = projection.runs.find((r) => r.runId === perRun.runId);
                return (
                  <div key={perRun.runId} className="px-4 py-3 border-b border-border/60 last:border-0">
                    <div className="font-mono text-[9.5px] text-muted-foreground/60 mb-1">
                      {run
                        ? new Date(run.timestamp).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : perRun.runId}
                    </div>
                    <p className="text-[12.5px]">
                      <b>{perRun.verdict}</b>
                      {perRun.reasoning && ` — ${perRun.reasoning}`}
                    </p>
                    {perRun.judgeFlagReason && (
                      <p className="text-[11.5px] text-muted-foreground mt-1">
                        Judgement review: {perRun.judgeFlagReason}
                      </p>
                    )}
                    {perRun.criterionContested && (() => {
                      // Compute origin-aware label using the same helpers as the live app.
                      // `graphRubrics` is not passed into OfflineConsolidatedDocument yet
                      // (the offline context does not carry it), so the origin index will
                      // have available=false → token degrades to "unknown" which renders
                      // exactly today's CONTESTED pill — preserving backward compatibility
                      // while the slot is wired for future use.
                      const isContested = resolveContested({ contested: perRun.criterionContested });
                      if (!isContested) return null;
                      const emptyOriginIdx = contestedOriginIndex(null);
                      const fakeScorableCriterion = { id: detail.id, title: detail.title, contested: isContested, verdict: perRun.verdict };
                      const originInfo = contestedOrigin(fakeScorableCriterion, emptyOriginIdx);
                      const token = originInfo ? contestedOriginToken(originInfo) : "unknown";
                      const { label } = contestedNotice({ origin: token ?? "unknown", verdict: perRun.verdict, reason: resolveContestReason(fakeScorableCriterion) });
                      return (
                        <span
                          data-contested-origin={token ?? undefined}
                          className="mt-1 inline-flex rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.07em] text-violet-500"
                        >
                          {label}
                        </span>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

// ── Re-export escapeForInlineScript for use in offline-html.ts ────────────────
export { escapeForInlineScript };
