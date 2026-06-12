"use client";

import { useState, useEffect, useCallback } from "react";

export interface WorkflowRun {
  id: number;
  name: string;
  status: "finished" | "error" | "halted" | "active";
  started_at: string | null;
  finished_at: string | null;
}

interface UseWorkflowRunsResult {
  runs: WorkflowRun[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useWorkflowRuns(
  slug: string | null,
  workflowId: number | null,
): UseWorkflowRunsResult {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    if (!slug || workflowId === null) {
      setRuns([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/workspaces/${slug}/workflows/${workflowId}/runs`,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch workflow runs: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Failed to fetch workflow runs");
      }

      setRuns(result.data?.runs ?? []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      setRuns([]);
    } finally {
      setIsLoading(false);
    }
  }, [slug, workflowId]);

  useEffect(() => {
    if (slug && workflowId !== null) {
      fetchRuns();
    } else {
      setRuns([]);
      setError(null);
    }
  }, [slug, workflowId, fetchRuns]);

  return { runs, isLoading, error, refetch: fetchRuns };
}
