"use client";

import React, { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorStatusBadge } from "./ErrorStatusBadge";
import { TriageActions } from "./TriageActions";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import type { ErrorIssueDetailResponse, ErrorIssueStatus, ErrorEventRecord } from "@/types/error-issues";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface BlobViewerProps {
  issueId: string;
  event: ErrorEventRecord;
}

function BlobViewer({ issueId, event }: BlobViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchBlob = useCallback(async () => {
    if (content !== null || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/errors/${issueId}/events/${event.id}/blob`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `Blob fetch failed (${res.status})`);
      }
      const text = await res.text();
      setContent(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stack trace");
    } finally {
      setLoading(false);
    }
  }, [issueId, event.id, content, loading]);

  const toggle = () => {
    if (!expanded) fetchBlob();
    setExpanded((v) => !v);
  };

  return (
    <div className="border rounded-md overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-sm bg-muted/30 hover:bg-muted/50 transition-colors text-left"
        onClick={toggle}
        data-testid={`event-toggle-${event.id}`}
      >
        <span className="flex items-center gap-2 font-medium">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {dateFormatter.format(new Date(event.createdAt))}
          {event.environment && (
            <Badge variant="outline" className="text-xs">{event.environment}</Badge>
          )}
          {event.release && (
            <Badge variant="secondary" className="text-xs font-mono">{event.release}</Badge>
          )}
        </span>
        <span className="text-muted-foreground text-xs font-mono truncate max-w-xs">
          {event.exceptionType}
        </span>
      </button>

      {expanded && (
        <div className="p-4 bg-background" data-testid={`event-blob-${event.id}`}>
          {loading && <Skeleton className="h-32 w-full" />}
          {error && (
            <div className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="blob-error">
              <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
              <span>Stack trace unavailable: {error}</span>
            </div>
          )}
          {content !== null && !loading && (
            <pre className="text-xs font-mono overflow-auto max-h-96 whitespace-pre-wrap break-all">
              {content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

interface ErrorIssueDetailProps {
  detail: ErrorIssueDetailResponse;
  onStatusChange?: (newStatus: ErrorIssueStatus) => void;
  onLoadMoreEvents?: () => void;
  loadingMoreEvents?: boolean;
}

export function ErrorIssueDetail({
  detail,
  onStatusChange,
  onLoadMoreEvents,
  loadingMoreEvents,
}: ErrorIssueDetailProps) {
  const { issue, events, eventsHasMore } = detail;

  return (
    <div className="space-y-6">
      {/* Metadata card */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-xl">{issue.title}</CardTitle>
            <p className="text-sm font-mono text-muted-foreground">{issue.exceptionType}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <ErrorStatusBadge status={issue.status} />
            <TriageActions
              issueId={issue.id}
              status={issue.status}
              onStatusChange={onStatusChange}
            />
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground font-medium">Environment</dt>
              <dd>{issue.environment ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground font-medium">Release</dt>
              <dd className="font-mono">{issue.release ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground font-medium">Repository</dt>
              <dd className="font-mono truncate">{issue.repoKey}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground font-medium">Occurrences</dt>
              <dd className="tabular-nums">{issue.occurrenceCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground font-medium">First Seen</dt>
              <dd>{dateFormatter.format(new Date(issue.firstSeenAt))}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground font-medium">Last Seen</dt>
              <dd>{dateFormatter.format(new Date(issue.lastSeenAt))}</dd>
            </div>
            {issue.metadata && Object.keys(issue.metadata).length > 0 && (
              <div className="col-span-2 md:col-span-4">
                <dt className="text-muted-foreground font-medium mb-1">Metadata</dt>
                <dd>
                  <pre className="text-xs font-mono bg-muted rounded p-2 overflow-auto max-h-32">
                    {JSON.stringify(issue.metadata, null, 2)}
                  </pre>
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Occurrences */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Occurrences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {events.length === 0 && (
            <p className="text-muted-foreground text-sm text-center py-6">No occurrences recorded.</p>
          )}
          {events.map((event) => (
            <BlobViewer key={event.id} issueId={issue.id} event={event} />
          ))}
          {eventsHasMore && (
            <div className="pt-2 flex justify-center">
              <Button variant="outline" size="sm" onClick={onLoadMoreEvents} disabled={loadingMoreEvents}>
                {loadingMoreEvents ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
