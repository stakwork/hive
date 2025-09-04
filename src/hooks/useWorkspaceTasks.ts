"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { WorkflowStatus } from "@/lib/chat";
import {
  usePusherConnection,
  TaskTitleUpdateEvent,
} from "@/hooks/usePusherConnection";

export interface TaskData {
  id: string;
  title: string;
  description: string | null;
  status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  priority: "LOW" | "MEDIUM" | "HIGH";
  workflowStatus: WorkflowStatus | null;
  sourceType: "USER" | "JANITOR" | "SYSTEM";
  stakworkProjectId?: number | null;
  createdAt: string;
  updatedAt: string;
  hasActionArtifact?: boolean;
  assignee?: {
    id: string;
    name: string | null;
    email: string | null;
  };
  repository?: {
    id: string;
    name: string;
    repositoryUrl: string;
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

interface PaginationData {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
}

interface UseWorkspaceTasksResult {
  tasks: TaskData[];
  loading: boolean;
  error: string | null;
  pagination: PaginationData | null;
  loadMore: () => Promise<void>;
  refetch: (includeLatestMessage?: boolean) => Promise<void>;
  waitingForInputCount: number;
}

export function useWorkspaceTasks(
  workspaceId: string | null, 
  workspaceSlug?: string | null, 
  includeNotifications: boolean = false
): UseWorkspaceTasksResult {
  const { data: session } = useSession();
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Handle real-time task title updates
  const handleTaskTitleUpdate = useCallback(
    (update: TaskTitleUpdateEvent) => {
      setTasks(prevTasks => 
        prevTasks.map(task => 
          task.id === update.taskId 
            ? { ...task, title: update.newTitle }
            : task
        )
      );
    },
    [],
  );

  // Subscribe to workspace-level updates if workspaceSlug is provided
  usePusherConnection({
    workspaceSlug,
    enabled: !!workspaceSlug,
    onTaskTitleUpdate: handleTaskTitleUpdate,
  });

  const fetchTasks = useCallback(async (page: number, reset: boolean = false, includeLatestMessage: boolean = includeNotifications) => {
    if (!workspaceId || !session?.user) {
      setTasks([]);
      setPagination(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = `/api/tasks?workspaceId=${workspaceId}&page=${page}&limit=5${includeLatestMessage ? '&includeLatestMessage=true' : ''}`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch tasks: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.success && Array.isArray(result.data)) {
        setTasks(prevTasks => reset ? result.data : [...prevTasks, ...result.data]);
        setPagination(result.pagination);
      } else {
        throw new Error("Invalid response format");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to fetch tasks";
      setError(errorMessage);
      console.error("Error fetching workspace tasks:", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, session?.user, includeNotifications]);

  const loadMore = useCallback(async () => {
    if (pagination?.hasMore) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      await fetchTasks(nextPage, false);
    }
  }, [fetchTasks, pagination?.hasMore, currentPage]);

  const refetch = useCallback(async (includeLatestMessage?: boolean) => {
    setCurrentPage(1);
    await fetchTasks(1, true, includeLatestMessage);
  }, [fetchTasks]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Calculate count of tasks waiting for input
  const waitingForInputCount = includeNotifications 
    ? tasks.filter(task => task.hasActionArtifact).length 
    : 0;

  return {
    tasks,
    loading,
    error,
    pagination,
    loadMore,
    refetch,
    waitingForInputCount,
  };
}