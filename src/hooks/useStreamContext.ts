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
    console.log("[useStreamContext] onMessage", { hasArtifacts: !!message.artifacts?.length, streamArtifactType: streamArtifact?.type, streamContent: streamArtifact?.content });
    if (streamArtifact?.content) {
      const content = streamArtifact.content as StreamContent;
      console.log("[useStreamContext] setting streamContext", { requestId: content.request_id, baseUrl: content.base_url });
      setStreamContext({
        requestId: content.request_id,
        eventsToken: content.events_token,
        baseUrl: content.base_url,
      });
    }
  }

  function onWorkflowStatusUpdate(update: WorkflowStatusUpdate) {
    console.log("[useStreamContext] onWorkflowStatusUpdate", update.workflowStatus);
    if (TERMINAL_STATUSES.includes(update.workflowStatus)) {
      console.log("[useStreamContext] clearing streamContext (terminal status)");
      setStreamContext(null);
    }
  }

  return { streamContext, onMessage, onWorkflowStatusUpdate };
}
