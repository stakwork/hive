"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, FlaskConical, Loader2, Sparkles, Square, TrendingUp, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import type { OpenHealthClimb, OpenHealthClimbStep, OpenHealthProgressResponse } from "@/types/openhealth";
import { ClimbStartPopover } from "../ClimbStartPopover";
import { formatCost, formatScore } from "../format";

/** Poll cadence for the stage of the attempt in flight. */
const POLL_MS = 10_000;

function conceptsOf(climb: OpenHealthClimb): { created: number; amended: number } {
  return climb.steps.reduce(
    (sum, step) =>
      step.kind === "improve"
        ? { created: sum.created + (step.created ?? 0), amended: sum.amended + (step.amended ?? 0) }
        : sum,
    { created: 0, amended: 0 },
  );
}

function headline(climb: OpenHealthClimb): { title: string; meta: string } {
  const { created, amended } = conceptsOf(climb);
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
  const attempts = `${climb.attempts} ${climb.attempts === 1 ? "attempt" : "attempts"}`;
  const cost = climb.costUsd !== null ? formatCost(climb.costUsd) : null;
  const tail = [attempts, span, concepts || null, cost].filter(Boolean).join(" · ");
  switch (climb.status) {
    case "running":
      return {
        title: `Climbing task ${climb.gtId}`,
        meta: `attempt ${climb.attempts} of ${climb.maxAttempts} · best ${formatScore(climb.bestF1)} · target ${formatScore(climb.targetF1)}`,
      };
    case "reached":
      return { title: `Reached ${formatScore(climb.bestF1)} on task ${climb.gtId}`, meta: tail };
    case "exhausted":
      return {
        title: `Stopped after ${attempts} on task ${climb.gtId}`,
        meta: `target ${formatScore(climb.targetF1)} not reached · ${tail}`,
      };
    case "stalled":
      return { title: `Nothing left to change on task ${climb.gtId}`, meta: tail };
    case "stopped":
      return { title: `Climb stopped on task ${climb.gtId}`, meta: tail };
    case "failed":
      return { title: `Climb failed on task ${climb.gtId}`, meta: tail };
  }
}

const CHIP = "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs";

function StepChip({ step, stage, onOpen }: { step: OpenHealthClimbStep; stage: string | null; onOpen?: () => void }) {
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
  const label = step.kind === "benchmark" ? `Run ${step.attempt}` : "Improve";
  const detail =
    step.kind === "benchmark"
      ? running
        ? (stage ?? "running")
        : step.f1 !== null
          ? formatScore(step.f1)
          : step.outcome
      : running
        ? "writing Concepts"
        : step.outcome === "succeeded"
          ? [step.created ? `+${step.created}` : null, step.amended ? `${step.amended} amended` : null]
              .filter(Boolean)
              .join(", ") || "wrote nothing"
          : step.outcome;
  return (
    <button
      type="button"
      className={`${CHIP} ${tone} ${onOpen ? "hover:border-foreground/40" : "cursor-default"}`}
      onClick={onOpen}
      disabled={!onOpen}
      title={step.error ?? undefined}
      data-testid="openhealth-climb-step"
      data-kind={step.kind}
      data-outcome={step.outcome}
    >
      <Icon className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
      <span className="font-medium">{label}</span>
      <span className={step.kind === "benchmark" && !running ? "font-semibold tabular-nums" : "tabular-nums"}>
        {detail}
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
 * One climb: where it stands, its steps in order (each opens the run it
 * stands for), Stop while it runs, and "Climb again" once it has ended.
 */
export function OpenHealthClimbStrip({
  climb,
  onOpenRun,
  onChanged,
  onClimbStarted,
}: {
  climb: OpenHealthClimb;
  /** Open a benchmark run in the viewer. */
  onOpenRun?: (runId: string) => void;
  /** After a stop was accepted. */
  onChanged?: () => void;
  onClimbStarted?: (started: { climbId: string; runId: string }) => void;
}) {
  const { workspace } = useWorkspace();
  const { canWrite } = useWorkspaceAccess();
  const slug = workspace?.slug;
  const base = slug ? `/api/workspaces/${slug}/openhealth/benchmarks` : null;
  const [stopping, setStopping] = useState(false);
  const [stage, setStage] = useState<string | null>(null);

  const running = climb.status === "running";
  const current = climb.steps.find((step) => step.runId === climb.currentRunId) ?? null;
  const currentAttempt =
    running && current?.kind === "benchmark" && current.outcome === "running" ? current.runId : null;

  // The stage of the attempt in flight, from the run's progress route.
  useEffect(() => {
    if (!base || !currentAttempt) {
      setStage(null);
      return;
    }
    let stale = false;
    const load = async () => {
      try {
        const response = await fetch(`${base}/runs/${currentAttempt}/progress`, { cache: "no-store" });
        if (!response.ok) return;
        const { stages } = (await response.json()) as OpenHealthProgressResponse;
        const active =
          stages.find((s) => s.status === "running") ?? [...stages].reverse().find((s) => s.status === "done");
        if (stale || !active) return;
        setStage(
          active.total
            ? `${active.label.toLowerCase()} ${active.done ?? 0}/${active.total}`
            : active.label.toLowerCase(),
        );
      } catch {
        // The chip falls back to "running".
      }
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      stale = true;
      clearInterval(timer);
    };
  }, [base, currentAttempt]);

  const stop = useCallback(async () => {
    if (!base) return;
    setStopping(true);
    try {
      const response = await fetch(`${base}/climbs/${climb.id}/stop`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not stop the climb");
      toast.success("Stopping — the step in flight ends at its next boundary");
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

  // An improve step opens the attempt it followed.
  const openFor = (index: number): (() => void) | undefined => {
    if (!onOpenRun) return undefined;
    const step = climb.steps[index];
    if (step.kind === "benchmark") return () => onOpenRun(step.runId);
    const before = climb.steps
      .slice(0, index)
      .reverse()
      .find((s) => s.kind === "benchmark");
    return before ? () => onOpenRun(before.runId) : undefined;
  };

  const best = climb.bestRunId ? climb.steps.find((s) => s.runId === climb.bestRunId) : null;

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
            best &&
            best.f1 !== null && (
              <ClimbStartPopover
                gtId={climb.gtId}
                seed={{ runId: best.runId, f1: best.f1 }}
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
          <React.Fragment key={step.runId}>
            {index > 0 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60" />}
            <StepChip step={step} stage={step.runId === currentAttempt ? stage : null} onOpen={openFor(index)} />
          </React.Fragment>
        ))}
        {running && climb.attempts < climb.maxAttempts && (
          <>
            <span className="px-1 text-xs text-muted-foreground/60">· · ·</span>
            <span className={`${CHIP} border-dashed text-muted-foreground`}>up to run {climb.maxAttempts}</span>
          </>
        )}
      </div>

      {running ? (
        <p className="text-xs text-muted-foreground">
          Each step opens the run it stands for. Stops when a run scores {formatScore(climb.targetF1)}, after{" "}
          {climb.maxAttempts} attempts, or when an improve run writes nothing.
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
