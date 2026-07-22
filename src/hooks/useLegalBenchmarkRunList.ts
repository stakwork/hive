import { useEffect, useState, useCallback, useRef } from "react";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";
import { parseBenchmarkRunResult } from "@/types/legal";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import { useWorkspace } from "@/hooks/useWorkspace";
import { getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";

export interface BenchmarkRunListRow {
  id: string;
  workspaceId: string;
  status: WorkflowStatus;
  projectId: number | null;
  taskSlug: string;
  taskTitle: string;
  createdAt: string;
  // Flat score fields from the runner webhook (single-run pipeline)
  n_passed?: number;
  n_total?: number;
  all_pass?: boolean;
  judgeNotes?: string; // "${n_passed}/${n_total} criteria passed. Judge: ${judge_model}"
  // Model fields stored at creation time
  model?: string;
  requestedJudgeModel?: string;
  judge_model?: string;
}

interface UseLegalBenchmarkRunListResult {
  runs: BenchmarkRunListRow[];
  total: number;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  setExpandedId: (id: string | null) => void;
}

const POLL_INTERVAL_MS = 15_000;

export function useLegalBenchmarkRunList(
  workspaceId: string | undefined,
): UseLegalBenchmarkRunListResult {
  const [runs, setRuns] = useState<BenchmarkRunListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { workspace } = useWorkspace();
  const workspaceSlug = workspace?.slug;

  const runsRef = useRef<BenchmarkRunListRow[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expandedIdRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);

  const fetchRuns = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetch(
        `/api/stakwork/runs?type=${StakworkRunType.LEGAL_BENCHMARK_RUNNER}&workspaceId=${workspaceId}&limit=20&includeResult=true`,
      );
      if (!res.ok) throw new Error("Failed to fetch runs");
      const data = await res.json();

      const rawRows: Array<{
        id: string;
        workspaceId: string;
        status: string;
        projectId: number | null;
        result: string | null;
        createdAt: string;
      }> = data.runs ?? [];

      const mapped: BenchmarkRunListRow[] = rawRows.map((r) => {
        const parsed = parseBenchmarkRunResult(r.result);
        return {
          id: r.id,
          workspaceId: r.workspaceId,
          status: r.status as WorkflowStatus,
          projectId: r.projectId,
          taskSlug: parsed?.taskSlug ?? "",
          taskTitle: parsed?.taskTitle ?? "",
          createdAt: r.createdAt,
          n_passed: parsed?.n_passed,
          n_total: parsed?.n_total,
          all_pass: parsed?.all_pass,
          // Format mirrors stakwork-run.ts:1655 — if the server-side format string changes, update this line to match.
          judgeNotes:
            parsed?.n_passed != null && parsed?.n_total != null
              ? `${parsed.n_passed}/${parsed.n_total} criteria passed${parsed.judge_model ? `. Judge: ${parsed.judge_model}` : ""}`
              : undefined,
          model: parsed?.model,
          requestedJudgeModel: parsed?.requestedJudgeModel,
          judge_model: parsed?.judge_model,
        };
      });

      runsRef.current = mapped;
      setRuns(mapped);
      setTotal(data.total ?? mapped.length);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  const fetchRunRef = useRef(fetchRuns);
  useEffect(() => { fetchRunRef.current = fetchRuns; }, [fetchRuns]);

  const channel = usePusherChannel(
    workspaceSlug ? getWorkspaceChannelName(workspaceSlug) : null,
  );

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const hasActiveRuns = useCallback(() =>
    runsRef.current.some(
      (r) => r.status === WorkflowStatus.PENDING || r.status === WorkflowStatus.IN_PROGRESS,
    ), []);

  const startPolling = useCallback(() => {
    stopPolling();
    intervalRef.current = setInterval(() => {
      // Keep polling while active runs exist, even if a row is expanded.
      if (hasActiveRuns()) {
        fetchRuns();
      } else {
        stopPolling();
      }
    }, POLL_INTERVAL_MS);
  }, [fetchRuns, stopPolling, hasActiveRuns]);

  // Initial fetch
  useEffect(() => {
    if (!workspaceId) return;
    fetchRuns();
  }, [workspaceId, fetchRuns]);

  // Start/stop polling whenever the runs list changes
  useEffect(() => {
    const active = runs.some(
      (r) => r.status === WorkflowStatus.PENDING || r.status === WorkflowStatus.IN_PROGRESS,
    );
    if (active) {
      startPolling();
    } else {
      stopPolling();
    }
    return stopPolling;
  }, [runs, startPolling, stopPolling]);

  // Pusher real-time completion detection
  useEffect(() => {
    if (!channel) return;
    const handleUpdate = (data: { runId?: string; run_id?: string }) => {
      const updatedId = data.runId ?? data.run_id;
      if (isFetchingRef.current) return; // drop burst duplicates
      if (runsRef.current.some((r) => r.id === updatedId)) {
        isFetchingRef.current = true;
        void Promise.resolve(fetchRunRef.current?.()).finally(() => {
          isFetchingRef.current = false;
        });
      }
    };
    channel.bind(PUSHER_EVENTS.STAKWORK_RUN_UPDATE, handleUpdate);
    return () => {
      channel.unbind(PUSHER_EVENTS.STAKWORK_RUN_UPDATE, handleUpdate);
    };
  }, [channel]);

  const setExpandedId = useCallback(
    (id: string | null) => {
      expandedIdRef.current = id;
      if (id === null) {
        // Collapsed: refetch and restart polling if there are active runs
        fetchRuns().then(() => {
          if (hasActiveRuns()) startPolling();
        });
      }
      // When expanding a row, polling intentionally continues (active runs keep updating).
    },
    [fetchRuns, startPolling, hasActiveRuns],
  );

  return { runs, total, isLoading, error, refetch: fetchRuns, setExpandedId };
}
