import { useEffect, useState, useCallback, useRef } from "react";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";
import { parseBenchmarkRunResult } from "@/types/legal";
import { RUN_LIST_LIMIT } from "@/lib/harvey-lab/benchmark-summary";
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
  updatedAt: string;
  // Flat score fields from the runner webhook (single-run pipeline)
  n_passed?: number;
  n_total?: number;
  all_pass?: boolean;
  judgeNotes?: string; // "${n_passed}/${n_total} criteria passed. Judge: ${judge_model}"
  /** Operator-chosen execution model (bare name). Absent on legacy runs. */
  requestedModel?: string;
  /** Operator-chosen judge model (bare name). Absent on legacy runs. */
  requestedJudgeModel?: string;
  /** Operator checked "Generate Report" at run creation */
  generateReport?: boolean;
  /** Report lifecycle: "generating" | "completed" | "failed" */
  reportStatus?: string;
  /** Relative link to the report chat, e.g. "/org/<login>?chat=<id>" */
  reportChatPath?: string;
  // Run report bundle flags — derived server-side from the persisted projection
  /** True when a sanitized run report bundle is available for this run */
  hasReport?: boolean;
  /** True when the bundle was truncated due to size limits */
  reportPartialBundle?: boolean;
  /** True when the bundle's schema_version is unsupported by this Hive version */
  schemaUnsupported?: boolean;
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
        `/api/stakwork/runs?type=${StakworkRunType.LEGAL_BENCHMARK_RUNNER}&workspaceId=${workspaceId}&limit=${RUN_LIST_LIMIT}&includeResult=true`,
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
        updatedAt: string;
        hasReport?: boolean;
        reportPartial?: boolean;
        schemaUnsupported?: boolean;
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
          updatedAt: r.updatedAt,
          n_passed: parsed?.n_passed,
          n_total: parsed?.n_total,
          all_pass: parsed?.all_pass,
          requestedModel: parsed?.requestedModel,
          requestedJudgeModel: parsed?.requestedJudgeModel,
          generateReport: parsed?.generateReport,
          reportStatus: parsed?.reportStatus,
          reportChatPath: parsed?.reportChatPath,
          // Run report bundle flags from the server-side mapper
          hasReport: r.hasReport ?? false,
          reportPartialBundle: r.reportPartial ?? false,
          schemaUnsupported: r.schemaUnsupported ?? false,
          // Unified judge precedence: operator choice takes priority over runner-echoed value.
          // Format mirrors stakwork-run.ts — if the server-side format string changes, update this line to match.
          judgeNotes:
            parsed?.n_passed != null && parsed?.n_total != null
              ? `${parsed.n_passed}/${parsed.n_total} criteria passed${
                  (parsed.requestedJudgeModel ?? parsed.judge_model)
                    ? `. Judge: ${parsed.requestedJudgeModel ?? parsed.judge_model}`
                    : ""
                }`
              : undefined,
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
    const handleUpdate = (_data: { runId?: string; run_id?: string }) => {
      // Refetch on any STAKWORK_RUN_UPDATE event on this workspace channel,
      // regardless of whether the run id is already in the loaded list.
      // This ensures the header strip updates live even when a brand-new run
      // fires its first update before the list has had a chance to load it.
      if (isFetchingRef.current) return; // drop burst duplicates
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
