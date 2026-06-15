"use client";

import React, { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ExternalLink, Flag } from "lucide-react";
import { useWorkflowRuns, type WorkflowRun } from "@/hooks/useWorkflowRuns";
import { FlagRunEvalModal } from "@/components/evals/FlagRunEvalModal";

const MAX_RUN_NAME_LEN = 40;

interface WorkflowRunsTableProps {
  slug: string;
  workflowId: number;
  onRunSelect?: (runId: number) => void;
  selectedRunId?: number;
  onEvalCaptured?: () => void;
}

function statusVariant(
  status: WorkflowRun["status"],
): "default" | "destructive" | "secondary" | "outline" {
  switch (status) {
    case "finished":
      return "default";
    case "error":
      return "destructive";
    case "halted":
      return "secondary";
    case "active":
      return "outline";
    case "completed":
      return "default";
  }
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
  const { runs, isLoading } = useWorkflowRuns(slug, workflowId);
  const [flaggingRunId, setFlaggingRunId] = useState<string | null>(null);
  const [flaggedRunIds, setFlaggedRunIds] = useState<Set<string>>(new Set());

  if (isLoading) {
    return (
      <div className="p-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">Run Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started At</TableHead>
              <TableHead>Finished At</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead className="w-24">View in Stak</TableHead>
              <TableHead className="w-16">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[0, 1, 2].map((i) => (
              <TableRow key={i}>
                <TableCell>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-8" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-8" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground p-4">No runs recorded yet.</p>;
  }

  const workflowIdStr = String(workflowId);

  return (
    <div className="p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-48">Run Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Started At</TableHead>
            <TableHead>Finished At</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead className="w-24">View in Stak</TableHead>
            <TableHead className="w-16">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => {
            const runIdStr = String(run.id);
            const isFlagged = flaggedRunIds.has(runIdStr);

            return (
              <TableRow
                key={run.id}
                onClick={() => onRunSelect?.(run.id)}
                className={`${run.id === selectedRunId ? "bg-muted" : ""} ${onRunSelect ? "cursor-pointer" : ""}`}
              >
                <TableCell>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-sm font-medium truncate block max-w-[180px]">
                        {run.name.length > MAX_RUN_NAME_LEN
                          ? run.name.slice(0, MAX_RUN_NAME_LEN) + "…"
                          : run.name}
                      </span>
                    </TooltipTrigger>
                    {run.name.length > MAX_RUN_NAME_LEN && (
                      <TooltipContent>{run.name}</TooltipContent>
                    )}
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                </TableCell>
                <TableCell className="text-sm">
                  {run.started_at ? new Date(run.started_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell className="text-sm">
                  {run.finished_at ? new Date(run.finished_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell className="text-sm">
                  {formatDuration(run.started_at, run.finished_at)}
                </TableCell>
                <TableCell>
                  <a
                    href={`https://jobs.stakwork.com/admin/projects/${run.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-blue-600 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open
                  </a>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {isFlagged ? (
                    <Flag className="h-4 w-4 text-orange-500 fill-orange-500 mx-auto" aria-label="Eval captured" />
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Capture eval"
                      onClick={() => setFlaggingRunId(runIdStr)}
                      className="h-7 w-7"
                      aria-label="Capture eval"
                    >
                      <Flag className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>

                {flaggingRunId === runIdStr && (
                  <FlagRunEvalModal
                    open={true}
                    onOpenChange={(o) => { if (!o) setFlaggingRunId(null); }}
                    slug={slug}
                    workflowId={workflowIdStr}
                    runId={runIdStr}
                    onCaptured={() => {
                      setFlaggedRunIds((prev) => new Set(prev).add(runIdStr));
                      setFlaggingRunId(null);
                      onEvalCaptured?.();
                    }}
                  />
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
