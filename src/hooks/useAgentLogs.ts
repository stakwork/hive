import { useCallback, useEffect, useRef, useState } from "react";
import { usePusherConnection, type AgentLogUpdateEvent } from "./usePusherConnection";

export interface AgentLogEntry {
  id: string;
  agent: string;
  createdAt: string;
}

/**
 * Fetches agent logs for a feature on mount, then keeps the list live
 * by subscribing to AGENT_LOG_UPDATED Pusher events on the feature channel.
 *
 * Returns:
 *   - `agentLogs`: ascending-by-createdAt list of log entries
 *   - `lastUpdated`: Record<id, number> — unix timestamp bumped on each upsert,
 *     used by LogsArtifactPanel to know when to invalidate its per-log cache.
 */
export function useAgentLogs(
  featureId: string | null | undefined,
  workspaceId: string | null | undefined
): { agentLogs: AgentLogEntry[]; lastUpdated: Record<string, number> } {
  const [agentLogs, setAgentLogs] = useState<AgentLogEntry[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Record<string, number>>({});

  // Track whether the initial fetch has run for the current featureId
  const fetchedForRef = useRef<string | null>(null);

  // Initial fetch on mount (or when featureId/workspaceId change)
  useEffect(() => {
    if (!featureId || !workspaceId) return;
    if (fetchedForRef.current === featureId) return;
    fetchedForRef.current = featureId;

    const fetchLogs = async () => {
      try {
        const res = await fetch(
          `/api/agent-logs?feature_id=${featureId}&workspace_id=${workspaceId}&limit=20`
        );
        if (!res.ok) return;
        const data = await res.json();
        const logs: AgentLogEntry[] = (data?.data ?? []).map(
          (l: { id: string; agent: string; createdAt: string }) => ({
            id: l.id,
            agent: l.agent,
            createdAt: l.createdAt,
          })
        );
        // API returns descending (newest first) — sort ascending for display
        logs.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        setAgentLogs(logs);
      } catch {
        // best-effort — silently ignore
      }
    };

    fetchLogs();
  }, [featureId, workspaceId]);

  // Reset when featureId changes so we re-fetch for the new feature
  useEffect(() => {
    if (!featureId) {
      fetchedForRef.current = null;
      setAgentLogs([]);
      setLastUpdated({});
    }
  }, [featureId]);

  const handleAgentLogUpdate = useCallback((event: AgentLogUpdateEvent) => {
    setAgentLogs((prev) => {
      const exists = prev.some((l) => l.id === event.id);
      const updated = exists
        ? prev.map((l) =>
            l.id === event.id ? { ...l, agent: event.agent, createdAt: event.createdAt } : l
          )
        : [...prev, { id: event.id, agent: event.agent, createdAt: event.createdAt }];
      // Re-sort ascending
      return [...updated].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    });

    // Bump lastUpdated so LogsArtifactPanel can detect the change
    setLastUpdated((prev) => ({ ...prev, [event.id]: Date.now() }));
  }, []);

  usePusherConnection({
    featureId: featureId ?? null,
    enabled: !!(featureId && workspaceId),
    onAgentLogUpdate: handleAgentLogUpdate,
  });

  return { agentLogs, lastUpdated };
}
