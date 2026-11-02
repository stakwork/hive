import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import { getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { parseLongMemoryRunResult, type LongMemoryRunResult, type LongMemoryRunWireRow } from "@/types/longmemory";

const POLL_INTERVAL_MS = 15_000;

export interface LongMemoryRunRow {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  hasReport: boolean;
  result: LongMemoryRunResult | null;
}

export const isActiveStatus = (status: string) => status === "PENDING" || status === "IN_PROGRESS";

/** Shape a wire row for the page. */
export function toRunRow(raw: LongMemoryRunWireRow): LongMemoryRunRow {
  return {
    id: raw.id,
    status: raw.status,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    hasReport: raw.hasReport === true,
    result: parseLongMemoryRunResult(raw.result),
  };
}

/**
 * The workspace's LongMemory runs, polled every 15 s while one is in flight
 * (and nudged by Pusher run updates), paused while the tab is hidden.
 */
export function useLongMemoryRuns() {
  const { workspace } = useWorkspace();
  const slug = workspace?.slug;
  const [runs, setRuns] = useState<LongMemoryRunRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const runsRef = useRef<LongMemoryRunRow[]>([]);

  const fetchRuns = useCallback(async () => {
    if (!slug) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    try {
      const res = await fetch(`/api/workspaces/${slug}/longmemory/benchmarks/runs`);
      if (!res.ok) throw new Error("Failed to fetch runs");
      const data = (await res.json()) as { runs?: LongMemoryRunWireRow[] };
      const rows = (data.runs ?? []).map(toRunRow);
      runsRef.current = rows;
      setRuns(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  const hasActive = runs.some((r) => isActiveStatus(r.status));
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => void fetchRuns(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasActive, fetchRuns]);

  const channel = usePusherChannel(slug ? getWorkspaceChannelName(slug) : null);
  useEffect(() => {
    if (!channel) return;
    const onUpdate = () => void fetchRuns();
    channel.bind(PUSHER_EVENTS.STAKWORK_RUN_UPDATE, onUpdate);
    return () => {
      channel.unbind(PUSHER_EVENTS.STAKWORK_RUN_UPDATE, onUpdate);
    };
  }, [channel, fetchRuns]);

  return { runs, isLoading, error, refetch: fetchRuns };
}
