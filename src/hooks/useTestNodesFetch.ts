"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import { TestLayerVisibility } from "@/stores/useGraphStore";
import { useDataStore } from "@/stores/useStores";
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
export function useTestNodesFetch(testLayerVisibility?: TestLayerVisibility) {
  const { id: workspaceId } = useWorkspace();
  const addNewNode = useDataStore((s) => s.addNewNode);
  const addNewNodeRef = useRef(addNewNode);

  // Keep ref in sync without retriggering effect
  addNewNodeRef.current = addNewNode;

  // Track which node types have been fetched to prevent duplicates
  const fetchedNodeTypes = useRef<Set<NodeType>>(new Set());
  const prevVisibility = useRef<TestLayerVisibility | null>(null);
  const prevWorkspace = useRef<string | null>(null);

  useEffect(() => {
    // Skip if workspace is not loaded or visibility is missing
    if (!workspaceId || !testLayerVisibility) {
      return;
    }

    // Reset fetched set when workspace changes
    if (prevWorkspace.current !== workspaceId) {
      fetchedNodeTypes.current = new Set();
      prevWorkspace.current = workspaceId;
    }

    // Check each visibility key for false → true transitions
    const visibilityEntries: Array<[VisibilityKey, boolean]> = [
      ["unitTests", testLayerVisibility.unitTests],
      ["integrationTests", testLayerVisibility.integrationTests],
      ["e2eTests", testLayerVisibility.e2eTests],
    ];

    visibilityEntries.forEach(([visibilityKey, isVisible]) => {
      const wasVisible = prevVisibility.current?.[visibilityKey] ?? false;
      // Only react to rising edge
      if (!isVisible || wasVisible) return;

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
          addNewNodeRef.current({ nodes, edges });

          // Mark this node type as fetched
          fetchedNodeTypes.current.add(nodeType);
        } catch (error) {
          console.error(`[useTestNodesFetch] Error fetching ${nodeType} nodes:`, error);
        }
      };

      fetchTestNodes();
    });

    prevVisibility.current = testLayerVisibility;
  }, [
    testLayerVisibility?.unitTests,
    testLayerVisibility?.integrationTests,
    testLayerVisibility?.e2eTests,
    workspaceId,
  ]);
}
