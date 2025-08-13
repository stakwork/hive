"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { WorkflowStatus } from "@/lib/chat";

export interface TaskData {
  id: string;
  title: string;
  description: string | null;
  status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  priority: "LOW" | "MEDIUM" | "HIGH";
  workflowStatus: WorkflowStatus | null;
  createdAt: string;
  updatedAt: string;
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
  refetch: () => Promise<void>;
}

export function useWorkspaceTasks(workspaceId: string | null): UseWorkspaceTasksResult {
  const { data: session } = useSession();
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const fetchTasks = useCallback(async (page: number, reset: boolean = false) => {
    if (!workspaceId || !session?.user) {
      setTasks([]);
      setPagination(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/tasks?workspaceId=${workspaceId}&page=${page}&limit=5`, {
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
  }, [workspaceId, session?.user]);

  const loadMore = useCallback(async () => {
    if (pagination?.hasMore) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      await fetchTasks(nextPage, false);
    }
  }, [fetchTasks, pagination?.hasMore, currentPage]);

  const refetch = useCallback(async () => {
    setCurrentPage(1);
    await fetchTasks(1, true);
  }, [fetchTasks]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return {
    tasks,
    loading,
    error,
    pagination,
    loadMore,
    refetch,
  };
}