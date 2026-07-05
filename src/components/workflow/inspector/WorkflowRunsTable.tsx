"use client";

import React, { useState } from "react";
import { formatRelativeOrDateInTz } from "@/lib/date-utils";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExternalLink, Flag, Bug, Loader2, MoreVertical } from "lucide-react";
import { useWorkflowRuns } from "@/hooks/useWorkflowRuns";
import { FlagRunEvalModal } from "@/components/evals/FlagRunEvalModal";
import { startDebugRun } from "@/lib/workflow/debugRun";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { RunStatusDot, runStatusMeta } from "./runStatus";

interface WorkflowRunsTableProps {
  slug: string;
  workflowId: number;
  onRunSelect?: (runId: number) => void;
  selectedRunId?: number;
  onEvalCaptured?: () => void;
}

function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) return "—";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return "—";
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export function WorkflowRunsTable({
  slug,
  workflowId,
  onRunSelect,
  selectedRunId,
  onEvalCaptured,
}: WorkflowRunsTableProps) {
  const { timezone } = useUserTimezone();
  const { runs, isLoading } = useWorkflowRuns(slug, workflowId);
  const [flaggingRunId, setFlaggingRunId] = useState<string | null>(null);
  const [flaggedRunIds, setFlaggedRunIds] = useState<Set<string>>(new Set());
  const [debuggingRunId, setDebuggingRunId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-1 px-2 py-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 px-2.5 py-2">
            <Skeleton className="h-2 w-2 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (runs.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No runs recorded yet.</p>;
  }

  return (
    <>
    <div className="px-2 pb-3 @container/runs">
      {runs.map((run) => {
        const runIdStr = String(run.id);
        const isFlagged = flaggedRunIds.has(runIdStr);
        const isDebugging = debuggingRunId === runIdStr;
        const isSelected = run.id === selectedRunId;
        const meta = runStatusMeta(run.status);
        const openHref = `https://jobs.stakwork.com/admin/projects/${run.id}`;

        const handleFlag = (e: React.MouseEvent) => {
          e.stopPropagation();
          if (!isFlagged) setFlaggingRunId(runIdStr);
        };
        const handleDebug = async (e: React.MouseEvent) => {
          e.stopPropagation();
          // Open blank tab synchronously to avoid popup blockers
          const tab = window.open("", "_blank");
          setDebuggingRunId(runIdStr);
          try {
            const taskId = await startDebugRun({ slug, workflowId, runId: run.id });
            if (tab) tab.location.href = `/w/${slug}/task/${taskId}`;
          } catch {
            tab?.close();
            toast.error("Failed to start debug session");
          } finally {
            setDebuggingRunId(null);
          }
        };

        return (
          <div
            key={run.id}
            data-testid="run-row"
            role={onRunSelect ? "button" : undefined}
            tabIndex={onRunSelect ? 0 : undefined}
            onClick={() => onRunSelect?.(run.id)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return; // ignore events from child elements (e.g. modal inputs)
              if (onRunSelect && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onRunSelect(run.id);
              }
            }}
            className={cn(
              "group/run relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
              onRunSelect && "cursor-pointer",
              isSelected ? "bg-muted" : "hover:bg-muted/60",
            )}
          >
            {isSelected && (
              <span className={cn("absolute left-0 top-1/2 h-7 w-0.5 -translate-y-1/2 rounded-full", meta.bar)} />
            )}

            <RunStatusDot status={run.status} />

            <div className="min-w-0 flex-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="truncate text-xs font-medium text-foreground">{run.name}</div>
                </TooltipTrigger>
                <TooltipContent>{run.name}</TooltipContent>
              </Tooltip>
              <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground whitespace-nowrap">
                <span className="font-mono">#{run.id}</span>
                <span>·</span>
                <span className={meta.text}>{meta.label}</span>
                <span>·</span>
                <span>{run.started_at ? formatRelativeOrDateInTz(run.started_at, timezone) : "—"}</span>
                <span>·</span>
                <span className="font-mono tabular-nums">
                  {formatDuration(run.started_at, run.finished_at)}
                </span>
              </div>
            </div>

            <div
              className={cn(
                "shrink-0 transition-opacity",
                isSelected ? "opacity-100" : "opacity-0 group-hover/run:opacity-100 focus-within:opacity-100",
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Wide: inline icon actions */}
              <div className="hidden items-center gap-0.5 @[300px]/runs:flex">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      aria-label="Open in Stak"
                    >
                      <a href={openHref} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open in Stak</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      aria-label={isFlagged ? "Eval captured" : "Flag for eval"}
                      disabled={isFlagged}
                      onClick={handleFlag}
                    >
                      <Flag className={cn("h-4 w-4", isFlagged && "fill-orange-500 text-orange-500")} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{isFlagged ? "Eval captured" : "Flag for eval"}</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      aria-label="Debug run"
                      disabled={isDebugging}
                      onClick={handleDebug}
                    >
                      {isDebugging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bug className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Debug run</TooltipContent>
                </Tooltip>
              </div>

              {/* Narrow: collapse to a 3-dot menu */}
              <div className="@[300px]/runs:hidden">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" aria-label="Run actions">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <a href={openHref} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Open in Stak
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleFlag} disabled={isFlagged}>
                      <Flag className={cn("mr-2 h-4 w-4", isFlagged && "fill-orange-500 text-orange-500")} />
                      {isFlagged ? "Eval captured" : "Flag for eval"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDebug} disabled={isDebugging}>
                      {isDebugging ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Bug className="mr-2 h-4 w-4" />
                      )}
                      Debug run
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

            </div>
          </div>
        );
      })}
    </div>
    {flaggingRunId && (
      <FlagRunEvalModal
        open={true}
        onOpenChange={(o) => {
          if (!o) setFlaggingRunId(null);
        }}
        slug={slug}
        workflowId={String(workflowId)}
        runId={flaggingRunId}
        onCaptured={() => {
          setFlaggedRunIds((prev) => new Set(prev).add(flaggingRunId));
          setFlaggingRunId(null);
          onEvalCaptured?.();
        }}
      />
    )}
    </>
  );
}
