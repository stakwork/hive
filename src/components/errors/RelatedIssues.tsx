import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { ErrorStatusBadge } from "./ErrorStatusBadge";
import type { ErrorIssueStatus } from "@/types/error-issues";

interface RelatedIssue {
  id: string;
  title: string;
  exceptionType: string;
  status: ErrorIssueStatus;
  occurrenceCount: number;
  lastSeenAt: string;
  kgRefId: string | null;
  sharedCodeNodeCount: number;
}

interface RelatedIssuesProps {
  issueId: string;
  workspaceSlug: string;
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function RelatedIssues({ issueId, workspaceSlug }: RelatedIssuesProps) {
  const [related, setRelated] = useState<RelatedIssue[]>([]);

  useEffect(() => {
    let cancelled = false;

    const fetchRelated = async () => {
      try {
        const res = await fetch(`/api/errors/${issueId}/related`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.related)) {
          setRelated(data.related);
        }
      } catch {
        // Best-effort: silently ignore errors, section stays hidden
      }
    };

    fetchRelated();
    return () => {
      cancelled = true;
    };
  }, [issueId]);

  if (related.length === 0) return null;

  return (
    <div className="space-y-3" data-testid="related-issues">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-muted-foreground" />
        Related Issues
        <span className="text-xs font-normal text-muted-foreground">({related.length})</span>
      </h3>

      <div className="divide-y divide-border rounded-md border">
        {related.map((issue) => {
          const isMuted = issue.status === "RESOLVED" || issue.status === "IGNORED";
          return (
            <Link
              key={issue.id}
              href={`/w/${workspaceSlug}/errors/${issue.id}`}
              className={`flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors ${isMuted ? "opacity-50" : ""}`}
              data-testid={`related-issue-${issue.id}`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <ErrorStatusBadge status={issue.status} />
                  <span className="text-xs font-mono text-muted-foreground truncate">
                    {issue.exceptionType}
                  </span>
                </div>
                <p className="text-sm truncate">{issue.title}</p>
              </div>
              <div className="shrink-0 text-right text-xs text-muted-foreground space-y-1">
                <p>{issue.occurrenceCount.toLocaleString()} occurrences</p>
                <p>{dateFormatter.format(new Date(issue.lastSeenAt))}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
