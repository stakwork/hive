import { useEffect, useRef, useState, useCallback } from "react";

export interface LogEntry {
  timestamp: string;
  projectId: string;
  chatId?: string;
  message: string;
}

export const useProjectLogWebSocket = (
  projectId: string | null,
  chatId?: string | null,
  isVerboseLoggingEnabled: boolean = false,
) => {
  const wsRef = useRef<WebSocket | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lastLogLine, setLastLogLine] = useState<string>("");

  const addLogEntry = useCallback((logEntry: LogEntry) => {
    setLogs((prevLogs) => [...prevLogs, logEntry]);
    setLastLogLine(logEntry.message);
  }, []);

  // Clear logs function
  const clearLogs = useCallback(() => {
    setLogs([]);
    setLastLogLine("");
  }, []);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    const connectToLogWebSocket = () => {
      const ws = new WebSocket(
        "wss://jobs.stakwork.com/cable?channel=ProjectLogChannel",
      );

      ws.onopen = () => {
        const command = {
          command: "subscribe",
          identifier: JSON.stringify({
            channel: "ProjectLogChannel",
            id: projectId,
          }),
        };
        ws.send(JSON.stringify(command));
      };

      ws.onmessage = (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        if (data.type === "ping") return;

        if (isVerboseLoggingEnabled) {
          console.log("Hive Chat Data message", data);
        }

        const messageData = data?.message;

        if (
          messageData &&
          (messageData.type === "on_step_start" ||
            messageData.type === "on_step_complete")
        ) {
          // Skip empty messages to keep the current thinking log visible
          if (!messageData.message || messageData.message.trim() === "") {
            return;
          }

          const logEntry: LogEntry = {
            timestamp: new Date().toISOString(),
            projectId,
            ...(chatId && { chatId }),
            message: messageData.message,
          };

          addLogEntry(logEntry);
        }
      };

      ws.onerror = () => {
        // WebSocket connection failed - this is expected on localhost
      };

      ws.onclose = () => {
        // Connection closed
      };

      return ws;
    };

    wsRef.current = connectToLogWebSocket();

    // Cleanup function
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // addLogEntry is stable (has no dependencies) and doesn't need to trigger reconnection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, chatId, isVerboseLoggingEnabled]);

  return {
    logs,
    lastLogLine,
    clearLogs,
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
    disconnect: () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    },
  };
};
