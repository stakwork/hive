import { useAgentEvents, type AgentEventsStatus } from "@/hooks/useAgentEvents";
import type { StreamContext } from "@/app/w/[slug]/task/[...taskParams]/components/WorkflowStatusBadge";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Given a streamContext with an agent identifier, accumulates SSE events
 * and maps them to the conversation shape expected by LogsArtifactPanel.
 *
 * Returns null when streamContext is null or agent is missing.
 */
export function useStreamedAgentLog(
  streamContext: (StreamContext & { agent?: string }) | null,
): { agent: string; conversation: ConversationMessage[]; status: AgentEventsStatus } | null {
  const { events, status } = useAgentEvents(
    streamContext?.requestId ?? null,
    streamContext?.eventsToken ?? null,
    streamContext?.baseUrl ?? null,
  );

  if (!streamContext || !streamContext.agent) return null;

  // Once done/error with no accumulated events, return null (nothing to show)
  if ((status === "done" || status === "error") && events.length === 0) return null;

  const conversation: ConversationMessage[] = events.map((e) => {
    if (e.type === "tool_call") {
      const inputStr = e.input
        ? Object.entries(e.input)
            .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
            .join(", ")
        : "";
      return {
        role: "assistant" as const,
        content: inputStr ? `🔧 ${e.toolName} — ${inputStr}` : `🔧 ${e.toolName}`,
      };
    }
    // text event
    return { role: "assistant" as const, content: e.text };
  });

  return { agent: streamContext.agent, conversation, status };
}
