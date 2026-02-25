import { useState, useEffect, useCallback, useRef } from "react";
import { ChatMessage, WorkflowStatus } from "@/lib/chat";
import { getPusherClient, getTaskChannelName, getFeatureChannelName, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
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
  status?: string;
  workflowStatus?: string;
  timestamp: Date;
}

export interface PRStatusChangeEvent {
  taskId: string;
  prNumber: number;
  prUrl?: string;
  state: "healthy" | "conflict" | "ci_failure" | "checking" | "merged" | "closed";
  artifactStatus?: "IN_PROGRESS" | "DONE" | "CANCELLED";
  problemDetails?: string;
  timestamp: Date;
}

export interface BountyStatusChangeEvent {
  taskId: string;
  artifactId: string;
  content: Record<string, unknown>;
}

export interface DeploymentStatusChangeEvent {
  taskId: string;
  deploymentStatus: "staging" | "production" | "failed";
  environment: "staging" | "production";
  deployedAt?: Date;
  timestamp: Date;
}

interface UsePusherConnectionOptions {
  taskId?: string | null;
  featureId?: string | null;
  workspaceSlug?: string | null;
  enabled?: boolean;
  onMessage?: (message: ChatMessage) => void;
  onWorkflowStatusUpdate?: (update: WorkflowStatusUpdate) => void;
  onRecommendationsUpdated?: (update: RecommendationsUpdatedEvent) => void;
  onTaskTitleUpdate?: (update: TaskTitleUpdateEvent) => void;
  onPRStatusChange?: (update: PRStatusChangeEvent) => void;
  onBountyStatusChange?: (update: BountyStatusChangeEvent) => void;
  onDeploymentStatusChange?: (update: DeploymentStatusChangeEvent) => void;
  onFeatureUpdated?: () => void;
  onStaleConnection?: () => void;
  connectionReadyDelay?: number; // Configurable delay for connection readiness
}

interface UsePusherConnectionReturn {
  isConnected: boolean;
  connectionId: string | null;
  connect: (id: string, type: "task" | "feature" | "workspace") => void;
  disconnect: () => void;
  error: string | null;
}

const LOGS = false;

export function usePusherConnection({
  taskId,
  featureId,
  workspaceSlug,
  enabled = true,
  onMessage,
  onWorkflowStatusUpdate,
  onRecommendationsUpdated,
  onTaskTitleUpdate,
  onPRStatusChange,
  onBountyStatusChange,
  onDeploymentStatusChange,
  onFeatureUpdated,
  onStaleConnection,
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
  const onPRStatusChangeRef = useRef(onPRStatusChange);
  const onBountyStatusChangeRef = useRef(onBountyStatusChange);
  const onDeploymentStatusChangeRef = useRef(onDeploymentStatusChange);
  const onFeatureUpdatedRef = useRef(onFeatureUpdated);
  const onStaleConnectionRef = useRef(onStaleConnection);
  const currentChannelIdRef = useRef<string | null>(null);
  const currentChannelTypeRef = useRef<"task" | "feature" | "workspace" | null>(null);
  const hasEverConnectedRef = useRef(false);

  onMessageRef.current = onMessage;
  onWorkflowStatusUpdateRef.current = onWorkflowStatusUpdate;
  onRecommendationsUpdatedRef.current = onRecommendationsUpdated;
  onTaskTitleUpdateRef.current = onTaskTitleUpdate;
  onPRStatusChangeRef.current = onPRStatusChange;
  onBountyStatusChangeRef.current = onBountyStatusChange;
  onDeploymentStatusChangeRef.current = onDeploymentStatusChange;
  onFeatureUpdatedRef.current = onFeatureUpdated;
  onStaleConnectionRef.current = onStaleConnection;

  const notifyStaleConnection = useCallback(() => {
    if (onStaleConnectionRef.current) {
      onStaleConnectionRef.current();
    }
  }, []);

  // Stable disconnect function
  const disconnect = useCallback(() => {
    if (channelRef.current && currentChannelIdRef.current && currentChannelTypeRef.current) {
      const channelName =
        currentChannelTypeRef.current === "task"
          ? getTaskChannelName(currentChannelIdRef.current)
          : currentChannelTypeRef.current === "feature"
            ? getFeatureChannelName(currentChannelIdRef.current)
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
    (targetId: string, type: "task" | "feature" | "workspace") => {
      // Disconnect from any existing channel
      disconnect();

      if (LOGS) {
        console.log(`Subscribing to Pusher channel for ${type}:`, targetId);
      }

      try {
        const channelName = type === "task" ? getTaskChannelName(targetId) : type === "feature" ? getFeatureChannelName(targetId) : getWorkspaceChannelName(targetId);
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

        // Task and feature channels share the same message events
        if (type === "task" || type === "feature") {
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
          channel.bind(PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE, (update: WorkflowStatusUpdate) => {
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
          });

          // Task title update events
          channel.bind(PUSHER_EVENTS.TASK_TITLE_UPDATE, (update: TaskTitleUpdateEvent) => {
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
          });

          // PR status change events
          channel.bind(PUSHER_EVENTS.PR_STATUS_CHANGE, (update: PRStatusChangeEvent) => {
            if (LOGS) {
              console.log("Received PR status change:", {
                taskId: update.taskId,
                prNumber: update.prNumber,
                state: update.state,
                channelName,
              });
            }
            if (onPRStatusChangeRef.current) {
              onPRStatusChangeRef.current(update);
            }
          });

          // Bounty status change events
          channel.bind(PUSHER_EVENTS.BOUNTY_STATUS_CHANGE, (update: BountyStatusChangeEvent) => {
            if (LOGS) {
              console.log("Received bounty status change:", {
                taskId: update.taskId,
                artifactId: update.artifactId,
                channelName,
              });
            }
            if (onBountyStatusChangeRef.current) {
              onBountyStatusChangeRef.current(update);
            }
          });

          // Deployment status change events
          channel.bind(PUSHER_EVENTS.DEPLOYMENT_STATUS_CHANGE, (update: DeploymentStatusChangeEvent) => {
            if (LOGS) {
              console.log("Received deployment status change:", {
                taskId: update.taskId,
                deploymentStatus: update.deploymentStatus,
                environment: update.environment,
                channelName,
              });
            }
            if (onDeploymentStatusChangeRef.current) {
              onDeploymentStatusChangeRef.current(update);
            }
          });

          // Feature updated events (plan data changed)
          channel.bind(PUSHER_EVENTS.FEATURE_UPDATED, () => {
            if (onFeatureUpdatedRef.current) {
              onFeatureUpdatedRef.current();
            }
          });
        }

        // Workspace-specific events
        if (type === "workspace") {
          channel.bind(PUSHER_EVENTS.RECOMMENDATIONS_UPDATED, (update: RecommendationsUpdatedEvent) => {
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
          });

          // Workspace task title update events
          channel.bind(PUSHER_EVENTS.WORKSPACE_TASK_TITLE_UPDATE, (update: TaskTitleUpdateEvent) => {
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
          });
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
      hasEverConnectedRef.current = false;
      disconnect();
      return;
    }

    // Determine which connection to make
    if (taskId && taskId !== currentChannelIdRef.current) {
      if (LOGS) {
        console.log("Connecting to Pusher channel for task:", taskId);
      }
      connect(taskId, "task");
    } else if (featureId && featureId !== currentChannelIdRef.current) {
      if (LOGS) {
        console.log("Connecting to Pusher channel for feature:", featureId);
      }
      connect(featureId, "feature");
    } else if (workspaceSlug && workspaceSlug !== currentChannelIdRef.current) {
      if (LOGS) {
        console.log("Connecting to Pusher channel for workspace:", workspaceSlug);
      }
      connect(workspaceSlug, "workspace");
    } else if (!taskId && !featureId && !workspaceSlug) {
      hasEverConnectedRef.current = false;
      disconnect();
    }

    return disconnect;
  }, [taskId, featureId, workspaceSlug, enabled, connect, disconnect]);

  // Notify consumers when real-time updates may have been missed.
  // 1) visibility restore from background tabs
  // 2) reconnect transitions after an established connection
  useEffect(() => {
    if (!enabled || (!taskId && !featureId && !workspaceSlug)) {
      return;
    }

    let client;
    try {
      client = getPusherClient();
    } catch (error) {
      console.error("Error getting Pusher client for stale-connection monitoring:", error);
      return;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        notifyStaleConnection();
      }
    };

    const handleStateChange = (states: { previous: string; current: string }) => {
      if (states.current === "connected") {
        if (hasEverConnectedRef.current && states.previous !== "connected") {
          notifyStaleConnection();
        }
        hasEverConnectedRef.current = true;
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    client.connection.bind("state_change", handleStateChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      client.connection.unbind("state_change", handleStateChange);
    };
  }, [enabled, taskId, featureId, workspaceSlug, notifyStaleConnection]);

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
