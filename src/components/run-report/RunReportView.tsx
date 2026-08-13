"use client";

import React, { useMemo, useState } from "react";
import { AlertCircle, Info } from "lucide-react";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import type { RunReportPayload } from "@/lib/run-report/types";
import { buildChainModel } from "@/lib/run-report/chain";
import { DocumentViewerModal } from "./DocumentViewerModal";
import { ReportHeader } from "./ReportHeader";
import { RubricLedger } from "./RubricLedger";
import { ChecklistMap } from "./ChecklistMap";
import {
  PipelineSection,
  TracesSection,
  ToolActivitySection,
  ConceptsSection,
  SourcesSection,
  HealthSection,
} from "./sections";
import { SectionErrorBoundary, Kicker } from "./chrome";

/**
 * Run report renderer — rubric-first.
 *
 * A reviewer opens this page because a criterion failed. The page reads in
 * that order: a header that sets the scene (task, score, goal, materials,
 * concepts pulled), the rubric ledger walking each criterion backwards from
 * the deliverable to the raw materials, and the checklist↔rubric coverage
 * view. Pipeline timeline, agent roster, tool activity and health remain
 * below as debugging context.
 *
 * Tier 1 (everything above) is deterministic bundle data. Tier 2 — agent
 * commentary from analysis.traces[] — appends per hop when present and never
 * determines whether a hop exists.
 *
 * A client component so it can read the user's timezone and pass it into
 * `formatInUserTz` — explicitly NOT `formatFeatureDate`, which hardcodes UTC.
 *
 * Sanitization and redaction are server-only and already complete before the
 * projection crosses the boundary; this component never sanitizes. The raw
 * bundle URL is not part of its props and cannot be. `workspaceSlug` only
 * enables the concept peek's authed node fetch (the /learn nodes route).
 */

interface Props {
  payload: RunReportPayload;
  taskTitle?: string;
  workspaceSlug?: string | null;
}

export function RunReportView({ payload, taskTitle = "Run report", workspaceSlug = null }: Props) {
  const { timezone } = useUserTimezone();
  const [openDoc, setOpenDoc] = useState<{ docId: string; tokens: string[] } | null>(null);

  const projection = payload.projection;
  const chain = useMemo(() => (projection ? buildChainModel(projection) : null), [projection]);

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
  if (!payload.hasReport || !projection || !chain) {
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
  const onOpenDoc = (docId: string, tokens: string[]) => setOpenDoc({ docId, tokens });

  return (
    <div className="max-w-[1080px] mx-auto" data-testid="run-report-view">
      {/* No section rail - the ledger's criterion list IS the navigation;
          the page reads top-to-bottom in review order. */}
      <main className="min-w-0 pb-24">
        <div id="run-report-header" className="scroll-mt-6">
          <SectionErrorBoundary>
            <ReportHeader
              projection={projection}
              chain={chain}
              taskTitle={taskTitle}
              timezone={timezone}
              workspaceSlug={workspaceSlug}
              onOpenDoc={onOpenDoc}
            />
          </SectionErrorBoundary>
        </div>
        <SectionErrorBoundary>
          <RubricLedger projection={projection} chain={chain} onOpenDoc={onOpenDoc} />
        </SectionErrorBoundary>
        <SectionErrorBoundary>
          <ChecklistMap chain={chain} />
        </SectionErrorBoundary>

        {/* Debugging context, demoted below the review surface */}
        <div className="mt-16 pt-4 border-t border-border">
          <Kicker>Debugging context</Kicker>
          <SectionErrorBoundary>
            <PipelineSection projection={projection} />
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
            <SourcesSection projection={projection} onOpenDoc={onOpenDoc} />
          </SectionErrorBoundary>
          <SectionErrorBoundary>
            <HealthSection projection={projection} />
          </SectionErrorBoundary>
        </div>
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
