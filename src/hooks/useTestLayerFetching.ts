import { useWorkspace } from "@/hooks/useWorkspace";
import { useDataStore } from "@/stores/useDataStore";
import { useGraphStore } from "@/stores/useGraphStore";
import { Link, Node } from "@Universe/types";
import { useEffect, useRef } from "react";

interface ApiResponse {
  success: boolean;
  data?: {
    nodes?: Node[];
    edges?: Link[];
  };
}

type TestVisibilityKey = keyof typeof nodeTypeMap;

const nodeTypeMap = {
  unitTests: 'unittest',
  integrationTests: 'integrationtest',
  e2eTests: 'e2etest',
} as const;

export function useTestLayerFetching() {
  const { id: workspaceId } = useWorkspace();
  const addNewNode = useDataStore((s) => s.addNewNode);
  const testLayerVisibility = useGraphStore((s) => s.testLayerVisibility);
  const testNodesFetched = useGraphStore((s) => s.testNodesFetched);
  const setTestNodesFetched = useGraphStore((s) => s.setTestNodesFetched);

  // Track ongoing fetches per test type to prevent duplicates
  const fetchInProgressRef = useRef<Record<TestVisibilityKey, boolean>>({
    unitTests: false,
    integrationTests: false,
    e2eTests: false,
  });

  // Abort controllers for cleanup
  const abortControllersRef = useRef<Record<TestVisibilityKey, AbortController | null>>({
    unitTests: null,
    integrationTests: null,
    e2eTests: null,
  });

  useEffect(() => {
    const fetchTestNodes = async (visibilityKey: TestVisibilityKey) => {
      if (!workspaceId) return;

      // Skip if already fetched or fetch in progress
      if (testNodesFetched[visibilityKey] || fetchInProgressRef.current[visibilityKey]) {
        return;
      }

      // Mark fetch as in progress
      fetchInProgressRef.current[visibilityKey] = true;

      // Create abort controller for this request
      const controller = new AbortController();
      abortControllersRef.current[visibilityKey] = controller;

      try {
        const nodeType = nodeTypeMap[visibilityKey];
        
        // Construct endpoint with node_type included in the endpoint string
        const endpoint = `graph/search?limit=500&depth=1&node_type=["${nodeType}"]`;
        
        const requestUrl = `/api/swarm/jarvis/nodes?id=${workspaceId}&endpoint=${encodeURIComponent(endpoint)}`;
        
        console.log(`Fetching ${visibilityKey} test nodes from: ${endpoint}`);

        const response = await fetch(requestUrl, {
          signal: controller.signal,
        });

        const data: ApiResponse = await response.json();

        if (data.success && data.data?.nodes) {
          // Merge nodes and edges into graph
          addNewNode({
            nodes: data.data.nodes.map(node => ({
              ...node,
              x: node.x ?? 0,
              y: node.y ?? 0,
              z: node.z ?? 0,
              edge_count: node.edge_count ?? 0,
            })),
            edges: data.data.edges || [],
          });

          // Mark as fetched
          setTestNodesFetched(visibilityKey, true);

          console.log(`Fetched ${data.data.nodes.length} ${visibilityKey} nodes with ${data.data.edges?.length || 0} edges`);
        }
      } catch (err) {
        // Don't log if request was aborted (cleanup)
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error(`Failed to fetch ${visibilityKey} test nodes:`, err);
        }
      } finally {
        // Always reset fetch in progress flag
        fetchInProgressRef.current[visibilityKey] = false;
        abortControllersRef.current[visibilityKey] = null;
      }
    };

    // Check each test type and fetch if visibility is enabled and not yet fetched
    (Object.keys(testLayerVisibility) as TestVisibilityKey[]).forEach((key) => {
      if (testLayerVisibility[key] && !testNodesFetched[key]) {
        fetchTestNodes(key);
      }
    });
  }, [workspaceId, testLayerVisibility, testNodesFetched, addNewNode, setTestNodesFetched]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Abort all ongoing fetches
      (Object.keys(abortControllersRef.current) as TestVisibilityKey[]).forEach((key) => {
        const controller = abortControllersRef.current[key];
        if (controller) {
          controller.abort();
          abortControllersRef.current[key] = null;
        }
      });
    };
  }, []);
}