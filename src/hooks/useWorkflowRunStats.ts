"use client";

import { useState, useEffect, useCallback } from "react";

export interface WorkflowStats {
  available: boolean;
  last_run_at?: string | null;
  total_runs?: number;
  active_runs?: number;
  error_rate?: number;
}

interface UseWorkflowRunStatsResult {
  stats: WorkflowStats | null;
  isLoading: boolean;
  error: string | null;
}

export function useWorkflowRunStats(
  slug: string | null,
  workflowId: number | null,
): UseWorkflowRunStatsResult {
  const [stats, setStats] = useState<WorkflowStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    if (!slug || workflowId === null) {
      setStats(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/workspaces/${slug}/workflows/${workflowId}/stats`,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch workflow stats: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Failed to fetch workflow stats");
      }

      setStats(result.data ?? { available: false });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      setStats({ available: false });
    } finally {
      setIsLoading(false);
    }
  }, [slug, workflowId]);

  useEffect(() => {
    if (slug && workflowId !== null) {
      fetchStats();
    } else {
      setStats(null);
      setError(null);
    }
  }, [slug, workflowId, fetchStats]);

  return { stats, isLoading, error };
}
