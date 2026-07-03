"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Bug, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorIssueDetail } from "@/components/errors";
import { useWorkspace } from "@/hooks/useWorkspace";
import { getPusherClient, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { useFixInPlanMode } from "./useFixInPlanMode";
import type {
  ErrorIssueDetailResponse,
  ErrorIssueStatus,
  ErrorIssueUpdatedPayload,
} from "@/types/error-issues";

const EVENTS_PER_PAGE = 20;

export default function ErrorIssueDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const issueId = params.issueId as string;
  const { slug: workspaceSlug } = useWorkspace();

  const [detail, setDetail] = useState<ErrorIssueDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const { launch: launchFixInPlanMode, isLaunching } = useFixInPlanMode(detail, slug);
  const [error, setError] = useState<string | null>(null);
  const [eventsSkip, setEventsSkip] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchDetail = useCallback(
    async (opts?: { append?: boolean; skip?: number }) => {
      const skip = opts?.skip ?? eventsSkip;
      const isAppend = opts?.append ?? false;

      if (!isAppend) setLoading(true);
      else setLoadingMore(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          events_limit: EVENTS_PER_PAGE.toString(),
          events_skip: skip.toString(),
        });
        const res = await fetch(`/api/errors/${issueId}?${params}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError("Issue not found or access denied.");
          } else {
            throw new Error(`Failed to fetch issue (${res.status})`);
          }
          return;
        }
        const data: ErrorIssueDetailResponse = await res.json();

        if (isAppend) {
          setDetail((prev) =>
            prev
              ? {
                  ...data,
                  issue: data.issue,
                  events: [...prev.events, ...data.events],
                }
              : data,
          );
        } else {
          setDetail(data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch issue");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [issueId, eventsSkip],
  );

  // Initial fetch
  useEffect(() => {
    fetchDetail({ skip: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId]);

  // Load more events
  const handleLoadMoreEvents = () => {
    const nextSkip = eventsSkip + EVENTS_PER_PAGE;
    setEventsSkip(nextSkip);
    fetchDetail({ append: true, skip: nextSkip });
  };

  // Pusher: merge live status/count updates
  useEffect(() => {
    if (!workspaceSlug || !process.env.NEXT_PUBLIC_PUSHER_KEY) return;

    let channel: ReturnType<ReturnType<typeof getPusherClient>["subscribe"]> | null = null;
    let pusherClient: ReturnType<typeof getPusherClient> | null = null;

    try {
      pusherClient = getPusherClient();
      const channelName = getWorkspaceChannelName(workspaceSlug);
      channel = pusherClient.subscribe(channelName);

      const handler = (payload: ErrorIssueUpdatedPayload) => {
        if (payload.id !== issueId) return;

        if (payload.isNew) {
          // New occurrence on this issue — refetch to get updated events list
          fetchDetail({ skip: 0 });
          setEventsSkip(0);
          return;
        }

        setDetail((prev) =>
          prev
            ? {
                ...prev,
                issue: {
                  ...prev.issue,
                  occurrenceCount: payload.occurrenceCount,
                  status: payload.status,
                  lastSeenAt: payload.lastSeenAt,
                },
              }
            : prev,
        );
      };

      channel.bind(PUSHER_EVENTS.ERROR_ISSUE_UPDATED, handler);

      return () => {
        channel?.unbind(PUSHER_EVENTS.ERROR_ISSUE_UPDATED, handler);
        try {
          pusherClient?.unsubscribe(getWorkspaceChannelName(workspaceSlug));
        } catch {
          // best-effort
        }
      };
    } catch (err) {
      console.error("[ErrorIssueDetailPage] Pusher setup failed", err);
    }
  }, [workspaceSlug, issueId, fetchDetail]);

  const handleStatusChange = (newStatus: ErrorIssueStatus) => {
    setDetail((prev) =>
      prev ? { ...prev, issue: { ...prev.issue, status: newStatus } } : prev,
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Bug}
        title={detail?.issue.title ?? "Error Issue"}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/w/${slug}/errors`)}
              className="gap-1"
              data-testid="back-to-errors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Errors
            </Button>
            {detail && (
              <Button
                variant="default"
                size="sm"
                onClick={launchFixInPlanMode}
                disabled={isLaunching}
                className="gap-1"
                data-testid="fix-in-plan-mode"
              >
                <Wand2 className="h-4 w-4" />
                {isLaunching ? "Creating plan…" : "Fix in Plan Mode"}
              </Button>
            )}
          </>
        }
      />

      {loading && (
        <div className="space-y-4" data-testid="detail-loading">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {error && !loading && (
        <div className="text-center py-12" data-testid="detail-error">
          <p className="text-destructive mb-2">Failed to load issue</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => fetchDetail({ skip: 0 })}
          >
            Retry
          </Button>
        </div>
      )}

      {detail && !loading && (
        <ErrorIssueDetail
          detail={detail}
          onStatusChange={handleStatusChange}
          onLoadMoreEvents={handleLoadMoreEvents}
          loadingMoreEvents={loadingMore}
        />
      )}
    </div>
  );
}
