import { useEffect, useState, useCallback, useRef } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { getPusherClient } from "@/lib/pusher";
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

export function useStakworkGeneration({
  featureId,
  type,
  enabled = true,
}: UseStakworkGenerationOptions) {
  const [latestRun, setLatestRun] = useState<StakworkRun | null>(null);
  const [querying, setQuerying] = useState(false);
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

  useEffect(() => {
    queryLatestRunRef.current = queryLatestRun;
  }, [queryLatestRun]);

  useEffect(() => {
    if (!enabled || !workspace?.id) return;
    queryLatestRun();
  }, [enabled, workspace?.id, featureId, type, queryLatestRun]);

  useEffect(() => {
    if (!enabled || !workspace?.slug) return;

    const pusher = getPusherClient();
    const channelName = `workspace-${workspace.slug}`;
    const channel = pusher.subscribe(channelName);

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

    return () => {
      channel.unbind("stakwork-run-update", handleRunUpdate);
      channel.unbind("stakwork-run-decision", handleRunDecision);
      pusher.unsubscribe(channelName);
    };
  }, [enabled, workspace?.slug, featureId, type]);

  return {
    latestRun,
    querying,
    refetch: queryLatestRun,
  };
}