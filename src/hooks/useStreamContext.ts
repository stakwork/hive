import { useState } from "react";
import type { StreamContext } from "@/app/w/[slug]/task/[...taskParams]/components/WorkflowStatusBadge";
import { type ChatMessage, type StreamContent, WorkflowStatus } from "@/lib/chat";
import type { WorkflowStatusUpdate } from "@/hooks/usePusherConnection";

export function useStreamContext() {
  const [streamContext, setStreamContext] = useState<StreamContext | null>(null);

  function onMessage(message: ChatMessage) {
    const streamArtifact = message.artifacts?.find((a) => a.type === "STREAM");
    console.log("[useStreamContext] onMessage", { hasArtifacts: !!message.artifacts?.length, streamArtifactType: streamArtifact?.type, streamContent: streamArtifact?.content });
    if (streamArtifact?.content) {
      const content = streamArtifact.content as StreamContent;
      console.log("[useStreamContext] setting streamContext", { requestId: content.requestId, baseUrl: content.baseUrl });
      setStreamContext({
        requestId: content.requestId,
        eventsToken: content.eventsToken,
        baseUrl: content.baseUrl,
        agent: content.agent,
      });
    }
  }

  function onWorkflowStatusUpdate(update: WorkflowStatusUpdate) {
    console.log("[useStreamContext] onWorkflowStatusUpdate", update.workflowStatus);
    // No-op: terminal statuses no longer clear streamContext.
    // The EventSource "done" event drives hasProvisional to false via the status-based check,
    // and clearing here caused a race condition that wiped a freshly-set context for the next run.
  }

  return { streamContext, onMessage, onWorkflowStatusUpdate };
}
