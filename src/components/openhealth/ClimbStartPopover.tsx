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
  isClimbRuns,
  isClimbTarget,
  OPENHEALTH_CLIMB_DEFAULT_RUNS,
  OPENHEALTH_CLIMB_DEFAULT_TARGET,
  OPENHEALTH_CLIMB_MAX_RUNS,
} from "@/lib/openhealth-benchmarks/climb";
import type { OpenHealthBenchmark, OpenHealthSplit } from "@/types/openhealth";
import { formatCost } from "./format";

export interface ClimbStartPopoverProps {
  gtId: number;
  split?: OpenHealthSplit;
  /** The task's benchmark; diagnosis when absent. The route checks the task against that catalogue. */
  benchmark?: OpenHealthBenchmark;
  /** Mean USD of this task's scored runs, for the estimate. */
  meanRunCost?: number | null;
  label?: string;
  disabled?: boolean;
  size?: "sm" | "default";
  variant?: "default" | "outline" | "secondary";
  className?: string;
  onStarted?: (started: { climbId: string }) => void;
}

/**
 * The "Climb" button and its settings: the target score and how many runs
 * at most. Starting posts to the climbs route, which launches the loop on
 * strut; the page then shows the climb.
 */
export function ClimbStartPopover({
  gtId,
  split,
  benchmark,
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
  const [runs, setRuns] = useState(String(OPENHEALTH_CLIMB_DEFAULT_RUNS));
  const [starting, setStarting] = useState(false);

  const targetValue = Number(target);
  const runsValue = Number(runs);
  const problem = !isClimbTarget(targetValue)
    ? "The target is a score above 0 and at most 1."
    : !isClimbRuns(runsValue)
      ? `Max runs is a whole number from 1 to ${OPENHEALTH_CLIMB_MAX_RUNS}.`
      : null;
  const estimate = problem === null && typeof meanRunCost === "number" ? meanRunCost * runsValue : null;

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
          ...(benchmark ? { task: benchmark.task } : {}),
          ...(benchmark?.variant ? { variant: benchmark.variant } : {}),
          targetF1: targetValue,
          maxRuns: runsValue,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { climbId?: string; error?: string };
      if (!response.ok || !body.climbId) throw new Error(body.error || "Could not start the climb");
      setOpen(false);
      onStarted?.({ climbId: body.climbId });
    } catch (e) {
      toast.error("Could not start the climb", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setStarting(false);
    }
  }, [slug, problem, gtId, split, benchmark, targetValue, runsValue, onStarted]);

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
            Runs the task, turns the run&apos;s scoring errors into Concepts, and runs it again. Stops at the first run
            that scores the target, or after the last run.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor={`climb-target-${gtId}`} className="text-xs">
              Target score
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
            <Label htmlFor={`climb-runs-${gtId}`} className="text-xs">
              Max runs
            </Label>
            <Input
              id={`climb-runs-${gtId}`}
              type="number"
              inputMode="numeric"
              min={1}
              max={OPENHEALTH_CLIMB_MAX_RUNS}
              step={1}
              value={runs}
              onChange={(event) => setRuns(event.target.value)}
              data-testid="openhealth-climb-runs"
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
              ? `About ${formatCost(estimate)} in benchmark runs for up to ${runsValue} ${runsValue === 1 ? "run" : "runs"}, plus the improve runs between them.`
              : `Up to ${runsValue} ${runsValue === 1 ? "run" : "runs"}, plus the improve runs between them.`}
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
