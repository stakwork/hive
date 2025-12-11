import {
  getPusherClient,
  getWorkspaceChannelName,
  PUSHER_EVENTS,
} from "@/lib/pusher";
import { StakworkRunType, WorkflowStatus } from "@prisma/client";
import { useEffect } from "react";

interface StakworkRunUpdateEvent {
  runId: string;
  type: StakworkRunType;
  status: WorkflowStatus;
  featureId: string;
  timestamp?: string | Date;
}

interface UseTasksHighlightOptions {
  workspaceSlug?: string | null;
  enabled?: boolean;
  onRunUpdate?: (update: StakworkRunUpdateEvent) => void;
}

/**
 * Subscribe to workspace Pusher channel (emitted from the Stakwork webhook)
 * and surface Stakwork run updates.
 */
export const useTasksHighlight = ({
  workspaceSlug,
  enabled = true,
  onRunUpdate,
}: UseTasksHighlightOptions) => {
  useEffect(() => {
    if (!enabled || !workspaceSlug) return;

    try {
      const pusher = getPusherClient();
      const channelName = getWorkspaceChannelName(workspaceSlug);
      const channel = pusher.subscribe(channelName);

      const handleRunUpdate = (data: StakworkRunUpdateEvent) => {
        console.log("Received Stakwork run update:", data);
        onRunUpdate?.(data);
      };

      channel.bind(PUSHER_EVENTS.STAKWORK_RUN_UPDATE, handleRunUpdate);

      return () => {
        channel.unbind(PUSHER_EVENTS.STAKWORK_RUN_UPDATE, handleRunUpdate);
        pusher.unsubscribe(channelName);
      };
    } catch (error) {
      console.error("Error subscribing to stakwork run updates:", error);
    }
  }, [enabled, workspaceSlug, onRunUpdate]);
};
