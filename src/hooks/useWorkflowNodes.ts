"use client";

import { useState, useEffect, useCallback } from "react";

export interface WorkflowNodeProperties {
  workflow_id: number;
  workflow_json: string;
  workflow_name?: string;
  customer_id?: number;
  date_added_to_graph?: string;
  node_key?: string;
}

export interface WorkflowNode {
  node_type: "Workflow";
  ref_id: string;
  properties: WorkflowNodeProperties;
  date_added_to_graph?: string;
}

interface UseWorkflowNodesResult {
  workflows: WorkflowNode[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch Workflow nodes from the graph API.
 * @param workspaceSlug - The workspace slug
 * @param enabled - Whether to fetch (default: true)
 */
export function useWorkflowNodes(
  workspaceSlug: string | null,
  enabled: boolean = true
): UseWorkflowNodesResult {
  const [workflows, setWorkflows] = useState<WorkflowNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkflows = useCallback(async () => {
    if (!workspaceSlug) {
      setWorkflows([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const url = `/api/workspaces/${workspaceSlug}/nodes?node_type=Workflow&output=json&limit=500`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch workflows: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Failed to fetch workflows");
      }

      const nodes = (result.data?.nodes || []) as WorkflowNode[];

      // Filter to only include Workflow nodes with valid properties
      const validWorkflows = nodes.filter(
        (node) =>
          node.node_type === "Workflow" &&
          node.properties?.workflow_id !== undefined &&
          node.properties?.workflow_json
      );

      setWorkflows(validWorkflows);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      setWorkflows([]);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceSlug]);

  useEffect(() => {
    if (enabled && workspaceSlug) {
      fetchWorkflows();
    } else {
      setWorkflows([]);
      setError(null);
    }
  }, [enabled, workspaceSlug, fetchWorkflows]);

  return {
    workflows,
    isLoading,
    error,
    refetch: fetchWorkflows,
  };
}
