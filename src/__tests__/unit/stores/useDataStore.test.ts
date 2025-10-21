import { describe, test, expect, beforeEach } from 'vitest'
import { useDataStore } from '@/stores/useDataStore'
import type { Node, Link, FetchDataResponse } from '@/app/w/[slug]/graph/Universe/types'

// ============================================================================
// Mock Data Factories
// ============================================================================

interface CreateMockNodeOptions {
  ref_id?: string
  node_type?: string
  name?: string
  label?: string
  x?: number
  y?: number
  z?: number
  edge_count?: number
  [key: string]: unknown
}

function createMockNode(overrides: CreateMockNodeOptions = {}): Node {
  const defaults: Node = {
    ref_id: `node-${Math.random().toString(36).substr(2, 9)}`,
    node_type: 'test',
    name: 'Test Node',
    label: 'Test Node',
    x: 0,
    y: 0,
    z: 0,
    edge_count: 0,
  }
  return { ...defaults, ...overrides }
}

interface CreateMockLinkOptions {
  ref_id?: string
  source?: string
  target?: string
  edge_type?: string
  [key: string]: unknown
}

function createMockLink(overrides: CreateMockLinkOptions = {}): Link {
  const defaults: Link = {
    ref_id: `link-${Math.random().toString(36).substr(2, 9)}`,
    source: 'node-1',
    target: 'node-2',
    edge_type: 'relation',
  }
  return { ...defaults, ...overrides }
}

function createMockFetchDataResponse(
  nodeCount: number,
  edgeCount: number,
  nodeOverrides: Partial<Node> = {},
  edgeOverrides: Partial<Link> = {}
): FetchDataResponse {
  // Generate unique prefix if ref_id is provided in nodeOverrides
  const refIdPrefix = (nodeOverrides as any).ref_id || `node-`
  const edgePrefix = (edgeOverrides as any).ref_id || `edge-`
  
  // Remove ref_id from overrides since we handle it separately
  const { ref_id: _nodeRefId, ...cleanNodeOverrides } = nodeOverrides as any
  const { ref_id: _edgeRefId, ...cleanEdgeOverrides } = edgeOverrides as any

  const nodes = Array.from({ length: nodeCount }, (_, i) =>
    createMockNode({ ref_id: `${refIdPrefix}${i}`, name: `Node ${i}`, ...cleanNodeOverrides })
  )

  const edges = Array.from({ length: edgeCount }, (_, i) => {
    const sourceIdx = i % nodeCount
    const targetIdx = (i + 1) % nodeCount
    return createMockLink({
      ref_id: `${edgePrefix}${i}`,
      source: `${refIdPrefix}${sourceIdx}`,
      target: `${refIdPrefix}${targetIdx}`,
      ...cleanEdgeOverrides,
    })
  })

  return { nodes, edges }
}

// ============================================================================
// Helper Utilities
// ============================================================================

function inspectStoreState() {
  const state = useDataStore.getState()
  return {
    nodeCount: state.dataInitial?.nodes.length || 0,
    edgeCount: state.dataInitial?.links.length || 0,
    newNodeCount: state.dataNew?.nodes.length || 0,
    newEdgeCount: state.dataNew?.links.length || 0,
    normalizedNodeCount: state.nodesNormalized.size,
    normalizedLinkCount: state.linksNormalized.size,
    nodeLinkPairCount: Object.keys(state.nodeLinksNormalized).length,
    nodeTypes: state.nodeTypes,
    linkTypes: state.linkTypes,
    sidebarFilters: state.sidebarFilters,
    sidebarFilterCounts: state.sidebarFilterCounts,
  }
}

function resetStoreState() {
  const store = useDataStore.getState()
  store.resetData()
  // Manually reset nodeLinksNormalized since resetData() doesn't clear it
  useDataStore.setState({ nodeLinksNormalized: {} })
}

// ============================================================================
// Test Suites
// ============================================================================

describe('useDataStore - addNewNode', () => {
  beforeEach(() => {
    resetStoreState()
  })

  // ==========================================================================
  // Basic Functionality Tests
  // ==========================================================================

  describe('Basic Functionality', () => {
    test('should add new nodes to empty store', () => {
      const data = createMockFetchDataResponse(3, 0)
      
      useDataStore.getState().addNewNode(data)
      
      const state = inspectStoreState()
      expect(state.nodeCount).toBe(3)
      expect(state.newNodeCount).toBe(3)
      expect(state.normalizedNodeCount).toBe(3)
    })

    test('should add new edges with valid source and target', () => {
      const data = createMockFetchDataResponse(3, 2)
      
      useDataStore.getState().addNewNode(data)
      
      const state = inspectStoreState()
      expect(state.edgeCount).toBe(2)
      expect(state.newEdgeCount).toBe(2)
      expect(state.normalizedLinkCount).toBe(2)
    })

    test('should handle empty nodes array gracefully', () => {
      const data: FetchDataResponse = { nodes: [], edges: [] }
      
      useDataStore.getState().addNewNode(data)
      
      const state = inspectStoreState()
      expect(state.nodeCount).toBe(0)
      expect(state.edgeCount).toBe(0)
    })

    test('should handle null/undefined data gracefully', () => {
      const data = null as unknown as FetchDataResponse
      
      useDataStore.getState().addNewNode(data)
      
      const state = inspectStoreState()
      expect(state.nodeCount).toBe(0)
    })

    test('should handle data with nodes but no edges', () => {
      const data = createMockFetchDataResponse(5, 0)
      
      useDataStore.getState().addNewNode(data)
      
      const state = inspectStoreState()
      expect(state.nodeCount).toBe(5)
      expect(state.edgeCount).toBe(0)
    })
  })

  // ==========================================================================
  // Deduplication Tests
  // ==========================================================================

  describe('Deduplication', () => {
    test('should not add duplicate nodes with same ref_id', () => {
      const node1 = createMockNode({ ref_id: 'node-duplicate', name: 'First' })
      const node2 = createMockNode({ ref_id: 'node-duplicate', name: 'Second' })
      
      useDataStore.getState().addNewNode({ nodes: [node1], edges: [] })
      useDataStore.getState().addNewNode({ nodes: [node2], edges: [] })
      
      const state = inspectStoreState()
      expect(state.nodeCount).toBe(1)
      expect(state.normalizedNodeCount).toBe(1)
      
      // Verify the first node is preserved (not overwritten)
      const storeState = useDataStore.getState()
      const savedNode = storeState.nodesNormalized.get('node-duplicate')
      expect(savedNode?.name).toBe('First')
    })

    test('should not add duplicate edges with same ref_id', () => {
      const nodes = [
        createMockNode({ ref_id: 'node-1' }),
        createMockNode({ ref_id: 'node-2' }),
      ]
      const edge1 = createMockLink({ ref_id: 'edge-duplicate', source: 'node-1', target: 'node-2' })
      const edge2 = createMockLink({ ref_id: 'edge-duplicate', source: 'node-1', target: 'node-2' })
      
      useDataStore.getState().addNewNode({ nodes, edges: [edge1] })
      useDataStore.getState().addNewNode({ nodes: [], edges: [edge2] })
      
      const state = inspectStoreState()
      expect(state.edgeCount).toBe(1)
      expect(state.normalizedLinkCount).toBe(1)
    })

    test('should handle partial duplicates (some new, some existing)', () => {
      const batch1 = [
        createMockNode({ ref_id: 'node-1' }),
        createMockNode({ ref_id: 'node-2' }),
      ]
      const batch2 = [
        createMockNode({ ref_id: 'node-2' }), // duplicate
        createMockNode({ ref_id: 'node-3' }), // new
      ]
      
      useDataStore.getState().addNewNode({ nodes: batch1, edges: [] })
      useDataStore.getState().addNewNode({ nodes: batch2, edges: [] })
      
      const state = inspectStoreState()
      expect(state.nodeCount).toBe(3) // Only 3 unique nodes
      expect(state.newNodeCount).toBe(1) // Only node-3 is new
    })
  })

  // ==========================================================================
  // Edge Validation Tests
  // ==========================================================================

  describe('Edge Validation', () => {
    test('should reject edges with missing source node', () => {
      const nodes = [createMockNode({ ref_id: 'node-1' })]
      const edges = [createMockLink({ source: 'missing-node', target: 'node-1' })]
      
      useDataStore.getState().addNewNode({ nodes, edges })
      
      const state = inspectStoreState()
      expect(state.nodeCount).toBe(1)
      expect(state.edgeCount).toBe(0) // Edge should be rejected
    })

    test('should reject edges with missing target node', () => {
      const nodes = [createMockNode({ ref_id: 'node-1' })]
      const edges = [createMockLink({ source: 'node-1', target: 'missing-node' })]
      
      useDataStore.getState().addNewNode({ nodes, edges })
      
      const state = inspectStoreState()
      expect(state.nodeCount).toBe(1)
      expect(state.edgeCount).toBe(0) // Edge should be rejected
    })

    test('should reject edges with both nodes missing', () => {
      const edges = [createMockLink({ source: 'missing-1', target: 'missing-2' })]
      
      useDataStore.getState().addNewNode({ nodes: [], edges })
      
      const state = inspectStoreState()
      expect(state.edgeCount).toBe(0)
    })

    test('should accept edges when nodes are added in same batch', () => {
      const data = createMockFetchDataResponse(3, 2)
      
      useDataStore.getState().addNewNode(data)
      
      const state = inspectStoreState()
      expect(state.edgeCount).toBe(2) // Both edges should be accepted
    })

    test('should accept edges when nodes exist from previous batch', () => {
      const nodes = [
        createMockNode({ ref_id: 'node-1' }),
        createMockNode({ ref_id: 'node-2' }),
      ]
      const edges = [createMockLink({ source: 'node-1', target: 'node-2' })]
      
      useDataStore.getState().addNewNode({ nodes, edges: [] })
      useDataStore.getState().addNewNode({ nodes: [], edges })
      
      const state = inspectStoreState()
      expect(state.edgeCount).toBe(1)
    })
  })

  // ==========================================================================
  // Relationship Tracking Tests
  // ==========================================================================

  describe('Relationship Tracking', () => {
    test('should update source node targets array', () => {
      const nodes = [
        createMockNode({ ref_id: 'node-1' }),
        createMockNode({ ref_id: 'node-2' }),
      ]
      const edges = [createMockLink({ source: 'node-1', target: 'node-2' })]
      
      useDataStore.getState().addNewNode({ nodes, edges })
      
      const storeState = useDataStore.getState()
      const sourceNode = storeState.nodesNormalized.get('node-1')
      expect(sourceNode?.targets).toContain('node-2')
    })

    test('should update target node sources array', () => {
      const nodes = [
        createMockNode({ ref_id: 'node-1' }),
        createMockNode({ ref_id: 'node-2' }),
      ]
      const edges = [createMockLink({ source: 'node-1', target: 'node-2' })]
      
      useDataStore.getState().addNewNode({ nodes, edges })
      
      const storeState = useDataStore.getState()
      const targetNode = storeState.nodesNormalized.get('node-2')
      expect(targetNode?.sources).toContain('node-1')
    })

    test('should populate nodeLinksNormalized bidirectionally', () => {
      const nodes = [
        createMockNode({ ref_id: 'node-1' }),
        createMockNode({ ref_id: 'node-2' }),
      ]
      const edges = [createMockLink({ ref_id: 'edge-1', source: 'node-1', target: 'node-2' })]
      
      useDataStore.getState().addNewNode({ nodes, edges })
      
      const storeState = useDataStore.getState()
      const pairKey = ['node-1', 'node-2'].sort().join('--')
      expect(storeState.nodeLinksNormalized[pairKey]).toContain('edge-1')
    })

    test('should track edge types on both nodes', () => {
      const nodes = [
        createMockNode({ ref_id: 'node-1' }),
        createMockNode({ ref_id: 'node-2' }),
      ]
      const edges = [createMockLink({ source: 'node-1', target: 'node-2', edge_type: 'custom-relation' })]
      
      useDataStore.getState().addNewNode({ nodes, edges })
      
      const storeState = useDataStore.getState()
      const sourceNode = storeState.nodesNormalized.get('node-1')
      const targetNode = storeState.nodesNormalized.get('node-2')
      
      expect(sourceNode?.edgeTypes).toContain('custom-relation')
      expect(targetNode?.edgeTypes).toContain('custom-relation')
    })

    test('should handle multiple edges between same nodes', () => {
      const nodes = [
        createMockNode({ ref_id: 'node-1' }),
        createMockNode({ ref_id: 'node-2' }),
      ]
      const edges = [
        createMockLink({ ref_id: 'edge-1', source: 'node-1', target: 'node-2', edge_type: 'type-a' }),
        createMockLink({ ref_id: 'edge-2', source: 'node-1', target: 'node-2', edge_type: 'type-b' }),
      ]
      
      useDataStore.getState().addNewNode({ nodes, edges })
      
      const storeState = useDataStore.getState()
      const pairKey = ['node-1', 'node-2'].sort().join('--')
      expect(storeState.nodeLinksNormalized[pairKey]).toHaveLength(2)
      expect(storeState.nodeLinksNormalized[pairKey]).toContain('edge-1')
      expect(storeState.nodeLinksNormalized[pairKey]).toContain('edge-2')
    })
  })

  // ==========================================================================
  // Normalization Tests
  // ==========================================================================

  describe('Normalization', () => {
    test('should populate nodesNormalized Map correctly', () => {
      const data = createMockFetchDataResponse(5, 0)
      
      useDataStore.getState().addNewNode(data)
      
      const storeState = useDataStore.getState()
      expect(storeState.nodesNormalized.size).toBe(5)
      
      data.nodes.forEach((node) => {
        expect(storeState.nodesNormalized.has(node.ref_id)).toBe(true)
        const storedNode = storeState.nodesNormalized.get(node.ref_id)
        expect(storedNode?.ref_id).toBe(node.ref_id)
        expect(storedNode?.name).toBe(node.name)
      })
    })

    test('should populate linksNormalized Map correctly', () => {
      const data = createMockFetchDataResponse(5, 3)
      
      useDataStore.getState().addNewNode(data)
      
      const storeState = useDataStore.getState()
      expect(storeState.linksNormalized.size).toBe(3)
      
      data.edges.forEach((edge) => {
        expect(storeState.linksNormalized.has(edge.ref_id)).toBe(true)
        const storedLink = storeState.linksNormalized.get(edge.ref_id)
        expect(storedLink?.source).toBe(edge.source)
        expect(storedLink?.target).toBe(edge.target)
      })
    })

    test('should maintain O(1) lookup performance for nodes', () => {
      const data = createMockFetchDataResponse(100, 0)
      
      useDataStore.getState().addNewNode(data)
      
      const storeState = useDataStore.getState()
      const start = performance.now()
      const node = storeState.nodesNormalized.get('node-50')
      const duration = performance.now() - start
      
      expect(node).toBeDefined()
      expect(duration).toBeLessThan(1) // Should be nearly instant (< 1ms)
    })

    test('should initialize sources and targets as empty arrays', () => {
      const nodes = [createMockNode({ ref_id: 'node-1' })]
      
      useDataStore.getState().addNewNode({ nodes, edges: [] })
      
      const storeState = useDataStore.getState()
      const node = storeState.nodesNormalized.get('node-1')
      expect(node?.sources).toEqual([])
      expect(node?.targets).toEqual([])
    })
  })

  // ==========================================================================
  // Metadata Calculation Tests
  // ==========================================================================

  describe('Metadata Calculation', () => {
    test('should extract unique nodeTypes', () => {
      const nodes = [
        createMockNode({ node_type: 'function' }),
        createMockNode({ node_type: 'class' }),
        createMockNode({ node_type: 'function' }), // duplicate type
      ]
      
      useDataStore.getState().addNewNode({ nodes, edges: [] })
      
      const state = inspectStoreState()
      expect(state.nodeTypes).toHaveLength(2)
      expect(state.nodeTypes).toContain('function')
      expect(state.nodeTypes).toContain('class')
    })

    test('should extract unique linkTypes', () => {
      const data = createMockFetchDataResponse(3, 0)
      const edges = [
        createMockLink({ source: 'node-0', target: 'node-1', edge_type: 'calls' }),
        createMockLink({ source: 'node-1', target: 'node-2', edge_type: 'imports' }),
        createMockLink({ source: 'node-0', target: 'node-2', edge_type: 'calls' }), // duplicate type
      ]
      
      useDataStore.getState().addNewNode({ nodes: data.nodes, edges })
      
      const state = inspectStoreState()
      expect(state.linkTypes).toHaveLength(2)
      expect(state.linkTypes).toContain('calls')
      expect(state.linkTypes).toContain('imports')
    })

    test('should create sidebar filters including "all"', () => {
      const nodes = [
        createMockNode({ node_type: 'function' }),
        createMockNode({ node_type: 'class' }),
      ]
      
      useDataStore.getState().addNewNode({ nodes, edges: [] })
      
      const state = inspectStoreState()
      expect(state.sidebarFilters).toContain('all')
      expect(state.sidebarFilters).toContain('function')
      expect(state.sidebarFilters).toContain('class')
    })

    test('should calculate filter counts correctly', () => {
      const nodes = [
        createMockNode({ node_type: 'function' }),
        createMockNode({ node_type: 'function' }),
        createMockNode({ node_type: 'class' }),
      ]
      
      useDataStore.getState().addNewNode({ nodes, edges: [] })
      
      const state = inspectStoreState()
      const allCount = state.sidebarFilterCounts.find((f) => f.name === 'all')
      const functionCount = state.sidebarFilterCounts.find((f) => f.name === 'function')
      const classCount = state.sidebarFilterCounts.find((f) => f.name === 'class')
      
      expect(allCount?.count).toBe(3)
      expect(functionCount?.count).toBe(2)
      expect(classCount?.count).toBe(1)
    })
  })

  // ==========================================================================
  // Incremental Update Tests
  // ==========================================================================

  describe('Incremental Updates', () => {
    test('should separate dataNew from dataInitial', () => {
      const batch1 = createMockFetchDataResponse(3, 2)
      const batch2Nodes = [
        createMockNode({ ref_id: 'new-node-0' }),
        createMockNode({ ref_id: 'new-node-1' }),
      ]
      
      useDataStore.getState().addNewNode(batch1)
      useDataStore.getState().addNewNode({ nodes: batch2Nodes, edges: [] })
      
      const state = inspectStoreState()
      expect(state.nodeCount).toBe(5) // dataInitial: 3 + 2
      expect(state.newNodeCount).toBe(2) // dataNew: only batch2
    })

    test('should not update store if no new data', () => {
      const nodes = [createMockNode({ ref_id: 'node-1' })]
      
      useDataStore.getState().addNewNode({ nodes, edges: [] })
      const firstState = useDataStore.getState()
      
      // Try adding same node again (should return early, no state change)
      useDataStore.getState().addNewNode({ nodes, edges: [] })
      const secondState = useDataStore.getState()
      
      // Store doesn't update, so dataNew should remain unchanged from first add
      expect(secondState.dataNew).toEqual(firstState.dataNew)
      expect(firstState.dataInitial).toEqual(secondState.dataInitial)
    })

    test('should accumulate nodes across multiple calls', () => {
      const batch1 = [createMockNode({ ref_id: 'node-1' })]
      const batch2 = [createMockNode({ ref_id: 'node-2' })]
      const batch3 = [createMockNode({ ref_id: 'node-3' })]
      
      useDataStore.getState().addNewNode({ nodes: batch1, edges: [] })
      useDataStore.getState().addNewNode({ nodes: batch2, edges: [] })
      useDataStore.getState().addNewNode({ nodes: batch3, edges: [] })
      
      const state = inspectStoreState()
      expect(state.nodeCount).toBe(3)
      expect(state.normalizedNodeCount).toBe(3)
    })

    test('should preserve existing data when adding new data', () => {
      const batch1 = [createMockNode({ ref_id: 'node-1', name: 'First' })]
      const batch2 = [createMockNode({ ref_id: 'node-2', name: 'Second' })]
      
      useDataStore.getState().addNewNode({ nodes: batch1, edges: [] })
      useDataStore.getState().addNewNode({ nodes: batch2, edges: [] })
      
      const storeState = useDataStore.getState()
      const node1 = storeState.nodesNormalized.get('node-1')
      const node2 = storeState.nodesNormalized.get('node-2')
      
      expect(node1?.name).toBe('First')
      expect(node2?.name).toBe('Second')
    })
  })

  // ==========================================================================
  // Performance Tests
  // ==========================================================================

  describe('Performance', () => {
    test('should handle 1000 nodes efficiently', () => {
      const data = createMockFetchDataResponse(1000, 0)
      
      const start = performance.now()
      useDataStore.getState().addNewNode(data)
      const duration = performance.now() - start
      
      expect(duration).toBeLessThan(1000) // Should complete in < 1 second
      
      const state = inspectStoreState()
      expect(state.nodeCount).toBe(1000)
      expect(state.normalizedNodeCount).toBe(1000)
    })

    test('should handle 1000 edges efficiently', () => {
      const data = createMockFetchDataResponse(100, 1000)
      
      const start = performance.now()
      useDataStore.getState().addNewNode(data)
      const duration = performance.now() - start
      
      expect(duration).toBeLessThan(1000) // Should complete in < 1 second
      
      const state = inspectStoreState()
      expect(state.nodeCount).toBe(100)
      expect(state.edgeCount).toBe(1000)
    })

    test('should handle large dataset with mixed nodes and edges', () => {
      const data = createMockFetchDataResponse(500, 800)
      
      const start = performance.now()
      useDataStore.getState().addNewNode(data)
      const duration = performance.now() - start
      
      expect(duration).toBeLessThan(2000) // Should complete in < 2 seconds
      
      const state = inspectStoreState()
      expect(state.nodeCount).toBe(500)
      expect(state.edgeCount).toBe(800)
      expect(state.normalizedNodeCount).toBe(500)
      expect(state.normalizedLinkCount).toBe(800)
    })

    test('should maintain performance with incremental additions', () => {
      const iterations = 10
      const nodesPerIteration = 100
      
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        const data = createMockFetchDataResponse(
          nodesPerIteration,
          nodesPerIteration - 1,
          { ref_id: `batch-${i}-node-` }
        )
        useDataStore.getState().addNewNode(data)
      }
      const duration = performance.now() - start
      
      expect(duration).toBeLessThan(3000) // 10 iterations in < 3 seconds
      
      const state = inspectStoreState()
      expect(state.nodeCount).toBe(iterations * nodesPerIteration)
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    test('should handle nodes with missing optional properties', () => {
      const node = createMockNode({ ref_id: 'minimal-node' })
      delete (node as any).label
      delete (node as any).edge_count
      
      useDataStore.getState().addNewNode({ nodes: [node], edges: [] })
      
      const storeState = useDataStore.getState()
      const savedNode = storeState.nodesNormalized.get('minimal-node')
      expect(savedNode).toBeDefined()
      expect(savedNode?.ref_id).toBe('minimal-node')
    })

    test('should handle self-referential edges', () => {
      const node = createMockNode({ ref_id: 'node-1' })
      const edge = createMockLink({ source: 'node-1', target: 'node-1' })
      
      useDataStore.getState().addNewNode({ nodes: [node], edges: [edge] })
      
      const state = inspectStoreState()
      expect(state.edgeCount).toBe(1)
      
      const storeState = useDataStore.getState()
      const savedNode = storeState.nodesNormalized.get('node-1')
      expect(savedNode?.sources).toContain('node-1')
      expect(savedNode?.targets).toContain('node-1')
    })

    test('should handle edges added before nodes in separate batches', () => {
      const edges = [createMockLink({ source: 'node-1', target: 'node-2' })]
      const nodes = [
        createMockNode({ ref_id: 'node-1' }),
        createMockNode({ ref_id: 'node-2' }),
      ]
      
      // Try adding edge first (should be rejected)
      useDataStore.getState().addNewNode({ nodes: [], edges })
      const state1 = inspectStoreState()
      expect(state1.edgeCount).toBe(0)
      
      // Add nodes, then edge should be accepted on retry
      useDataStore.getState().addNewNode({ nodes, edges })
      const state2 = inspectStoreState()
      expect(state2.edgeCount).toBe(1)
    })

    test('should handle very long node names', () => {
      const longName = 'A'.repeat(1000)
      const node = createMockNode({ ref_id: 'long-name-node', name: longName })
      
      useDataStore.getState().addNewNode({ nodes: [node], edges: [] })
      
      const storeState = useDataStore.getState()
      const savedNode = storeState.nodesNormalized.get('long-name-node')
      expect(savedNode?.name).toBe(longName)
      expect(savedNode?.name.length).toBe(1000)
    })

    test('should handle special characters in ref_id', () => {
      const specialChars = ['node-with-dash', 'node_with_underscore', 'node.with.dot', 'node:with:colon']
      const nodes = specialChars.map((ref_id) => createMockNode({ ref_id }))
      
      useDataStore.getState().addNewNode({ nodes, edges: [] })
      
      const storeState = useDataStore.getState()
      specialChars.forEach((ref_id) => {
        expect(storeState.nodesNormalized.has(ref_id)).toBe(true)
      })
    })

    test('should handle empty edge_type', () => {
      const data = createMockFetchDataResponse(2, 0)
      const edges = [createMockLink({ source: 'node-0', target: 'node-1', edge_type: '' })]
      
      useDataStore.getState().addNewNode({ nodes: data.nodes, edges })
      
      const state = inspectStoreState()
      expect(state.edgeCount).toBe(1)
      expect(state.linkTypes).toContain('')
    })
  })
})