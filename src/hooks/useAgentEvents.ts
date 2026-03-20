import { useEffect, useRef, useState } from "react";

export interface AgentTextEvent {
  type: "text";
  text: string;
}

export interface AgentToolCallEvent {
  type: "tool_call";
  toolName: string;
}

export type AgentEvent = AgentTextEvent | AgentToolCallEvent;

export type AgentEventsStatus = "idle" | "streaming" | "done" | "error";

export function useAgentEvents(
  requestId: string | null,
  token: string | null,
  baseUrl: string | null,
): { latestEvent: AgentEvent | null; status: AgentEventsStatus } {
  const [latestEvent, setLatestEvent] = useState<AgentEvent | null>(null);
  const [status, setStatus] = useState<AgentEventsStatus>("idle");
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!requestId || !token || !baseUrl) {
      return;
    }

    setStatus("streaming");
    setLatestEvent(null);

    const url = `${baseUrl}/events/${requestId}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "text") {
          setLatestEvent({ type: "text", text: data.text ?? "" });
        } else if (data.type === "tool_call") {
          setLatestEvent({ type: "tool_call", toolName: data.toolName ?? data.tool_name ?? "" });
        } else if (data.type === "done") {
          setStatus("done");
          es.close();
          esRef.current = null;
        } else if (data.type === "error") {
          setStatus("error");
          es.close();
          esRef.current = null;
        }
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      setStatus("error");
      es.close();
      esRef.current = null;
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [requestId, token, baseUrl]);

  return { latestEvent, status };
}
