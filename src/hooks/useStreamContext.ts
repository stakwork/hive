import { useState } from "react";
import type { StreamContext } from "@/app/w/[slug]/task/[...taskParams]/components/WorkflowStatusBadge";
import { type ChatMessage, type StreamContent, WorkflowStatus } from "@/lib/chat";
import type { WorkflowStatusUpdate } from "@/hooks/usePusherConnection";

const TERMINAL_STATUSES: WorkflowStatus[] = [
  WorkflowStatus.COMPLETED,
  WorkflowStatus.FAILED,
  WorkflowStatus.ERROR,
  WorkflowStatus.HALTED,
];

export function useStreamContext() {
  const [streamContext, setStreamContext] = useState<StreamContext | null>(null);

  function onMessage(message: ChatMessage) {
    const streamArtifact = message.artifacts?.find((a) => a.type === "STREAM");
    if (streamArtifact?.content) {
      const content = streamArtifact.content as StreamContent;
      setStreamContext({
        requestId: content.request_id,
        eventsToken: content.events_token,
        baseUrl: content.base_url,
      });
    }
  }

  function onWorkflowStatusUpdate(update: WorkflowStatusUpdate) {
    if (TERMINAL_STATUSES.includes(update.workflowStatus)) {
      setStreamContext(null);
    }
  }

  return { streamContext, onMessage, onWorkflowStatusUpdate };
}
