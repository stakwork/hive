"use client";

import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { WorkflowStatus } from "@prisma/client";
import { PillSection } from "@/components/legal/PillSection";
import { CascadeTrace } from "@/components/legal/CascadeTrace";
import { DownloadReportButton } from "@/components/run-report/DownloadReportButton";
import { useRunCascade } from "@/hooks/useRunCascade";
import { useWorkspace } from "@/hooks/useWorkspace";

// The pure trace lives in CascadeTrace.tsx (it is also bundled into the
// offline HTML export); re-exported here so existing imports keep working.
export { CascadeTrace } from "@/components/legal/CascadeTrace";

/** The single-file HTML snapshot of one run's trace. */
export function cascadeExportUrl(workspaceSlug: string, runId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceSlug)}/legal/benchmarks/cascade/export?runId=${encodeURIComponent(runId)}`;
}

// ── Pill + panel wired to the polling hook ───────────────────────────────────

interface BenchmarkRunCascadeProps {
  runId: string;
  /** The StakworkRun's workflow status — keeps the trace polling for new
   *  agents while the run is active. */
  runStatus?: WorkflowStatus | string;
}

/**
 * "Traces" in the expanded run row: a small pill that pops in once the run's
 * agent sessions exist, expanding into the full cascade panel on click. The
 * heavyweight protocol (session details + turn chains) only runs while the
 * panel is open.
 */
export function BenchmarkRunCascade({ runId, runStatus }: BenchmarkRunCascadeProps) {
  const [open, setOpen] = useState(false);
  const { workspace } = useWorkspace();
  const { sessions, model, error, isLive } = useRunCascade(runId, {
    enabled: open,
    runStatus,
  });

  // The pill pops in only once a trace exists — legacy runs with no sessions
  // show nothing at all.
  if (sessions.length === 0) return null;

  const slug = workspace?.slug ?? null;

  return (
    <PillSection
      testId="run-cascade"
      open={open}
      onOpenChange={setOpen}
      label={
        <>
          Traces{" "}
          <span className="font-normal text-muted-foreground">
            ({sessions.length} agent{sessions.length !== 1 ? "s" : ""})
          </span>
          {isLive && (
            <span className="h-2 w-2 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
          )}
        </>
      }
    >
      {error ? (
        <p className="px-4 py-6 text-center text-sm text-destructive">
          Failed to load trace: {error}
        </p>
      ) : !model ? (
        <div className="flex items-center justify-center gap-2 px-4 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading trace…</span>
        </div>
      ) : model.agents.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          No agent sessions recorded for this run.
        </p>
      ) : (
        <CascadeTrace
          model={model}
          workspaceSlug={slug}
          headerAction={
            slug ? (
              <DownloadReportButton
                exportUrl={cascadeExportUrl(slug, runId)}
                label="Download HTML"
              />
            ) : null
          }
        />
      )}
    </PillSection>
  );
}
