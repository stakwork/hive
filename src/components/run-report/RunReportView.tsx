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
  ConceptsSection,
  SourcesSection,
  HealthSection,
} from "./sections";

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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)] gap-8 max-w-[1180px]" data-testid="run-report-view">
      {/* Sticky section rail */}
      <nav className="hidden lg:block sticky top-4 self-start max-h-[calc(100vh-2rem)] overflow-y-auto font-mono text-[11px] border-r border-border pr-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.group}>
            <div className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground/50 mt-4 mb-1.5 first:mt-0">
              {group.group}
            </div>
            {group.items.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="block text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded px-2 -ml-2 py-0.5 transition-colors"
              >
                {item.label}
              </a>
            ))}
          </div>
        ))}
      </nav>

      <main className="min-w-0 pb-24">
        <OverviewSection projection={projection} timezone={timezone} taskTitle={taskTitle} />
        <PipelineSection projection={projection} />
        <RubricsSection rows={rubricRows} />
        <FailuresSection
          rows={rubricRows}
          projection={projection}
          onOpenDoc={(docId, tokens) => setOpenDoc({ docId, tokens })}
        />
        <TracesSection projection={projection} />
        <ConceptsSection projection={projection} />
        <SourcesSection
          projection={projection}
          onOpenDoc={(docId, tokens) => setOpenDoc({ docId, tokens })}
        />
        <HealthSection projection={projection} />
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
