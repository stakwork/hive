"use client";

import React, { useCallback, useState } from "react";
import { ArrowRight, Check, FlaskConical, Loader2, Sparkles, Square, TrendingUp, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import type { OpenHealthClimb, OpenHealthClimbStep } from "@/types/openhealth";
import { ClimbStartPopover } from "../ClimbStartPopover";
import { formatCost, formatScore } from "../format";
import { describeStage } from "../parts";

/** What the climb's improve runs changed in the graph, by count. */
export function climbConcepts(climb: OpenHealthClimb): { created: number; amended: number } {
  return climb.steps.reduce(
    (sum, step) =>
      step.kind === "improve"
        ? { created: sum.created + step.created.length, amended: sum.amended + step.amended.length }
        : sum,
    { created: 0, amended: 0 },
  );
}

function headline(climb: OpenHealthClimb): { title: string; meta: string } {
  const task = climb.gtId === null ? "a task" : `task ${climb.gtId}`;
  const { created, amended } = climbConcepts(climb);
  const concepts = [
    created > 0 ? `${created} ${created === 1 ? "Concept" : "Concepts"} added` : null,
    amended > 0 ? `${amended} amended` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const span =
    climb.startF1 !== null && climb.bestF1 !== null && climb.startF1 !== climb.bestF1
      ? `${formatScore(climb.startF1)} → ${formatScore(climb.bestF1)}`
      : `best ${formatScore(climb.bestF1)}`;
  const runs = `${climb.attempts} ${climb.attempts === 1 ? "run" : "runs"}`;
  const cost = climb.costUsd !== null ? formatCost(climb.costUsd) : null;
  const tail = [runs, span, concepts || null, cost].filter(Boolean).join(" · ");
  switch (climb.status) {
    case "running":
      return {
        title: `Climbing ${task}`,
        meta:
          climb.attempts === 0
            ? `starting · target ${formatScore(climb.targetF1)}`
            : `run ${climb.attempts} of ${climb.maxRuns} · best ${formatScore(climb.bestF1)} · target ${formatScore(climb.targetF1)}`,
      };
    case "reached":
      return { title: `Reached ${formatScore(climb.bestF1)} on ${task}`, meta: tail };
    case "exhausted":
      return {
        title: `Stopped after ${runs} on ${task}`,
        meta: `target ${formatScore(climb.targetF1)} not reached · ${tail}`,
      };
    case "stopped":
      return { title: `Climb stopped on ${task}`, meta: tail };
    case "failed":
      return { title: `Climb failed on ${task}`, meta: tail };
  }
}

const CHIP = "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs";

function stepDetail(step: OpenHealthClimbStep): string {
  if (step.kind === "benchmark") {
    if (step.outcome === "running") return (step.stages && describeStage(step.stages)) ?? "running";
    return step.f1 !== null ? formatScore(step.f1) : step.outcome;
  }
  if (step.outcome === "running") return "writing Concepts";
  if (step.outcome !== "succeeded") return step.outcome;
  const wrote = [
    step.created.length ? `+${step.created.length}` : null,
    step.amended.length ? `${step.amended.length} amended` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return wrote || (step.applied ? "wrote nothing" : "not applied");
}

function StepChip({ step, selected, onOpen }: { step: OpenHealthClimbStep; selected: boolean; onOpen?: () => void }) {
  const running = step.outcome === "running";
  const bad = step.outcome === "failed";
  const off = step.outcome === "cancelled";
  const tone = bad
    ? "border-destructive/40 bg-destructive/5 text-destructive"
    : off
      ? "border-dashed text-muted-foreground"
      : running
        ? "border-primary/40 bg-primary/5 text-primary"
        : step.kind === "improve"
          ? "border-transparent bg-secondary text-secondary-foreground"
          : "bg-card";
  const Icon = running ? Loader2 : bad ? X : step.kind === "improve" ? Sparkles : FlaskConical;
  const label = step.kind === "benchmark" ? `Run ${step.iteration + 1}` : "Improve";
  return (
    <button
      type="button"
      className={`${CHIP} ${tone} ${selected ? "ring-2 ring-primary/40" : ""} ${onOpen ? "hover:border-foreground/40" : "cursor-default"}`}
      onClick={onOpen}
      disabled={!onOpen}
      title={step.error ?? undefined}
      aria-pressed={selected}
      data-testid="openhealth-climb-step"
      data-kind={step.kind}
      data-outcome={step.outcome}
    >
      <Icon className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
      <span className="font-medium">{label}</span>
      <span className={step.kind === "benchmark" && !running ? "font-semibold tabular-nums" : "tabular-nums"}>
        {stepDetail(step)}
      </span>
      {step.kind === "benchmark" && step.f1 !== null && (
        <span className={`text-[10px] ${step.newBest ? "text-green-600" : "text-muted-foreground"}`}>
          {step.newBest ? "new best" : "below best"}
        </span>
      )}
    </button>
  );
}

/**
 * One climb: where it stands, its steps in order, Stop while it runs, and
 * "Climb again" once it has ended. A step chip selects that step
 * (`onSelectStep` with its index in `climb.steps`).
 */
export function OpenHealthClimbStrip({
  climb,
  selected = null,
  onSelectStep,
  onChanged,
  onClimbStarted,
}: {
  climb: OpenHealthClimb;
  /** The index of the selected step, when the strip has a viewer under it. */
  selected?: number | null;
  onSelectStep?: (index: number) => void;
  /** After a stop was accepted. */
  onChanged?: () => void;
  onClimbStarted?: (started: { climbId: string }) => void;
}) {
  const { workspace } = useWorkspace();
  const { canWrite } = useWorkspaceAccess();
  const slug = workspace?.slug;
  const base = slug ? `/api/workspaces/${slug}/openhealth/benchmarks` : null;
  const [stopping, setStopping] = useState(false);

  const running = climb.status === "running";

  const stop = useCallback(async () => {
    if (!base) return;
    setStopping(true);
    try {
      const response = await fetch(`${base}/climbs/${climb.id}/cancel`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not stop the climb");
      toast.success("Stopping — the loop ends at its next step");
      onChanged?.();
    } catch (e) {
      toast.error("Could not stop the climb", { description: e instanceof Error ? e.message : "Please try again." });
    } finally {
      setStopping(false);
    }
  }, [base, climb.id, onChanged]);

  const { title, meta } = headline(climb);
  const Icon = climb.status === "reached" ? Check : climb.status === "failed" ? X : TrendingUp;
  const frame =
    climb.status === "reached"
      ? "border-green-600/40"
      : climb.status === "failed"
        ? "border-destructive/40"
        : running
          ? "border-primary/40"
          : "";
  const iconTone =
    climb.status === "reached" ? "text-green-600" : climb.status === "failed" ? "text-destructive" : "text-primary";

  return (
    <div
      className={`space-y-3 rounded-lg border bg-card px-4 py-3 ${frame}`}
      data-testid="openhealth-climb"
      data-status={climb.status}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Icon className={`h-4 w-4 ${iconTone}`} />
        <span className="text-sm font-semibold" data-testid="openhealth-climb-title">
          {title}
        </span>
        <span className="text-xs text-muted-foreground" data-testid="openhealth-climb-meta">
          {meta}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {running && climb.costUsd !== null && (
            <span className="text-xs text-muted-foreground">{formatCost(climb.costUsd)} so far</span>
          )}
          {running ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!canWrite || stopping}
              onClick={() => void stop()}
              data-testid="openhealth-climb-stop"
            >
              {stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
              {stopping ? "Stopping…" : "Stop"}
            </Button>
          ) : (
            climb.gtId !== null && (
              <ClimbStartPopover
                gtId={climb.gtId}
                meanRunCost={climb.costUsd !== null && climb.attempts > 0 ? climb.costUsd / climb.attempts : null}
                label="Climb again"
                disabled={!canWrite}
                onStarted={onClimbStarted}
              />
            )
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" data-testid="openhealth-climb-steps">
        {climb.steps.map((step, index) => (
          <React.Fragment key={`${step.kind}-${step.iteration}`}>
            {index > 0 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60" />}
            <StepChip
              step={step}
              selected={selected === index}
              onOpen={onSelectStep ? () => onSelectStep(index) : undefined}
            />
          </React.Fragment>
        ))}
        {running && climb.steps.length === 0 && (
          <span className={`${CHIP} border-primary/40 bg-primary/5 text-primary`}>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="font-medium">Run 1</span>
            <span>starting</span>
          </span>
        )}
        {running && climb.attempts < climb.maxRuns && (
          <>
            <span className="px-1 text-xs text-muted-foreground/60">· · ·</span>
            <span className={`${CHIP} border-dashed text-muted-foreground`}>up to run {climb.maxRuns}</span>
          </>
        )}
      </div>

      {running ? (
        <p className="text-xs text-muted-foreground">
          Stops at the first run that scores {formatScore(climb.targetF1)}, or after run {climb.maxRuns}. The Concepts
          its improve runs write stay.
        </p>
      ) : (
        climb.stopReason && (
          <p
            className={`text-xs ${climb.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
            data-testid="openhealth-climb-reason"
          >
            {climb.stopReason}
          </p>
        )
      )}
    </div>
  );
}
