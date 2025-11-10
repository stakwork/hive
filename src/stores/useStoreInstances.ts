import { Link } from "@Universe/types";
import { useStore } from "zustand";
import { getStoreBundle } from "./createStoreFactory";
import { DataStore } from "./useDataStore";
import { GraphStore } from "./useGraphStore";

export function useDataStoreInstance<T>(id: string, selector: (s: DataStore) => T) {
  return useStore(getStoreBundle(id).data, selector);
}

export function useGraphStoreInstance<T>(id: string, selector: (s: GraphStore) => T) {
  return useStore(getStoreBundle(id).graph, selector);
}

export function useSimulationStoreInstance<T>(id: string, selector: (s: any) => T) {
  return useStore(getStoreBundle(id).simulation, selector);
}

// Helper functions converted to use instance pattern
export const useFilteredNodesInstance = (id: string) =>
  useDataStoreInstance(id, (s) => {
    if (s.sidebarFilter === 'all') {
      return s.dataInitial?.nodes || []
    }

    return (s.dataInitial?.nodes || []).filter((i) => i.node_type?.toLowerCase() === s.sidebarFilter.toLowerCase())
  })

export const useNodeTypesInstance = (id: string) => useDataStoreInstance(id, (s) => s.nodeTypes)

export const useNormalizedNodeInstance = (id: string, refId: string) => {
  const nodesNormalized = useDataStoreInstance(id, (s) => s.nodesNormalized)

  if (refId) {
    return nodesNormalized.get(refId)
  }

  return null
}

export const useLinksBetweenNodesInstance = (id: string, nodeA: string, nodeB: string) => {
  const { linksNormalized, nodeLinksNormalized } = getStoreBundle(id).data.getState()

  if (!nodeA || !nodeB) {
    return []
  }

  const pairKey = [nodeA, nodeB].sort().join('--')
  const refIds = nodeLinksNormalized[pairKey] || []

  return refIds.map((refId) => linksNormalized.get(refId)).filter((link): link is Link => !!link)
}

// Non-hook version for use in other functions/memos
export const getLinksBetweenNodesInstance = (id: string, nodeA: string, nodeB: string) => {
  const { linksNormalized, nodeLinksNormalized } = getStoreBundle(id).data.getState()

  if (!nodeA || !nodeB) {
    return []
  }

  const pairKey = [nodeA, nodeB].sort().join('--')
  const refIds = nodeLinksNormalized[pairKey] || []

  return refIds.map((refId) => linksNormalized.get(refId)).filter((link): link is Link => !!link)
}

export const useSelectedNodeInstance = (id: string) => useGraphStoreInstance(id, (s) => s.selectedNode)
export const useHoveredNodeInstance = (id: string) => useGraphStoreInstance(id, (s) => s.hoveredNode)

export const useSelectedNodeRelativeIdsInstance = (id: string) => {
  const selectedNode = useGraphStoreInstance(id, (s) => s.selectedNode)

  if (!selectedNode) {
    return []
  }

  const { dataInitial } = getStoreBundle(id).data.getState()

  const links = dataInitial?.links || []

  const relativeIds = links.reduce<string[]>((acc, curr) => {
    if (curr.source === selectedNode?.ref_id) {
      acc.push(curr.target)
    }

    if (curr.target === selectedNode?.ref_id) {
      acc.push(curr.source)
    }

    return acc
  }, [])

  return relativeIds
}