import { useEffect, useRef, useState } from "react";
import { useCanvasChatStore } from "@/app/org/[githubLogin]/_state/canvasChatStore";
import { getSubAgentRunsFromMessages } from "@/app/org/[githubLogin]/_components/SubAgentRunCard";
import { useAgentLogs } from "./useAgentLogs";

/**
 * Combines Jamie's streaming state with Pusher-based sub-agent log
 * activity to produce a single `isActive` boolean for the canvas
 * chat header indicator.
 *
 * Race-condition safe (PR #4255 pattern): `hasRecentLog` is only
 * cleared by a 3-second debounce timeout, never by `isLoading` or
 * `isStreaming` flipping to false — preventing a workflow-status
 * signal from wiping the indicator before the last log event lands.
 */
export function useCanvasAgentActivity(
  activeConversationId: string | null,
  workspaceId: string | null,
): { isActive: boolean } {
  // Narrow selectors — only re-render when the specific booleans change
  const isLoading = useCanvasChatStore(
    (s) =>
      (activeConversationId
        ? s.conversations[activeConversationId]?.isLoading
        : false) ?? false,
  );
  const isStreaming = useCanvasChatStore(
    (s) =>
      (activeConversationId
        ? s.conversations[activeConversationId]?.isStreaming
        : false) ?? false,
  );

  // Derive the most recently dispatched sub-agent feature ID so we can
  // subscribe to its Pusher channel for background log activity.
  const messages = useCanvasChatStore(
    (s) =>
      (activeConversationId
        ? s.conversations[activeConversationId]?.messages
        : undefined) ?? EMPTY_MESSAGES,
  );

  const subAgentRuns = getSubAgentRunsFromMessages(messages);
  const activeFeatureId =
    subAgentRuns.length > 0
      ? subAgentRuns[subAgentRuns.length - 1].featureId
      : null;

  const { lastUpdated } = useAgentLogs(activeFeatureId, workspaceId);

  // ── Recent-log state ─────────────────────────────────────────────────
  // Set true whenever a new Pusher AGENT_LOG_UPDATED event arrives.
  // Cleared only by a 3-second timeout (never synchronously) so a
  // stale workflow-status transition cannot race-clear the indicator.
  const [hasRecentLog, setHasRecentLog] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUpdatedRef = useRef(lastUpdated);

  useEffect(() => {
    if (lastUpdated === lastUpdatedRef.current) return;
    lastUpdatedRef.current = lastUpdated;
    setHasRecentLog(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setHasRecentLog(false), 3000);
  }, [lastUpdated]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  return { isActive: isLoading || isStreaming || hasRecentLog };
}

const EMPTY_MESSAGES: [] = [];
