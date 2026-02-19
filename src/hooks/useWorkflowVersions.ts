"use client";

import { useState, useEffect, useCallback } from "react";

export interface WorkflowVersion {
  workflow_version_id: string;
  workflow_id: number;
  workflow_json: string;
  workflow_name?: string;
  date_added_to_graph: string;
  published: boolean;
  published_at?: string | null;
  ref_id: string;
  node_type: "Workflow_version";
}

interface UseWorkflowVersionsResult {
  versions: WorkflowVersion[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch Workflow_version nodes from the graph API for a specific workflow.
 * @param workspaceSlug - The workspace slug
 * @param workflowId - The workflow ID to fetch versions for
 */
export function useWorkflowVersions(
  workspaceSlug: string | null,
  workflowId: number | null,
): UseWorkflowVersionsResult {
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVersions = useCallback(async () => {
    if (!workspaceSlug || workflowId === null) {
      setVersions([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const url = `/api/workspaces/${workspaceSlug}/workflows/${workflowId}/versions`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch workflow versions: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Failed to fetch workflow versions");
      }

      const fetchedVersions = (result.data?.versions || []) as WorkflowVersion[];

      // Filter to only include valid Workflow_version nodes
      const validVersions = fetchedVersions.filter(
        (version) => version.node_type === "Workflow_version" && version.workflow_version_id && version.workflow_json,
      );

      setVersions(validVersions);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      setVersions([]);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceSlug, workflowId]);

  useEffect(() => {
    if (workspaceSlug && workflowId !== null) {
      fetchVersions();
    } else {
      setVersions([]);
      setError(null);
    }
  }, [workspaceSlug, workflowId, fetchVersions]);

  return {
    versions,
    isLoading,
    error,
    refetch: fetchVersions,
  };
}
