"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getPusherClient, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";

interface UseUnresolvedErrorCountParams {
  workspaceId: string | null | undefined;
  slug: string | null | undefined;
}

interface UseUnresolvedErrorCountReturn {
  count: number;
}

export function useUnresolvedErrorCount({
  workspaceId,
  slug,
}: UseUnresolvedErrorCountParams): UseUnresolvedErrorCountReturn {
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const params = new URLSearchParams({
        workspace_id: workspaceId,
        status: "UNRESOLVED",
        limit: "1",
      });
      const res = await fetch(`/api/errors?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      setCount(data.total ?? 0);
    } catch {
      // best-effort — keep existing count
    }
  }, [workspaceId]);

  // Initial fetch and re-fetch when workspaceId changes
  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  // Pusher subscription for live updates
  const fetchCountRef = useRef(fetchCount);
  useEffect(() => {
    fetchCountRef.current = fetchCount;
  });

  useEffect(() => {
    if (!slug || !process.env.NEXT_PUBLIC_PUSHER_KEY) return;

    let channel: ReturnType<ReturnType<typeof getPusherClient>["subscribe"]> | null = null;
    let pusherClient: ReturnType<typeof getPusherClient> | null = null;

    try {
      pusherClient = getPusherClient();
      const channelName = getWorkspaceChannelName(slug);
      channel = pusherClient.subscribe(channelName);

      const handleErrorIssueUpdated = () => {
        fetchCountRef.current();
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
      console.error("[useUnresolvedErrorCount] Pusher setup failed", err);
    }
  }, [slug]);

  return { count };
}
