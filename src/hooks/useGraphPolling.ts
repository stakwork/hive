import { useWorkspace } from "@/hooks/useWorkspace";
import { useDataStore } from "@/stores/useDataStore";
import { Link, Node } from "@Universe/types";
import { useCallback, useEffect, useRef, useState } from "react";

interface ApiResponse {
  success: boolean;
  data?: {
    nodes?: Node[];
    edges?: Link[];
  };
}

interface UseGraphPollingOptions {
  endpoint?: string;
  enabled?: boolean;
  interval?: number;
}

export function useGraphPolling({
  endpoint: propEndpoint,
  enabled = false,
  interval = 3000
}: UseGraphPollingOptions = {}) {
  const { id: workspaceId } = useWorkspace();
  const [isPolling, setIsPolling] = useState(false);
  const [isPollingActive, setIsPollingActive] = useState(false);

  const addNewNode = useDataStore((s) => s.addNewNode);
  const dataInitial = useDataStore((s) => s.dataInitial);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isPollingRequestInProgress = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch new nodes and edges for polling
  const fetchLatestNodes = useCallback(async () => {

    if (!workspaceId || !enabled || isPollingRequestInProgress.current) return;

    // Mark request as in progress
    isPollingRequestInProgress.current = true;
    setIsPollingActive(true);

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      // Use graph/search as base endpoint for polling
      let pollingEndpoint = propEndpoint || "graph/search?limit=20&top_node_count=20";

      // Add start_date_added_to_graph parameter if we have nodes (use latest node's date)
      const latestNode = dataInitial?.nodes?.[0]; // Nodes are sorted by date_added_to_graph
      if (latestNode?.date_added_to_graph) {
        const dateParam = Math.floor(latestNode.date_added_to_graph); // Remove decimal part
        pollingEndpoint += `&start_date_added_to_graph=${dateParam}`;
        console.log(`Polling: Using latest node date: ${latestNode.date_added_to_graph} -> ${dateParam}`);
      } else {
        console.log(`Polling: No existing nodes, using base endpoint`);
      }

      const requestUrl = `/api/swarm/jarvis/nodes?id=${workspaceId}&endpoint=${encodeURIComponent(pollingEndpoint)}`;
      console.log(`Polling endpoint: ${pollingEndpoint}`);

      const response = await fetch(requestUrl, {
        signal: abortControllerRef.current.signal
      });
      const data: ApiResponse = await response.json();

      if (data.success && data.data?.nodes) {
        // Add new nodes and edges to the graph (store handles deduplication)
        addNewNode({
          nodes: data.data.nodes.map(node => ({
            ...node,
            x: 0,
            y: 0,
            z: 0,
            edge_count: 0
          })),
          edges: data.data.edges || []
        });

        // Log polling results
        if (data.data.nodes.length > 0) {
          console.log(`Polling: Found ${data.data.nodes.length} nodes, ${data.data.edges?.length || 0} edges`);
        }
      }
    } catch (err) {
      // Don't log error if request was aborted (user navigated away)
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error("Failed to fetch latest nodes:", err);
      }
    } finally {
      // Always mark request as finished, even if there was an error
      isPollingRequestInProgress.current = false;
      setIsPollingActive(false);
      abortControllerRef.current = null;
    }
  }, [workspaceId, addNewNode, propEndpoint, enabled, dataInitial]);

  // Start polling
  const startPolling = useCallback(() => {
    if (pollIntervalRef.current || !enabled) return; // Already polling or disabled

    setIsPolling(true);
    pollIntervalRef.current = setInterval(() => {
      fetchLatestNodes();
    }, interval);
  }, [fetchLatestNodes, enabled, interval]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    // Abort any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setIsPolling(false);
    // Reset the request flag when stopping polling
    isPollingRequestInProgress.current = false;
    setIsPollingActive(false);
  }, []);

  // Cleanup on unmount or when disabled
  useEffect(() => {
    return () => {
      console.log("useGraphPolling cleanup: stopping polling");
      stopPolling();
    };
  }, [stopPolling]);

  // Start polling when enabled and data is available
  useEffect(() => {
    if (enabled && dataInitial?.nodes && dataInitial.nodes.length > 0 && !isPolling) {
      const timer = setTimeout(() => {
        startPolling();
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [enabled, dataInitial, isPolling, startPolling]);

  // Stop polling when disabled
  useEffect(() => {
    if (!enabled && isPolling) {
      stopPolling();
    }
  }, [enabled, isPolling, stopPolling]);

  return {
    isPolling,
    isPollingActive,
    startPolling,
    stopPolling
  };
}