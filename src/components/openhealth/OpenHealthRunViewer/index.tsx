"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Square } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PillSection } from "@/components/legal/PillSection";
import { StrutRunGraph } from "@/components/strut-run-graph";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { openHealthDeliverable } from "@/lib/openhealth-benchmarks/constants";
import type { OpenHealthProgressResponse, OpenHealthRunDetail, OpenHealthStage } from "@/types/openhealth";
import { BenchmarkBadge, formatCost, formatDuration, formatMetric, formatScore } from "../format";
import { DiagnosisList, Stages, Stat } from "../parts";
import { ArtifactPanel } from "./ArtifactPanel";
import { ImprovePanel } from "./ImprovePanel";

/** Poll cadence while the run is in flight. */
const POLL_MS = 10_000;

type Panel = "graph" | "problem-list" | "summary" | "timeline" | "checklist" | "ingest";

function ScoredDiagnosis({ run }: { run: OpenHealthRunDetail }) {
  const { scores } = run;
  if (!scores) return null;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8" data-testid="openhealth-run-scores">
        <Stat label={formatMetric(scores.metric)} value={formatScore(scores.f1)} emphasis />
        <Stat label="Tier" value={scores.tier ?? "—"} emphasis />
        <Stat label="Recall" value={formatScore(scores.recall)} />
        <Stat label="Precision" value={formatScore(scores.precision)} />
        <Stat label="Matched / answer key" value={`${scores.nMatched ?? "—"} / ${scores.nGt ?? "—"}`} />
        <Stat label="Predicted" value={scores.nPred ?? "—"} />
        <Stat label="Cost" value={formatCost(run.costUsd)} />
        <Stat label="Duration" value={formatDuration(run.durationMs)} />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <DiagnosisList
          title="Matched"
          hint="The model's diagnosis and the answer-key diagnosis it matched"
          testId="openhealth-run-matched"
          items={run.matched.map((m) =>
            m.pred === m.gt ? (
              m.pred
            ) : (
              <>
                {m.pred} <span className="text-muted-foreground">↔ {m.gt}</span>
              </>
            ),
          )}
        />
        <DiagnosisList
          title="Missed"
          hint="In the answer key, not in the model's list"
          testId="openhealth-run-missed"
          items={run.missed}
        />
        <DiagnosisList
          title="Extra"
          hint="In the model's list, matched nothing"
          testId="openhealth-run-extra"
          items={run.extra}
        />
      </div>
    </>
  );
}

/**
 * A summary's score: recall of the answer key's findings (whole patient),
 * that recall against leakage (a specialty with an active problem), or
 * whether it abstained (a specialty with none).
 */
function ScoredSummary({ run }: { run: OpenHealthRunDetail }) {
  const { scores } = run;
  if (!scores) return null;
  const abstention = scores.metric === "abstention_accuracy";
  const specialty = run.variant === "specialty_conditioned";
  const mustInclude = run.found.length + run.missed.length;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="openhealth-run-scores">
        <Stat label={formatMetric(scores.metric)} value={formatScore(scores.f1)} emphasis />
        {abstention ? (
          <Stat label="Abstained" value={scores.f1 >= 0.5 ? "Yes" : "No"} emphasis />
        ) : (
          <Stat label={specialty ? "Critical findings named" : "Findings named"} value={`${run.found.length} / ${mustInclude}`} emphasis />
        )}
        {specialty && <Stat label="Leaked" value={run.extra.length} />}
        <Stat label="Words" value={run.summaryWords ?? "—"} />
        <Stat label="Cost" value={formatCost(run.costUsd)} />
        <Stat label="Duration" value={formatDuration(run.durationMs)} />
      </div>
      {specialty && run.criticalCount === 0 && !abstention && (
        <p
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm"
          data-testid="openhealth-run-no-critical"
        >
          The answer key lists no critical finding for this specialty, so the paper&apos;s scorer gives this task 0
          whatever the summary says. The score is the benchmark&apos;s, not the summary&apos;s.
        </p>
      )}
      {abstention ? (
        <p className="text-sm text-muted-foreground" data-testid="openhealth-run-abstention">
          {scores.f1 >= 0.5
            ? "The chart has no active problem in this specialty, and the summary said so."
            : "The chart has no active problem in this specialty; the right answer was one short sentence saying so, and the summary did not abstain."}
        </p>
      ) : null}
      <div className={`grid gap-3 ${specialty ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
        {!abstention && (
          <>
            <DiagnosisList
              title="Named"
              hint={specialty ? "Critical findings of the specialty the summary names" : "Must-include findings the summary names"}
              testId="openhealth-run-found"
              items={run.found}
            />
            <DiagnosisList
              title="Missed"
              hint="In the answer key, not named in the summary"
              testId="openhealth-run-missed"
              items={run.missed}
            />
          </>
        )}
        {specialty && (
          <DiagnosisList
            title="Leaked"
            hint="Findings outside the specialty that the summary mentions"
            testId="openhealth-run-extra"
            items={run.extra}
          />
        )}
      </div>
    </>
  );
}

function Scored({ run }: { run: OpenHealthRunDetail }) {
  return run.task === "context_summarization" ? <ScoredSummary run={run} /> : <ScoredDiagnosis run={run} />;
}

function Ingest({ run }: { run: OpenHealthRunDetail }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="px-4 py-2 font-medium">Section</th>
          <th className="px-4 py-2 font-medium">Needed</th>
          <th className="px-4 py-2 text-right font-medium">Steps</th>
          <th className="px-4 py-2 text-right font-medium">Cost</th>
          <th className="px-4 py-2 font-medium">Error</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {run.ingested.map((section) => (
          <tr key={section.file}>
            <td className="px-4 py-1.5 font-mono text-xs">{section.file}</td>
            <td className="px-4 py-1.5">{section.needed === null ? "—" : section.needed ? "Yes" : "No"}</td>
            <td className="px-4 py-1.5 text-right tabular-nums">{section.steps ?? "—"}</td>
            <td className="px-4 py-1.5 text-right tabular-nums">{formatCost(section.cost)}</td>
            <td className="px-4 py-1.5 text-destructive">{section.error ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One benchmark run: its progress while it runs, its scores and files once it has. */
export function OpenHealthRunViewer({ runId, onSettled }: { runId: string; onSettled?: () => void }) {
  const { workspace } = useWorkspace();
  const { canWrite } = useWorkspaceAccess();
  const slug = workspace?.slug;
  const base = slug ? `/api/workspaces/${slug}/openhealth/benchmarks/runs/${runId}` : null;

  const [run, setRun] = useState<OpenHealthRunDetail | null>(null);
  const [stages, setStages] = useState<OpenHealthStage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    if (!base) return;
    try {
      const response = await fetch(base, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as OpenHealthRunDetail & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load the run");
      setRun(body);
      setError(null);
      if (body.outcome === "running") {
        const progress = await fetch(`${base}/progress`, { cache: "no-store" });
        if (progress.ok) setStages(((await progress.json()) as OpenHealthProgressResponse).stages);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the run");
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const running = run?.outcome === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  // The list behind this viewer learns the run is over when the viewer does.
  useEffect(() => {
    if (running) wasRunning.current = true;
    else if (run && wasRunning.current) {
      wasRunning.current = false;
      onSettled?.();
    }
  }, [running, run, onSettled]);

  const cancel = useCallback(async () => {
    if (!base) return;
    setCancelling(true);
    try {
      const response = await fetch(`${base}/cancel`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not cancel the run");
      toast.success("Cancelling — the run stops at its next step");
    } catch (e) {
      setCancelling(false);
      toast.error("Could not cancel the run", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    }
  }, [base]);

  if (error && !run) {
    return (
      <p className="text-sm text-destructive" data-testid="openhealth-run-error">
        {error}
      </p>
    );
  }
  if (!run || !base) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading the run…
      </p>
    );
  }

  const toggle = (name: Panel) => (open: boolean) => setPanel(open ? name : null);
  const hasFiles = run.outcome === "succeeded";
  // The run's deliverable: a problem list, or a summary.
  const deliverable = openHealthDeliverable(run.task);
  const deliverableLabel = deliverable === "summary" ? "Summary" : "Problem list";

  return (
    <div className="space-y-4" data-testid="openhealth-run-viewer">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{run.title ?? `Task ${run.gtId ?? ""}`}</span>
        {run.task !== "patient_diagnosis" && (
          <BenchmarkBadge benchmark={{ task: run.task, variant: run.variant }} specialty={run.specialty} />
        )}
        {run.patientId !== null && <Badge variant="outline">Patient {run.patientId}</Badge>}
        {run.chart?.encounterCount != null && <Badge variant="outline">{run.chart.encounterCount} encounters</Badge>}
        {run.chart && run.chart.sectionsFailed.length > 0 && (
          <Badge variant="destructive">{run.chart.sectionsFailed.length} sections failed to ingest</Badge>
        )}
        {run.spreadsheetUrl && (
          <a
            href={run.spreadsheetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            data-testid="openhealth-run-sheet"
          >
            Open the working sheet
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      {run.clinicalQuestion && run.task === "context_summarization" && (
        <p className="text-sm text-muted-foreground" data-testid="openhealth-run-question">
          {run.clinicalQuestion}
        </p>
      )}

      {running && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card px-4 py-3">
          <Stages stages={stages} />
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={!canWrite || cancelling}
            onClick={() => void cancel()}
            data-testid="openhealth-run-cancel"
          >
            {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        </div>
      )}
      {run.outcome === "failed" && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" data-testid="openhealth-run-failure">
          {run.error}
        </p>
      )}
      {run.outcome === "cancelled" && <p className="text-sm text-muted-foreground">The run was cancelled.</p>}
      {run.outcome === "succeeded" && <Scored run={run} />}
      {run.outcome === "succeeded" && run.strutRunId && <ImprovePanel endpoint={`${base}/improve`} />}

      {run.strutRunId && (
        <div className="flex flex-wrap gap-2">
          <PillSection label="Graph" open={panel === "graph"} onOpenChange={toggle("graph")} testId="openhealth-run-graph">
            <StrutRunGraph endpoint={`/api/workspaces/${slug}/strut/runs/${runId}/graph`} live={running} />
          </PillSection>
          {hasFiles && (
            <>
              <PillSection
                label={deliverableLabel}
                open={panel === deliverable}
                onOpenChange={toggle(deliverable)}
                testId={`openhealth-run-${deliverable}`}
              >
                <ArtifactPanel endpoint={`${base}/artifacts/${deliverable}`} kind={deliverable} />
              </PillSection>
              <PillSection
                label="Timeline"
                open={panel === "timeline"}
                onOpenChange={toggle("timeline")}
                testId="openhealth-run-timeline"
              >
                <ArtifactPanel endpoint={`${base}/artifacts/timeline`} kind="markdown" />
              </PillSection>
              <PillSection
                label="Checklist"
                open={panel === "checklist"}
                onOpenChange={toggle("checklist")}
                testId="openhealth-run-checklist"
              >
                <ArtifactPanel endpoint={`${base}/artifacts/checklist`} kind="markdown" />
              </PillSection>
              {run.ingested.length > 0 && (
                <PillSection
                  label={`Ingest (${run.ingested.length})`}
                  open={panel === "ingest"}
                  onOpenChange={toggle("ingest")}
                  testId="openhealth-run-ingest"
                >
                  <Ingest run={run} />
                </PillSection>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
