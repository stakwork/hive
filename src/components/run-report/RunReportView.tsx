"use client";

import React, { useState } from "react";
import { AlertCircle, Info } from "lucide-react";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import type { RunReportPayload } from "@/lib/run-report/types";
import { DocumentViewerModal } from "./DocumentViewerModal";
import {
  OverviewSection,
  PipelineSection,
  RubricsSection,
  FailuresSection,
  TracesSection,
  ToolActivitySection,
  ConceptsSection,
  SourcesSection,
  HealthSection,
} from "./sections";
import { SectionErrorBoundary, anchorId } from "./chrome";
import { readSummaries, isRecord, asString, readRosterNames } from "@/lib/run-report/derive";

/**
 * Run report renderer.
 *
 * Laid out as an editorial report — sticky section rail, numeric hero, gantt,
 * rubric heat-strip — following the information design of the generator's own
 * viewer, rendered with Hive's tokens and primitives.
 *
 * A client component so it can read the user's timezone and pass it into
 * `formatInUserTz` — explicitly NOT `formatFeatureDate`, which hardcodes UTC.
 *
 * Sanitization and redaction are server-only and already complete before the
 * projection crosses the boundary; this component never sanitizes and never
 * fetches. The raw bundle URL is not part of its props and cannot be.
 *
 * Deliberately workspace-agnostic so a generic `/w/[slug]/reports` route is a
 * later drop-in.
 */

interface Props {
  payload: RunReportPayload;
  taskTitle?: string;
}

const NAV_GROUPS: Array<{ group: string; items: Array<{ id: string; label: string }> }> = [
  {
    group: "Report",
    items: [
      { id: "overview", label: "Overview" },
      { id: "pipeline", label: "Pipeline" },
      { id: "rubrics", label: "Rubric scoreboard" },
    ],
  },
  {
    group: "Failures",
    items: [{ id: "failures", label: "Investigations" }],
  },
  {
    group: "Agents",
    items: [{ id: "agents", label: "Agent roster" }],
  },
  {
    group: "Context",
    items: [
      { id: "concepts", label: "Concept pulls" },
      { id: "sources", label: "Sources & artifacts" },
      { id: "system", label: "System health" },
    ],
  },
];

export function RunReportView({ payload, taskTitle = "Run report" }: Props) {
  const { timezone } = useUserTimezone();
  const [openDoc, setOpenDoc] = useState<{ docId: string; tokens: string[] } | null>(null);

  const projection = payload.projection;
  // rubricRows is derived server-side (single source) — read from projection.
  const rubricRows = projection?.rubricRows ?? [];

  // ── Report exists but could not be loaded from S3 ─────────────────────────
  if (payload.error === "unavailable") {
    return (
      <StateNotice
        icon={<AlertCircle className="h-5 w-5" />}
        title="Report couldn't be loaded"
        body="The report bundle exists for this run but couldn't be fetched from storage. It may have been moved or deleted. Reloading may help."
        testId="run-report-state-unavailable"
      />
    );
  }

  // ── Report URL rejected by the SSRF guard ────────────────────────────────
  if (payload.error === "url_rejected") {
    return (
      <StateNotice
        icon={<AlertCircle className="h-5 w-5" />}
        title="Report location not permitted"
        body="The report bundle for this run is stored at a location that is not permitted by this deployment's security policy. Contact your workspace administrator."
        testId="run-report-state-url-rejected"
      />
    );
  }

  // ── No report on this run ─────────────────────────────────────────────────
  if (!payload.hasReport || !projection) {
    return (
      <StateNotice
        icon={<Info className="h-5 w-5" />}
        title="No report for this run"
        body="This run didn't produce a report bundle. Enable “Generate Report” before starting a run to capture one."
        testId="run-report-state-absent"
      />
    );
  }

  const activeDoc = openDoc
    ? projection.sourceDocs.find((d) => d.id === openDoc.docId) ?? null
    : null;

  // The rail lists every failed rubric and every agent, mirroring the
  // generator's own viewer: tap C-038 → its investigation, tap an agent →
  // its roster card. Names join the same way TracesSection renders them.
  const rosterMap = readRosterNames(projection.analysis, projection.pageData.agents);
  const rosterNames = [...rosterMap.values()];
  const navGroups = NAV_GROUPS.map((group) => {
    if (group.group === "Failures") {
      return {
        ...group,
        items: [
          ...group.items,
          ...rubricRows
            .filter((r) => !r.passed)
            .map((r) => ({ id: anchorId("failure", r.id), label: r.id })),
        ],
      };
    }
    if (group.group === "Agents") {
      return {
        ...group,
        items: [
          ...group.items,
          ...rosterNames.map((n) => ({ id: anchorId("agent", n), label: n })),
          { id: "tool-activity", label: "Tool activity" },
        ],
      };
    }
    return group;
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)] gap-8 max-w-[1180px]" data-testid="run-report-view">
      {/* Sticky section rail */}
      <nav className="hidden lg:block sticky top-4 self-start max-h-[calc(100vh-2rem)] overflow-y-auto font-mono text-[11px] border-r border-border pr-4">
        {navGroups.map((group) => (
          <div key={group.group}>
            <div className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground/50 mt-4 mb-1.5 first:mt-0">
              {group.group}
            </div>
            {group.items.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                title={item.label}
                className="block truncate text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded px-2 -ml-2 py-0.5 transition-colors"
              >
                {item.label}
              </a>
            ))}
          </div>
        ))}
      </nav>

      <main className="min-w-0 pb-24">
        <SectionErrorBoundary>
          <OverviewSection projection={projection} timezone={timezone} taskTitle={taskTitle} />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <PipelineSection projection={projection} />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <RubricsSection rows={rubricRows} />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <FailuresSection
            rows={rubricRows}
            projection={projection}
            onOpenDoc={(docId, tokens) => setOpenDoc({ docId, tokens })}
          />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <TracesSection projection={projection} />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <ToolActivitySection projection={projection} />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <ConceptsSection projection={projection} />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <SourcesSection
            projection={projection}
            onOpenDoc={(docId, tokens) => setOpenDoc({ docId, tokens })}
          />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <HealthSection projection={projection} />
        </SectionErrorBoundary>
      </main>

      <DocumentViewerModal
        doc={activeDoc}
        tokens={openDoc?.tokens ?? []}
        open={openDoc !== null}
        onOpenChange={(next) => !next && setOpenDoc(null)}
      />
    </div>
  );
}

function StateNotice({
  icon,
  title,
  body,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  testId: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-10 text-center"
      data-testid={testId}
    >
      <div className="text-muted-foreground">{icon}</div>
      <div className="text-sm font-medium">{title}</div>
      <p className="text-sm text-muted-foreground max-w-md">{body}</p>
    </div>
  );
}
