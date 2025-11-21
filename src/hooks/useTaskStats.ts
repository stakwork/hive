"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";

export interface TaskStats {
  total: number;
  inProgress: number;
  waitingForInput: number;
}

interface UseTaskStatsResult {
  stats: TaskStats | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useTaskStats(workspaceId: string | null): UseTaskStatsResult {
  const { data: session } = useSession();
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    if (!workspaceId || !session?.user) {
      setStats(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/stats?workspaceId=${workspaceId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch task statistics: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success && result.data) {
        setStats(result.data);
      } else {
        throw new Error("Invalid response format");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to fetch task statistics";
      setError(errorMessage);
      console.error("Error fetching task statistics:", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, session?.user]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return {
    stats,
    loading,
    error,
    refetch: fetchStats,
  };
}
