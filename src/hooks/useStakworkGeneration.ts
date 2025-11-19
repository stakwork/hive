import { useEffect, useState, useCallback, useRef } from "react";
import { useToast } from "@/components/ui/use-toast";
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

interface CreateRunInput {
  type: StakworkRunType;
  featureId: string;
  workspaceId: string;
}

export function useStakworkGeneration({
  featureId,
  type,
  enabled = true,
}: UseStakworkGenerationOptions) {
  const [latestRun, setLatestRun] = useState<StakworkRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [querying, setQuerying] = useState(false);
  const { toast } = useToast();
  const { workspace } = useWorkspace();

  // Use ref to store latest query function for Pusher handlers
  const queryLatestRunRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // Query for latest run without decision
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

      // Find latest run without decision
      const runWithoutDecision = data.runs?.find(
        (run: StakworkRun) => run.decision === null
      );

      if (runWithoutDecision) {
        setLatestRun(runWithoutDecision);
      }
    } catch (error) {
      console.error("Error querying stakwork runs:", error);
    } finally {
      setQuerying(false);
    }
  }, [enabled, workspace?.id, featureId, type]);

  // Update ref whenever queryLatestRun changes (for Pusher handlers)
  useEffect(() => {
    queryLatestRunRef.current = queryLatestRun;
  }, [queryLatestRun]);

  // Query on mount and when key dependencies change
  useEffect(() => {
    if (!enabled || !workspace?.id) return;
    queryLatestRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, workspace?.id, featureId, type]);

  // Subscribe to Pusher updates
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
      // If update is for our feature and type, refetch
      if (data.featureId === featureId && data.type === type) {
        queryLatestRunRef.current?.();
      }
    };

    const handleRunDecision = (data: {
      runId: string;
      decision: StakworkRunDecision;
      featureId: string;
    }) => {
      // If decision is for our feature, refetch
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

  // Create new stakwork run
  const createRun = useCallback(
    async (input: CreateRunInput) => {
      try {
        setLoading(true);
        const response = await fetch("/api/stakwork/ai/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to create stakwork run");
        }

        const data = await response.json();
        setLatestRun(data.run);

        toast({
          title: "Generation started",
          description: "Your deep thinking process has begun. This may take a few minutes.",
        });

        return data.run;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to start generation";
        toast({
          title: "Error",
          description: message,
          variant: "destructive",
        });
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  // Accept stakwork run result
  const acceptRun = useCallback(
    async (runId: string, targetFeatureId: string) => {
      try {
        setLoading(true);
        const response = await fetch(`/api/stakwork/runs/${runId}/decision`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision: "ACCEPTED",
            featureId: targetFeatureId,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to accept result");
        }

        const data = await response.json();

        toast({
          title: "Result accepted",
          description: "The generated content has been saved to your feature.",
        });

        // Clear latest run since decision is made
        setLatestRun(null);

        return data.run;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to accept result";
        toast({
          title: "Error",
          description: message,
          variant: "destructive",
        });
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  // Reject stakwork run result
  const rejectRun = useCallback(
    async (runId: string, feedback?: string) => {
      try {
        setLoading(true);
        const response = await fetch(`/api/stakwork/runs/${runId}/decision`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision: "REJECTED",
            feedback,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to reject result");
        }

        const data = await response.json();

        toast({
          title: "Result rejected",
          description: "The generated content has been discarded.",
        });

        // Clear latest run since decision is made
        setLatestRun(null);

        return data.run;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to reject result";
        toast({
          title: "Error",
          description: message,
          variant: "destructive",
        });
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  return {
    latestRun,
    loading,
    querying,
    createRun,
    acceptRun,
    rejectRun,
    refetch: queryLatestRun,
  };
}
