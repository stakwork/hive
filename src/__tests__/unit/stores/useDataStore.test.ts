import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getStoreBundle, destroyStoreBundle } from '@/stores/createStoreFactory';
import type { FetchDataResponse, Node, Link } from '@Universe/types';

// Test data factories
const createMockNode = (overrides: Partial<Node> = {}): Node => ({
  ref_id: `node-${Math.random().toString(36).substr(2, 9)}`,
  name: 'Test Node',
  label: 'Test Label',
  node_type: 'Function',
  x: 0,
  y: 0,
  z: 0,
  edge_count: 0,
  date_added_to_graph: Date.now(),
  ...overrides,
});

const createMockLink = (overrides: Partial<Link> = {}): Link => ({
  ref_id: `link-${Math.random().toString(36).substr(2, 9)}`,
  source: overrides.source || 'node-1',
  target: overrides.target || 'node-2',
  edge_type: 'CALLS',
  ...overrides,
});

const createMockFetchData = (
  nodeCount: number = 5,
  edgeCount: number = 3,
  overrides: Partial<FetchDataResponse> = {}
): FetchDataResponse => {
  const nodes: Node[] = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push(createMockNode({ ref_id: `node-${i}`, name: `Node ${i}` }));
  }

  const edges: Link[] = [];
  for (let i = 0; i < edgeCount && i < nodeCount - 1; i++) {
    edges.push(createMockLink({ ref_id: `link-${i}`, source: `node-${i}`, target: `node-${i + 1}` }));
  }

  return {
    nodes,
    edges,
    ...overrides,
  };
};

// Helper to inspect store state
const inspectStore = (storeId: string = 'test') => {
  const bundle = getStoreBundle(storeId);
  return bundle.data.getState();
};

describe('createDataStore - Basic Functionality', () => {
  const storeId = 'test-basic';

  beforeEach(() => {
    destroyStoreBundle(storeId);
    const bundle = getStoreBundle(storeId);
    bundle.data.getState().resetData();
  });

  it('should initialize with default state', () => {
    const state = inspectStore(storeId);

    expect(state.dataInitial).toBeNull();
    expect(state.dataNew).toBeNull();
    expect(state.nodesNormalized.size).toBe(0);
    expect(state.linksNormalized.size).toBe(0);
    expect(state.nodeTypes).toEqual([]);
    expect(state.linkTypes).toEqual([]);
    expect(state.sidebarFilter).toBe('all');
  });

  it('should add new nodes and links via addNewNode', () => {
    const bundle = getStoreBundle(storeId);
    const mockData = createMockFetchData(3, 2);

    bundle.data.getState().addNewNode(mockData);

    const state = inspectStore(storeId);
    expect(state.dataInitial?.nodes).toHaveLength(3);
    expect(state.dataInitial?.links).toHaveLength(2);
    expect(state.nodesNormalized.size).toBe(3);
    expect(state.linksNormalized.size).toBe(2);
  });

  it('should set dataNew to null when no new data after deduplication (Bug#2 fix)', () => {
    const bundle = getStoreBundle(storeId);
    const mockData = createMockFetchData(2, 1);

    // First call adds data
    bundle.data.getState().addNewNode(mockData);
    expect(inspectStore(storeId).dataNew?.nodes).toHaveLength(2);

    // Second call with same data should set dataNew to null
    bundle.data.getState().addNewNode(mockData);
    expect(inspectStore(storeId).dataNew).toBeNull();
  });

  it('should extract unique node types and link types', () => {
    const bundle = getStoreBundle(storeId);
    const mockData = {
      nodes: [
        createMockNode({ ref_id: 'n1', node_type: 'Function' }),
        createMockNode({ ref_id: 'n2', node_type: 'Class' }),
        createMockNode({ ref_id: 'n3', node_type: 'Function' }),
      ],
      edges: [
        createMockLink({ ref_id: 'e1', source: 'n1', target: 'n2', edge_type: 'CALLS' }),
        createMockLink({ ref_id: 'e2', source: 'n2', target: 'n3', edge_type: 'IMPORTS' }),
      ],
    };

    bundle.data.getState().addNewNode(mockData);

    const state = inspectStore(storeId);
    expect(state.nodeTypes).toEqual(expect.arrayContaining(['Class', 'Function']));
    expect(state.linkTypes).toEqual(expect.arrayContaining(['CALLS', 'IMPORTS']));
  });

  it('should reset graph data', () => {
    const bundle = getStoreBundle(storeId);
    const mockData = createMockFetchData(3, 2);

    bundle.data.getState().addNewNode(mockData);
    expect(inspectStore(storeId).dataInitial).not.toBeNull();

    bundle.data.getState().resetData();

    const state = inspectStore(storeId);
    expect(state.dataInitial).toBeNull();
    expect(state.dataNew).toBeNull();
    expect(state.nodesNormalized.size).toBe(0);
    expect(state.linksNormalized.size).toBe(0);
    expect(state.nodeTypes).toEqual([]);
    expect(state.linkTypes).toEqual([]);
  });
});

describe('createDataStore - Node Deduplication', () => {
  const storeId = 'test-dedup';

  beforeEach(() => {
    destroyStoreBundle(storeId);
    const bundle = getStoreBundle(storeId);
    bundle.data.getState().resetData();
  });

  it('should prevent duplicate nodes by ref_id', () => {
    const bundle = getStoreBundle(storeId);
    const node = createMockNode({ ref_id: 'duplicate-node' });
    const mockData1 = { nodes: [node], edges: [] };
    const mockData2 = { nodes: [node], edges: [] };

    bundle.data.getState().addNewNode(mockData1);
    bundle.data.getState().addNewNode(mockData2);

    const state = inspectStore(storeId);
    expect(state.nodesNormalized.size).toBe(1);
    expect(state.dataInitial?.nodes).toHaveLength(1);
  });

  it('should use Map for O(1) node lookup', () => {
    const bundle = getStoreBundle(storeId);
    const nodes = Array.from({ length: 1000 }, (_, i) => 
      createMockNode({ ref_id: `node-${i}`, name: `Node ${i}` })
    );
    const mockData = { nodes, edges: [] };

    const startTime = performance.now();
    bundle.data.getState().addNewNode(mockData);
    const endTime = performance.now();

    const state = inspectStore(storeId);
    expect(state.nodesNormalized.size).toBe(1000);
    
    // O(1) lookup verification
    const lookupStart = performance.now();
    const found = state.nodesNormalized.has('node-500');
    const lookupEnd = performance.now();

    expect(found).toBe(true);
    expect(lookupEnd - lookupStart).toBeLessThan(1); // Should be instant
    expect(endTime - startTime).toBeLessThan(100); // Addition should be fast
  });

  it('should prevent duplicate links by ref_id', () => {
    const bundle = getStoreBundle(storeId);
    const node1 = createMockNode({ ref_id: 'node-1' });
    const node2 = createMockNode({ ref_id: 'node-2' });
    const link = createMockLink({ ref_id: 'duplicate-link', source: 'node-1', target: 'node-2' });

    const mockData1 = { nodes: [node1, node2], edges: [link] };
    const mockData2 = { nodes: [], edges: [link] };

    bundle.data.getState().addNewNode(mockData1);
    bundle.data.getState().addNewNode(mockData2);

    const state = inspectStore(storeId);
    expect(state.linksNormalized.size).toBe(1);
    expect(state.dataInitial?.links).toHaveLength(1);
  });
});

describe('createDataStore - Edge Validation', () => {
  const storeId = 'test-edge';

  beforeEach(() => {
    destroyStoreBundle(storeId);
    const bundle = getStoreBundle(storeId);
    bundle.data.getState().resetData();
  });

  it('should reject edges when source node does not exist', () => {
    const bundle = getStoreBundle(storeId);
    const node = createMockNode({ ref_id: 'existing-node' });
    const link = createMockLink({ ref_id: 'invalid-link', source: 'non-existent', target: 'existing-node' });

    const mockData = { nodes: [node], edges: [link] };
    bundle.data.getState().addNewNode(mockData);

    const state = inspectStore(storeId);
    expect(state.linksNormalized.size).toBe(0);
  });

  it('should reject edges when target node does not exist', () => {
    const bundle = getStoreBundle(storeId);
    const node = createMockNode({ ref_id: 'existing-node' });
    const link = createMockLink({ ref_id: 'invalid-link', source: 'existing-node', target: 'non-existent' });

    const mockData = { nodes: [node], edges: [link] };
    bundle.data.getState().addNewNode(mockData);

    const state = inspectStore(storeId);
    expect(state.linksNormalized.size).toBe(0);
  });

  it('should accept edges when both source and target nodes exist', () => {
    const bundle = getStoreBundle(storeId);
    const node1 = createMockNode({ ref_id: 'node-1' });
    const node2 = createMockNode({ ref_id: 'node-2' });
    const link = createMockLink({ ref_id: 'valid-link', source: 'node-1', target: 'node-2' });

    const mockData = { nodes: [node1, node2], edges: [link] };
    bundle.data.getState().addNewNode(mockData);

    const state = inspectStore(storeId);
    expect(state.linksNormalized.size).toBe(1);
    expect(state.linksNormalized.get('valid-link')).toBeDefined();
  });

  it('should use Map for O(1) link lookup', () => {
    const bundle = getStoreBundle(storeId);
    const nodes = Array.from({ length: 100 }, (_, i) => 
      createMockNode({ ref_id: `node-${i}` })
    );
    const edges = Array.from({ length: 99 }, (_, i) => 
      createMockLink({ ref_id: `link-${i}`, source: `node-${i}`, target: `node-${i + 1}` })
    );

    bundle.data.getState().addNewNode({ nodes, edges });

    const state = inspectStore(storeId);
    const lookupStart = performance.now();
    const found = state.linksNormalized.has('link-50');
    const lookupEnd = performance.now();

    expect(found).toBe(true);
    expect(lookupEnd - lookupStart).toBeLessThan(1); // O(1) lookup
  });

  it('should handle edges added after nodes are present', () => {
    const bundle = getStoreBundle(storeId);
    const node1 = createMockNode({ ref_id: 'node-1' });
    const node2 = createMockNode({ ref_id: 'node-2' });

    // Add nodes first
    bundle.data.getState().addNewNode({ nodes: [node1, node2], edges: [] });
    expect(inspectStore(storeId).linksNormalized.size).toBe(0);

    // Add edge later
    const link = createMockLink({ ref_id: 'late-link', source: 'node-1', target: 'node-2' });
    bundle.data.getState().addNewNode({ nodes: [], edges: [link] });

    const state = inspectStore(storeId);
    expect(state.linksNormalized.size).toBe(1);
  });
});

describe('createDataStore - Relationship Tracking', () => {
  const storeId = 'test-relationships';

  beforeEach(() => {
    destroyStoreBundle(storeId);
    const bundle = getStoreBundle(storeId);
    bundle.data.getState().resetData();
  });

  it('should update source node targets array', () => {
    const bundle = getStoreBundle(storeId);
    const node1 = createMockNode({ ref_id: 'node-1' });
    const node2 = createMockNode({ ref_id: 'node-2' });
    const link = createMockLink({ ref_id: 'link-1', source: 'node-1', target: 'node-2' });

    bundle.data.getState().addNewNode({ nodes: [node1, node2], edges: [link] });

    const state = inspectStore(storeId);
    const sourceNode = state.nodesNormalized.get('node-1');
    expect(sourceNode?.targets).toContain('node-2');
  });

  it('should update target node sources array', () => {
    const bundle = getStoreBundle(storeId);
    const node1 = createMockNode({ ref_id: 'node-1' });
    const node2 = createMockNode({ ref_id: 'node-2' });
    const link = createMockLink({ ref_id: 'link-1', source: 'node-1', target: 'node-2' });

    bundle.data.getState().addNewNode({ nodes: [node1, node2], edges: [link] });

    const state = inspectStore(storeId);
    const targetNode = state.nodesNormalized.get('node-2');
    expect(targetNode?.sources).toContain('node-1');
  });

  it('should populate nodeLinksNormalized with sorted pair keys', () => {
    const bundle = getStoreBundle(storeId);
    const node1 = createMockNode({ ref_id: 'node-1' });
    const node2 = createMockNode({ ref_id: 'node-2' });
    const link = createMockLink({ ref_id: 'link-1', source: 'node-1', target: 'node-2' });

    bundle.data.getState().addNewNode({ nodes: [node1, node2], edges: [link] });

    const state = inspectStore(storeId);
    const pairKey = 'node-1--node-2';
    expect(state.nodeLinksNormalized[pairKey]).toContain('link-1');
  });

  it('should track edge types on both nodes', () => {
    const bundle = getStoreBundle(storeId);
    const node1 = createMockNode({ ref_id: 'node-1' });
    const node2 = createMockNode({ ref_id: 'node-2' });
    const link = createMockLink({ ref_id: 'link-1', source: 'node-1', target: 'node-2', edge_type: 'CALLS' });

    bundle.data.getState().addNewNode({ nodes: [node1, node2], edges: [link] });

    const state = inspectStore(storeId);
    const sourceNode = state.nodesNormalized.get('node-1');
    const targetNode = state.nodesNormalized.get('node-2');

    expect(sourceNode?.edgeTypes).toContain('CALLS');
    expect(targetNode?.edgeTypes).toContain('CALLS');
  });

  it('should handle multiple links between same node pair', () => {
    const bundle = getStoreBundle(storeId);
    const node1 = createMockNode({ ref_id: 'node-1' });
    const node2 = createMockNode({ ref_id: 'node-2' });
    const link1 = createMockLink({ ref_id: 'link-1', source: 'node-1', target: 'node-2', edge_type: 'CALLS' });
    const link2 = createMockLink({ ref_id: 'link-2', source: 'node-1', target: 'node-2', edge_type: 'IMPORTS' });

    bundle.data.getState().addNewNode({ nodes: [node1, node2], edges: [link1, link2] });

    const state = inspectStore(storeId);
    const pairKey = 'node-1--node-2';
    expect(state.nodeLinksNormalized[pairKey]).toHaveLength(2);
    expect(state.nodeLinksNormalized[pairKey]).toEqual(expect.arrayContaining(['link-1', 'link-2']));
  });

  it('should deduplicate edge types in node edgeTypes array', () => {
    const bundle = getStoreBundle(storeId);
    const node1 = createMockNode({ ref_id: 'node-1' });
    const node2 = createMockNode({ ref_id: 'node-2' });
    const node3 = createMockNode({ ref_id: 'node-3' });
    const link1 = createMockLink({ ref_id: 'link-1', source: 'node-1', target: 'node-2', edge_type: 'CALLS' });
    const link2 = createMockLink({ ref_id: 'link-2', source: 'node-1', target: 'node-3', edge_type: 'CALLS' });

    bundle.data.getState().addNewNode({ nodes: [node1, node2, node3], edges: [link1, link2] });

    const state = inspectStore(storeId);
    const sourceNode = state.nodesNormalized.get('node-1');
    
    // Should have unique edge types only
    const callsCount = sourceNode?.edgeTypes?.filter(t => t === 'CALLS').length;
    expect(callsCount).toBe(1);
  });
});

describe('createDataStore - Metadata Calculation', () => {
  const storeId = 'test-metadata';

  beforeEach(() => {
    destroyStoreBundle(storeId);
    const bundle = getStoreBundle(storeId);
    bundle.data.getState().resetData();
  });

  it('should calculate unique node types', () => {
    const bundle = getStoreBundle(storeId);
    const mockData = {
      nodes: [
        createMockNode({ ref_id: 'n1', node_type: 'Function' }),
        createMockNode({ ref_id: 'n2', node_type: 'Class' }),
        createMockNode({ ref_id: 'n3', node_type: 'Function' }),
        createMockNode({ ref_id: 'n4', node_type: 'File' }),
      ],
      edges: [],
    };

    bundle.data.getState().addNewNode(mockData);

    const state = inspectStore(storeId);
    expect(state.nodeTypes).toHaveLength(3);
    expect(state.nodeTypes).toEqual(expect.arrayContaining(['Class', 'File', 'Function']));
  });

  it('should calculate sidebar filters from node types', () => {
    const bundle = getStoreBundle(storeId);
    const mockData = {
      nodes: [
        createMockNode({ ref_id: 'n1', node_type: 'Function' }),
        createMockNode({ ref_id: 'n2', node_type: 'Class' }),
      ],
      edges: [],
    };

    bundle.data.getState().addNewNode(mockData);

    const state = inspectStore(storeId);
    expect(state.sidebarFilters).toContain('all');
    expect(state.sidebarFilters).toContain('function');
    expect(state.sidebarFilters).toContain('class');
  });

  it('should calculate sidebar filter counts correctly', () => {
    const bundle = getStoreBundle(storeId);
    const mockData = {
      nodes: [
        createMockNode({ ref_id: 'n1', node_type: 'Function' }),
        createMockNode({ ref_id: 'n2', node_type: 'Function' }),
        createMockNode({ ref_id: 'n3', node_type: 'Class' }),
      ],
      edges: [],
    };

    bundle.data.getState().addNewNode(mockData);

    const state = inspectStore(storeId);
    const allCount = state.sidebarFilterCounts.find(f => f.name === 'all')?.count;
    const functionCount = state.sidebarFilterCounts.find(f => f.name === 'function')?.count;
    const classCount = state.sidebarFilterCounts.find(f => f.name === 'class')?.count;

    expect(allCount).toBe(3);
    expect(functionCount).toBe(2);
    expect(classCount).toBe(1);
  });

  it('should handle node_type normalization (Bug#4 fix)', () => {
    const bundle = getStoreBundle(storeId);
    const mockData = {
      nodes: [
        createMockNode({ ref_id: 'n1', node_type: '  Function  ' }), // whitespace
        createMockNode({ ref_id: 'n2', node_type: undefined }), // undefined
        createMockNode({ ref_id: 'n3', node_type: '' }), // empty string
      ],
      edges: [],
    };

    // Should not crash
    expect(() => bundle.data.getState().addNewNode(mockData)).not.toThrow();

    const state = inspectStore(storeId);
    expect(state.nodeTypes).toEqual(expect.arrayContaining(['Function', 'Unknown']));
  });

  it('should calculate link types from edges', () => {
    const bundle = getStoreBundle(storeId);
    const node1 = createMockNode({ ref_id: 'node-1' });
    const node2 = createMockNode({ ref_id: 'node-2' });
    const node3 = createMockNode({ ref_id: 'node-3' });
    
    const mockData = {
      nodes: [node1, node2, node3],
      edges: [
        createMockLink({ ref_id: 'link-1', source: 'node-1', target: 'node-2', edge_type: 'CALLS' }),
        createMockLink({ ref_id: 'link-2', source: 'node-2', target: 'node-3', edge_type: 'IMPORTS' }),
        createMockLink({ ref_id: 'link-3', source: 'node-1', target: 'node-3', edge_type: 'CALLS' }),
      ],
    };

    bundle.data.getState().addNewNode(mockData);

    const state = inspectStore(storeId);
    expect(state.linkTypes).toHaveLength(2);
    expect(state.linkTypes).toEqual(expect.arrayContaining(['CALLS', 'IMPORTS']));
  });
});

describe('createDataStore - Incremental Updates', () => {
  const storeId = 'test-incremental';

  beforeEach(() => {
    destroyStoreBundle(storeId);
    const bundle = getStoreBundle(storeId);
    bundle.data.getState().resetData();
  });

  it('should accumulate nodes across multiple addNewNode calls (Bug#1 fix)', () => {
    const bundle = getStoreBundle(storeId);
    
    // First batch
    const batch1 = createMockFetchData(3, 2);
    bundle.data.getState().addNewNode(batch1);
    expect(inspectStore(storeId).dataInitial?.nodes).toHaveLength(3);

    // Second batch with new nodes
    const batch2 = createMockFetchData(2, 1);
    bundle.data.getState().addNewNode(batch2);
    
    const state = inspectStore(storeId);
    expect(state.dataInitial?.nodes).toHaveLength(5); // 3 + 2
    expect(state.nodesNormalized.size).toBe(5);
  });

  it('should track only new nodes in dataNew', () => {
    const bundle = getStoreBundle(storeId);
    
    const batch1 = createMockFetchData(3, 2);
    bundle.data.getState().addNewNode(batch1);

    const batch2 = createMockFetchData(2, 1);
    bundle.data.getState().addNewNode(batch2);
    
    const state = inspectStore(storeId);
    expect(state.dataNew?.nodes).toHaveLength(2); // Only new nodes from batch2
  });

  it('should accumulate links across multiple addNewNode calls (Bug#1 fix)', () => {
    const bundle = getStoreBundle(storeId);
    const node1 = createMockNode({ ref_id: 'node-1' });
    const node2 = createMockNode({ ref_id: 'node-2' });
    const node3 = createMockNode({ ref_id: 'node-3' });

    // First batch with 1 link
    bundle.data.getState().addNewNode({
      nodes: [node1, node2],
      edges: [createMockLink({ ref_id: 'link-1', source: 'node-1', target: 'node-2' })],
    });
    expect(inspectStore(storeId).dataInitial?.links).toHaveLength(1);

    // Second batch with 1 more link
    bundle.data.getState().addNewNode({
      nodes: [node3],
      edges: [createMockLink({ ref_id: 'link-2', source: 'node-2', target: 'node-3' })],
    });

    const state = inspectStore(storeId);
    expect(state.dataInitial?.links).toHaveLength(2); // 1 + 1
    expect(state.linksNormalized.size).toBe(2);
  });
});

describe('createDataStore - Node Sorting', () => {
  const storeId = 'test-sorting';

  beforeEach(() => {
    destroyStoreBundle(storeId);
    const bundle = getStoreBundle(storeId);
    bundle.data.getState().resetData();
  });

  it('should sort nodes by date_added_to_graph in ascending order (Bug#3 fix)', () => {
    const bundle = getStoreBundle(storeId);
    const now = Date.now();
    
    const mockData = {
      nodes: [
        createMockNode({ ref_id: 'n3', date_added_to_graph: now + 3000 }),
        createMockNode({ ref_id: 'n1', date_added_to_graph: now + 1000 }),
        createMockNode({ ref_id: 'n2', date_added_to_graph: now + 2000 }),
      ],
      edges: [],
    };

    bundle.data.getState().addNewNode(mockData);

    const state = inspectStore(storeId);
    const nodes = state.dataInitial?.nodes || [];
    
    // Verify sorted order
    expect(nodes[0].ref_id).toBe('n1');
    expect(nodes[1].ref_id).toBe('n2');
    expect(nodes[2].ref_id).toBe('n3');
  });

  it('should handle nodes without date_added_to_graph timestamp', () => {
    const bundle = getStoreBundle(storeId);
    const now = Date.now();
    
    const mockData = {
      nodes: [
        createMockNode({ ref_id: 'n1', date_added_to_graph: now + 1000 }),
        createMockNode({ ref_id: 'n2', date_added_to_graph: undefined }),
        createMockNode({ ref_id: 'n3', date_added_to_graph: now + 2000 }),
      ],
      edges: [],
    };

    // Should not crash
    expect(() => bundle.data.getState().addNewNode(mockData)).not.toThrow();

    const state = inspectStore(storeId);
    expect(state.dataInitial?.nodes).toHaveLength(3);
  });
});

describe('createDataStore - Performance', () => {
  const storeId = 'test-performance';

  beforeEach(() => {
    destroyStoreBundle(storeId);
    const bundle = getStoreBundle(storeId);
    bundle.data.getState().resetData();
  });

  it('should handle large datasets efficiently (10k+ nodes)', () => {
    const bundle = getStoreBundle(storeId);
    const nodeCount = 10000;
    const nodes = Array.from({ length: nodeCount }, (_, i) => 
      createMockNode({ ref_id: `node-${i}`, name: `Node ${i}` })
    );

    const startTime = performance.now();
    bundle.data.getState().addNewNode({ nodes, edges: [] });
    const endTime = performance.now();

    const state = inspectStore(storeId);
    expect(state.nodesNormalized.size).toBe(nodeCount);
    expect(endTime - startTime).toBeLessThan(1000); // Should process in under 1 second
  });

  it('should batch rapid addNewNode calls within 1000ms window', async () => {
    const bundle = getStoreBundle(storeId);
    const batch1 = createMockFetchData(2, 1);
    const batch2 = createMockFetchData(2, 1);
    const batch3 = createMockFetchData(2, 1);

    // Rapid fire calls within batching window
    bundle.data.getState().addNewNode(batch1);
    bundle.data.getState().addNewNode(batch2);
    bundle.data.getState().addNewNode(batch3);

    // Wait for batching window to flush (1000ms + buffer)
    await new Promise(resolve => setTimeout(resolve, 1100));

    const state = inspectStore(storeId);
    expect(state.nodesNormalized.size).toBe(6); // All nodes should be added
  });
});

describe('createDataStore - Edge Cases', () => {
  const storeId = 'test-edge-cases';

  beforeEach(() => {
    destroyStoreBundle(storeId);
    const bundle = getStoreBundle(storeId);
    bundle.data.getState().resetData();
  });

  it('should handle empty node arrays gracefully', () => {
    const bundle = getStoreBundle(storeId);
    const mockData = { nodes: [], edges: [] };

    expect(() => bundle.data.getState().addNewNode(mockData)).not.toThrow();

    const state = inspectStore(storeId);
    expect(state.dataInitial).toBeNull();
    expect(state.dataNew).toBeNull();
  });

  it('should handle null/undefined data gracefully', () => {
    const bundle = getStoreBundle(storeId);

    expect(() => bundle.data.getState().addNewNode(null as any)).not.toThrow();
    expect(() => bundle.data.getState().addNewNode(undefined as any)).not.toThrow();
    expect(() => bundle.data.getState().addNewNode({} as any)).not.toThrow();
  });

  it('should handle nodes with missing required fields', () => {
    const bundle = getStoreBundle(storeId);
    const mockData = {
      nodes: [
        { ref_id: 'n1' } as Node, // Missing most fields
      ],
      edges: [],
    };

    expect(() => bundle.data.getState().addNewNode(mockData)).not.toThrow();

    const state = inspectStore(storeId);
    expect(state.nodesNormalized.has('n1')).toBe(true);
  });

  it('should handle self-referencing edges', () => {
    const bundle = getStoreBundle(storeId);
    const node = createMockNode({ ref_id: 'self-node' });
    const link = createMockLink({ ref_id: 'self-link', source: 'self-node', target: 'self-node' });

    const mockData = { nodes: [node], edges: [link] };
    bundle.data.getState().addNewNode(mockData);

    const state = inspectStore(storeId);
    expect(state.linksNormalized.size).toBe(1);
    
    const selfNode = state.nodesNormalized.get('self-node');
    expect(selfNode?.sources).toContain('self-node');
    expect(selfNode?.targets).toContain('self-node');
  });

  it('should handle cyclic graph structures', () => {
    const bundle = getStoreBundle(storeId);
    const node1 = createMockNode({ ref_id: 'node-1' });
    const node2 = createMockNode({ ref_id: 'node-2' });
    const node3 = createMockNode({ ref_id: 'node-3' });

    const mockData = {
      nodes: [node1, node2, node3],
      edges: [
        createMockLink({ ref_id: 'link-1-2', source: 'node-1', target: 'node-2' }),
        createMockLink({ ref_id: 'link-2-3', source: 'node-2', target: 'node-3' }),
        createMockLink({ ref_id: 'link-3-1', source: 'node-3', target: 'node-1' }), // Cycle
      ],
    };

    expect(() => bundle.data.getState().addNewNode(mockData)).not.toThrow();

    const state = inspectStore(storeId);
    expect(state.linksNormalized.size).toBe(3);
  });

  it('should handle nodes removed then re-added', () => {
    const bundle = getStoreBundle(storeId);
    const node = createMockNode({ ref_id: 'reusable-node' });

    // Add node
    bundle.data.getState().addNewNode({ nodes: [node], edges: [] });
    expect(inspectStore(storeId).nodesNormalized.has('reusable-node')).toBe(true);

    // Reset data (removes node)
    bundle.data.getState().resetData();
    expect(inspectStore(storeId).nodesNormalized.has('reusable-node')).toBe(false);

    // Re-add same node
    bundle.data.getState().addNewNode({ nodes: [node], edges: [] });
    expect(inspectStore(storeId).nodesNormalized.has('reusable-node')).toBe(true);
  });
});

describe('createDataStore - Store Reset', () => {
  const storeId = 'test-reset';

  beforeEach(() => {
    destroyStoreBundle(storeId);
    const bundle = getStoreBundle(storeId);
    bundle.data.getState().resetData();
  });

  it('should clear all fields including linkTypes on resetData (Bug#5 fix)', () => {
    const bundle = getStoreBundle(storeId);
    const node1 = createMockNode({ ref_id: 'node-1' });
    const node2 = createMockNode({ ref_id: 'node-2' });
    const link = createMockLink({ ref_id: 'link-1', source: 'node-1', target: 'node-2', edge_type: 'CALLS' });

    // Populate store
    bundle.data.getState().addNewNode({ nodes: [node1, node2], edges: [link] });
    expect(inspectStore(storeId).linkTypes).toHaveLength(1);

    // Reset
    bundle.data.getState().resetData();

    const state = inspectStore(storeId);
    expect(state.dataInitial).toBeNull();
    expect(state.dataNew).toBeNull();
    expect(state.nodesNormalized.size).toBe(0);
    expect(state.linksNormalized.size).toBe(0);
    expect(state.nodeLinksNormalized).toEqual({});
    expect(state.nodeTypes).toEqual([]);
    expect(state.linkTypes).toEqual([]); // Bug#5 fix verified
    expect(state.sidebarFilter).toBe('all');
    expect(state.sidebarFilters).toEqual([]);
    expect(state.repositoryNodes).toEqual([]);
  });
});

describe('createDataStore - Repository Node Separation', () => {
  const storeId = 'test-repo-nodes';

  beforeEach(() => {
    destroyStoreBundle(storeId);
    const bundle = getStoreBundle(storeId);
    bundle.data.getState().resetData();
  });

  it('should separate repository nodes from graph nodes', () => {
    const bundle = getStoreBundle(storeId);
    const mockData = {
      nodes: [
        createMockNode({ ref_id: 'repo-1', node_type: 'GitHubRepo' }),
        createMockNode({ ref_id: 'func-1', node_type: 'Function' }),
        createMockNode({ ref_id: 'commit-1', node_type: 'Commits' }),
        createMockNode({ ref_id: 'class-1', node_type: 'Class' }),
      ],
      edges: [],
    };

    bundle.data.getState().addNewNode(mockData);

    const state = inspectStore(storeId);
    expect(state.repositoryNodes).toHaveLength(2); // GitHubRepo + Commits
    expect(state.dataInitial?.nodes).toHaveLength(2); // Function + Class (graph nodes only)
  });

  it('should handle all repository node types', () => {
    const bundle = getStoreBundle(storeId);
    const repoNodeTypes = ['GitHubRepo', 'Commits', 'Stars', 'Issues', 'Age', 'Contributor'];
    
    const mockData = {
      nodes: repoNodeTypes.map((type, i) => 
        createMockNode({ ref_id: `repo-${i}`, node_type: type })
      ),
      edges: [],
    };

    bundle.data.getState().addNewNode(mockData);

    const state = inspectStore(storeId);
    expect(state.repositoryNodes).toHaveLength(6);
    expect(state.dataInitial?.nodes).toHaveLength(0); // No graph nodes
  });

  it('should deduplicate repository nodes by ref_id', () => {
    const bundle = getStoreBundle(storeId);
    const repoNode = createMockNode({ ref_id: 'repo-1', node_type: 'GitHubRepo' });

    bundle.data.getState().addNewNode({ nodes: [repoNode], edges: [] });
    bundle.data.getState().addNewNode({ nodes: [repoNode], edges: [] });

    const state = inspectStore(storeId);
    expect(state.repositoryNodes).toHaveLength(1);
  });

  it('should handle mixed repository and graph nodes in same batch', () => {
    const bundle = getStoreBundle(storeId);
    const mockData = {
      nodes: [
        createMockNode({ ref_id: 'repo-1', node_type: 'GitHubRepo' }),
        createMockNode({ ref_id: 'func-1', node_type: 'Function' }),
        createMockNode({ ref_id: 'stars-1', node_type: 'Stars' }),
        createMockNode({ ref_id: 'class-1', node_type: 'Class' }),
      ],
      edges: [],
    };

    bundle.data.getState().addNewNode(mockData);

    const state = inspectStore(storeId);
    expect(state.repositoryNodes).toHaveLength(2);
    expect(state.dataInitial?.nodes).toHaveLength(2);
    expect(state.nodeTypes).toEqual(expect.arrayContaining(['Class', 'Function']));
  });
});

describe('createDataStore - Store Integration', () => {
  const storeId = 'test-integration';

  beforeEach(() => {
    destroyStoreBundle(storeId);
    const bundle = getStoreBundle(storeId);
    bundle.data.getState().resetData();
  });

  it('should create isolated store instances', () => {
    const bundle1 = getStoreBundle('store-1');
    const bundle2 = getStoreBundle('store-2');

    const mockData1 = createMockFetchData(3, 2);
    const mockData2 = createMockFetchData(5, 4);

    bundle1.data.getState().addNewNode(mockData1);
    bundle2.data.getState().addNewNode(mockData2);

    expect(bundle1.data.getState().nodesNormalized.size).toBe(3);
    expect(bundle2.data.getState().nodesNormalized.size).toBe(5);

    destroyStoreBundle('store-1');
    destroyStoreBundle('store-2');
  });

  it('should support store bundle creation and destruction', () => {
    const bundle = getStoreBundle('temp-store');
    expect(bundle.data).toBeDefined();
    expect(bundle.graph).toBeDefined();
    expect(bundle.simulation).toBeDefined();

    destroyStoreBundle('temp-store');
    
    // Creating new instance should give fresh state
    const newBundle = getStoreBundle('temp-store');
    expect(newBundle.data.getState().dataInitial).toBeNull();

    destroyStoreBundle('temp-store');
  });
});