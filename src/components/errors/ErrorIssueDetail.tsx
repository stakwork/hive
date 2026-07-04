"use client";

import React, { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorStatusBadge } from "./ErrorStatusBadge";
import { TriageActions } from "./TriageActions";
import { ChevronDown, ChevronRight, AlertTriangle, GitPullRequest } from "lucide-react";
import type { ErrorIssueDetailResponse, ErrorIssueStatus, ErrorEventRecord, ErrorIssueRecord, CorrelationCandidate } from "@/types/error-issues";
import { parseStackFrameLines, buildBlobUrl, resolveRef } from "@/lib/utils/github-links";
import type { StructuredFrame, ParsedBlob } from "@/lib/utils/error-frames";
import { parseBlobContent } from "@/lib/utils/error-frames";

// ── LikelyCause card ──────────────────────────────────────────────────────────

/** Builds a GitHub commit URL from a repo URL and commit SHA. */
function buildCommitUrl(repositoryUrl: string | null, sha: string): string | null {
  if (!repositoryUrl) return null;
  try {
    const { owner, repo } = (() => {
      const u = repositoryUrl.trim().replace(/\.git$/i, "");
      const ssh = u.match(/^git@[^:]+:([^/]+)\/([^/]+?)\/?$/);
      if (ssh) return { owner: ssh[1], repo: ssh[2] };
      const https = u.match(/^https?:\/\/[^/]+\/([^/]+)\/([^/]+?)\/?$/i);
      if (https) return { owner: https[1], repo: https[2] };
      throw new Error("unrecognised URL");
    })();
    return `https://github.com/${owner}/${repo}/commit/${sha}`;
  } catch {
    return null;
  }
}

interface LikelyCauseProps {
  issue: Pick<
    ErrorIssueRecord,
    | "correlatedPrNumber"
    | "correlatedPrUrl"
    | "correlatedCommitSha"
    | "correlationConfidence"
    | "correlationCandidates"
  >;
  /** Repository URL used to build commit links — sourced from the first event. */
  repositoryUrl?: string | null;
}

function LikelyCause({ issue, repositoryUrl }: LikelyCauseProps) {
  const {
    correlationConfidence,
    correlatedPrNumber,
    correlatedPrUrl,
    correlatedCommitSha,
    correlationCandidates,
  } = issue;

  // No correlation at all — render nothing.
  if (!correlationConfidence) return null;

  const shortSha = (sha: string) => sha.slice(0, 7);

  if (correlationConfidence === "high") {
    const commitUrl = correlatedCommitSha
      ? buildCommitUrl(repositoryUrl ?? null, correlatedCommitSha)
      : null;

    return (
      <Card data-testid="likely-cause-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <GitPullRequest className="h-4 w-4 text-amber-500" aria-hidden />
            Likely Cause
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          {correlatedPrNumber != null && correlatedPrUrl ? (
            <p>
              This error started after{" "}
              <a
                href={correlatedPrUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline hover:text-primary transition-colors"
                data-testid="correlation-pr-link"
              >
                PR #{correlatedPrNumber}
              </a>
            </p>
          ) : null}
          {correlatedCommitSha ? (
            <p className="text-muted-foreground">
              First seen at commit{" "}
              {commitUrl ? (
                <a
                  href={commitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono underline hover:text-primary transition-colors"
                  title={correlatedCommitSha}
                  data-testid="correlation-commit-link"
                >
                  {shortSha(correlatedCommitSha)}
                </a>
              ) : (
                <span className="font-mono" title={correlatedCommitSha} data-testid="correlation-commit-link">
                  {shortSha(correlatedCommitSha)}
                </span>
              )}
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  // "likely" confidence — list candidates without asserting a single cause.
  const candidates: CorrelationCandidate[] = Array.isArray(correlationCandidates)
    ? correlationCandidates
    : [];

  return (
    <Card data-testid="likely-cause-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <GitPullRequest className="h-4 w-4 text-amber-500" aria-hidden />
          Likely Cause
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-2">
        <p className="text-muted-foreground">Possibly caused by one of:</p>
        <ul className="space-y-1 list-disc list-inside" data-testid="correlation-candidates-list">
          {candidates.map((c) => (
            <li key={c.refId}>
              {c.prNumber != null && c.prUrl ? (
                <a
                  href={c.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-primary transition-colors"
                  data-testid={`correlation-candidate-${c.prNumber}`}
                >
                  PR #{c.prNumber}
                </a>
              ) : (
                <span className="font-mono text-muted-foreground">{c.refId}</span>
              )}
              {c.mergeDate && (
                <span className="text-muted-foreground ml-2 text-xs">
                  merged {new Date(c.mergeDate).toLocaleDateString()}
                </span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface StackTraceViewerProps {
  rawStackTrace: string;
  repositoryUrl: string | null;
  commitSha: string | null;
  release: string | null;
  defaultBranch: string | null;
  frames?: StructuredFrame[];
}

function StackTraceViewer({
  rawStackTrace,
  repositoryUrl,
  commitSha,
  release,
  defaultBranch,
  frames,
}: StackTraceViewerProps) {
  const ref = resolveRef({ commitSha, release, defaultBranch });

  // ── Structured frames path ───────────────────────────────────────────────
  if (frames && frames.length > 0) {
    return (
      <pre className="text-xs font-mono overflow-auto max-h-96 whitespace-pre-wrap break-all">
        {frames.map((frame, idx) => {
          const label = [
            frame.filename,
            frame.lineno != null ? `:${frame.lineno}` : "",
            frame.function ? ` in ${frame.function}` : "",
          ].join("");

          if (frame.inApp && repositoryUrl && frame.lineno != null) {
            let href: string;
            try {
              href = buildBlobUrl({ repositoryUrl, ref, path: frame.filename, line: frame.lineno });
            } catch {
              return <span key={idx}>{label}{"\n"}</span>;
            }
            return (
              <React.Fragment key={idx}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-blue-400 transition-colors"
                >
                  {label}
                </a>
                {"\n"}
              </React.Fragment>
            );
          }

          // inApp:false or missing — dimmed, non-clickable
          return (
            <span key={idx} className="text-muted-foreground/50">
              {label}{"\n"}
            </span>
          );
        })}
      </pre>
    );
  }

  // ── Legacy raw-string fallback path ─────────────────────────────────────
  const parsedFrames = parseStackFrameLines(rawStackTrace);

  return (
    <pre className="text-xs font-mono overflow-auto max-h-96 whitespace-pre-wrap break-all">
      {parsedFrames.map((frame, idx) => {
        if (frame.resolvable && repositoryUrl && frame.path && frame.line !== null) {
          let href: string;
          try {
            href = buildBlobUrl({ repositoryUrl, ref, path: frame.path, line: frame.line });
          } catch {
            return <span key={idx}>{frame.raw}{"\n"}</span>;
          }
          return (
            <a
              key={idx}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-blue-400 transition-colors"
            >
              {frame.raw}
            </a>
          );
        }
        return <span key={idx}>{frame.raw}</span>;
      }).reduce<React.ReactNode[]>((acc, el, idx) => {
        if (idx === 0) return [el];
        return [...acc, "\n", el];
      }, [])}
    </pre>
  );
}

// ── Parsed blob state ─────────────────────────────────────────────────────────

interface BlobViewerProps {
  issueId: string;
  event: ErrorEventRecord;
}

function BlobViewer({ issueId, event }: BlobViewerProps) {
  const [blob, setBlob] = useState<ParsedBlob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchBlob = useCallback(async () => {
    if (blob !== null || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/errors/${issueId}/events/${event.id}/blob`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `Blob fetch failed (${res.status})`);
      }
      const text = await res.text();
      setBlob(parseBlobContent(text));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stack trace");
    } finally {
      setLoading(false);
    }
  }, [issueId, event.id, blob, loading]);

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
          {blob !== null && !loading && (
            <StackTraceViewer
              rawStackTrace={blob.stackTrace}
              repositoryUrl={event.repositoryUrl}
              commitSha={event.commitSha}
              release={event.release}
              defaultBranch={event.defaultBranch}
              frames={blob.frames}
            />
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

  // Surface a repository URL from the first event (for commit link building).
  const firstEventRepoUrl = events[0]?.repositoryUrl ?? null;

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

      {/* Regression correlation */}
      <LikelyCause issue={issue} repositoryUrl={firstEventRepoUrl} />

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
