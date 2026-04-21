"use client";

import { useState, useEffect, useCallback } from "react";

export interface TaskStats {
  total: number;
  inProgress: number;
  waitingForInput: number;
  queuedCount: number;
}

interface UseTaskStatsResult {
  stats: TaskStats | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useTaskStats(workspaceId: string | null): UseTaskStatsResult {
  // Stats are safe to fetch for both authenticated users and public viewers
  // on isPublicViewable workspaces; the server handles authorization and
  // returns 4xx otherwise.
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    if (!workspaceId) {
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
  }, [workspaceId]);

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
