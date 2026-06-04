"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import { getTaskChannelName, getFeatureChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type { AgentLogEntry } from "@/hooks/useAgentLogs";
import type { AgentLogUpdateEvent } from "@/hooks/usePusherConnection";

/**
 * Fetches agent logs for a task and/or feature on mount, then keeps the list
 * live by subscribing to AGENT_LOG_UPDATED Pusher events on both channels.
 *
 * - When both `taskId` and `featureId` are provided, two parallel fetches run
 *   and results are merged/deduplicated by `id`, sorted ascending by `createdAt`.
 * - When only `featureId` is provided (plan mode), degrades to a single fetch
 *   and single Pusher subscription — identical behaviour to the old `useAgentLogs`.
 * - Returns `{ agentLogs, lastUpdated }` — same shape as `useAgentLogs`.
 */
export function useWorkflowLogs(
  taskId: string | null | undefined,
  featureId: string | null | undefined,
  workspaceId: string | null | undefined
): { agentLogs: AgentLogEntry[]; lastUpdated: Record<string, number> } {
  const [agentLogs, setAgentLogs] = useState<AgentLogEntry[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Record<string, number>>({});
  const fetchedRef = useRef<string | null>(null);

  const upsertLog = useCallback((event: AgentLogUpdateEvent) => {
    setAgentLogs((prev) => {
      const exists = prev.some((l) => l.id === event.id);
      const updated = exists
        ? prev.map((l) =>
            l.id === event.id ? { ...l, agent: event.agent, createdAt: event.createdAt } : l
          )
        : [...prev, { id: event.id, agent: event.agent, createdAt: event.createdAt }];
      return updated.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    });
    setLastUpdated((prev) => ({ ...prev, [event.id]: Date.now() }));
  }, []);

  // Fetch on mount when IDs are available
  useEffect(() => {
    if (!workspaceId || (!taskId && !featureId)) return;
    const key = `${taskId ?? ""}:${featureId ?? ""}:${workspaceId}`;
    if (fetchedRef.current === key) return;
    fetchedRef.current = key;

    const fetchAll = async () => {
      const requests: Promise<Response>[] = [];
      if (taskId) requests.push(fetch(`/api/agent-logs?task_id=${taskId}&workspace_id=${workspaceId}&limit=20`));
      if (featureId) requests.push(fetch(`/api/agent-logs?feature_id=${featureId}&workspace_id=${workspaceId}&limit=20`));

      const responses = await Promise.allSettled(requests);
      const seen = new Set<string>();
      const merged: AgentLogEntry[] = [];

      for (const res of responses) {
        if (res.status !== "fulfilled" || !res.value.ok) continue;
        const data = await res.value.json();
        for (const l of (data?.data ?? [])) {
          if (seen.has(l.id)) continue;
          seen.add(l.id);
          merged.push({ id: l.id, agent: l.agent, createdAt: l.createdAt });
        }
      }

      merged.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setAgentLogs(merged);
    };

    fetchAll().catch(() => {});
  }, [taskId, featureId, workspaceId]);

  // Reset when both IDs are cleared
  useEffect(() => {
    if (!taskId && !featureId) {
      fetchedRef.current = null;
      setAgentLogs([]);
      setLastUpdated({});
    }
  }, [taskId, featureId]);

  // Dual Pusher subscriptions — usePusherChannel is refcounted, safe to call twice
  const taskChannel = usePusherChannel(taskId ? getTaskChannelName(taskId) : null);
  const featureChannel = usePusherChannel(featureId ? getFeatureChannelName(featureId) : null);

  useEffect(() => {
    if (!taskChannel) return;
    taskChannel.bind(PUSHER_EVENTS.AGENT_LOG_UPDATED, upsertLog);
    return () => { taskChannel.unbind(PUSHER_EVENTS.AGENT_LOG_UPDATED, upsertLog); };
  }, [taskChannel, upsertLog]);

  useEffect(() => {
    if (!featureChannel) return;
    featureChannel.bind(PUSHER_EVENTS.AGENT_LOG_UPDATED, upsertLog);
    return () => { featureChannel.unbind(PUSHER_EVENTS.AGENT_LOG_UPDATED, upsertLog); };
  }, [featureChannel, upsertLog]);

  return { agentLogs, lastUpdated };
}
