"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PillSection } from "@/components/legal/PillSection";
import { StrutRunGraph } from "@/components/strut-run-graph";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { OpenHealthClimb, OpenHealthClimbStep } from "@/types/openhealth";
import { formatCost, formatScore, formatWhen } from "../format";
import { OpenHealthClimbStrip } from "../OpenHealthClimbStrip";
import { ArtifactPanel } from "../OpenHealthRunViewer/ArtifactPanel";
import { DiagnosisList, Stages, Stat } from "../parts";

/** Poll cadence while the climb is in flight. */
const POLL_MS = 10_000;

type Panel = "graph" | "problem-list" | "timeline" | "checklist";

function NameList({ title, hint, names, testId }: { title: string; hint: string; names: string[]; testId: string }) {
  if (names.length === 0) return null;
  return (
    <div className="rounded-lg border bg-card" data-testid={testId}>
      <div className="border-b px-4 py-2">
        <p className="text-sm font-semibold">
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

function BenchmarkStep({ step }: { step: OpenHealthClimbStep }) {
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
        <Stat label="Weighted F1" value={formatScore(step.f1)} emphasis />
        <Stat label="Missed / extra" value={`${step.missed.length} / ${step.extra.length}`} />
        <Stat label="Cost" value={formatCost(step.costUsd)} />
        <Stat label="Started" value={step.startedAt ? formatWhen(step.startedAt) : "—"} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <DiagnosisList
          title="Missed"
          hint="In the answer key, not in the model's list"
          testId="openhealth-climb-step-missed"
          items={step.missed}
        />
        <DiagnosisList
          title="Extra"
          hint="In the model's list, matched nothing"
          testId="openhealth-climb-step-extra"
          items={step.extra}
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
  const nothing = step.created.length + step.amended.length + step.rejected.length === 0;
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
    </div>
  );
}

/**
 * One climb: its strip (steps as chips), the selected step in full, and
 * the loop's graph. Polls while the climb runs; the newest step is shown
 * until the member picks one.
 */
export function OpenHealthClimbViewer({
  climbId,
  initialStep = null,
  onSettled,
  onClimbStarted,
}: {
  climbId: string;
  /** The step to open with, as an index into the climb's steps. */
  initialStep?: number | null;
  onSettled?: () => void;
  onClimbStarted?: (started: { climbId: string }) => void;
}) {
  const { workspace } = useWorkspace();
  const slug = workspace?.slug;
  const base = slug ? `/api/workspaces/${slug}/openhealth/benchmarks/climbs/${climbId}` : null;

  const [climb, setClimb] = useState<OpenHealthClimb | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(initialStep);
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

  return (
    <div className="space-y-4" data-testid="openhealth-climb-viewer">
      <OpenHealthClimbStrip
        climb={climb}
        selected={index}
        onSelectStep={setPicked}
        onChanged={load}
        onClimbStarted={onClimbStarted}
      />

      {step && (
        <div className="space-y-3" data-testid="openhealth-climb-step-detail" data-kind={step.kind}>
          <p className="text-sm font-semibold">
            {step.kind === "benchmark" ? `Run ${step.iteration + 1}` : `Improve after run ${step.iteration + 1}`}
          </p>
          {step.kind === "benchmark" ? <BenchmarkStep step={step} /> : <ImproveStep step={step} />}
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
            <StrutRunGraph endpoint={`${base}/graph`} live={running} />
          </PillSection>
          {files && (
            <>
              <PillSection
                label="Problem list"
                open={panel === "problem-list"}
                onOpenChange={toggle("problem-list")}
                testId="openhealth-climb-problem-list"
              >
                <ArtifactPanel endpoint={`${base}/artifacts/problem-list${files}`} kind="problem-list" />
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
