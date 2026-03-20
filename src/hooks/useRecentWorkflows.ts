"use client";

import { useState, useEffect, useCallback } from "react";

export interface RecentWorkflow {
  id: number;
  name: string;
  updated_at: string | null;
  last_modified_by: string | null;
}

interface UseRecentWorkflowsResult {
  workflows: RecentWorkflow[];
  isLoading: boolean;
  error: string | null;
}

export function useRecentWorkflows(): UseRecentWorkflowsResult {
  const [workflows, setWorkflows] = useState<RecentWorkflow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRecentWorkflows = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/workflow/recent");

      if (!response.ok) {
        throw new Error(`Failed to fetch recent workflows: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || "Failed to fetch recent workflows");
      }

      setWorkflows(result.data.workflows ?? []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      setWorkflows([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecentWorkflows();
  }, [fetchRecentWorkflows]);

  return { workflows, isLoading, error };
}
