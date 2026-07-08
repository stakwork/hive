import { useEffect, useState, useCallback, useRef } from "react";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";
import { parseBenchmarkRunResult } from "@/types/legal";

export interface BenchmarkRunListRow {
  id: string;
  workspaceId: string;
  status: WorkflowStatus;
  projectId: number | null;
  taskSlug: string;
  taskTitle: string;
  createdAt: string;
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

  const runsRef = useRef<BenchmarkRunListRow[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expandedIdRef = useRef<string | null>(null);

  const fetchRuns = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetch(
        `/api/stakwork/runs?type=${StakworkRunType.LEGAL_BENCHMARK_RUNNER}&workspaceId=${workspaceId}&limit=100`,
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

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    intervalRef.current = setInterval(() => {
      if (expandedIdRef.current !== null) return;
      const hasActive = runsRef.current.some(
        (r) => r.status === WorkflowStatus.PENDING || r.status === WorkflowStatus.IN_PROGRESS,
      );
      if (hasActive) {
        fetchRuns();
      } else {
        stopPolling();
      }
    }, POLL_INTERVAL_MS);
  }, [fetchRuns, stopPolling]);

  // Initial fetch
  useEffect(() => {
    if (!workspaceId) return;
    fetchRuns();
  }, [workspaceId, fetchRuns]);

  // Start/stop polling whenever the runs list changes
  useEffect(() => {
    const hasActive = runs.some(
      (r) => r.status === WorkflowStatus.PENDING || r.status === WorkflowStatus.IN_PROGRESS,
    );
    if (hasActive && expandedIdRef.current === null) {
      startPolling();
    } else {
      stopPolling();
    }
    return stopPolling;
  }, [runs, startPolling, stopPolling]);

  const setExpandedId = useCallback(
    (id: string | null) => {
      expandedIdRef.current = id;
      if (id !== null) {
        // Pause polling while a row is expanded
        stopPolling();
      } else {
        // Resumed: refetch and restart polling if there are active runs
        fetchRuns().then(() => {
          const hasActive = runsRef.current.some(
            (r) => r.status === WorkflowStatus.PENDING || r.status === WorkflowStatus.IN_PROGRESS,
          );
          if (hasActive) startPolling();
        });
      }
    },
    [fetchRuns, startPolling, stopPolling],
  );

  return { runs, total, isLoading, error, refetch: fetchRuns, setExpandedId };
}
