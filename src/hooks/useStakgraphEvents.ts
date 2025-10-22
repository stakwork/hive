import { useEffect, useRef, useState } from "react";
import { StakgraphProgressEvent } from "@/types/stakgraph";

export function useStakgraphEvents(swarmName: string | undefined, shouldConnect: boolean) {
  const [currentEvent, setCurrentEvent] = useState<StakgraphProgressEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!shouldConnect || !swarmName) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setIsConnected(false);
        setCurrentEvent(null);
      }
      return;
    }

    const eventsUrl = `https://${swarmName}:7799/events`;

    try {
      const eventSource = new EventSource(eventsUrl);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as StakgraphProgressEvent;
          setCurrentEvent(data);
        } catch (err) {
          console.error("Failed to parse stakgraph event:", err);
        }
      };

      eventSource.onerror = (err) => {
        console.error("EventSource error:", err);
        setError("Connection error");
        setIsConnected(false);
        eventSource.close();
      };
    } catch (err) {
      console.error("Failed to create EventSource:", err);
      setError("Failed to connect");
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setIsConnected(false);
      }
    };
  }, [swarmName, shouldConnect]);

  return { currentEvent, isConnected, error };
}
