import { useEffect, useState, useCallback, useRef } from "react";
import { WorkflowStatus } from "@prisma/client";
import { parseBenchmarkRunResult } from "@/types/legal";
import { RUN_LIST_LIMIT } from "@/lib/harvey-lab/benchmark-summary";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import { useWorkspace } from "@/hooks/useWorkspace";
import { getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type { BenchmarkRunListRow } from "@/hooks/useLegalBenchmarkRunList";

export type { BenchmarkRunListRow } from "@/hooks/useLegalBenchmarkRunList";

/** Workflow Benchmark task slug prefix — used to filter BENCHMARK_RUNNER rows. */
const WF_PREFIX = "wfbench/";

const POLL_INTERVAL_MS = 15_000;

interface UseWorkflowBenchmarkRunListResult {
  runs: BenchmarkRunListRow[];
  total: number;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  setExpandedId: (id: string | null) => void;
}

/** Coerce a wire score count (number or numeric string) to a number; undefined otherwise. */
function toCount(value: unknown): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function useWorkflowBenchmarkRunList(
  workspaceId: string | undefined,
): UseWorkflowBenchmarkRunListResult {
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
  const missedUpdateRef = useRef(false);

  const fetchRuns = useCallback(async () => {
    if (!workspaceId) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      missedUpdateRef.current = true;
      return;
    }
    try {
      const res = await fetch(
        `/api/stakwork/runs?type=BENCHMARK_RUNNER&workspaceId=${workspaceId}&limit=${RUN_LIST_LIMIT}&includeResult=true`,
      );
      if (!res.ok) throw new Error("Failed to fetch workflow benchmark runs");
      const data = await res.json();

      interface RawRunRow {
        id: string;
        workspaceId: string;
        status: string;
        projectId: number | null;
        result: string | null;
        createdAt: string;
        updatedAt: string;
        hasReport?: boolean;
      }

      const rawRows: RawRunRow[] = data.runs ?? [];

      // Filter to only workflow benchmark rows by taskSlug prefix.
      const mapped: BenchmarkRunListRow[] = rawRows
        .map((r) => {
          const parsed = parseBenchmarkRunResult(r.result);
          return { parsed, r };
        })
        .filter(({ parsed }) => parsed?.taskSlug?.startsWith(WF_PREFIX))
        .map(({ parsed, r }) => {
          // `requestedModel` is optional — handle gracefully
          const requestedModel = parsed?.requestedModel ?? undefined;
          const requestedJudgeModel = parsed?.requestedJudgeModel ?? undefined;
          const nPassed = toCount(parsed?.n_passed);
          const nTotal = toCount(parsed?.n_total);

          return {
            id: r.id,
            workspaceId: r.workspaceId,
            runType: "manual" as const,
            status: r.status as WorkflowStatus,
            projectId: r.projectId,
            taskSlug: parsed?.taskSlug ?? "",
            taskTitle: parsed?.taskTitle ?? "",
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            n_passed: nPassed,
            n_total: nTotal,
            all_pass: typeof parsed?.all_pass === "boolean" ? parsed.all_pass : undefined,
            evalTriggerRef: parsed?.evalTriggerRef,
            evalOutputRef: parsed?.evalOutputRef,
            criteria_results: parsed?.criteria_results,
            requestedModel,
            requestedJudgeModel,
            generateJamieChat: parsed?.generateJamieChat,
            jamieChatStatus: parsed?.jamieChatStatus,
            jamieChatPath: parsed?.jamieChatPath,
            generateRunReport: parsed?.generateRunReport,
            hasReport: r.hasReport === true,
            runner: parsed?.runner === "strut" ? "strut" : undefined,
            strutRunUrl: typeof parsed?.strutRunUrl === "string" ? parsed.strutRunUrl : undefined,
            judgeNotes:
              nPassed != null && nTotal != null
                ? `${nPassed}/${nTotal} criteria passed${
                    (requestedJudgeModel ?? parsed?.judge_model)
                      ? `. Judge: ${requestedJudgeModel ?? parsed?.judge_model}`
                      : ""
                  }`
                : undefined,
          } satisfies BenchmarkRunListRow;
        });

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
        (r) =>
          r.status === WorkflowStatus.PENDING || r.status === WorkflowStatus.IN_PROGRESS,
      ),
    [],
  );

  const startPolling = useCallback(() => {
    stopPolling();
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    intervalRef.current = setInterval(() => {
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

  // Start/stop polling whenever runs list changes
  useEffect(() => {
    const active = runs.some(
      (r) =>
        r.status === WorkflowStatus.PENDING || r.status === WorkflowStatus.IN_PROGRESS,
    );
    if (active) {
      startPolling();
    } else {
      stopPolling();
    }
    return stopPolling;
  }, [runs, startPolling, stopPolling]);

  // Visibility gating
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") {
        stopPolling();
        return;
      }
      if (missedUpdateRef.current) {
        missedUpdateRef.current = false;
        void fetchRuns().then(() => {
          if (hasActiveRuns()) startPolling();
        });
      } else if (hasActiveRuns()) {
        startPolling();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchRuns, stopPolling, startPolling, hasActiveRuns]);

  // Pusher real-time updates
  useEffect(() => {
    if (!channel) return;
    const handleUpdate = (_data: { runId?: string; run_id?: string; type?: string }) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      void Promise.resolve(fetchRunRef.current?.()).finally(() => {
        isFetchingRef.current = false;
      });
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
        fetchRuns().then(() => {
          if (hasActiveRuns()) startPolling();
        });
      }
    },
    [fetchRuns, startPolling, hasActiveRuns],
  );

  return { runs, total, isLoading, error, refetch: fetchRuns, setExpandedId };
}
