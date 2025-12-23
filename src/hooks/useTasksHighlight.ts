"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import {
  getPusherClient,
  getWorkspaceChannelName,
  PUSHER_EVENTS,
} from "@/lib/pusher";
import { StakworkRunType, TaskStatus, WorkflowStatus } from "@prisma/client";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface StakworkRunUpdateEvent {
  runId: string;
  type: StakworkRunType;
  status: WorkflowStatus;
  featureId: string;
  timestamp?: string | Date;
}

interface TaskData {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  workflowStatus: WorkflowStatus | null;
  sourceType: "USER" | "JANITOR" | "TASK_COORDINATOR" | "SYSTEM";
  createdAt: string;
  updatedAt: string;
  assignee?: {
    id: string;
    name: string | null;
    email: string | null;
  };
  createdBy: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    githubAuth: {
      githubUsername: string;
    } | null;
  };
}

interface UseTasksHighlightOptions {
  workspaceSlug?: string | null;
  enabled?: boolean;
  onRunUpdate?: (update: StakworkRunUpdateEvent) => void;
  onTasksUpdate?: (tasks: TaskData[]) => void;
}

interface UseTasksHighlightResult {
  inProgressTasks: TaskData[];
  tasksLoading: boolean;
  tasksError: string | null;
  refreshTasks: () => Promise<void>;
}

/**
 * Subscribe to workspace Pusher channel (emitted from the Stakwork webhook),
 * surface Stakwork run updates, and fetch in-progress tasks on load.
 */
export const useTasksHighlight = ({
  workspaceSlug,
  enabled = true,
  onRunUpdate,
  onTasksUpdate,
}: UseTasksHighlightOptions): UseTasksHighlightResult => {
  const { data: session } = useSession();
  const {
    id: workspaceId,
    slug: currentWorkspaceSlug,
    getWorkspaceBySlug,
  } = useWorkspace();
  const [inProgressTasks, setInProgressTasks] = useState<TaskData[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);

  // Resolve workspace info from provided slug or current workspace
  const activeWorkspaceSlug = useMemo(
    () => workspaceSlug || currentWorkspaceSlug || null,
    [workspaceSlug, currentWorkspaceSlug]
  );
  const activeWorkspaceId = useMemo(() => {
    if (workspaceSlug) {
      return getWorkspaceBySlug(workspaceSlug)?.id || null;
    }
    return workspaceId || null;
  }, [workspaceSlug, getWorkspaceBySlug, workspaceId]);

  const normalizeStatus = useCallback((status: unknown): TaskStatus => {
    if (typeof status !== "string") return TaskStatus.IN_PROGRESS;
    const upper = status.toUpperCase();
    return (Object.values(TaskStatus) as string[]).includes(upper)
      ? (upper as TaskStatus)
      : TaskStatus.IN_PROGRESS;
  }, []);

  const normalizeWorkflowStatus = useCallback(
    (status: unknown): WorkflowStatus | null => {
      if (typeof status !== "string") return null;
      const upper = status.toUpperCase();
      return (Object.values(WorkflowStatus) as string[]).includes(upper)
        ? (upper as WorkflowStatus)
        : null;
    },
    []
  );

  const mapJarvisNodeToTask = useCallback(
    (node: any): TaskData => {
      const status = normalizeStatus(node?.properties?.status);
      return {
        id: node?.ref_id ?? node?.id ?? "",
        title:
          node?.properties?.title ||
          node?.properties?.name ||
          node?.name ||
          node?.ref_id ||
          "Untitled Task",
        description:
          typeof node?.properties?.description === "string"
            ? node.properties.description
            : null,
        status,
        workflowStatus: normalizeWorkflowStatus(
          node?.properties?.workflowStatus
        ),
        sourceType:
          (node?.properties?.sourceType as TaskData["sourceType"]) || "SYSTEM",
        createdAt:
          (node?.properties?.createdAt as string) ||
          new Date().toISOString(),
        updatedAt:
          (node?.properties?.updatedAt as string) ||
          new Date().toISOString(),
        assignee: undefined,
        createdBy: {
          id: "",
          name: null,
          email: null,
          image: null,
          githubAuth: null,
        },
      };
    },
    [normalizeStatus, normalizeWorkflowStatus]
  );

  // Fetch tasks function (Jarvis-backed to avoid inconsistent DB column issues)
  const fetchInProgressTasks = useCallback(async () => {
    // console.log("[useTasksHighlight] fetchInProgressTasks called", {
    //   activeWorkspaceId,
    //   hasSession: !!session?.user,
    //   activeWorkspaceSlug,
    // });

    if (!activeWorkspaceId || !session?.user) {
      // console.log("[useTasksHighlight] Skipping fetch - missing workspace ID or session");
      return;
    }

    // console.log("[useTasksHighlight] Starting task fetch...");
    setTasksLoading(true);
    setTasksError(null);

    try {
      const requestUrl = `/api/swarm/jarvis/search-by-types?id=${workspaceId}`;
      // console.log("[useTasksHighlight] Making request to:", requestUrl);

      const searchPayload = {
        nodeTypes: {
          "Task": 100,
        },
        include_properties: true,
        namespace: "default"
      };
      // console.log("[useTasksHighlight] Request payload:", searchPayload);

      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(searchPayload),
      });

      // console.log("[useTasksHighlight] Response status:", response.status);
      const result = await response.json();
      // console.log("[useTasksHighlight] Response result:", result);

      const nodes = result?.data?.nodes;
      // console.log("[useTasksHighlight] Extracted nodes:", {
      //   success: result.success,
      //   nodeCount: Array.isArray(nodes) ? nodes.length : 0,
      //   nodes: nodes?.slice(0, 3), // Log first 3 nodes for debugging
      // });

      if (result.success && Array.isArray(nodes)) {
        const tasks = nodes.map(mapJarvisNodeToTask);
        // console.log("[useTasksHighlight] Mapped tasks:", {
        //   totalTasks: tasks.length,
        //   taskSample: tasks.slice(0, 3),
        // });

        const inProgressOnly = tasks.filter(
          (task) => task.status === TaskStatus.IN_PROGRESS
        );
        // console.log("[useTasksHighlight] Filtered in-progress tasks:", {
        //   inProgressCount: inProgressOnly.length,
        //   inProgressTasks: inProgressOnly,
        // });

        setInProgressTasks(inProgressOnly);
        onTasksUpdate?.(inProgressOnly);
      } else {
        throw new Error("Invalid response format from Jarvis");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to fetch tasks";
      // console.error("[useTasksHighlight] Error fetching tasks:", {
      //   error: err,
      //   errorMessage,
      //   activeWorkspaceId,
      //   requestUrl: `/api/swarm/jarvis/search-by-types?id=${workspaceId}`,
      // });
      setTasksError(errorMessage);
    } finally {
      console.log("[useTasksHighlight] Task fetch completed");
      setTasksLoading(false);
    }
  }, [activeWorkspaceId, session?.user, onTasksUpdate, mapJarvisNodeToTask, workspaceId, activeWorkspaceSlug]);

  // Refresh function for external use
  const refreshTasks = useCallback(async () => {
    await fetchInProgressTasks();
  }, [fetchInProgressTasks]);

  // Fetch tasks on mount and when dependencies change
  useEffect(() => {
    if (enabled) {
      fetchInProgressTasks();
    }
  }, [fetchInProgressTasks, enabled]);

  // Subscribe to Pusher updates
  useEffect(() => {
    // console.log("[useTasksHighlight] Pusher effect starting", {
    //   enabled,
    //   activeWorkspaceSlug,
    //   hasOnRunUpdate: !!onRunUpdate,
    // });

    if (!enabled || !activeWorkspaceSlug) {
      // console.log("[useTasksHighlight] Pusher effect skipped - not enabled or no workspace slug");
      return;
    }

    try {
      // console.log("[useTasksHighlight] Getting Pusher client...");
      const pusher = getPusherClient();
      // console.log("[useTasksHighlight] Pusher client obtained:", pusher);

      const channelName = getWorkspaceChannelName(activeWorkspaceSlug);
      // console.log("[useTasksHighlight] Subscribing to channel:", channelName);

      const channel = pusher.subscribe(channelName);
      // console.log("[useTasksHighlight] Channel subscription created:", channel);

      // Log channel connection state
      channel.bind('pusher:subscription_succeeded', () => {
        // console.log("[useTasksHighlight] Channel subscription succeeded:", channelName);
      });

      channel.bind('pusher:subscription_error', (error: any) => {
        console.error("[useTasksHighlight] Channel subscription error:", error);
      });

      const handleRunUpdate = (payload: unknown) => {
        const data = payload as StakworkRunUpdateEvent;
        // console.log("[useTasksHighlight] Received Stakwork run update:", {
        //   data,
        //   timestamp: new Date().toISOString(),
        //   activeWorkspaceSlug,
        // });
        onRunUpdate?.(data);

        // Refresh tasks when run updates occur
        console.log("[useTasksHighlight] Refreshing tasks after run update");
        fetchInProgressTasks();
      };

      // console.log("[useTasksHighlight] Binding to event:", PUSHER_EVENTS.STAKWORK_RUN_UPDATE);
      channel.bind(PUSHER_EVENTS.STAKWORK_RUN_UPDATE, handleRunUpdate);

      // Note: bind_global is not available on ChannelLike interface
      // If you need to debug all events, you'll need to bind to each event individually

      // console.log("[useTasksHighlight] Pusher setup complete for workspace:", activeWorkspaceSlug);

    } catch (error) {
      console.error("[useTasksHighlight] Error setting up Pusher subscription:", {
        error,
        activeWorkspaceSlug,
        enabled,
      });
    }
  }, [enabled, activeWorkspaceSlug, onRunUpdate, fetchInProgressTasks]);

  return {
    inProgressTasks,
    tasksLoading,
    tasksError,
    refreshTasks,
  };
};
