import { useEffect, useState, useCallback, useRef } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { getPusherClient } from "@/lib/pusher";
import { toast } from "sonner";
import type { StakworkRunType, WorkflowStatus, StakworkRunDecision } from "@prisma/client";

interface StakworkRun {
  id: string;
  type: StakworkRunType;
  status: WorkflowStatus;
  result: string | null;
  dataType: string;
  decision: StakworkRunDecision | null;
  feedback: string | null;
  featureId: string | null;
  projectId: number | null;
  createdAt: string;
  updatedAt: string;
}

interface UseStakworkGenerationOptions {
  featureId: string;
  type: StakworkRunType;
  enabled?: boolean;
}

const STALE_RUN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export function useStakworkGeneration({
  featureId,
  type,
  enabled = true,
}: UseStakworkGenerationOptions) {
  const [latestRun, setLatestRun] = useState<StakworkRun | null>(null);
  const [querying, setQuerying] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const { workspace } = useWorkspace();

  const queryLatestRunRef = useRef<(() => Promise<void>) | undefined>(undefined);

  const queryLatestRun = useCallback(async () => {
    if (!enabled || !workspace?.id) return;

    try {
      setQuerying(true);
      const params = new URLSearchParams({
        workspaceId: workspace.id,
        featureId,
        type,
        limit: "1",
      });

      const response = await fetch(`/api/stakwork/runs?${params}`);
      if (!response.ok) {
        throw new Error("Failed to query stakwork runs");
      }

      const data = await response.json();

      const runWithoutDecision = data.runs?.find(
        (run: StakworkRun) => run.decision === null
      );

      if (runWithoutDecision) {
        setLatestRun(runWithoutDecision);
      } else {
        setLatestRun(null);
      }
    } catch (error) {
      console.error("Error querying stakwork runs:", error);
    } finally {
      setQuerying(false);
    }
  }, [enabled, workspace?.id, featureId, type]);

  queryLatestRunRef.current = queryLatestRun;

  useEffect(() => {
    if (!enabled || !workspace?.id) return;
    queryLatestRun();
  }, [enabled, workspace?.id, featureId, type, queryLatestRun]);

  useEffect(() => {
    if (!latestRun || (latestRun.status !== "IN_PROGRESS" && latestRun.status !== "PENDING")) {
      setIsStale(false);
      return;
    }
    const elapsed = Date.now() - new Date(latestRun.createdAt).getTime();
    const remaining = STALE_RUN_TIMEOUT_MS - elapsed;
    if (remaining <= 0) {
      setIsStale(true);
      return;
    }
    const timer = setTimeout(() => setIsStale(true), remaining);
    return () => clearTimeout(timer);
  }, [latestRun]);

  useEffect(() => {
    if (!enabled || !workspace?.slug) return;

    let channel: ReturnType<ReturnType<typeof getPusherClient>["subscribe"]> | null = null;

    try {
      const pusher = getPusherClient();
      const channelName = `workspace-${workspace.slug}`;
      channel = pusher.subscribe(channelName);

      const handleRunUpdate = (data: {
        runId: string;
        type: StakworkRunType;
        status: WorkflowStatus;
        featureId: string;
      }) => {
        if (data.featureId === featureId && data.type === type) {
          queryLatestRunRef.current?.();
        }
      };

      const handleRunDecision = (data: {
        runId: string;
        decision: StakworkRunDecision;
        featureId: string;
      }) => {
        if (data.featureId === featureId) {
          queryLatestRunRef.current?.();
        }
      };

      channel.bind("stakwork-run-update", handleRunUpdate);
      channel.bind("stakwork-run-decision", handleRunDecision);
    } catch {
      // Pusher not configured in this environment
      return;
    }

    return () => {
      channel?.unbind("stakwork-run-update");
      channel?.unbind("stakwork-run-decision");
    };
  }, [enabled, workspace?.slug, featureId, type]);

  const stopRun = useCallback(async () => {
    if (!latestRun?.id || isStopping) return;

    try {
      setIsStopping(true);
      const response = await fetch(`/api/stakwork/runs/${latestRun.id}/stop`, {
        method: "POST",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to stop run");
      }

      toast.success("Deep Research stopped");
      await queryLatestRun();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to stop run");
    } finally {
      setIsStopping(false);
    }
  }, [latestRun?.id, isStopping, queryLatestRun]);

  return {
    latestRun,
    querying,
    refetch: queryLatestRun,
    stopRun,
    isStopping,
    isStale,
  };
}
