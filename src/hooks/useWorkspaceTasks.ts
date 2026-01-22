"use client";

import {
  TaskTitleUpdateEvent,
  usePusherConnection,
} from "@/hooks/usePusherConnection";
import { WorkflowStatus } from "@/lib/chat";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

// SessionStorage key for persisting current page across navigation
export const TASKS_PAGE_STORAGE_KEY = (workspaceId: string) => `tasks_page_${workspaceId}`;

// Helper functions for sessionStorage operations
export const saveCurrentPage = (workspaceId: string, page: number) => {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(TASKS_PAGE_STORAGE_KEY(workspaceId), page.toString());
  }
};

export const getStoredPage = (workspaceId: string): number => {
  if (typeof window !== "undefined") {
    const stored = window.sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspaceId));
    if (stored) {
      const parsed = parseInt(stored, 10);
      // Return default if parsing resulted in NaN (corrupted data)
      return isNaN(parsed) ? 1 : parsed;
    }
    return 1;
  }
  return 1;
};

export const clearStoredPage = (workspaceId: string) => {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(TASKS_PAGE_STORAGE_KEY(workspaceId));
  }
};

export interface TaskData {
  id: string;
  title: string;
  description: string | null;
  status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  priority: "LOW" | "MEDIUM" | "HIGH";
  workflowStatus: WorkflowStatus | null;
  sourceType: "USER" | "JANITOR" | "TASK_COORDINATOR" | "SYSTEM";
  mode: string;
  podId?: string | null;
  stakworkProjectId?: number | null;
  featureId?: string | null;
  systemAssigneeType?: "TASK_COORDINATOR" | "BOUNTY_HUNTER" | null;
  createdAt: string;
  updatedAt: string;
  hasActionArtifact?: boolean;
  prArtifact?: {
    id: string;
    type: string;
    content: any;
  } | null;
  assignee?: {
    id: string;
    name: string | null;
    email: string | null;
    image?: string | null;
    icon?: string | null;
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
  includeNotifications: boolean = false,
  pageLimit: number = 5,
  showArchived: boolean = false,
  search?: string,
  filters?: {
    sourceType?: string;
    status?: string;
    priority?: string;
    hasPod?: boolean;
  },
  showAllStatuses: boolean = false
): UseWorkspaceTasksResult {
  const { data: session } = useSession();
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isRestoringFromStorage, setIsRestoringFromStorage] = useState(false);

  const fetchTasks = useCallback(async (page: number, reset: boolean = false, includeLatestMessage: boolean = includeNotifications, limit: number = pageLimit) => {
    if (!workspaceId || !session?.user) {
      setTasks([]);
      setPagination(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const archivedParam = showArchived ? '&includeArchived=true' : '';
      const searchParam = search && search.trim() ? `&search=${encodeURIComponent(search.trim())}` : '';
      const sourceTypeParam = filters?.sourceType ? `&sourceType=${encodeURIComponent(filters.sourceType)}` : '';
      const statusParam = filters?.status ? `&status=${encodeURIComponent(filters.status)}` : '';
      const priorityParam = filters?.priority ? `&priority=${encodeURIComponent(filters.priority)}` : '';
      const hasPodParam = filters?.hasPod !== undefined ? `&hasPod=${filters.hasPod}` : '';
      const showAllStatusesParam = showAllStatuses ? '&showAllStatuses=true' : '';
      const url = `/api/tasks?workspaceId=${workspaceId}&page=${page}&limit=${limit}${includeLatestMessage ? '&includeLatestMessage=true' : ''}${archivedParam}${searchParam}${sourceTypeParam}${statusParam}${priorityParam}${hasPodParam}${showAllStatusesParam}`;

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
  }, [workspaceId, session?.user, includeNotifications, pageLimit, showArchived, search, filters?.sourceType, filters?.status, filters?.priority, filters?.hasPod, showAllStatuses]);

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
        const archivedParam = showArchived ? '&includeArchived=true' : '';
        const searchParam = search && search.trim() ? `&search=${encodeURIComponent(search.trim())}` : '';
        const sourceTypeParam = filters?.sourceType ? `&sourceType=${encodeURIComponent(filters.sourceType)}` : '';
        const statusParam = filters?.status ? `&status=${encodeURIComponent(filters.status)}` : '';
        const priorityParam = filters?.priority ? `&priority=${encodeURIComponent(filters.priority)}` : '';
        const hasPodParam = filters?.hasPod !== undefined ? `&hasPod=${filters.hasPod}` : '';
        const showAllStatusesParam = showAllStatuses ? '&showAllStatuses=true' : '';
        const url = `/api/tasks?workspaceId=${workspaceId}&page=${page}&limit=${pageLimit}${includeLatestMessage ? '&includeLatestMessage=true' : ''}${archivedParam}${searchParam}${sourceTypeParam}${statusParam}${priorityParam}${hasPodParam}${showAllStatusesParam}`;
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
  }, [workspaceId, session?.user, includeNotifications, fetchTasks, showArchived, showAllStatuses]);

  // Handle real-time task title updates (also handles archive status changes)
  const handleTaskTitleUpdate = useCallback(
    (update: TaskTitleUpdateEvent) => {
      setTasks(prevTasks => {
        // If task is archived/unarchived, remove it from current list
        // (it will now belong to the opposite tab)
        if ('archived' in update && update.archived !== showArchived) {
          const filteredTasks = prevTasks.filter(task => task.id !== update.taskId);

          // Fetch exactly 1 replacement item to maintain the same total count
          // Use setTimeout to avoid state updates during render
          setTimeout(() => {
            if (pagination?.hasMore) {
              // Calculate page to get the next item after current loaded items
              const totalLoadedItems = filteredTasks.length; // After removal
              const nextItemPage = totalLoadedItems + 1;

              // Fetch exactly 1 replacement item
              fetchTasks(nextItemPage, false, includeNotifications, 1);
            }
          }, 0);

          return filteredTasks;
        }

        // Otherwise update the task in place
        return prevTasks.map(task =>
          task.id === update.taskId
            ? {
                ...task,
                ...(update.newTitle !== undefined && { title: update.newTitle }),
                ...('podId' in update && { podId: update.podId }),
              }
            : task
        );
      });
    },
    [showArchived, fetchTasks, includeNotifications, pagination?.hasMore],
  );

  // Subscribe to workspace-level updates if workspaceSlug is provided
  usePusherConnection({
    workspaceSlug,
    enabled: !!workspaceSlug,
    onTaskTitleUpdate: handleTaskTitleUpdate,
  });

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
