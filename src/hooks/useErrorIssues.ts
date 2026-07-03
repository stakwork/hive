"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getPusherClient, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type {
  ErrorIssueRecord,
  ErrorIssuesListResponse,
  ErrorIssueUpdatedPayload,
  ErrorIssueStatus,
  ErrorIssueSort,
} from "@/types/error-issues";

interface UseErrorIssuesParams {
  workspaceId: string | null | undefined;
  slug: string | null | undefined;
  status?: ErrorIssueStatus | "all";
  repoKey?: string;
  skip?: number;
  limit?: number;
  sort?: ErrorIssueSort;
}

interface UseErrorIssuesReturn {
  issues: ErrorIssueRecord[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useErrorIssues({
  workspaceId,
  slug,
  status,
  repoKey,
  skip = 0,
  limit = 20,
  sort,
}: UseErrorIssuesParams): UseErrorIssuesReturn {
  const [issues, setIssues] = useState<ErrorIssueRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchIssues = useCallback(async () => {
    if (!workspaceId) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ workspace_id: workspaceId });
      if (status) params.set("status", status);
      if (repoKey) params.set("repoKey", repoKey);
      if (sort) params.set("sort", sort);
      params.set("skip", skip.toString());
      params.set("limit", limit.toString());

      const res = await fetch(`/api/errors?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch error issues");

      const data: ErrorIssuesListResponse = await res.json();
      setIssues(data.issues);
      setTotal(data.total);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch error issues");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, status, repoKey, skip, limit, sort]);

  // Initial fetch and re-fetch when filters change
  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  // Pusher subscription on workspace channel
  const fetchIssuesRef = useRef(fetchIssues);
  useEffect(() => {
    fetchIssuesRef.current = fetchIssues;
  });

  useEffect(() => {
    if (!slug || !process.env.NEXT_PUBLIC_PUSHER_KEY) return;

    let channel: ReturnType<ReturnType<typeof getPusherClient>["subscribe"]> | null = null;
    let pusherClient: ReturnType<typeof getPusherClient> | null = null;

    try {
      pusherClient = getPusherClient();
      const channelName = getWorkspaceChannelName(slug);
      channel = pusherClient.subscribe(channelName);

      const handleErrorIssueUpdated = (payload: ErrorIssueUpdatedPayload) => {
        if (payload.isNew) {
          // New issue — refetch to get full record (fingerprint/title/exceptionType not in payload)
          fetchIssuesRef.current();
          return;
        }

        setIssues((prev) => {
          const exists = prev.some((i) => i.id === payload.id);
          if (!exists) {
            // Unknown id + not new: fetch to reconcile
            fetchIssuesRef.current();
            return prev;
          }
          // Merge updated fields in-place
          return prev.map((i) =>
            i.id === payload.id
              ? {
                  ...i,
                  occurrenceCount: payload.occurrenceCount,
                  status: payload.status,
                  lastSeenAt: payload.lastSeenAt,
                }
              : i,
          );
        });
      };

      channel.bind(PUSHER_EVENTS.ERROR_ISSUE_UPDATED, handleErrorIssueUpdated);

      return () => {
        channel?.unbind(PUSHER_EVENTS.ERROR_ISSUE_UPDATED, handleErrorIssueUpdated);
        try {
          pusherClient?.unsubscribe(getWorkspaceChannelName(slug));
        } catch {
          // best-effort
        }
      };
    } catch (err) {
      console.error("[useErrorIssues] Pusher setup failed", err);
    }
  }, [slug]);

  return { issues, total, hasMore, loading, error, refetch: fetchIssues };
}
