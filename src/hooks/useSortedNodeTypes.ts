"use client";

import { useMemo } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useNodeTypes } from "@/stores/useDataStore";

export interface NodeTypeOrderItem {
  type: string;
  order: number;
}

/**
 * Hook that returns node types sorted according to workspace configuration
 */
export function useSortedNodeTypes() {
  const { workspace } = useWorkspace();
  const nodeTypesFromGraph = useNodeTypes();

  const sortedNodeTypes = useMemo(() => {
    if (!nodeTypesFromGraph || nodeTypesFromGraph.length === 0) {
      return [];
    }

    // Get the order configuration from workspace
    const nodeTypeOrder = workspace?.nodeTypeOrder as NodeTypeOrderItem[] | null;

    if (!nodeTypeOrder || nodeTypeOrder.length === 0) {
      // No custom order configured, return alphabetical order
      return [...nodeTypesFromGraph].sort((a, b) => a.localeCompare(b));
    }

    // Create order map from configuration
    const orderMap = new Map(nodeTypeOrder.map(item => [item.type, item.order]));

    // Sort node types according to configuration
    return [...nodeTypesFromGraph].sort((a, b) => {
      const orderA = orderMap.get(a) ?? 999; // Put unknown types at end
      const orderB = orderMap.get(b) ?? 999;

      if (orderA === orderB) {
        // If same order (or both unknown), sort alphabetically
        return a.localeCompare(b);
      }

      return orderA - orderB;
    });
  }, [nodeTypesFromGraph, workspace?.nodeTypeOrder]);

  return sortedNodeTypes;
}

/**
 * Hook that returns the order number for a specific node type
 */
export function useNodeTypeOrder(nodeType: string): number {
  const { workspace } = useWorkspace();

  const nodeTypeOrder = useMemo(() => {
    const order = workspace?.nodeTypeOrder as NodeTypeOrderItem[] | null;

    if (!order || order.length === 0) {
      return 999; // Default order for unconfigured types
    }

    const orderItem = order.find(item => item.type === nodeType);
    return orderItem?.order ?? 999;
  }, [workspace?.nodeTypeOrder, nodeType]);

  return nodeTypeOrder;
}

/**
 * Utility function to sort any array of node types according to workspace configuration
 */
export function sortNodeTypesByConfig(
  nodeTypes: string[],
  nodeTypeOrder: NodeTypeOrderItem[] | null | undefined
): string[] {
  if (!nodeTypes || nodeTypes.length === 0) {
    return [];
  }

  if (!nodeTypeOrder || nodeTypeOrder.length === 0) {
    // No custom order configured, return alphabetical order
    return [...nodeTypes].sort((a, b) => a.localeCompare(b));
  }

  // Create order map from configuration
  const orderMap = new Map(nodeTypeOrder.map(item => [item.type, item.order]));

  // Sort node types according to configuration
  return [...nodeTypes].sort((a, b) => {
    const orderA = orderMap.get(a) ?? 999; // Put unknown types at end
    const orderB = orderMap.get(b) ?? 999;

    if (orderA === orderB) {
      // If same order (or both unknown), sort alphabetically
      return a.localeCompare(b);
    }

    return orderA - orderB;
  });
}