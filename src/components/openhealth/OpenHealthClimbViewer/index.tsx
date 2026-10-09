"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PillSection } from "@/components/legal/PillSection";
import { StrutRunGraph } from "@/components/strut-run-graph";
import { useWorkspace } from "@/hooks/useWorkspace";
import { openHealthClimbStepPath } from "@/lib/openhealth-benchmarks/climb";
import { openHealthDeliverable } from "@/lib/openhealth-benchmarks/constants";
import type { OpenHealthClimb, OpenHealthClimbStep, OpenHealthContestRejected } from "@/types/openhealth";
import { formatCost, formatMetric, formatScore, formatWhen } from "../format";
import { OpenHealthClimbStrip } from "../OpenHealthClimbStrip";
import { ArtifactPanel } from "../OpenHealthRunViewer/ArtifactPanel";
import { CONTESTED_TEXT, ContestedNote, DiagnosisList, Stages, Stat } from "../parts";

/** Poll cadence while the climb is in flight. */
const POLL_MS = 10_000;

type Panel = "graph" | "problem-list" | "summary" | "timeline" | "checklist";

/** Columns for the lists under a run's scores, by how many there are. */
const LIST_COLUMNS = ["", "lg:grid-cols-1", "lg:grid-cols-2", "lg:grid-cols-3"];

function NameList({
  title,
  hint,
  names,
  testId,
  tone = "",
}: {
  title: string;
  hint: string;
  names: string[];
  testId: string;
  /** Classes for the title and the frame: the contested lists are violet. */
  tone?: string;
}) {
  if (names.length === 0) return null;
  return (
    <div className={`rounded-lg border bg-card ${tone ? "border-violet-500/40" : ""}`} data-testid={testId}>
      <div className="border-b px-4 py-2">
        <p className={`text-sm font-semibold ${tone}`}>
          {title} <span className="font-normal tabular-nums text-muted-foreground">{names.length}</span>
        </p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <ul className="divide-y text-sm">
        {names.map((name) => (
          <li key={name} className="px-4 py-2">
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RejectedContests({ items }: { items: OpenHealthContestRejected[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border bg-card" data-testid="openhealth-climb-step-contests-rejected">
      <div className="border-b px-4 py-2">
        <p className="text-sm font-semibold">
          Contests refused <span className="font-normal tabular-nums text-muted-foreground">{items.length}</span>
        </p>
        <p className="text-xs text-muted-foreground">Did not pass the workflow&apos;s checks; the score is unchanged</p>
      </div>
      <ul className="divide-y text-sm">
        {items.map((item, index) => (
          <li key={`${item.error}-${index}`} className="px-4 py-2">
            <span className="font-mono text-xs">{item.error}</span>
            {item.reason && <span className="block text-xs text-muted-foreground">{item.reason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BenchmarkStep({ step, climb }: { step: OpenHealthClimbStep; climb: OpenHealthClimb }) {
  const summary = climb.task === "context_summarization";
  const specialty = climb.variant === "specialty_conditioned";
  if (step.outcome === "running") {
    return (
      <div className="rounded-lg border bg-card px-4 py-3" data-testid="openhealth-climb-step-running">
        {step.stages ? (
          <Stages stages={step.stages} />
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Running the task…
          </p>
        )}
      </div>
    );
  }
  if (step.outcome !== "succeeded") {
    return (
      <p
        className={`text-sm ${step.outcome === "failed" ? "text-destructive" : "text-muted-foreground"}`}
        data-testid="openhealth-climb-step-ended"
      >
        {step.outcome === "failed" ? (step.error ?? "The run failed.") : "The run was cancelled."}
      </p>
    );
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="openhealth-climb-step-scores">
        <Stat
          label={formatMetric(step.metric ?? (summary ? null : "weighted_problem_list_f1_neutral"))}
          value={formatScore(step.f1)}
          sub={<ContestedNote official={step.f1Official} contested={step.contested.length} />}
          emphasis
        />
        <Stat
          label={summary ? (specialty ? "Missed / leaked" : "Missed") : "Missed / extra"}
          value={summary && !specialty ? step.missed.length : `${step.missed.length} / ${step.extra.length}`}
        />
        <Stat label="Cost" value={formatCost(step.costUsd)} />
        <Stat label="Started" value={step.startedAt ? formatWhen(step.startedAt) : "—"} />
      </div>
      <div
        className={`grid gap-3 ${LIST_COLUMNS[1 + (!summary || specialty ? 1 : 0) + (step.contested.length > 0 ? 1 : 0)]}`}
      >
        <DiagnosisList
          title="Missed"
          hint={summary ? "In the answer key, not named in the summary" : "In the answer key, not in the model's list"}
          testId="openhealth-climb-step-missed"
          items={step.missed}
        />
        {(!summary || specialty) && (
          <DiagnosisList
            title={summary ? "Leaked" : "Extra"}
            hint={
              summary
                ? "Findings outside the specialty that the summary mentions"
                : "In the model's list, matched nothing"
            }
            testId="openhealth-climb-step-extra"
            items={step.extra}
          />
        )}
        <NameList
          title="Contested"
          hint="In the answer key, but the chart contradicts it: excluded from the score"
          names={step.contested}
          testId="openhealth-climb-step-contested-list"
          tone={CONTESTED_TEXT}
        />
      </div>
    </>
  );
}

function ImproveStep({ step }: { step: OpenHealthClimbStep }) {
  if (step.outcome === "running") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="openhealth-climb-step-running">
        <Loader2 className="h-4 w-4 animate-spin" />
        Reading the run&apos;s scoring errors and writing Concepts. This takes a few minutes.
      </p>
    );
  }
  if (step.outcome !== "succeeded") {
    return (
      <p
        className={`text-sm ${step.outcome === "failed" ? "text-destructive" : "text-muted-foreground"}`}
        data-testid="openhealth-climb-step-ended"
      >
        {step.outcome === "failed" ? (step.error ?? "The improve run failed.") : "The improve run was cancelled."}
      </p>
    );
  }
  const nothing = step.created.length + step.amended.length + step.rejected.length + step.contestsAccepted.length === 0;
  return (
    <div className="space-y-3" data-testid="openhealth-climb-step-improve">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={step.applied ? "default" : "outline"}>
          {step.applied ? "Written to the graph" : "Proposed only"}
        </Badge>
        {step.summary && <span className="whitespace-pre-wrap">{step.summary}</span>}
      </div>
      {nothing && <p className="text-sm text-muted-foreground">The improve run proposed nothing.</p>}
      <NameList
        title="New Concepts"
        hint="Written under their parent Concept"
        names={step.created}
        testId="openhealth-climb-step-created"
      />
      <NameList
        title="Amended"
        hint="Existing Concepts given replacement docs"
        names={step.amended}
        testId="openhealth-climb-step-amended"
      />
      <NameList
        title="Refused"
        hint="Proposals that did not pass the workflow's checks"
        names={step.rejected}
        testId="openhealth-climb-step-rejected"
      />
      <NameList
        title="Contested gold"
        hint="Answer-key items the chart contradicts, recorded in the graph: excluded from the score from the next run on"
        names={step.contestsAccepted}
        testId="openhealth-climb-step-contests"
        tone={CONTESTED_TEXT}
      />
      <RejectedContests items={step.contestsRejected} />
    </div>
  );
}

/**
 * One climb: its strip (steps as chips), the selected step in full, and
 * the loop's graph, opened on that step's own subflow (the whole loop is a
 * crumb away). Polls while the climb runs; the newest step is shown
 * until one is picked. The pick is the caller's when `onSelectStep` is
 * given (so the chart can pick a step too), the viewer's own otherwise.
 */
export function OpenHealthClimbViewer({
  climbId,
  selected = null,
  onSelectStep,
  onSettled,
  onClimbStarted,
}: {
  climbId: string;
  /** The selected step, as an index into the climb's steps; null shows the newest. */
  selected?: number | null;
  /** A chip was picked. Given, the caller owns `selected`; absent, the viewer does, starting from it. */
  onSelectStep?: (index: number) => void;
  onSettled?: () => void;
  onClimbStarted?: (started: { climbId: string }) => void;
}) {
  const { workspace } = useWorkspace();
  const slug = workspace?.slug;
  const base = slug ? `/api/workspaces/${slug}/openhealth/benchmarks/climbs/${climbId}` : null;

  const [climb, setClimb] = useState<OpenHealthClimb | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ownPick, setOwnPick] = useState<number | null>(selected);
  const picked = onSelectStep ? selected : ownPick;
  const pick = onSelectStep ?? setOwnPick;
  const [panel, setPanel] = useState<Panel | null>(null);
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    if (!base) return;
    try {
      const response = await fetch(base, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as OpenHealthClimb & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load the climb");
      setClimb(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the climb");
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const running = climb?.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  // The list behind this viewer learns the climb is over when the viewer does.
  useEffect(() => {
    if (running) wasRunning.current = true;
    else if (climb && wasRunning.current) {
      wasRunning.current = false;
      onSettled?.();
    }
  }, [running, climb, onSettled]);

  if (error && !climb) {
    return (
      <p className="text-sm text-destructive" data-testid="openhealth-climb-error">
        {error}
      </p>
    );
  }
  if (!climb || !base) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading the climb…
      </p>
    );
  }

  const index = picked !== null && picked < climb.steps.length ? picked : climb.steps.length - 1;
  const step = index >= 0 ? climb.steps[index] : null;
  const toggle = (name: Panel) => (open: boolean) => setPanel(open ? name : null);
  const files = step?.kind === "benchmark" && step.outcome === "succeeded" ? `?iteration=${step.iteration}` : null;
  // The run's deliverable: a problem list, or a summary.
  const deliverable = openHealthDeliverable(climb.task);
  const deliverableLabel = deliverable === "summary" ? "Summary" : "Problem list";

  return (
    <div className="space-y-4" data-testid="openhealth-climb-viewer">
      <OpenHealthClimbStrip
        climb={climb}
        selected={index}
        onSelectStep={pick}
        onChanged={load}
        onClimbStarted={onClimbStarted}
      />

      {step && (
        <div className="space-y-3" data-testid="openhealth-climb-step-detail" data-kind={step.kind}>
          <p className="text-sm font-semibold">
            {step.kind === "benchmark" ? `Run ${step.iteration + 1}` : `Improve after run ${step.iteration + 1}`}
          </p>
          {step.kind === "benchmark" ? <BenchmarkStep step={step} climb={climb} /> : <ImproveStep step={step} />}
        </div>
      )}

      {climb.strutRunId && (
        <div className="flex flex-wrap gap-2">
          <PillSection
            label="Graph"
            open={panel === "graph"}
            onOpenChange={toggle("graph")}
            testId="openhealth-climb-graph"
          >
            <StrutRunGraph
              endpoint={`/api/workspaces/${slug}/strut/runs/${climbId}/graph`}
              workspaceSlug={slug}
              live={running}
              scope={step ? openHealthClimbStepPath(step) : null}
            />
          </PillSection>
          {files && (
            <>
              <PillSection
                label={deliverableLabel}
                open={panel === deliverable}
                onOpenChange={toggle(deliverable)}
                testId={`openhealth-climb-${deliverable}`}
              >
                <ArtifactPanel endpoint={`${base}/artifacts/${deliverable}${files}`} kind={deliverable} />
              </PillSection>
              <PillSection
                label="Timeline"
                open={panel === "timeline"}
                onOpenChange={toggle("timeline")}
                testId="openhealth-climb-timeline"
              >
                <ArtifactPanel endpoint={`${base}/artifacts/timeline${files}`} kind="markdown" />
              </PillSection>
              <PillSection
                label="Checklist"
                open={panel === "checklist"}
                onOpenChange={toggle("checklist")}
                testId="openhealth-climb-checklist"
              >
                <ArtifactPanel endpoint={`${base}/artifacts/checklist${files}`} kind="markdown" />
              </PillSection>
            </>
          )}
        </div>
      )}
    </div>
  );
}
