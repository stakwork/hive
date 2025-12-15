import { useState, useEffect, useCallback, useRef } from "react";
import { ChatMessage, WorkflowStatus } from "@/lib/chat";
import {
  getPusherClient,
  getTaskChannelName,
  getWorkspaceChannelName,
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

export interface RecommendationsUpdatedEvent {
  workspaceSlug: string;
  newRecommendationCount: number;
  totalRecommendationCount: number;
  timestamp: Date;
}

export interface TaskTitleUpdateEvent {
  taskId: string;
  newTitle?: string;
  previousTitle?: string;
  archived?: boolean;
  podId?: string | null;
  timestamp: Date;
}

interface UsePusherConnectionOptions {
  taskId?: string | null;
  workspaceSlug?: string | null;
  enabled?: boolean;
  onMessage?: (message: ChatMessage) => void;
  onWorkflowStatusUpdate?: (update: WorkflowStatusUpdate) => void;
  onRecommendationsUpdated?: (update: RecommendationsUpdatedEvent) => void;
  onTaskTitleUpdate?: (update: TaskTitleUpdateEvent) => void;
  connectionReadyDelay?: number; // Configurable delay for connection readiness
}

interface UsePusherConnectionReturn {
  isConnected: boolean;
  connectionId: string | null;
  connect: (id: string, type: 'task' | 'workspace') => void;
  disconnect: () => void;
  error: string | null;
}

const LOGS = false;

export function usePusherConnection({
  taskId,
  workspaceSlug,
  enabled = true,
  onMessage,
  onWorkflowStatusUpdate,
  onRecommendationsUpdated,
  onTaskTitleUpdate,
  connectionReadyDelay = 100, // Default 100ms delay to prevent race conditions
}: UsePusherConnectionOptions): UsePusherConnectionReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Use refs to avoid circular dependencies
  const channelRef = useRef<Channel | null>(null);
  const onMessageRef = useRef(onMessage);
  const onWorkflowStatusUpdateRef = useRef(onWorkflowStatusUpdate);
  const onRecommendationsUpdatedRef = useRef(onRecommendationsUpdated);
  const onTaskTitleUpdateRef = useRef(onTaskTitleUpdate);
  const currentChannelIdRef = useRef<string | null>(null);
  const currentChannelTypeRef = useRef<'task' | 'workspace' | null>(null);

  onMessageRef.current = onMessage;
  onWorkflowStatusUpdateRef.current = onWorkflowStatusUpdate;
  onRecommendationsUpdatedRef.current = onRecommendationsUpdated;
  onTaskTitleUpdateRef.current = onTaskTitleUpdate;

  // Stable disconnect function
  const disconnect = useCallback(() => {
    if (channelRef.current && currentChannelIdRef.current && currentChannelTypeRef.current) {
      const channelName = currentChannelTypeRef.current === 'task' 
        ? getTaskChannelName(currentChannelIdRef.current)
        : getWorkspaceChannelName(currentChannelIdRef.current);

      if (LOGS) {
        console.log("Unsubscribing from Pusher channel:", channelName);
      }

      // Unbind all events
      channelRef.current.unbind_all();

      // Unsubscribe from the channel
      getPusherClient().unsubscribe(channelName);

      channelRef.current = null;
      currentChannelIdRef.current = null;
      currentChannelTypeRef.current = null;
      setIsConnected(false);
      setConnectionId(null);
      setError(null);
    }
  }, []);

  // Stable connect function
  const connect = useCallback(
    (targetId: string, type: 'task' | 'workspace') => {
      // Disconnect from any existing channel
      disconnect();

      if (LOGS) {
        console.log(`Subscribing to Pusher channel for ${type}:`, targetId);
      }

      try {
        const channelName = type === 'task' 
          ? getTaskChannelName(targetId)
          : getWorkspaceChannelName(targetId);
        const channel = getPusherClient().subscribe(channelName);

        // Set up event handlers
        channel.bind("pusher:subscription_succeeded", () => {
          if (LOGS) {
            console.log("Successfully subscribed to Pusher channel:", channelName);
          }

          // Add a small delay to ensure Pusher is fully ready to receive messages
          setTimeout(() => {
            setIsConnected(true);
            setError(null);
            setConnectionId(`pusher_${type}_${targetId}_${Date.now()}`);
          }, connectionReadyDelay);
        });

        channel.bind("pusher:subscription_error", (error: unknown) => {
          console.error("Pusher subscription error:", error);
          setError(`Failed to connect to ${type} real-time updates`);
          setIsConnected(false);
        });

        // Task-specific events
        if (type === 'task') {
          // Message events (payload is messageId)
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

          // Workflow status update events
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

          // Task title update events
          channel.bind(
            PUSHER_EVENTS.TASK_TITLE_UPDATE,
            (update: TaskTitleUpdateEvent) => {
              if (LOGS) {
                console.log("Received task title update:", {
                  taskId: update.taskId,
                  newTitle: update.newTitle,
                  previousTitle: update.previousTitle,
                  channelName,
                });
              }
              if (onTaskTitleUpdateRef.current) {
                onTaskTitleUpdateRef.current(update);
              }
            },
          );
        }

        // Workspace-specific events
        if (type === 'workspace') {
          channel.bind(
            PUSHER_EVENTS.RECOMMENDATIONS_UPDATED,
            (update: RecommendationsUpdatedEvent) => {
              if (LOGS) {
                console.log("Received recommendations update:", {
                  workspaceSlug: update.workspaceSlug,
                  newRecommendationCount: update.newRecommendationCount,
                  totalRecommendationCount: update.totalRecommendationCount,
                  channelName,
                });
              }
              if (onRecommendationsUpdatedRef.current) {
                onRecommendationsUpdatedRef.current(update);
              }
            },
          );

          // Workspace task title update events
          channel.bind(
            PUSHER_EVENTS.WORKSPACE_TASK_TITLE_UPDATE,
            (update: TaskTitleUpdateEvent) => {
              if (LOGS) {
                console.log("Received workspace task title update:", {
                  taskId: update.taskId,
                  newTitle: update.newTitle,
                  previousTitle: update.previousTitle,
                  channelName,
                });
              }
              if (onTaskTitleUpdateRef.current) {
                onTaskTitleUpdateRef.current(update);
              }
            },
          );
        }

        channelRef.current = channel;
        currentChannelIdRef.current = targetId;
        currentChannelTypeRef.current = type;
      } catch (error) {
        console.error("Error setting up Pusher connection:", error);
        setError(`Failed to setup ${type} real-time connection`);
        setIsConnected(false);
      }
    },
    [disconnect, connectionReadyDelay],
  );

  // Connection management effect
  useEffect(() => {
    if (!enabled) {
      disconnect();
      return;
    }

    // Determine which connection to make
    if (taskId && taskId !== currentChannelIdRef.current) {
      if (LOGS) {
        console.log("Connecting to Pusher channel for task:", taskId);
      }
      connect(taskId, 'task');
    } else if (workspaceSlug && workspaceSlug !== currentChannelIdRef.current) {
      if (LOGS) {
        console.log("Connecting to Pusher channel for workspace:", workspaceSlug);
      }
      connect(workspaceSlug, 'workspace');
    } else if (!taskId && !workspaceSlug) {
      disconnect();
    }

    return disconnect;
  }, [taskId, workspaceSlug, enabled, connect, disconnect]);

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
