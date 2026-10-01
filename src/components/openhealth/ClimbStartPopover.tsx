"use client";

import React, { useCallback, useState } from "react";
import { Loader2, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  isClimbAttempts,
  isClimbTarget,
  OPENHEALTH_CLIMB_DEFAULT_ATTEMPTS,
  OPENHEALTH_CLIMB_DEFAULT_TARGET,
  OPENHEALTH_CLIMB_MAX_ATTEMPTS,
} from "@/lib/openhealth-benchmarks/climb";
import type { OpenHealthSplit } from "@/types/openhealth";
import { formatCost, formatScore } from "./format";

export interface ClimbStartPopoverProps {
  gtId: number;
  split?: OpenHealthSplit;
  /** A scored run to adopt as attempt 1: the climb starts with an improve over it. */
  seed?: { runId: string; f1: number } | null;
  /** Mean USD of this task's scored runs, for the estimate. */
  meanRunCost?: number | null;
  label?: string;
  disabled?: boolean;
  size?: "sm" | "default";
  variant?: "default" | "outline" | "secondary";
  className?: string;
  onStarted?: (started: { climbId: string; runId: string }) => void;
}

/**
 * The "Climb" button and its settings: target F1 and the attempt budget.
 * Starting posts to the climbs route; the page then shows the climb strip.
 */
export function ClimbStartPopover({
  gtId,
  split,
  seed,
  meanRunCost,
  label = "Climb",
  disabled,
  size = "sm",
  variant = "outline",
  className,
  onStarted,
}: ClimbStartPopoverProps) {
  const { workspace } = useWorkspace();
  const slug = workspace?.slug;
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(String(OPENHEALTH_CLIMB_DEFAULT_TARGET));
  const [attempts, setAttempts] = useState(String(OPENHEALTH_CLIMB_DEFAULT_ATTEMPTS));
  const [starting, setStarting] = useState(false);

  const targetValue = Number(target);
  const attemptsValue = Number(attempts);
  const minAttempts = seed ? 2 : 1;
  const problem = !isClimbTarget(targetValue)
    ? "The target is a score above 0 and at most 1."
    : seed && targetValue <= seed.f1
      ? `This run already scored ${formatScore(seed.f1)}. Pick a higher target.`
      : !isClimbAttempts(attemptsValue) || attemptsValue < minAttempts
        ? `Attempts is a whole number from ${minAttempts} to ${OPENHEALTH_CLIMB_MAX_ATTEMPTS}.`
        : null;
  const newRuns = problem ? null : attemptsValue - (seed ? 1 : 0);
  const estimate = newRuns !== null && typeof meanRunCost === "number" ? meanRunCost * newRuns : null;

  const start = useCallback(async () => {
    if (!slug || problem) return;
    setStarting(true);
    try {
      const response = await fetch(`/api/workspaces/${slug}/openhealth/benchmarks/climbs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gtId,
          ...(split ? { split } : {}),
          targetF1: targetValue,
          maxAttempts: attemptsValue,
          ...(seed ? { seedRunId: seed.runId } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { climbId?: string; runId?: string; error?: string };
      if (!response.ok || !body.climbId || !body.runId) throw new Error(body.error || "Could not start the climb");
      setOpen(false);
      onStarted?.({ climbId: body.climbId, runId: body.runId });
    } catch (e) {
      toast.error("Could not start the climb", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setStarting(false);
    }
  }, [slug, problem, gtId, split, targetValue, attemptsValue, seed, onStarted]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size={size}
          variant={variant}
          disabled={disabled}
          className={className}
          data-testid="openhealth-climb-open"
        >
          <TrendingUp className="h-3.5 w-3.5" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3" data-testid="openhealth-climb-form">
        <div>
          <p className="text-sm font-semibold">Climb task {gtId}</p>
          <p className="text-xs text-muted-foreground">
            {seed
              ? `Attempt 1 is this run (${formatScore(seed.f1)}). An improve run turns its errors into Concepts, then the task runs again.`
              : "Runs the task, turns the run's scoring errors into Concepts, and runs it again."}{" "}
            Stops at the target, when the attempts are spent, or when an improve run writes nothing.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor={`climb-target-${gtId}`} className="text-xs">
              Target F1
            </Label>
            <Input
              id={`climb-target-${gtId}`}
              type="number"
              inputMode="decimal"
              min={0.05}
              max={1}
              step={0.05}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              data-testid="openhealth-climb-target"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`climb-attempts-${gtId}`} className="text-xs">
              Max attempts
            </Label>
            <Input
              id={`climb-attempts-${gtId}`}
              type="number"
              inputMode="numeric"
              min={minAttempts}
              max={OPENHEALTH_CLIMB_MAX_ATTEMPTS}
              step={1}
              value={attempts}
              onChange={(event) => setAttempts(event.target.value)}
              data-testid="openhealth-climb-attempts"
            />
          </div>
        </div>
        {problem ? (
          <p className="text-xs text-destructive" data-testid="openhealth-climb-problem">
            {problem}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground" data-testid="openhealth-climb-estimate">
            {estimate !== null
              ? `About ${formatCost(estimate)} in benchmark runs for ${newRuns} new ${newRuns === 1 ? "run" : "runs"}, plus the improve runs.`
              : `Up to ${newRuns} new ${newRuns === 1 ? "run" : "runs"}, plus the improve runs.`}
          </p>
        )}
        <Button
          size="sm"
          className="w-full"
          disabled={!slug || !!problem || starting}
          onClick={() => void start()}
          data-testid="openhealth-climb-start"
        >
          {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="h-3.5 w-3.5" />}
          Start climbing
        </Button>
      </PopoverContent>
    </Popover>
  );
}
