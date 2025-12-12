import { useEffect, useState, useCallback, useRef } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { getPusherClient, PUSHER_EVENTS } from "@/lib/pusher";
import type { ThinkingArtifact } from "@/types/thinking";
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
  const [thinkingArtifacts, setThinkingArtifacts] = useState<ThinkingArtifact[]>([]);
  const [openThinkingModal, setOpenThinkingModal] = useState(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastWebhookUpdateRef = useRef<number>(Date.now());
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

    const handleThinkingUpdate = (data: {
      runId: string;
      artifacts: ThinkingArtifact[];
    }) => {
      if (latestRun?.id === data.runId) {
        setThinkingArtifacts(data.artifacts);
        lastWebhookUpdateRef.current = Date.now();
      }
    };

    channel.bind("stakwork-run-update", handleRunUpdate);
    channel.bind("stakwork-run-decision", handleRunDecision);
    channel.bind(PUSHER_EVENTS.STAKWORK_RUN_THINKING_UPDATE, handleThinkingUpdate);

    return () => {
      channel.unbind("stakwork-run-update", handleRunUpdate);
      channel.unbind("stakwork-run-decision", handleRunDecision);
      channel.unbind(PUSHER_EVENTS.STAKWORK_RUN_THINKING_UPDATE, handleThinkingUpdate);
      pusher.unsubscribe(channelName);
    };
  }, [enabled, workspace?.slug, featureId, type, latestRun?.id]);

  // Polling fallback for thinking artifacts
  const fetchThinkingArtifacts = useCallback(async (runId: string) => {
    try {
      const response = await fetch(`/api/stakwork/runs/${runId}/thinking`);
      if (response.ok) {
        const data = await response.json();
        // Only update if no recent webhook update (within last 10 seconds)
        const timeSinceLastWebhook = Date.now() - lastWebhookUpdateRef.current;
        if (timeSinceLastWebhook > 10000) {
          setThinkingArtifacts(data.artifacts || []);
        }
      }
    } catch (error) {
      console.error('Failed to fetch thinking artifacts:', error);
    }
  }, []);

  // Start/stop polling based on run status
  useEffect(() => {
    if (
      latestRun?.id &&
      (latestRun.status === 'IN_PROGRESS' || latestRun.status === 'PENDING')
    ) {
      // Initial fetch
      fetchThinkingArtifacts(latestRun.id);

      // Poll every 4 seconds (middle of 3-5 second range)
      pollingIntervalRef.current = setInterval(() => {
        fetchThinkingArtifacts(latestRun.id);
      }, 4000);
    } else {
      // Clear polling when run is complete or not active
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [latestRun?.id, latestRun?.status, fetchThinkingArtifacts]);

  return {
    latestRun,
    querying,
    refetch: queryLatestRun,
    thinkingArtifacts,
    openThinkingModal,
    setOpenThinkingModal,
  };
}
