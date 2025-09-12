"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { WorkflowStatus } from "@/lib/chat";
import {
  usePusherConnection,
  TaskTitleUpdateEvent,
} from "@/hooks/usePusherConnection";

// SessionStorage key for persisting current page across navigation
const TASKS_PAGE_STORAGE_KEY = (workspaceId: string) => `tasks_page_${workspaceId}`;

// Helper functions for sessionStorage operations
const saveCurrentPage = (workspaceId: string, page: number) => {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(TASKS_PAGE_STORAGE_KEY(workspaceId), page.toString());
  }
};

const getStoredPage = (workspaceId: string): number => {
  if (typeof window !== "undefined") {
    const stored = sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspaceId));
    return stored ? parseInt(stored, 10) : 1;
  }
  return 1;
};

const clearStoredPage = (workspaceId: string) => {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(TASKS_PAGE_STORAGE_KEY(workspaceId));
  }
};

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
  const [isRestoringFromStorage, setIsRestoringFromStorage] = useState(false);

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

  // Function to restore state from sessionStorage by fetching all pages up to stored page
  const restoreFromStorage = useCallback(async (includeLatestMessage: boolean = includeNotifications) => {
    if (!workspaceId || !session?.user) return;

    const storedPage = getStoredPage(workspaceId);
    if (storedPage <= 1) {
      // No stored state or already at initial state, proceed with normal fetch
      await fetchTasks(1, true, includeLatestMessage);
      return;
    }

    setIsRestoringFromStorage(true);
    setLoading(true);
    setError(null);

    try {
      // Fetch all pages from 1 to storedPage to rebuild the complete tasks array
      const allTasks: TaskData[] = [];
      let finalPagination: PaginationData | null = null;

      for (let page = 1; page <= storedPage; page++) {
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
          allTasks.push(...result.data);
          finalPagination = result.pagination;
        } else {
          throw new Error("Invalid response format");
        }
      }

      setTasks(allTasks);
      setPagination(finalPagination);
      setCurrentPage(storedPage);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to restore tasks from storage";
      setError(errorMessage);
      console.error("Error restoring workspace tasks from storage:", err);
      // Clear invalid stored state and fallback to normal fetch
      clearStoredPage(workspaceId);
      await fetchTasks(1, true, includeLatestMessage);
    } finally {
      setLoading(false);
      setIsRestoringFromStorage(false);
    }
  }, [workspaceId, session?.user, includeNotifications, fetchTasks]);

  const loadMore = useCallback(async () => {
    if (pagination?.hasMore && workspaceId) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      // Save the new page to sessionStorage for persistence
      saveCurrentPage(workspaceId, nextPage);
      await fetchTasks(nextPage, false);
    }
  }, [fetchTasks, pagination?.hasMore, currentPage, workspaceId]);

  const refetch = useCallback(async (includeLatestMessage?: boolean) => {
    if (workspaceId) {
      // Clear stored state when explicitly refetching (e.g., on refresh)
      clearStoredPage(workspaceId);
    }
    setCurrentPage(1);
    await fetchTasks(1, true, includeLatestMessage);
  }, [fetchTasks, workspaceId]);

  useEffect(() => {
    // Use restoreFromStorage instead of refetch to maintain state across navigation
    restoreFromStorage();
  }, [restoreFromStorage]);

  // Note: Global notification count is now handled by WorkspaceProvider

  return {
    tasks,
    loading: loading || isRestoringFromStorage,
    error,
    pagination,
    loadMore,
    refetch,
  };
}