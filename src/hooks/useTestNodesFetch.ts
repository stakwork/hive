"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import { useDataStore } from "@/stores/useDataStore";
import { useGraphStore } from "@/stores/useGraphStore";
import { useEffect, useRef } from "react";

type VisibilityKey = "unitTests" | "integrationTests" | "e2eTests";
type NodeType = "unittest" | "integrationtest" | "e2etest";

const VISIBILITY_TO_NODE_TYPE: Record<VisibilityKey, NodeType> = {
  unitTests: "unittest",
  integrationTests: "integrationtest",
  e2eTests: "e2etest",
};

/**
 * Hook that subscribes to test layer visibility changes and fetches test nodes on-demand.
 * Prevents duplicate fetches by tracking which node types have already been fetched.
 */
export function useTestNodesFetch() {
  const { id: workspaceId } = useWorkspace();
  const addNewNode = useDataStore((s) => s.addNewNode);
  const testLayerVisibility = useGraphStore((s) => s.testLayerVisibility);

  // Track which node types have been fetched to prevent duplicates
  const fetchedNodeTypes = useRef<Set<NodeType>>(new Set());

  useEffect(() => {
    // Skip if workspace is not loaded
    if (!workspaceId) {
      return;
    }

    // Check each visibility key for false → true transitions
    Object.entries(testLayerVisibility).forEach(([key, isVisible]) => {
      if (!isVisible) {
        return; // Skip if layer is not visible
      }

      const visibilityKey = key as VisibilityKey;
      const nodeType = VISIBILITY_TO_NODE_TYPE[visibilityKey];

      // Skip if already fetched
      if (fetchedNodeTypes.current.has(nodeType)) {
        return;
      }

      // Fetch test nodes for this type
      const fetchTestNodes = async () => {
        try {
          const endpoint = encodeURIComponent("graph/search");
          const nodeTypeParam = encodeURIComponent(JSON.stringify([nodeType]));
          const url = `/api/swarm/jarvis/nodes?id=${workspaceId}&endpoint=${endpoint}&node_type=${nodeTypeParam}`;

          console.log(`[useTestNodesFetch] Fetching ${nodeType} nodes from:`, url);

          const response = await fetch(url);

          if (!response.ok) {
            throw new Error(`Failed to fetch ${nodeType} nodes: ${response.statusText}`);
          }

          const result = await response.json();

          if (!result.success || !result.data) {
            throw new Error(`API returned unsuccessful response for ${nodeType}`);
          }

          // Map nodes to include default position values
          const nodes = (result.data.nodes || []).map((node: any) => ({
            ...node,
            x: node.x ?? 0,
            y: node.y ?? 0,
            z: node.z ?? 0,
            edge_count: node.edge_count ?? 0,
          }));

          const edges = result.data.edges || [];

          console.log(`[useTestNodesFetch] Fetched ${nodes.length} ${nodeType} nodes, ${edges.length} edges`);

          // Add nodes to the graph
          addNewNode({ nodes, edges });

          // Mark this node type as fetched
          fetchedNodeTypes.current.add(nodeType);
        } catch (error) {
          console.error(`[useTestNodesFetch] Error fetching ${nodeType} nodes:`, error);
        }
      };

      fetchTestNodes();
    });
  }, [testLayerVisibility, workspaceId, addNewNode]);
}
