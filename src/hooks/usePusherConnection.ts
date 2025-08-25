import { useState, useEffect, useCallback, useRef } from "react";
import { ChatMessage, WorkflowStatus } from "@/lib/chat";
import {
  getPusherClient,
  getTaskChannelName,
  PUSHER_EVENTS,
} from "@/lib/pusher";
import type { Channel } from "pusher-js";

export interface WorkflowStatusUpdate {
  taskId: string;
  workflowStatus: WorkflowStatus;
  workflowStartedAt?: Date;
  workflowCompletedAt?: Date;
  timestamp: Date;
}

interface UsePusherConnectionOptions {
  taskId: string | null;
  enabled?: boolean;
  onMessage?: (message: ChatMessage) => void;
  onWorkflowStatusUpdate?: (update: WorkflowStatusUpdate) => void;
  connectionReadyDelay?: number; // Configurable delay for connection readiness
}

interface UsePusherConnectionReturn {
  isConnected: boolean;
  connectionId: string | null;
  connect: (taskId: string) => void;
  disconnect: () => void;
  error: string | null;
}

const LOGS = false;

export function usePusherConnection({
  taskId,
  enabled = true,
  onMessage,
  onWorkflowStatusUpdate,
  connectionReadyDelay = 100, // Default 100ms delay to prevent race conditions
}: UsePusherConnectionOptions): UsePusherConnectionReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Use refs to avoid circular dependencies
  const channelRef = useRef<Channel | null>(null);
  const onMessageRef = useRef(onMessage);
  const onWorkflowStatusUpdateRef = useRef(onWorkflowStatusUpdate);
  const currentTaskIdRef = useRef<string | null>(null);

  onMessageRef.current = onMessage;
  onWorkflowStatusUpdateRef.current = onWorkflowStatusUpdate;

  // Stable disconnect function
  const disconnect = useCallback(() => {
    if (channelRef.current && currentTaskIdRef.current) {
      if (LOGS) {
        console.log(
          "Unsubscribing from Pusher channel:",
          getTaskChannelName(currentTaskIdRef.current),
        );
      }

      // Unbind all events
      channelRef.current.unbind_all();

      // Unsubscribe from the channel
      getPusherClient().unsubscribe(
        getTaskChannelName(currentTaskIdRef.current),
      );

      channelRef.current = null;
      currentTaskIdRef.current = null;
      setIsConnected(false);
      setConnectionId(null);
      setError(null);
    }
  }, []);

  // Stable connect function
  const connect = useCallback(
    (targetTaskId: string) => {
      // Disconnect from any existing channel
      disconnect();

      if (LOGS) {
        console.log("Subscribing to Pusher channel for task:", targetTaskId);
      }

      try {
        const channelName = getTaskChannelName(targetTaskId);
        const channel = getPusherClient().subscribe(channelName);

        // Set up event handlers
        channel.bind("pusher:subscription_succeeded", () => {
          if (LOGS) {
            console.log(
              "Successfully subscribed to Pusher channel:",
              channelName,
            );
          }

          // Add a small delay to ensure Pusher is fully ready to receive messages
          // This prevents race conditions where the first message response might be lost
          setTimeout(() => {
            setIsConnected(true);
            setError(null);
            // Generate a connection ID for compatibility
            setConnectionId(`pusher_${targetTaskId}_${Date.now()}`);
          }, connectionReadyDelay);
        });

        channel.bind("pusher:subscription_error", (error: unknown) => {
          console.error("Pusher subscription error:", error);
          setError("Failed to connect to real-time messaging");
          setIsConnected(false);
        });
        //payload is messageId
        channel.bind(PUSHER_EVENTS.NEW_MESSAGE, async (payload: string) => {
          try {
            if (typeof payload === "string") {
              const res = await fetch(`/api/chat/messages/${payload}`);
              if (res.ok) {
                const data = await res.json();
                const full: ChatMessage = data.data;
                if (onMessageRef.current) onMessageRef.current(full);
                return;
              } else {
                console.error("Failed to fetch message by id", payload);
                return;
              }
            }
          } catch (err) {
            console.error("Error handling NEW_MESSAGE event:", err);
            return;
          }
        });

        // Bind to workflow status update events
        channel.bind(
          PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
          (update: WorkflowStatusUpdate) => {
            if (LOGS) {
              console.log("Received workflow status update:", {
                taskId: update.taskId,
                workflowStatus: update.workflowStatus,
                channelName,
              });
            }
            if (onWorkflowStatusUpdateRef.current) {
              onWorkflowStatusUpdateRef.current(update);
            }
          },
        );

        channelRef.current = channel;
        currentTaskIdRef.current = targetTaskId;
      } catch (error) {
        console.error("Error setting up Pusher connection:", error);
        setError("Failed to setup real-time connection");
        setIsConnected(false);
      }
    },
    [disconnect, connectionReadyDelay],
  );

  // Connection management effect
  useEffect(() => {
    if (!taskId || !enabled) {
      disconnect();
      return;
    }

    // Only connect if we don't already have a connection for this task
    if (currentTaskIdRef.current !== taskId) {
      if (LOGS) {
        console.log("Connecting to Pusher channel for task:", taskId);
      }
      connect(taskId);
    }

    return disconnect;
  }, [taskId, enabled, connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    connectionId,
    connect,
    disconnect,
    error,
  };
}
