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
  hasReport?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fetch and subscribe to a single LEGAL_BENCHMARK_RUNNER run. `null` for
 * `runId` no-ops the hook (returns `{ run: null, isLoading: false, isStale: false }`).
 */
export function useLegalBenchmarkRun(runId: string | null): UseLegalBenchmarkRunResult {
  const { workspace } = useWorkspace();
  const [run, setRun] = useState<LegalBenchmarkRun | null>(null);
  const [isLoading, setIsLoading] = useState(runId !== null);
  const [isStale, setIsStale] = useState(false);

  // Ref so the timer / Pusher callbacks always call the latest fetcher.
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
        hasReport: rawRunner.hasReport === true,
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
        hasReport: runnerRow.hasReport === true,
        runnerOutputUrl: runnerResult?.runnerOutputUrl ?? null,
        runnerOutputText: runnerResult?.runnerOutputText ?? null,
        scoreJson: null,
        errorMessage: runnerResult?.errorMessage ?? null,
        createdAt: runnerRow.createdAt,
        updatedAt: runnerRow.updatedAt,
      };

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
  // If still in-progress after the poll, mark stale. Resets when the run
  // leaves in-progress. Same guard as useStakworkGeneration's hasFiredPollRef.
  //
  // The guard is keyed on the row version (id + updatedAt), not on the effect
  // firing: every fetch stores a fresh `run` object, so without it a run
  // already past the threshold re-armed a zero-delay poll on every re-render —
  // an unbounded refetch loop.
  const polledRowRef = useRef<string | null>(null);

  useEffect(() => {
    if (!run || !IN_PROGRESS_STATUSES.has(run.status)) {
      setIsStale(false);
      polledRowRef.current = null;
      return;
    }

    const rowVersion = `${run.id}:${run.updatedAt}`;
    if (polledRowRef.current === rowVersion) {
      // Already polled this row version and it is still in progress.
      setIsStale(true);
      return;
    }

    const elapsed = Date.now() - new Date(run.updatedAt).getTime();
    const timer = setTimeout(() => {
      polledRowRef.current = rowVersion;
      void fetchRunRef.current?.();
    }, Math.max(0, STALE_RUN_TIMEOUT_MS - elapsed));

    return () => clearTimeout(timer);
  }, [run]);

  // Pusher subscription — refetch when a STAKWORK_RUN_UPDATE matches our run id.
  useEffect(() => {
    if (!workspace?.slug || !runId) return;

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
