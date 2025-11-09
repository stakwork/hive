import { useStoreId } from './StoreProvider'
import {
  useDataStoreInstance,
  useGraphStoreInstance,
  useSimulationStoreInstance,
  useFilteredNodesInstance,
  useNodeTypesInstance,
  useNormalizedNodeInstance,
  getLinksBetweenNodesInstance,
  useSelectedNodeInstance,
  useHoveredNodeInstance,
  useSelectedNodeRelativeIdsInstance
} from './useStoreInstances'
import { DataStore } from './useDataStore'
import { GraphStore } from './useGraphStore'
import { GraphStyle, graphStyles, Neighbourhood } from './createGraphStore'

// Convenience hooks that automatically use the store ID from context
export function useDataStore<T>(selector: (s: DataStore) => T) {
  const storeId = useStoreId()
  return useDataStoreInstance(storeId, selector)
}

export function useGraphStore<T>(selector: (s: GraphStore) => T) {
  const storeId = useStoreId()
  return useGraphStoreInstance(storeId, selector)
}

export function useSimulationStore<T>(selector: (s: any) => T) {
  const storeId = useStoreId()
  return useSimulationStoreInstance(storeId, selector)
}

// Helper hooks
export function useFilteredNodes() {
  const storeId = useStoreId()
  return useFilteredNodesInstance(storeId)
}

export function useNodeTypes() {
  const storeId = useStoreId()
  return useNodeTypesInstance(storeId)
}

export function useNormalizedNode(refId: string) {
  const storeId = useStoreId()
  return useNormalizedNodeInstance(storeId, refId)
}

export function getLinksBetweenNodes(nodeA: string, nodeB: string) {
  const storeId = useStoreId()
  return getLinksBetweenNodesInstance(storeId, nodeA, nodeB)
}

export function useSelectedNode() {
  const storeId = useStoreId()
  return useSelectedNodeInstance(storeId)
}

export function useHoveredNode() {
  const storeId = useStoreId()
  return useHoveredNodeInstance(storeId)
}

export function useSelectedNodeRelativeIds() {
  const storeId = useStoreId()
  return useSelectedNodeRelativeIdsInstance(storeId)
}

// Re-export types and constants
export type { GraphStyle, Neighbourhood }
export { graphStyles }

// Debug utilities
export { getStoreRegistryInfo, logStoreInstances } from './createStoreFactory'