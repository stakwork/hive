"use client";

import React, { useState } from "react";
import { FileText, AlertTriangle } from "lucide-react";
import {
  formatDuration,
  aggregateFixes,
  toEpochMs,
  isRecord,
  asString,
  type RubricRow,
} from "@/lib/run-report/derive";
import type { RunReportProjection } from "@/lib/run-report/types";
import { formatInUserTz } from "@/lib/date-utils";
import {
  Section,
  Panel,
  EmptyPanel,
  Chip,
  StatusBadge,
  MiniHeading,
  KeyValues,
  Fold,
  Kicker,
  stringify,
} from "./chrome";
import { Gantt } from "./Gantt";
import { RubricStrip, FilterPills } from "./RubricStrip";

/**
 * The nine report sections, laid out as an editorial report rather than a stack
 * of cards — mirroring the information design of the generator's own viewer.
 *
 * ABSOLUTE RULE for this directory: every prose field from the bundle renders
 * as ESCAPED REACT TEXT. Nothing here imports `MarkdownRenderer` or
 * `MermaidDiagram` — `MarkdownRenderer` routes ```mermaid fences into
 * `MermaidDiagram`, which sets `dangerouslySetInnerHTML` with no mermaid
 * `securityLevel` configured. That is an HTML sink outside this directory, and
 * bundle content must never reach it.
 *
 * The only sanitized-HTML surface is `source_docs[].html`, rendered through
 * `SanitizedContent` in the document modal.
 */

// ── 1. Overview (hero) ───────────────────────────────────────────────────────

export function OverviewSection({
  projection,
  timezone,
  taskTitle,
}: {
  projection: RunReportProjection;
  timezone: string;
  taskTitle: string;
}) {
  const { stats, schemaVersion, generatedAtMs } = projection;
  const goal = asString(projection.pageData.setVar.task_goal);
  const allPassed = stats.failCount === 0 && stats.passCount !== null;

  return (
    <section id="overview" className="scroll-mt-6 pt-2" data-testid="run-report-section-overview">
      <Kicker>Run summary</Kicker>
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-2">{taskTitle}</h1>
      {goal && <p className="text-[15px] text-muted-foreground max-w-[70ch]">{goal}</p>}

      <div className="flex flex-wrap items-end gap-8 mt-6">
        <div>
          <div className="text-[64px] leading-none font-semibold tracking-tight tabular-nums">
            {stats.passCount ?? "—"}
            <span className="text-3xl text-muted-foreground/60 font-normal">
              {" / "}
              {stats.rubricCount}
            </span>
          </div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground/70 mt-2">
            Rubric criteria passed
          </div>
        </div>

        <div className="flex-1 min-w-[240px]">
          {stats.passCount !== null && (
            <StatusBadge kind={allPassed ? "pass" : "fail"}>
              {allPassed ? "All criteria passed" : `${stats.failCount} criteria failed`}
            </StatusBadge>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            <Chip label="docs" value={stats.sourceDocCount} />
            <Chip label="workfiles" value={stats.workfileCount} />
            <Chip label="agents" value={stats.traceCount} />
            <Chip label="steps" value={stats.branchCount} />
            <Chip label="schema" value={`v${schemaVersion}`} />
          </div>
          {generatedAtMs !== null && (
            <div className="font-mono text-[10.5px] text-muted-foreground/70 mt-3">
              Generated {formatInUserTz(new Date(generatedAtMs), timezone)}
            </div>
          )}
        </div>
      </div>

      <Panel className="mt-6">
        <MiniHeading>Run configuration</MiniHeading>
        <KeyValues data={projection.pageData.setVar} />
      </Panel>
    </section>
  );
}

// ── 2. Pipeline ──────────────────────────────────────────────────────────────

export function PipelineSection({ projection }: { projection: RunReportProjection }) {
  const branches = projection.pageData.branches;

  const steps = branches.filter(isRecord).map((b) => ({
    name: asString(b.name) ?? asString(b.step) ?? "step",
    startMs: toEpochMs(b.start),
    endMs: toEpochMs(b.end),
  }));

  return (
    <Section
      id="pipeline"
      kicker="Data flow"
      title="Pipeline timeline"
      lede={steps.length > 0 ? `${steps.length} workflow steps on a shared time axis.` : undefined}
    >
      {steps.length === 0 ? (
        <EmptyPanel label="No pipeline data for this run." />
      ) : (
        <Gantt steps={steps} />
      )}
    </Section>
  );
}

// ── 3. Rubric scoreboard ─────────────────────────────────────────────────────

export function RubricsSection({ rows }: { rows: RubricRow[] }) {
  const [filter, setFilter] = useState<"all" | "pass" | "fail">("all");

  if (rows.length === 0) {
    return (
      <Section id="rubrics" kicker="format_results" title="Rubric scoreboard">
        <EmptyPanel label="No rubric results for this run." />
      </Section>
    );
  }

  const counts = {
    all: rows.length,
    pass: rows.filter((r) => r.passed).length,
    fail: rows.filter((r) => !r.passed).length,
  };
  const visible =
    filter === "all" ? rows : rows.filter((r) => (filter === "pass" ? r.passed : !r.passed));

  const scrollToRubric = (rubricId: string) => {
    setFilter("all");
    // Defer so the filtered-in node exists before we scroll to it.
    requestAnimationFrame(() => {
      document.getElementById(`rubric-${rubricId}`)?.scrollIntoView({ block: "center" });
    });
  };

  return (
    <Section id="rubrics" kicker="format_results" title="Rubric scoreboard">
      <RubricStrip rows={rows} onSelect={scrollToRubric} />
      <FilterPills value={filter} onChange={setFilter} counts={counts} />

      <div className="space-y-2">
        {visible.map((row) => (
          <details
            key={row.id}
            id={`rubric-${row.id}`}
            className={`rounded-lg border bg-muted/20 scroll-mt-24 ${
              row.passed ? "border-border" : "border-destructive/40"
            }`}
          >
            <summary className="flex gap-3 items-baseline px-3.5 py-2.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              <span className="font-mono text-[11px] text-muted-foreground/70 min-w-[46px]">
                {row.id}
              </span>
              <span className="flex-1 text-[13.5px]">{row.title}</span>
              <StatusBadge kind={row.passed ? "pass" : "fail"}>
                {row.passed ? "pass" : "fail"}
              </StatusBadge>
            </summary>
            {row.reasoning && (
              <p className="px-3.5 pb-3.5 pl-[72px] text-[13px] text-muted-foreground whitespace-pre-wrap">
                {row.reasoning}
              </p>
            )}
          </details>
        ))}
      </div>
    </Section>
  );
}

// ── 4. Failure investigations ────────────────────────────────────────────────

export function FailuresSection({
  rows,
  projection,
  onOpenDoc,
}: {
  rows: RubricRow[];
  projection: RunReportProjection;
  onOpenDoc: (docId: string, tokens: string[]) => void;
}) {
  const failures = rows.filter((r) => !r.passed);
  const fixes = aggregateFixes(rows);

  return (
    <Section id="failures" kicker="Root cause" title="Failure investigations">
      {failures.length === 0 ? (
        <EmptyPanel label="No failures for this run." />
      ) : (
        <>
          {failures.map((row) => {
            // rubric_links is the SOLE data source for the failure → document
            // deep link; without it that pathway has no wiring.
            const links = projection.rubricLinks[row.id] ?? [];
            return (
              <Panel key={row.id} tone="fail" className="mt-4">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[11px] text-muted-foreground/70">{row.id}</span>
                  <h3 className="text-[17px] font-semibold flex-1">{row.title}</h3>
                </div>

                {row.reasoning && (
                  <p className="text-[13px] text-muted-foreground mt-2 whitespace-pre-wrap">
                    {row.reasoning}
                  </p>
                )}

                {row.causeSummary && (
                  <div className="border-l-[3px] border-destructive bg-destructive/[0.06] rounded-r-lg px-4 py-2.5 mt-3 text-[14px]">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground block mb-1">
                      {row.causeType ?? "root cause"}
                    </span>
                    {row.causeSummary}
                  </div>
                )}

                {links.length > 0 && (
                  <>
                    <MiniHeading>Evidence</MiniHeading>
                    <div className="flex flex-wrap gap-2">
                      {links.map((link, i) => (
                        <button
                          key={`${link.doc}-${i}`}
                          type="button"
                          onClick={() => onOpenDoc(link.doc, link.tokens)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 font-mono text-[11px] text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
                          data-testid="run-report-failure-doc-link"
                        >
                          <FileText className="h-3 w-3" />
                          {docTitle(projection, link.doc)}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </Panel>
            );
          })}

          {fixes.length > 0 && (
            <>
              <MiniHeading>Aggregated root causes</MiniHeading>
              <Panel>
                <ul className="space-y-3">
                  {fixes.map((fix) => (
                    <li key={fix.causeType} className="text-[13.5px]">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[11px] text-foreground">{fix.causeType}</span>
                        <span className="text-muted-foreground text-xs">
                          {fix.count} rubric{fix.count === 1 ? "" : "s"} · {fix.rubricIds.join(", ")}
                        </span>
                      </div>
                      {fix.suggestions.map((suggestion, i) => (
                        <p key={i} className="text-muted-foreground mt-1">
                          {suggestion}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              </Panel>
            </>
          )}
        </>
      )}
    </Section>
  );
}

function docTitle(projection: RunReportProjection, docId: string): string {
  return projection.sourceDocs.find((d) => d.id === docId)?.title ?? docId;
}

// ── 5. Agent roster ──────────────────────────────────────────────────────────

export function TracesSection({ projection }: { projection: RunReportProjection }) {
  const traces = projection.analysis.traces;

  return (
    <Section id="agents" kicker="send_agent_logs" title="Agent roster">
      {/* An empty traces array is the deterministic-only run — a LEGITIMATE
          empty state that must never route to the error state. */}
      {traces.length === 0 ? (
        <EmptyPanel label="No agent traces for this run." />
      ) : (
        traces.filter(isRecord).map((trace, i) => (
          <Panel key={i} className="mt-4">
            <div className="flex flex-wrap items-baseline gap-3">
              <h3 className="text-[19px] font-semibold">
                {asString(trace.agent) ?? `Agent ${i + 1}`}
              </h3>
              {asString(trace.started_at) && (
                <span className="font-mono text-[11px] text-muted-foreground/70">
                  {asString(trace.started_at)}
                </span>
              )}
            </div>
            <Fold summary="Transcript" monospace>
              <pre className="text-[11.5px] whitespace-pre-wrap break-all font-mono text-muted-foreground">
                {stringify(trace)}
              </pre>
            </Fold>
          </Panel>
        ))
      )}
    </Section>
  );
}

// ── 6. Concept pulls ─────────────────────────────────────────────────────────

export function ConceptsSection({ projection }: { projection: RunReportProjection }) {
  const concepts = projection.concepts;

  // `concepts: {}` is the generator DEFAULT (the pass is opt-in behind
  // --concepts) and therefore the common shape. It means "not run", never an
  // error.
  if (Object.keys(concepts).length === 0) {
    return (
      <Section id="concepts" kicker="Concept usage" title="Concept pulls">
        <EmptyPanel label="Concept synthesis was not run for this benchmark." />
      </Section>
    );
  }

  const synthesis = isRecord(concepts.synthesis) ? concepts.synthesis : {};
  const narrative = asString(synthesis.overall_narrative);
  const nodes = Array.isArray(concepts.nodes) ? concepts.nodes.filter(isRecord) : [];

  return (
    <Section id="concepts" kicker="Concept usage" title="Concept pulls">
      {narrative ? (
        <Panel>
          {/* Escaped React text. This string is known to contain ```mermaid
              fences and raw HTML; both must render as literal characters. */}
          <p
            className="text-[13.5px] whitespace-pre-wrap text-muted-foreground"
            data-testid="run-report-concept-narrative"
          >
            {narrative}
          </p>
        </Panel>
      ) : (
        <EmptyPanel label="No synthesis narrative for this run." />
      )}

      {nodes.length > 0 && (
        <>
          <MiniHeading>Concepts referenced</MiniHeading>
          <div className="flex flex-wrap gap-2">
            {nodes.map((node, i) => (
              <Chip key={i} label={asString(node.kind) ?? "concept"} value={asString(node.label) ?? asString(node.id) ?? "—"} />
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

// ── 7 + 8. Sources & artifacts ───────────────────────────────────────────────

export function SourcesSection({
  projection,
  onOpenDoc,
}: {
  projection: RunReportProjection;
  onOpenDoc: (docId: string, tokens: string[]) => void;
}) {
  const { sourceDocs, workfiles } = projection;

  return (
    <Section id="sources" kicker="Context" title="Sources &amp; artifacts">
      <MiniHeading>Source documents ({sourceDocs.length})</MiniHeading>
      {sourceDocs.length === 0 ? (
        <EmptyPanel label="No source documents for this run." />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
          {sourceDocs.map((doc) => (
            <button
              key={doc.id}
              type="button"
              onClick={() => onOpenDoc(doc.id, [])}
              className="text-left rounded-lg border border-border bg-muted/20 p-3.5 hover:border-primary/50 transition-colors"
              data-testid="run-report-doc-link"
            >
              <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/70 mb-1.5">
                Document
              </div>
              <div className="text-[13px] flex items-start gap-2">
                <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <span className="break-words">{doc.title}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <MiniHeading>Workfiles ({workfiles.length})</MiniHeading>
      {workfiles.length === 0 ? (
        <EmptyPanel label="No workfiles for this run." />
      ) : (
        workfiles.map((file, i) => (
          <Fold key={i} summary={file.name ?? `Workfile ${i + 1}`} monospace>
            {/* Plain text, rendered escaped. Running it through the HTML
                sanitizer would swallow angle-bracketed legal prose. */}
            <pre className="text-[11.5px] whitespace-pre-wrap break-words font-mono text-muted-foreground">
              {file.text}
            </pre>
          </Fold>
        ))
      )}
    </Section>
  );
}

// ── 9. System health ─────────────────────────────────────────────────────────

export function HealthSection({ projection }: { projection: RunReportProjection }) {
  const { security, healthNotes, logStats, outputs } = projection.pageData;
  const isEmpty =
    Object.keys(security).length === 0 &&
    healthNotes.length === 0 &&
    Object.keys(logStats).length === 0 &&
    Object.keys(outputs).length === 0;

  return (
    <Section id="system" kicker="Meta" title="System health">
      {isEmpty ? (
        <EmptyPanel label="No health or security data for this run." />
      ) : (
        <>
          {healthNotes.length > 0 && (
            <Panel>
              <ul className="space-y-1.5">
                {healthNotes.filter(isRecord).map((note, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px]">
                    <AlertTriangle
                      className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${
                        asString(note.level) === "warn"
                          ? "text-amber-500"
                          : "text-muted-foreground/50"
                      }`}
                    />
                    <span className="text-muted-foreground">
                      {asString(note.message) ?? stringify(note)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            {Object.keys(security).length > 0 && (
              <Panel>
                <MiniHeading>Security</MiniHeading>
                <KeyValues data={security} />
              </Panel>
            )}
            {Object.keys(logStats).length > 0 && (
              <Panel>
                <MiniHeading>Log stats</MiniHeading>
                <KeyValues data={logStats} />
              </Panel>
            )}
            {Object.keys(outputs).length > 0 && (
              <Panel className="lg:col-span-2">
                <MiniHeading>Outputs</MiniHeading>
                <KeyValues data={outputs} />
              </Panel>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

export { formatDuration };
