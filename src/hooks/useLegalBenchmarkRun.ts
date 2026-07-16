import { useEffect, useState, useCallback, useRef } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { getPusherClient, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import {
  type LegalBenchmarkRun,
  type BenchmarkRunRow,
  parseBenchmarkRunResult,
  deriveBenchmarkStatus,
} from "@/types/legal";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";

const STALE_RUN_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

/** Operator-facing statuses that represent an in-progress run. */
const IN_PROGRESS_STATUSES = new Set<string>(["running"]);

interface UseLegalBenchmarkRunResult {
  run: LegalBenchmarkRun | null;
  isLoading: boolean;
  isStale: boolean;
  refetch: () => Promise<void>;
}

/** Raw shape returned by /api/stakwork/runs for a single row. */
interface RawRunRow {
  id: string;
  workspaceId: string;
  type: string;
  status: string;
  projectId: number | null;
  result: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useLegalBenchmarkRun(runId: string): UseLegalBenchmarkRunResult {
  const { workspace } = useWorkspace();
  const [run, setRun] = useState<LegalBenchmarkRun | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStale, setIsStale] = useState(false);

  // Keep refs so async timer / Pusher callbacks always read latest values.
  const runRef = useRef<LegalBenchmarkRun | null>(null);
  const fetchRunRef = useRef<(() => Promise<void>) | undefined>(undefined);

  const fetchRun = useCallback(async () => {
    if (!workspace?.id || !runId) return;

    try {
      setIsLoading(true);

      const res = await fetch(
        `/api/stakwork/runs?workspaceId=${workspace.id}&type=${StakworkRunType.LEGAL_BENCHMARK_RUNNER}&includeResult=true`,
      );

      if (!res.ok) {
        throw new Error("Failed to fetch benchmark runs");
      }

      const data = await res.json();
      const rawRunnerRuns: RawRunRow[] = data.runs ?? [];

      const rawRunner = rawRunnerRuns.find((r) => r.id === runId);

      if (!rawRunner) {
        runRef.current = null;
        setRun(null);
        return;
      }

      const runnerResult = parseBenchmarkRunResult(rawRunner.result);

      const runnerRow: BenchmarkRunRow = {
        id: rawRunner.id,
        workspaceId: rawRunner.workspaceId,
        type: rawRunner.type as StakworkRunType,
        status: rawRunner.status as WorkflowStatus,
        projectId: rawRunner.projectId,
        result: runnerResult,
        createdAt: rawRunner.createdAt,
        updatedAt: rawRunner.updatedAt,
      };

      const compositeStatus = deriveBenchmarkStatus(runnerRow.status);

      const legalRun: LegalBenchmarkRun = {
        id: runnerRow.id,
        workspaceId: runnerRow.workspaceId,
        taskSlug: runnerResult?.taskSlug ?? "",
        taskTitle: runnerResult?.taskTitle ?? "",
        status: compositeStatus,
        runnerRun: runnerRow,
        scorerRun: null,
        runnerOutputUrl: runnerResult?.runnerOutputUrl ?? null,
        runnerOutputText: runnerResult?.runnerOutputText ?? null,
        scoreJson: null,
        errorMessage: runnerResult?.errorMessage ?? null,
        createdAt: runnerRow.createdAt,
        updatedAt: runnerRow.updatedAt,
      };

      runRef.current = legalRun;
      setRun(legalRun);
    } catch (error) {
      console.error("Error fetching legal benchmark run:", error);
    } finally {
      setIsLoading(false);
    }
  }, [workspace?.id, runId]);

  fetchRunRef.current = fetchRun;

  // Initial fetch on mount.
  useEffect(() => {
    if (!workspace?.id || !runId) return;
    fetchRun();
  }, [workspace?.id, runId, fetchRun]);

  // Stale timeout: after 3 minutes with an in-progress status, poll once.
  // If still in-progress after the poll, mark stale. Resets when status leaves in-progress.
  useEffect(() => {
    if (!run || !IN_PROGRESS_STATUSES.has(run.status)) {
      setIsStale(false);
      return;
    }

    const elapsed = Date.now() - new Date(run.updatedAt).getTime();
    const remaining = Math.max(0, STALE_RUN_TIMEOUT_MS - elapsed);

    const timer = setTimeout(async () => {
      await fetchRunRef.current?.();
      if (runRef.current && IN_PROGRESS_STATUSES.has(runRef.current.status)) {
        setIsStale(true);
      }
    }, remaining);

    return () => clearTimeout(timer);
  }, [run]);

  // Pusher subscription — refetch when a STAKWORK_RUN_UPDATE matches our run id.
  useEffect(() => {
    if (!workspace?.slug) return;

    let channel: ReturnType<ReturnType<typeof getPusherClient>["subscribe"]> | null =
      null;

    try {
      const pusher = getPusherClient();
      const channelName = getWorkspaceChannelName(workspace.slug);
      channel = pusher.subscribe(channelName);

      const handleUpdate = (data: {
        runId?: string;
        run_id?: string;
        status?: string;
      }) => {
        const updatedId = data.runId ?? data.run_id;
        const updatedStatus = data.status ?? "";

        if (updatedId === runId) {
          // Optimistically clear stale if the status is terminal.
          if (!IN_PROGRESS_STATUSES.has(updatedStatus)) {
            setIsStale(false);
          }
          fetchRunRef.current?.();
        }
      };

      channel.bind(PUSHER_EVENTS.STAKWORK_RUN_UPDATE, handleUpdate);
    } catch {
      // Pusher not configured in this environment — degrade gracefully.
      return;
    }

    return () => {
      channel?.unbind(PUSHER_EVENTS.STAKWORK_RUN_UPDATE);
    };
  }, [workspace?.slug, runId]);

  return { run, isLoading, isStale, refetch: fetchRun };
}
