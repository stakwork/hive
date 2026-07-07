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

/** Operator-facing composite statuses that represent an in-progress pipeline. */
const IN_PROGRESS_STATUSES = new Set<string>(["running", "scoring"]);

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

      // Fetch runner and scorer runs in parallel via the generic /api/stakwork/runs endpoint.
      const [runnerRes, scorerRes] = await Promise.all([
        fetch(
          `/api/stakwork/runs?workspaceId=${workspace.id}&type=${StakworkRunType.LEGAL_BENCHMARK_RUNNER}`,
        ),
        fetch(
          `/api/stakwork/runs?workspaceId=${workspace.id}&type=${StakworkRunType.LEGAL_BENCHMARK_SCORER}`,
        ),
      ]);

      if (!runnerRes.ok || !scorerRes.ok) {
        throw new Error("Failed to fetch benchmark runs");
      }

      const [runnerData, scorerData] = await Promise.all([
        runnerRes.json(),
        scorerRes.json(),
      ]);

      const rawRunnerRuns: RawRunRow[] = runnerData.runs ?? [];
      const rawScorerRuns: RawRunRow[] = scorerData.runs ?? [];

      // Resolve the pair: runId is normally the runner's id but can also be the scorer's.
      let rawRunner = rawRunnerRuns.find((r) => r.id === runId);
      let rawScorer: RawRunRow | undefined;

      if (rawRunner) {
        const runnerResult = parseBenchmarkRunResult(rawRunner.result);
        rawScorer = rawScorerRuns.find((s) => s.id === runnerResult?.siblingRunId);
      } else {
        // Fallback: runId is a scorer id → find scorer, then locate paired runner.
        rawScorer = rawScorerRuns.find((s) => s.id === runId);
        if (rawScorer) {
          const scorerResult = parseBenchmarkRunResult(rawScorer.result);
          rawRunner = rawRunnerRuns.find((r) => r.id === scorerResult?.siblingRunId);
        }
      }

      if (!rawRunner) {
        runRef.current = null;
        setRun(null);
        return;
      }

      // Parse result JSON fields and build typed rows.
      const runnerResult = parseBenchmarkRunResult(rawRunner.result);
      const scorerResult = rawScorer ? parseBenchmarkRunResult(rawScorer.result) : null;

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

      const scorerRow: BenchmarkRunRow | null = rawScorer
        ? {
            id: rawScorer.id,
            workspaceId: rawScorer.workspaceId,
            type: rawScorer.type as StakworkRunType,
            status: rawScorer.status as WorkflowStatus,
            projectId: rawScorer.projectId,
            result: scorerResult,
            createdAt: rawScorer.createdAt,
            updatedAt: rawScorer.updatedAt,
          }
        : null;

      const compositeStatus = deriveBenchmarkStatus(runnerRow.status, scorerRow?.status);

      const legalRun: LegalBenchmarkRun = {
        id: runnerRow.id,
        workspaceId: runnerRow.workspaceId,
        taskSlug: runnerResult?.taskSlug ?? "",
        taskTitle: runnerResult?.taskTitle ?? "",
        status: compositeStatus,
        runnerRun: runnerRow,
        scorerRun: scorerRow,
        runnerOutputUrl: runnerResult?.runnerOutputUrl ?? null,
        runnerOutputText: runnerResult?.runnerOutputText ?? null,
        scoreJson: scorerResult?.scoreJson ?? null,
        errorMessage:
          runnerResult?.errorMessage ?? scorerResult?.errorMessage ?? null,
        createdAt: runnerRow.createdAt,
        updatedAt: scorerRow?.updatedAt ?? runnerRow.updatedAt,
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

  // Stale timeout: after 3 minutes with an in-progress composite status, poll once.
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

  // Pusher subscription — refetch when a STAKWORK_RUN_UPDATE matches our runner or scorer.
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

        // The scorer's id is stored in the runner row's result.siblingRunId.
        const siblingRunId = runRef.current?.runnerRun?.result?.siblingRunId;

        if (updatedId === runId || updatedId === siblingRunId) {
          // Optimistically clear stale if the status is not an in-progress composite value
          // (covers both BenchmarkPipelineStatus and WorkflowStatus terminal values).
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
