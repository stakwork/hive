import { describe, test, expect, beforeEach } from 'vitest'
import { useDataStore } from '@/stores/useDataStore'

// Type definitions inferred from codebase usage
interface Node {
  ref_id: string
  node_type: string
  x: number
  y: number
  z: number
  edge_count: number
  name?: string
  properties?: Record<string, unknown>
  sources?: string[]
  targets?: string[]
  edgeTypes?: string[]
  date_added_to_graph?: number
  children?: string[]
}

interface Link {
  ref_id: string
  source: string
  target: string
  edge_type: string
}

interface FetchDataResponse {
  nodes: Node[]
  edges: Link[]
}

// Mock data factory helpers
const createMockNode = (overrides: Partial<Node> = {}): Node => ({
  ref_id: `node-${Math.random().toString(36).substr(2, 9)}`,
  node_type: 'Topic',
  x: 0,
  y: 0,
  z: 0,
  edge_count: 0,
  name: 'Test Node',
  properties: {},
  sources: [],
  targets: [],
  edgeTypes: [],
  ...overrides,
})

const createMockLink = (overrides: Partial<Link> = {}): Link => ({
  ref_id: `link-${Math.random().toString(36).substr(2, 9)}`,
  source: 'node-1',
  target: 'node-2',
  edge_type: 'RELATES_TO',
  ...overrides,
})

const createMockFetchData = (
  nodeCount: number,
  edgeCount: number,
  options: { connectNodes?: boolean } = {}
): FetchDataResponse => {
  const nodes: Node[] = []
  const edges: Link[] = []

  // Create nodes
  for (let i = 0; i < nodeCount; i++) {
    nodes.push(
      createMockNode({
        ref_id: `node-${i}`,
        name: `Node ${i}`,
        node_type: i % 3 === 0 ? 'Topic' : i % 3 === 1 ? 'Episode' : 'Person',
      })
    )
  }

  // Create edges
  if (options.connectNodes && nodeCount > 1) {
    for (let i = 0; i < Math.min(edgeCount, nodeCount - 1); i++) {
      edges.push(
        createMockLink({
          ref_id: `edge-${i}`,
          source: `node-${i}`,
          target: `node-${i + 1}`,
          edge_type: i % 2 === 0 ? 'RELATES_TO' : 'MENTIONS',
        })
      )
    }
  }

  return { nodes, edges }
}

describe('useDataStore - addNewNode', () => {
  beforeEach(() => {
    // Reset store state before each test
    const store = useDataStore.getState()
    store.resetData()
  })

  describe('Basic Functionality', () => {
    test('should add new nodes to empty store', () => {
      const store = useDataStore.getState()
      const mockData = createMockFetchData(3, 0)

      store.addNewNode(mockData)

      const state = useDataStore.getState()
      expect(state.dataInitial.nodes).toHaveLength(3)
      expect(state.dataNew.nodes).toHaveLength(3)
      expect(state.nodesNormalized.size).toBe(3)
    })

    test('should add new edges with valid source and target nodes', () => {
      const store = useDataStore.getState()
      const mockData = createMockFetchData(3, 2, { connectNodes: true })

      store.addNewNode(mockData)

      const state = useDataStore.getState()
      expect(state.dataInitial.links).toHaveLength(2)
      expect(state.dataNew.links).toHaveLength(2)
      expect(state.linksNormalized.size).toBe(2)
    })

    test('should initialize nodes with empty sources and targets arrays', () => {
      const store = useDataStore.getState()
      const node = createMockNode({ ref_id: 'node-1' })

      store.addNewNode({ nodes: [node], edges: [] })

      const state = useDataStore.getState()
      const addedNode = state.nodesNormalized.get('node-1')
      expect(addedNode?.sources).toEqual([])
      expect(addedNode?.targets).toEqual([])
      expect(addedNode?.edgeTypes).toEqual([])
    })

    test('should handle empty nodes array', () => {
      const store = useDataStore.getState()
      store.addNewNode({ nodes: [], edges: [] })

      const state = useDataStore.getState()
      expect(state.dataInitial.nodes).toHaveLength(0)
      expect(state.nodesNormalized.size).toBe(0)
    })

    test('should handle null or undefined data.nodes', () => {
      const store = useDataStore.getState()
      store.addNewNode({ nodes: null as unknown as Node[], edges: [] })

      const state = useDataStore.getState()
      expect(state.dataInitial.nodes).toHaveLength(0)
    })
  })

  describe('Deduplication', () => {
    test('should not add duplicate nodes with same ref_id', () => {
      const store = useDataStore.getState()
      const node = createMockNode({ ref_id: 'node-duplicate', name: 'Original' })
      const duplicateNode = createMockNode({ ref_id: 'node-duplicate', name: 'Duplicate' })

      // Add first node
      store.addNewNode({ nodes: [node], edges: [] })
      const stateAfterFirst = useDataStore.getState()
      expect(stateAfterFirst.nodesNormalized.size).toBe(1)
      expect(stateAfterFirst.nodesNormalized.get('node-duplicate')?.name).toBe('Original')

      // Try to add duplicate
      store.addNewNode({ nodes: [duplicateNode], edges: [] })
      const stateAfterSecond = useDataStore.getState()
      expect(stateAfterSecond.nodesNormalized.size).toBe(1)
      expect(stateAfterSecond.nodesNormalized.get('node-duplicate')?.name).toBe('Original')
    })

    test('should not add duplicate edges with same ref_id', () => {
      const store = useDataStore.getState()
      const nodes = [
        createMockNode({ ref_id: 'node-1' }),
        createMockNode({ ref_id: 'node-2' }),
      ]
      const edge = createMockLink({ ref_id: 'edge-duplicate', source: 'node-1', target: 'node-2' })
      const duplicateEdge = createMockLink({
        ref_id: 'edge-duplicate',
        source: 'node-1',
        target: 'node-2',
      })

      // Add nodes and first edge
      store.addNewNode({ nodes, edges: [edge] })
      const stateAfterFirst = useDataStore.getState()
      expect(stateAfterFirst.linksNormalized.size).toBe(1)

      // Try to add duplicate edge
      store.addNewNode({ nodes: [], edges: [duplicateEdge] })
      const stateAfterSecond = useDataStore.getState()
      expect(stateAfterSecond.linksNormalized.size).toBe(1)
    })

    test('should handle partial duplicates (some new, some existing)', () => {
      const store = useDataStore.getState()
      const firstBatch = createMockFetchData(3, 0)
      const secondBatch = {
        nodes: [
          firstBatch.nodes[0], // duplicate
          firstBatch.nodes[1], // duplicate
          createMockNode({ ref_id: 'node-new', name: 'New Node' }), // new
        ],
        edges: [],
      }

      store.addNewNode(firstBatch)
      const stateAfterFirst = useDataStore.getState()
      expect(stateAfterFirst.nodesNormalized.size).toBe(3)

      store.addNewNode(secondBatch)
      const stateAfterSecond = useDataStore.getState()
      expect(stateAfterSecond.nodesNormalized.size).toBe(4) // 3 original + 1 new
      expect(stateAfterSecond.nodesNormalized.has('node-new')).toBe(true)
    })
  })

  describe('Edge Validation', () => {
    test('should reject edges with missing source node', () => {
      const store = useDataStore.getState()
      const node = createMockNode({ ref_id: 'node-target' })
      const edge = createMockLink({
        ref_id: 'edge-invalid',
        source: 'node-missing',
        target: 'node-target',
      })

      store.addNewNode({ nodes: [node], edges: [edge] })

      const state = useDataStore.getState()
      expect(state.nodesNormalized.size).toBe(1)
      expect(state.linksNormalized.size).toBe(0) // Edge rejected
    })

    test('should reject edges with missing target node', () => {
      const store = useDataStore.getState()
      const node = createMockNode({ ref_id: 'node-source' })
      const edge = createMockLink({
        ref_id: 'edge-invalid',
        source: 'node-source',
        target: 'node-missing',
      })

      store.addNewNode({ nodes: [node], edges: [edge] })

      const state = useDataStore.getState()
      expect(state.nodesNormalized.size).toBe(1)
      expect(state.linksNormalized.size).toBe(0) // Edge rejected
    })

    test('should reject edges with both source and target nodes missing', () => {
      const store = useDataStore.getState()
      const edge = createMockLink({
        ref_id: 'edge-invalid',
        source: 'node-missing-1',
        target: 'node-missing-2',
      })

      store.addNewNode({ nodes: [], edges: [edge] })

      const state = useDataStore.getState()
      expect(state.linksNormalized.size).toBe(0) // Edge rejected
    })

    test('should accept edges when both source and target exist', () => {
      const store = useDataStore.getState()
      const nodes = [
        createMockNode({ ref_id: 'node-1' }),
        createMockNode({ ref_id: 'node-2' }),
      ]
      const edge = createMockLink({ ref_id: 'edge-valid', source: 'node-1', target: 'node-2' })

      store.addNewNode({ nodes, edges: [edge] })

      const state = useDataStore.getState()
      expect(state.linksNormalized.size).toBe(1)
      expect(state.linksNormalized.get('edge-valid')).toBeDefined()
    })
  })

  describe('Relationship Tracking', () => {
    test('should update source node targets array', () => {
      const store = useDataStore.getState()
      const nodes = [
        createMockNode({ ref_id: 'node-1' }),
        createMockNode({ ref_id: 'node-2' }),
      ]
      const edge = createMockLink({ ref_id: 'edge-1', source: 'node-1', target: 'node-2' })

      store.addNewNode({ nodes, edges: [edge] })

      const state = useDataStore.getState()
      const sourceNode = state.nodesNormalized.get('node-1')
      expect(sourceNode?.targets).toContain('node-2')
    })

    test('should update target node sources array', () => {
      const store = useDataStore.getState()
      const nodes = [
        createMockNode({ ref_id: 'node-1' }),
        createMockNode({ ref_id: 'node-2' }),
      ]
      const edge = createMockLink({ ref_id: 'edge-1', source: 'node-1', target: 'node-2' })

      store.addNewNode({ nodes, edges: [edge] })

      const state = useDataStore.getState()
      const targetNode = state.nodesNormalized.get('node-2')
      expect(targetNode?.sources).toContain('node-1')
    })

    test('should track multiple relationships for a single node', () => {
      const store = useDataStore.getState()
      const nodes = [
        createMockNode({ ref_id: 'node-center' }),
        createMockNode({ ref_id: 'node-1' }),
        createMockNode({ ref_id: 'node-2' }),
        createMockNode({ ref_id: 'node-3' }),
      ]
      const edges = [
        createMockLink({ ref_id: 'edge-1', source: 'node-center', target: 'node-1' }),
        createMockLink({ ref_id: 'edge-2', source: 'node-center', target: 'node-2' }),
        createMockLink({ ref_id: 'edge-3', source: 'node-3', target: 'node-center' }),
      ]

      store.addNewNode({ nodes, edges })

      const state = useDataStore.getState()
      const centerNode = state.nodesNormalized.get('node-center')
      expect(centerNode?.targets).toHaveLength(2)
      expect(centerNode?.targets).toContain('node-1')
      expect(centerNode?.targets).toContain('node-2')
      expect(centerNode?.sources).toHaveLength(1)
      expect(centerNode?.sources).toContain('node-3')
    })

    test('should track edge types on nodes', () => {
      const store = useDataStore.getState()
      const nodes = [
        createMockNode({ ref_id: 'node-1' }),
        createMockNode({ ref_id: 'node-2' }),
      ]
      const edge = createMockLink({
        ref_id: 'edge-1',
        source: 'node-1',
        target: 'node-2',
        edge_type: 'MENTIONS',
      })

      store.addNewNode({ nodes, edges: [edge] })

      const state = useDataStore.getState()
      const sourceNode = state.nodesNormalized.get('node-1')
      const targetNode = state.nodesNormalized.get('node-2')
      expect(sourceNode?.edgeTypes).toContain('MENTIONS')
      expect(targetNode?.edgeTypes).toContain('MENTIONS')
    })

    test('should not duplicate edge types on nodes', () => {
      const store = useDataStore.getState()
      const nodes = [
        createMockNode({ ref_id: 'node-1' }),
        createMockNode({ ref_id: 'node-2' }),
        createMockNode({ ref_id: 'node-3' }),
      ]
      const edges = [
        createMockLink({
          ref_id: 'edge-1',
          source: 'node-1',
          target: 'node-2',
          edge_type: 'RELATES_TO',
        }),
        createMockLink({
          ref_id: 'edge-2',
          source: 'node-1',
          target: 'node-3',
          edge_type: 'RELATES_TO',
        }),
      ]

      store.addNewNode({ nodes, edges })

      const state = useDataStore.getState()
      const node1 = state.nodesNormalized.get('node-1')
      expect(node1?.edgeTypes).toHaveLength(1)
      expect(node1?.edgeTypes).toContain('RELATES_TO')
    })
  })

  describe('Normalization - nodeLinksNormalized', () => {
    test('should populate nodeLinksNormalized with sorted pair keys', () => {
      const store = useDataStore.getState()
      const nodes = [
        createMockNode({ ref_id: 'node-a' }),
        createMockNode({ ref_id: 'node-b' }),
      ]
      const edge = createMockLink({ ref_id: 'edge-1', source: 'node-a', target: 'node-b' })

      store.addNewNode({ nodes, edges: [edge] })

      const state = useDataStore.getState()
      // Pair key should be sorted: 'node-a--node-b'
      expect(state.nodeLinksNormalized['node-a--node-b']).toBeDefined()
      expect(state.nodeLinksNormalized['node-a--node-b']).toContain('edge-1')
    })

    test('should handle reverse pair keys consistently', () => {
      const store = useDataStore.getState()
      const nodes = [
        createMockNode({ ref_id: 'node-z' }),
        createMockNode({ ref_id: 'node-a' }),
      ]
      const edge = createMockLink({ ref_id: 'edge-1', source: 'node-z', target: 'node-a' })

      store.addNewNode({ nodes, edges: [edge] })

      const state = useDataStore.getState()
      // Should be sorted: 'node-a--node-z' (alphabetically)
      expect(state.nodeLinksNormalized['node-a--node-z']).toBeDefined()
      expect(state.nodeLinksNormalized['node-a--node-z']).toContain('edge-1')
    })

    test('should track multiple edges between same node pair', () => {
      const store = useDataStore.getState()
      const nodes = [
        createMockNode({ ref_id: 'node-1' }),
        createMockNode({ ref_id: 'node-2' }),
      ]
      const edges = [
        createMockLink({ ref_id: 'edge-1', source: 'node-1', target: 'node-2' }),
        createMockLink({ ref_id: 'edge-2', source: 'node-1', target: 'node-2' }),
      ]

      store.addNewNode({ nodes, edges })

      const state = useDataStore.getState()
      const pairKey = 'node-1--node-2'
      expect(state.nodeLinksNormalized[pairKey]).toHaveLength(2)
      expect(state.nodeLinksNormalized[pairKey]).toContain('edge-1')
      expect(state.nodeLinksNormalized[pairKey]).toContain('edge-2')
    })
  })

  describe('Metadata Calculation', () => {
    test('should extract unique node types', () => {
      const store = useDataStore.getState()
      const nodes = [
        createMockNode({ ref_id: 'node-1', node_type: 'Topic' }),
        createMockNode({ ref_id: 'node-2', node_type: 'Episode' }),
        createMockNode({ ref_id: 'node-3', node_type: 'Topic' }),
        createMockNode({ ref_id: 'node-4', node_type: 'Person' }),
      ]

      store.addNewNode({ nodes, edges: [] })

      const state = useDataStore.getState()
      expect(state.nodeTypes).toHaveLength(3)
      expect(state.nodeTypes).toContain('Topic')
      expect(state.nodeTypes).toContain('Episode')
      expect(state.nodeTypes).toContain('Person')
    })

    test('should extract unique link types', () => {
      const store = useDataStore.getState()
      const mockData = createMockFetchData(4, 3, { connectNodes: true })

      store.addNewNode(mockData)

      const state = useDataStore.getState()
      expect(state.linkTypes.length).toBeGreaterThan(0)
      expect(state.linkTypes).toContain('RELATES_TO')
      expect(state.linkTypes).toContain('MENTIONS')
    })

    test('should calculate sidebar filter counts by node type', () => {
      const store = useDataStore.getState()
      const nodes = [
        createMockNode({ ref_id: 'node-1', node_type: 'Topic' }),
        createMockNode({ ref_id: 'node-2', node_type: 'Topic' }),
        createMockNode({ ref_id: 'node-3', node_type: 'Episode' }),
      ]

      store.addNewNode({ nodes, edges: [] })

      const state = useDataStore.getState()
      expect(state.sidebarFilterCounts).toBeDefined()
      expect(Array.isArray(state.sidebarFilterCounts)).toBe(true)

      const topicFilter = state.sidebarFilterCounts.find((f) => f.name === 'topic')
      const episodeFilter = state.sidebarFilterCounts.find((f) => f.name === 'episode')

      expect(topicFilter?.count).toBe(2)
      expect(episodeFilter?.count).toBe(1)
    })

    test('should update filter counts on subsequent additions', () => {
      const store = useDataStore.getState()
      const firstBatch = [createMockNode({ ref_id: 'node-1', node_type: 'Topic' })]
      const secondBatch = [
        createMockNode({ ref_id: 'node-2', node_type: 'Topic' }),
        createMockNode({ ref_id: 'node-3', node_type: 'Episode' }),
      ]

      store.addNewNode({ nodes: firstBatch, edges: [] })
      const stateAfterFirst = useDataStore.getState()
      const topicCountFirst = stateAfterFirst.sidebarFilterCounts.find(
        (f) => f.name === 'topic'
      )?.count
      expect(topicCountFirst).toBe(1)

      store.addNewNode({ nodes: secondBatch, edges: [] })
      const stateAfterSecond = useDataStore.getState()
      const topicCountSecond = stateAfterSecond.sidebarFilterCounts.find(
        (f) => f.name === 'topic'
      )?.count
      const episodeCountSecond = stateAfterSecond.sidebarFilterCounts.find(
        (f) => f.name === 'episode'
      )?.count
      expect(topicCountSecond).toBe(2)
      expect(episodeCountSecond).toBe(1)
    })
  })

  describe('Incremental Updates', () => {
    test('should separate dataNew from dataInitial', () => {
      const store = useDataStore.getState()
      // Create first batch with unique IDs
      const firstBatch = {
        nodes: [
          createMockNode({ ref_id: 'batch1-node-0' }),
          createMockNode({ ref_id: 'batch1-node-1' }),
        ],
        edges: [],
      }
      // Create second batch with different unique IDs
      const secondBatch = {
        nodes: [
          createMockNode({ ref_id: 'batch2-node-0' }),
          createMockNode({ ref_id: 'batch2-node-1' }),
          createMockNode({ ref_id: 'batch2-node-2' }),
        ],
        edges: [],
      }

      store.addNewNode(firstBatch)
      const stateAfterFirst = useDataStore.getState()
      expect(stateAfterFirst.dataInitial!.nodes).toHaveLength(2)
      expect(stateAfterFirst.dataNew!.nodes).toHaveLength(2)

      store.addNewNode(secondBatch)
      const stateAfterSecond = useDataStore.getState()
      // All nodes should be unique
      expect(stateAfterSecond.dataInitial!.nodes).toHaveLength(5) // Cumulative: 2 + 3
      expect(stateAfterSecond.dataNew!.nodes).toHaveLength(3) // Only new from second batch
    })

    test('should not update store if no new nodes or edges', () => {
      const store = useDataStore.getState()
      const batch = createMockFetchData(2, 1, { connectNodes: true })

      store.addNewNode(batch)
      const stateAfterFirst = useDataStore.getState()
      const initialNodeCount = stateAfterFirst.dataInitial.nodes.length

      // Try to add same data again (all duplicates)
      store.addNewNode(batch)
      const stateAfterSecond = useDataStore.getState()

      expect(stateAfterSecond.dataInitial.nodes.length).toBe(initialNodeCount)
      expect(stateAfterSecond.dataNew.nodes).toHaveLength(0) // No new data
    })

    test('should handle mixed new and duplicate data', () => {
      const store = useDataStore.getState()
      const firstBatch = [
        createMockNode({ ref_id: 'node-1' }),
        createMockNode({ ref_id: 'node-2' }),
      ]
      const secondBatch = [
        createMockNode({ ref_id: 'node-1' }), // duplicate
        createMockNode({ ref_id: 'node-3' }), // new
        createMockNode({ ref_id: 'node-4' }), // new
      ]

      store.addNewNode({ nodes: firstBatch, edges: [] })
      store.addNewNode({ nodes: secondBatch, edges: [] })

      const state = useDataStore.getState()
      expect(state.dataInitial.nodes).toHaveLength(4) // 2 original + 2 new
      expect(state.dataNew.nodes).toHaveLength(2) // Only node-3 and node-4
    })
  })

  describe('Edge Cases', () => {
    test('should handle empty edges array', () => {
      const store = useDataStore.getState()
      const nodes = [createMockNode({ ref_id: 'node-1' })]

      store.addNewNode({ nodes, edges: [] })

      const state = useDataStore.getState()
      expect(state.nodesNormalized.size).toBe(1)
      expect(state.linksNormalized.size).toBe(0)
    })

    test('should handle nodes with missing optional properties', () => {
      const store = useDataStore.getState()
      const minimalNode: Node = {
        ref_id: 'node-minimal',
        node_type: 'Topic',
        x: 0,
        y: 0,
        z: 0,
        edge_count: 0,
      }

      store.addNewNode({ nodes: [minimalNode], edges: [] })

      const state = useDataStore.getState()
      const addedNode = state.nodesNormalized.get('node-minimal')
      expect(addedNode).toBeDefined()
      expect(addedNode?.ref_id).toBe('node-minimal')
    })

    test('should handle edges with no edge_type', () => {
      const store = useDataStore.getState()
      const nodes = [
        createMockNode({ ref_id: 'node-1' }),
        createMockNode({ ref_id: 'node-2' }),
      ]
      const edge = {
        ref_id: 'edge-no-type',
        source: 'node-1',
        target: 'node-2',
        edge_type: '',
      }

      store.addNewNode({ nodes, edges: [edge] })

      const state = useDataStore.getState()
      expect(state.linksNormalized.size).toBe(1)
      expect(state.linksNormalized.get('edge-no-type')).toBeDefined()
    })

    test('should maintain store state consistency after multiple operations', () => {
      const store = useDataStore.getState()

      // Operation 1: Add initial data
      store.addNewNode(createMockFetchData(5, 3, { connectNodes: true }))
      const stateAfter1 = useDataStore.getState()
      const nodeCount1 = stateAfter1.nodesNormalized.size
      const linkCount1 = stateAfter1.linksNormalized.size

      // Operation 2: Add more data
      store.addNewNode(createMockFetchData(3, 2, { connectNodes: true }))
      const stateAfter2 = useDataStore.getState()

      // Operation 3: Reset and add new data
      store.resetData()
      store.addNewNode(createMockFetchData(2, 1, { connectNodes: true }))
      const stateAfter3 = useDataStore.getState()

      expect(stateAfter2.nodesNormalized.size).toBeGreaterThan(nodeCount1)
      expect(stateAfter2.linksNormalized.size).toBeGreaterThan(linkCount1)
      expect(stateAfter3.nodesNormalized.size).toBe(2)
      expect(stateAfter3.linksNormalized.size).toBe(1)
    })
  })

  describe('Performance', () => {
    test('should handle 1000+ nodes efficiently', () => {
      const store = useDataStore.getState()
      const largeDataset = createMockFetchData(1000, 0)

      const startTime = performance.now()
      store.addNewNode(largeDataset)
      const endTime = performance.now()

      const state = useDataStore.getState()
      expect(state.nodesNormalized.size).toBe(1000)
      expect(endTime - startTime).toBeLessThan(1000) // Should complete in less than 1 second
    })

    test('should maintain O(1) lookup performance with large datasets', () => {
      const store = useDataStore.getState()
      const largeDataset = createMockFetchData(1000, 0)

      store.addNewNode(largeDataset)
      const state = useDataStore.getState()

      const startTime = performance.now()
      const node = state.nodesNormalized.get('node-500')
      const endTime = performance.now()

      expect(node).toBeDefined()
      expect(endTime - startTime).toBeLessThan(1) // Map lookup should be near-instant
    })

    test('should handle large edge datasets efficiently', () => {
      const store = useDataStore.getState()
      const largeDataset = createMockFetchData(500, 499, { connectNodes: true })

      const startTime = performance.now()
      store.addNewNode(largeDataset)
      const endTime = performance.now()

      const state = useDataStore.getState()
      expect(state.nodesNormalized.size).toBe(500)
      expect(state.linksNormalized.size).toBe(499)
      expect(endTime - startTime).toBeLessThan(1000) // Should complete in less than 1 second
    })

    test('should not degrade with multiple incremental additions', () => {
      const store = useDataStore.getState()
      const additionTimes: number[] = []

      // Add data in 10 batches
      for (let i = 0; i < 10; i++) {
        const batchStart = performance.now()
        store.addNewNode(createMockFetchData(100, 50, { connectNodes: true }))
        const batchEnd = performance.now()
        additionTimes.push(batchEnd - batchStart)
      }

      const state = useDataStore.getState()
      expect(state.nodesNormalized.size).toBeGreaterThan(900) // Most nodes should be unique

      // Check that performance doesn't significantly degrade
      const firstBatchTime = additionTimes[0]
      const lastBatchTime = additionTimes[additionTimes.length - 1]
      expect(lastBatchTime).toBeLessThan(firstBatchTime * 3) // Should not be more than 3x slower
    })
  })

  describe('State Reset', () => {
    test('should clear all normalized data on resetData', () => {
      const store = useDataStore.getState()
      store.addNewNode(createMockFetchData(10, 5, { connectNodes: true }))

      store.resetData()
      const state = useDataStore.getState()

      expect(state.dataInitial).toBeNull()
      expect(state.dataNew).toBeNull()
      expect(state.nodesNormalized.size).toBe(0)
      expect(state.linksNormalized.size).toBe(0)
      expect(state.nodeTypes).toHaveLength(0)
    })
  })
})