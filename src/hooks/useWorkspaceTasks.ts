"use client";

import {
  TaskTitleUpdateEvent,
  PRStatusChangeEvent,
  DeploymentStatusChangeEvent,
  usePusherConnection,
} from "@/hooks/usePusherConnection";

export type { DeploymentStatusChangeEvent };
import { WorkflowStatus } from "@/lib/chat";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";

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
  dependsOnTaskIds?: string[];
  autoMerge?: boolean;
  deploymentStatus?: string | null;
  deployedToStagingAt?: string | null;
  deployedToProductionAt?: string | null;
  createdAt: string;
  updatedAt: string;
  hasActionArtifact?: boolean;
  prArtifact?: {
    id: string;
    type: string;
    content: any;
  } | null;
  feature?: {
    id: string;
    title: string;
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
  showAllStatuses: boolean = false,
  sortBy?: string,
  sortOrder?: string,
  initialPage: number = 1,
  onPageChange?: (page: number) => void
): UseWorkspaceTasksResult {
  const { data: session } = useSession();
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage > 0 ? initialPage : 1);
  const [isReplayingPages, setIsReplayingPages] = useState(false);
  const isMountedRef = useRef(false);

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
      const sortByParam = sortBy ? `&sortBy=${encodeURIComponent(sortBy)}` : '';
      const sortOrderParam = sortOrder ? `&sortOrder=${encodeURIComponent(sortOrder)}` : '';
      const url = `/api/tasks?workspaceId=${workspaceId}&page=${page}&limit=${limit}${includeLatestMessage ? '&includeLatestMessage=true' : ''}${archivedParam}${searchParam}${sourceTypeParam}${statusParam}${priorityParam}${hasPodParam}${showAllStatusesParam}${sortByParam}${sortOrderParam}`;

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
  }, [workspaceId, session?.user, includeNotifications, pageLimit, showArchived, search, filters?.sourceType, filters?.status, filters?.priority, filters?.hasPod, showAllStatuses, sortBy, sortOrder]);

  // Function to replay pages 1..N when initialPage > 1 (on mount from URL param)
  const replayPages = useCallback(async (targetPage: number, includeLatestMessage: boolean = includeNotifications) => {
    if (!workspaceId || !session?.user || targetPage <= 1) {
      await fetchTasks(1, true, includeLatestMessage);
      return;
    }

    setIsReplayingPages(true);
    setLoading(true);
    setError(null);

    try {
      // Fetch all pages from 1 to targetPage to rebuild the complete tasks array
      const allTasks: TaskData[] = [];
      let finalPagination: PaginationData | null = null;

      for (let page = 1; page <= targetPage; page++) {
        const archivedParam = showArchived ? '&includeArchived=true' : '';
        const searchParam = search && search.trim() ? `&search=${encodeURIComponent(search.trim())}` : '';
        const sourceTypeParam = filters?.sourceType ? `&sourceType=${encodeURIComponent(filters.sourceType)}` : '';
        const statusParam = filters?.status ? `&status=${encodeURIComponent(filters.status)}` : '';
        const priorityParam = filters?.priority ? `&priority=${encodeURIComponent(filters.priority)}` : '';
        const hasPodParam = filters?.hasPod !== undefined ? `&hasPod=${filters.hasPod}` : '';
        const showAllStatusesParam = showAllStatuses ? '&showAllStatuses=true' : '';
        const sortByParam = sortBy ? `&sortBy=${encodeURIComponent(sortBy)}` : '';
        const sortOrderParam = sortOrder ? `&sortOrder=${encodeURIComponent(sortOrder)}` : '';
        const url = `/api/tasks?workspaceId=${workspaceId}&page=${page}&limit=${pageLimit}${includeLatestMessage ? '&includeLatestMessage=true' : ''}${archivedParam}${searchParam}${sourceTypeParam}${statusParam}${priorityParam}${hasPodParam}${showAllStatusesParam}${sortByParam}${sortOrderParam}`;
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
      setCurrentPage(targetPage);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to replay pages";
      setError(errorMessage);
      console.error("Error replaying pages:", err);
      // Fallback to normal fetch on error
      await fetchTasks(1, true, includeLatestMessage);
    } finally {
      setLoading(false);
      setIsReplayingPages(false);
    }
  }, [workspaceId, session?.user, includeNotifications, pageLimit, showArchived, search, filters, showAllStatuses, sortBy, sortOrder, fetchTasks]);

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

  // Handle real-time PR status changes
  const handlePRStatusChange = useCallback((event: PRStatusChangeEvent) => {
    setTasks(prevTasks => {
      return prevTasks.map(task => {
        if (task.id !== event.taskId) return task;

        // Update PR artifact if present
        const updatedTask = { ...task };
        
        if (task.prArtifact?.content) {
          updatedTask.prArtifact = {
            ...task.prArtifact,
            content: {
              ...task.prArtifact.content,
              status: event.artifactStatus || task.prArtifact.content.status,
              state: event.state || task.prArtifact.content.state,
            },
          };
        }

        // Update task status to DONE if PR was merged (artifactStatus === 'DONE')
        if (event.artifactStatus === 'DONE') {
          updatedTask.status = 'DONE';
        }

        return updatedTask;
      });
    });
  }, []);

  // Subscribe to workspace-level updates if workspaceSlug is provided
  usePusherConnection({
    workspaceSlug,
    enabled: !!workspaceSlug,
    onTaskTitleUpdate: handleTaskTitleUpdate,
    onPRStatusChange: handlePRStatusChange,
  });

  const loadMore = useCallback(async () => {
    if (pagination?.hasMore && workspaceId) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      onPageChange?.(nextPage);
      await fetchTasks(nextPage, false);
    }
  }, [fetchTasks, pagination?.hasMore, currentPage, workspaceId, onPageChange]);

  const refetch = useCallback(async (includeLatestMessage?: boolean) => {
    setCurrentPage(1);
    onPageChange?.(1);
    await fetchTasks(1, true, includeLatestMessage);
  }, [fetchTasks, onPageChange]);

  // On mount: replay pages if initialPage > 1
  // On filter/sort/search/tab change after mount: reset to page 1
  useEffect(() => {
    if (!isMountedRef.current) {
      // Initial mount - replay pages if initialPage > 1
      isMountedRef.current = true;
      if (initialPage > 1) {
        replayPages(initialPage);
      } else {
        fetchTasks(1, true);
      }
    } else {
      // Filter/sort/search/tab change after mount - reset to page 1
      setCurrentPage(1);
      onPageChange?.(1);
      fetchTasks(1, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    // Only react to filter/sort/search changes, not page changes
    showArchived,
    search,
    filters?.sourceType,
    filters?.status,
    filters?.priority,
    filters?.hasPod,
    showAllStatuses,
    sortBy,
    sortOrder,
  ]);

  // Note: Global notification count is now handled by WorkspaceProvider

  return {
    tasks,
    loading: loading || isReplayingPages,
    error,
    pagination,
    loadMore,
    refetch,
  };
}
