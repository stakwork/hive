"use client";

import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ExternalLink } from "lucide-react";
import { useWorkflowRuns, type WorkflowRun } from "@/hooks/useWorkflowRuns";

const MAX_RUN_NAME_LEN = 40;

interface WorkflowRunsTableProps {
  slug: string;
  workflowId: number;
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

export function WorkflowRunsTable({ slug, workflowId }: WorkflowRunsTableProps) {
  const { runs, isLoading } = useWorkflowRuns(slug, workflowId);

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
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={`https://jobs.stakwork.com/admin/projects/${run.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800 group"
                    >
                      <span className="truncate">
                        {run.name.length > MAX_RUN_NAME_LEN
                          ? run.name.slice(0, MAX_RUN_NAME_LEN) + "…"
                          : run.name}
                      </span>
                      <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </a>
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
