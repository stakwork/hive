import { useEffect, useRef, useState, useCallback } from "react";

export interface WorkflowData {
  workflowData: {
    transitions?: unknown[];
    connections?: unknown[];
    [key: string]: unknown;
  };
  status: string;
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
      setWorkflowData(data);

      // Stop polling if workflow is completed
      if (data.status === "completed" && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
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
  }, []);

  // Start/stop polling based on isActive, projectId, and workflow status
  useEffect(() => {
    // Don't start polling if not active, no projectId, or workflow is already completed
    if (!isActive || !projectId || workflowData?.status === "completed") {
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
  }, [isActive, projectId, pollingInterval, fetchWorkflowData, workflowData?.status]);

  return {
    workflowData,
    isLoading,
    error,
    clearWorkflowData,
    isPolling: intervalRef.current !== null,
    refetch: fetchWorkflowData,
  };
};
