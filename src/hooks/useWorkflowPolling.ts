import { useEffect, useRef, useState, useCallback } from "react";
import { deepEqual } from '@/lib/utils/deepEqual';

export const TERMINAL_STATUSES = ["completed", "failed", "error", "halted", "paused", "stopped"];

export interface WorkflowData {
  workflowData: {
    transitions?: unknown[];
    connections?: unknown[];
    [key: string]: unknown;
  };
  status: string;
  current_transition_completion?: number;
}

export const useWorkflowPolling = (
  projectId: string | null,
  isActive: boolean = false,
  pollingInterval: number = 2000,
) => {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [workflowData, setWorkflowData] = useState<WorkflowData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const previousDataRef = useRef<WorkflowData | null>(null);
  // Track terminal state via ref so the effect doesn't re-run on every status change
  const isTerminalRef = useRef<boolean>(false);

  const fetchWorkflowData = useCallback(async () => {
    if (!projectId) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`/api/stakwork/workflow/${projectId}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch workflow data: ${response.statusText}`);
      }

      const data: WorkflowData = await response.json();
      
      // Only update state if data has actually changed (prevents unnecessary re-renders)
      if (!deepEqual(previousDataRef.current, data)) {
        previousDataRef.current = data;
        setWorkflowData(data);
      }

      // Stop polling if workflow has reached a terminal state
      if (TERMINAL_STATUSES.includes(data.status)) {
        isTerminalRef.current = true;
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    } catch (err) {
      console.error("Error fetching workflow data:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  // Clear workflow data function
  const clearWorkflowData = useCallback(() => {
    setWorkflowData(null);
    setError(null);
    isTerminalRef.current = false;
  }, []);

  // Start/stop polling based on isActive and projectId only.
  // Terminal-state management is handled inside fetchWorkflowData via isTerminalRef,
  // so we intentionally omit workflowData?.status from deps to avoid re-triggering.
  useEffect(() => {
    // Don't start polling if not active, no projectId, or already reached a terminal state
    if (!isActive || !projectId || isTerminalRef.current) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Fetch immediately when starting
    fetchWorkflowData();

    // Then set up polling interval
    intervalRef.current = setInterval(fetchWorkflowData, pollingInterval);

    // Cleanup function
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isActive, projectId, pollingInterval, fetchWorkflowData]);

  return {
    workflowData,
    isLoading,
    error,
    clearWorkflowData,
    isPolling: intervalRef.current !== null,
    refetch: fetchWorkflowData,
  };
};
