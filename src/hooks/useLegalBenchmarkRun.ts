import { useEffect, useState, useCallback, useRef } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { getPusherClient, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type { LegalBenchmarkRun } from "@/types/legal";

const STALE_RUN_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

const IN_PROGRESS_STATUSES = new Set(["RUNNING", "SCORING"]);

interface UseLegalBenchmarkRunResult {
  run: LegalBenchmarkRun | null;
  isLoading: boolean;
  isStale: boolean;
  refetch: () => Promise<void>;
}

export function useLegalBenchmarkRun(runId: string): UseLegalBenchmarkRunResult {
  const { workspace } = useWorkspace();
  const [run, setRun] = useState<LegalBenchmarkRun | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStale, setIsStale] = useState(false);

  // Track current run in a ref so async timer callbacks can read the latest value
  // without depending on stale closure over state.
  const runRef = useRef<LegalBenchmarkRun | null>(null);
  const fetchRunRef = useRef<(() => Promise<void>) | undefined>(undefined);

  const fetchRun = useCallback(async () => {
    if (!workspace?.slug || !runId) return;

    try {
      setIsLoading(true);
      const response = await fetch(
        `/api/workspaces/${workspace.slug}/legal/benchmarks/runs/${runId}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch run");
      }
      const data = await response.json();
      const newRun = data.run ?? data;
      // Update ref immediately so timer callbacks can read the fresh value
      runRef.current = newRun;
      setRun(newRun);
    } catch (error) {
      console.error("Error fetching legal benchmark run:", error);
    } finally {
      setIsLoading(false);
    }
  }, [workspace?.slug, runId]);

  fetchRunRef.current = fetchRun;

  // Initial fetch on mount
  useEffect(() => {
    if (!workspace?.slug || !runId) return;
    fetchRun();
  }, [workspace?.slug, runId, fetchRun]);

  // Stale timeout: after 3 minutes with an in-progress run, poll once.
  // If still in-progress after the poll, mark stale. Reset when run leaves in-progress.
  useEffect(() => {
    if (!run || !IN_PROGRESS_STATUSES.has(run.status)) {
      setIsStale(false);
      return;
    }

    const elapsed = Date.now() - new Date(run.updatedAt).getTime();
    const remaining = Math.max(0, STALE_RUN_TIMEOUT_MS - elapsed);

    const timer = setTimeout(async () => {
      // Poll once, then check runRef (updated synchronously inside fetchRun before setRun)
      await fetchRunRef.current?.();
      if (runRef.current && IN_PROGRESS_STATUSES.has(runRef.current.status)) {
        setIsStale(true);
      }
    }, remaining);

    return () => clearTimeout(timer);
  }, [run]);

  // Pusher subscription — only refetch when the event is for this run
  useEffect(() => {
    if (!workspace?.slug) return;

    let channel: ReturnType<ReturnType<typeof getPusherClient>["subscribe"]> | null = null;

    try {
      const pusher = getPusherClient();
      const channelName = getWorkspaceChannelName(workspace.slug);
      channel = pusher.subscribe(channelName);

      const handleUpdate = (data: { run_id: string; status: string }) => {
        if (data.run_id === runId) {
          // If the incoming status is terminal, immediately clear the stale flag
          // so consumers see it reset synchronously before the fetch completes.
          if (!IN_PROGRESS_STATUSES.has(data.status)) {
            setIsStale(false);
          }
          fetchRunRef.current?.();
        }
      };

      channel.bind(PUSHER_EVENTS.LEGAL_BENCHMARK_UPDATE, handleUpdate);
    } catch {
      // Pusher not configured in this environment
      return;
    }

    return () => {
      channel?.unbind(PUSHER_EVENTS.LEGAL_BENCHMARK_UPDATE);
    };
  }, [workspace?.slug, runId]);

  return { run, isLoading, isStale, refetch: fetchRun };
}
