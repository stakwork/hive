"use client";

import React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ErrorStatusBadge } from "./ErrorStatusBadge";
import { TriageActions } from "./TriageActions";
import { GitPullRequest, HelpCircle } from "lucide-react";
import type { ErrorIssueRecord, ErrorIssueStatus } from "@/types/error-issues";
import { IMPACT_EXPLANATION } from "@/lib/utils/impact-tier";
import { ImpactBadge } from "./ImpactBadge";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Small "?" info popover that surfaces the IMPACT_EXPLANATION text. */
function ImpactInfoPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center ml-1 text-muted-foreground hover:text-foreground focus:outline-none"
          aria-label="What does Impact mean?"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm" side="top">
        {IMPACT_EXPLANATION}
      </PopoverContent>
    </Popover>
  );
}

/** Render a compact impact indicator. Score is [0,1]; null = unscored. */
function ImpactIndicator({
  score,
  meta,
}: {
  score: number | null;
  meta: Record<string, unknown> | null;
}) {
  return <ImpactBadge score={score} meta={meta} testId="impact-indicator" />;
}

interface ErrorIssuesTableProps {
  issues: ErrorIssueRecord[];
  loading: boolean;
  error: string | null;
  onRowClick: (issueId: string) => void;
  onStatusChange?: (issueId: string, newStatus: ErrorIssueStatus) => void;
}

export function ErrorIssuesTable({
  issues,
  loading,
  error,
  onRowClick,
  onStatusChange,
}: ErrorIssuesTableProps) {
  if (loading) {
    return (
      <div className="rounded-md border" data-testid="error-issues-table-loading">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Culprit</TableHead>
              <TableHead>Environment</TableHead>
              <TableHead>Repo</TableHead>
              <TableHead className="text-right">Occurrences</TableHead>
              <TableHead>Last Seen</TableHead>
              <TableHead>Impact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-6" />
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[1, 2, 3, 4, 5].map((i) => (
              <TableRow key={i}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12" data-testid="error-issues-table-error">
        <p className="text-destructive mb-2">Error loading issues</p>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground" data-testid="error-issues-table-empty">
        No error issues found.
      </div>
    );
  }

  return (
    <div className="rounded-md border" data-testid="error-issues-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Culprit</TableHead>
            <TableHead>Environment</TableHead>
            <TableHead>Repo</TableHead>
            <TableHead className="text-right">Occurrences</TableHead>
            <TableHead>Last Seen</TableHead>
            <TableHead>
              <span className="inline-flex items-center gap-0.5">
                Impact
                <ImpactInfoPopover />
              </span>
            </TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-6" />
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {issues.map((issue) => (
            <TableRow
              key={issue.id}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => onRowClick(issue.id)}
              data-testid={`error-issue-row-${issue.id}`}
            >
              <TableCell className="font-medium max-w-xs truncate">
                {issue.title}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm font-mono max-w-[12rem] truncate">
                {issue.exceptionType}
              </TableCell>
              <TableCell className="text-sm">
                {issue.environment ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-sm font-mono text-muted-foreground max-w-[10rem] truncate">
                {issue.repoKey}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {issue.occurrenceCount.toLocaleString()}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                {dateFormatter.format(new Date(issue.lastSeenAt))}
              </TableCell>
              <TableCell>
                <ImpactIndicator score={issue.impactScore ?? null} meta={issue.impactMeta ?? null} />
              </TableCell>
              <TableCell>
                <ErrorStatusBadge status={issue.status} />
              </TableCell>
              <TableCell className="text-center px-1">
                {issue.correlationConfidence ? (
                  <GitPullRequest
                    className="h-3.5 w-3.5 text-amber-500 inline-block"
                    aria-label="Correlation available"
                    data-testid={`correlation-indicator-${issue.id}`}
                  />
                ) : null}
              </TableCell>
              <TableCell
                onClick={(e) => e.stopPropagation()}
              >
                <TriageActions
                  issueId={issue.id}
                  status={issue.status}
                  onStatusChange={(newStatus) => onStatusChange?.(issue.id, newStatus)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
