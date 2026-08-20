"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";
import {
  parseWorkflowBenchmarkRunResult,
  isWorkflowBenchmarkSlug,
  type WorkflowBenchmarkRunResult,
} from "@/types/workflow-benchmark";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import { useWorkspace } from "@/hooks/useWorkspace";
import { getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";

export interface WorkflowBenchmarkRunListRow {
  id: string;
  workspaceId: string;
  status: WorkflowStatus;
  projectId: number | null;
  taskSlug: string;
  taskTitle: string;
  createdAt: string;
  updatedAt: string;
  n_passed?: number;
  n_total?: number;
  all_pass?: boolean;
  criteria_results?: WorkflowBenchmarkRunResult["criteria_results"];
  requestedModel?: string;
  requestedJudgeModel?: string;
  judgeNotes?: string;
}

interface UseWorkflowBenchmarkRunListResult {
  runs: WorkflowBenchmarkRunListRow[];
  total: number;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const POLL_INTERVAL_MS = 15_000;
const RUN_LIST_LIMIT = 100;

export function useWorkflowBenchmarkRunList(
  workspaceId: string | undefined,
): UseWorkflowBenchmarkRunListResult {
  const [runs, setRuns] = useState<WorkflowBenchmarkRunListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { workspace } = useWorkspace();
  const workspaceSlug = workspace?.slug;

  const runsRef = useRef<WorkflowBenchmarkRunListRow[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isFetchingRef = useRef(false);
  const missedUpdateRef = useRef(false);

  const fetchRuns = useCallback(async () => {
    if (!workspaceId) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      missedUpdateRef.current = true;
      return;
    }
    try {
      const res = await fetch(
        `/api/stakwork/runs?type=${StakworkRunType.BENCHMARK_RUNNER}&workspaceId=${workspaceId}&limit=${RUN_LIST_LIMIT}&includeResult=true`,
      );
      if (!res.ok) throw new Error("Failed to fetch runs");
      const data = await res.json();

      interface RawRunRow {
        id: string;
        workspaceId: string;
        status: string;
        projectId: number | null;
        result: string | null;
        createdAt: string;
        updatedAt: string;
      }

      const rawRows: RawRunRow[] = data.runs ?? [];

      // Filter to wfbench/ domain only — in case BENCHMARK_RUNNER is ever
      // shared across benchmark domains, this ensures Workflow Benchmarks
      // only surfaces its own runs.
      const mapped: WorkflowBenchmarkRunListRow[] = rawRows
        .map((r) => {
          const parsed = parseWorkflowBenchmarkRunResult(r.result);
          return {
            id: r.id,
            workspaceId: r.workspaceId,
            status: r.status as WorkflowStatus,
            projectId: r.projectId,
            taskSlug: parsed?.taskSlug ?? "",
            taskTitle: parsed?.taskTitle ?? "",
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            n_passed: parsed?.n_passed,
            n_total: parsed?.n_total,
            all_pass: parsed?.all_pass,
            criteria_results: parsed?.criteria_results,
            requestedModel: parsed?.requestedModel,
            requestedJudgeModel: parsed?.requestedJudgeModel,
            judgeNotes:
              parsed?.n_passed != null && parsed?.n_total != null
                ? `${parsed.n_passed}/${parsed.n_total} criteria passed${
                    (parsed.requestedJudgeModel ?? parsed.judge_model)
                      ? `. Judge: ${parsed.requestedJudgeModel ?? parsed.judge_model}`
                      : ""
                  }`
                : undefined,
          };
        })
        .filter((r) => isWorkflowBenchmarkSlug(r.taskSlug));

      runsRef.current = mapped;
      setRuns(mapped);
      setTotal(mapped.length);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  const fetchRunRef = useRef(fetchRuns);
  useEffect(() => {
    fetchRunRef.current = fetchRuns;
  }, [fetchRuns]);

  const channel = usePusherChannel(
    workspaceSlug ? getWorkspaceChannelName(workspaceSlug) : null,
  );

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const hasActiveRuns = useCallback(
    () =>
      runsRef.current.some(
        (r) => r.status === WorkflowStatus.PENDING || r.status === WorkflowStatus.IN_PROGRESS,
      ),
    [],
  );

  const startPolling = useCallback(() => {
    stopPolling();
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    intervalRef.current = setInterval(() => {
      if (hasActiveRuns()) {
        void fetchRunRef.current();
      } else {
        stopPolling();
      }
    }, POLL_INTERVAL_MS);
  }, [stopPolling, hasActiveRuns]);

  // Initial fetch
  useEffect(() => {
    if (!workspaceId) return;
    void fetchRuns();
  }, [workspaceId, fetchRuns]);

  // Start/stop polling based on active runs
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

  // Tab visibility handling — defer fetches while hidden, catch up on restore
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") {
        stopPolling();
        return;
      }
      if (missedUpdateRef.current) {
        missedUpdateRef.current = false;
        void fetchRunRef.current().then(() => {
          if (hasActiveRuns()) startPolling();
        });
      } else if (hasActiveRuns()) {
        startPolling();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [stopPolling, startPolling, hasActiveRuns]);

  // Pusher real-time updates
  useEffect(() => {
    if (!channel) return;
    const handleUpdate = (_data: unknown) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      void Promise.resolve(fetchRunRef.current()).finally(() => {
        isFetchingRef.current = false;
      });
    };
    channel.bind(PUSHER_EVENTS.STAKWORK_RUN_UPDATE, handleUpdate);
    return () => {
      channel.unbind(PUSHER_EVENTS.STAKWORK_RUN_UPDATE, handleUpdate);
    };
  }, [channel]);

  return { runs, total, isLoading, error, refetch: fetchRuns };
}
