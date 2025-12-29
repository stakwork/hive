import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDataStore } from '@/stores/createDataStore';
import { 
  createMockNode, 
  createMockLink, 
  createMockFetchData 
} from '@/__tests__/support/helpers/data-store-test-helpers';

/**
 * Unit tests for createDataStore factory function
 * 
 * This test suite focuses on:
 * - Store factory and independent instance creation
 * - Store lifecycle management (creation, cleanup, isolation)
 * - Core state management functionality
 * 
 * Note: The existing useDataStore.test.ts provides comprehensive coverage
 * for the addNewNode functionality and batching logic. This test suite 
 * complements that coverage by focusing on factory-specific behaviors.
 */

/**
 * Store Factory & Initialization Tests
 */
describe('createDataStore - Factory & Initialization', () => {
  test('should create a new store instance', () => {
    const store = createDataStore();
    
    expect(store).toBeDefined();
    expect(typeof store.getState).toBe('function');
    expect(typeof store.subscribe).toBe('function');
  });

  test('should initialize with default state', () => {
    const store = createDataStore();
    const state = store.getState();

    // Verify default state structure
    expect(state.dataInitial).toBeNull();
    expect(state.dataNew).toBeNull();
    expect(state.nodesNormalized).toBeInstanceOf(Map);
    expect(state.nodesNormalized.size).toBe(0);
    expect(state.linksNormalized).toBeInstanceOf(Map);
    expect(state.linksNormalized.size).toBe(0);
    expect(state.nodeLinksNormalized).toEqual({});
    expect(state.nodeTypes).toEqual([]);
    expect(state.linkTypes).toEqual([]);
    expect(state.sidebarFilters).toEqual([]);
    expect(state.sidebarFilterCounts).toEqual([]);
    expect(state.repositoryNodes).toEqual([]);
    expect(state.filters).toBeDefined();
    expect(state.sidebarFilter).toBe('all');
    expect(state.splashDataLoading).toBe(true);
  });

  test('should create independent store instances', () => {
    const store1 = createDataStore();
    const store2 = createDataStore();

    // Add data to store1 (first call applies immediately)
    const mockData = createMockFetchData(2, 0);
    store1.getState().addNewNode(mockData);

    // Verify store2 is unaffected
    expect(store1.getState().dataInitial?.nodes.length).toBe(2);
    expect(store2.getState().dataInitial).toBeNull();
  });

  test('should support store destruction without side effects', async () => {
    const store = createDataStore();
    const mockData = createMockFetchData(3, 2);
    
    // First call applies immediately
    store.getState().addNewNode(mockData);
    
    // Wait for any pending timers
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    expect(store.getState().dataInitial?.nodes.length).toBe(3);

    // Reset data (simulating cleanup)
    store.getState().resetData();
    
    expect(store.getState().dataInitial).toBeNull();
    expect(store.getState().nodesNormalized.size).toBe(0);
    expect(store.getState().linksNormalized.size).toBe(0);
  });
});

/**
 * Store Lifecycle Management Tests
 */
describe('createDataStore - Store Lifecycle', () => {
  test('should support resetData to clear all state', async () => {
    const store = createDataStore();
    
    // Add data (first call applies immediately)
    store.getState().addNewNode(createMockFetchData(5, 3));
    
    // Wait for batching timeout
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    expect(store.getState().dataInitial?.nodes.length).toBe(5);

    // Reset
    store.getState().resetData();

    // Verify all state cleared
    expect(store.getState().dataInitial).toBeNull();
    expect(store.getState().dataNew).toBeNull();
    expect(store.getState().nodesNormalized.size).toBe(0);
    expect(store.getState().linksNormalized.size).toBe(0);
    expect(store.getState().nodeLinksNormalized).toEqual({});
    expect(store.getState().nodeTypes).toEqual([]);
    expect(store.getState().sidebarFilters).toEqual([]);
  });

  test('should support resetGraph to clear data and filters', async () => {
    const store = createDataStore();
    
    // Add data and modify filters
    store.getState().addNewNode(createMockFetchData(3, 2));
    
    // Wait for batching timeout
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    store.getState().setFilters({ limit: 100, skip: 10 });
    
    expect(store.getState().dataInitial?.nodes.length).toBe(3);
    expect(store.getState().filters.limit).toBe(100);

    // Reset graph
    store.getState().resetGraph();

    // Both filters and data should be cleared
    expect(store.getState().dataInitial).toBeNull();
    expect(store.getState().dataNew).toBeNull();
    expect(store.getState().filters.limit).toBe(1000); // default
    expect(store.getState().filters.skip).toBe(0); // default
  });

  test('should maintain state consistency after multiple reset cycles', async () => {
    const store = createDataStore();
    
    // Cycle 1
    store.getState().addNewNode(createMockFetchData(3, 0));
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(store.getState().dataInitial?.nodes.length).toBe(3);
    
    store.getState().resetData();
    expect(store.getState().dataInitial).toBeNull();

    // Cycle 2
    store.getState().addNewNode(createMockFetchData(5, 0));
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(store.getState().dataInitial?.nodes.length).toBe(5);
    
    store.getState().resetData();
    expect(store.getState().dataInitial).toBeNull();

    // Cycle 3
    store.getState().addNewNode(createMockFetchData(2, 0));
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(store.getState().dataInitial?.nodes.length).toBe(2);
  });
});

/**
 * Repository Node Separation Tests
 */
describe('createDataStore - Repository Node Separation', () => {
  test('should separate repository nodes from regular graph nodes', async () => {
    const store = createDataStore();
    
    const mockData = {
      nodes: [
        createMockNode({ ref_id: 'node-1', node_type: 'TestType' }),
        createMockNode({ ref_id: 'node-2', node_type: 'GitHubRepo' }),
        createMockNode({ ref_id: 'node-3', node_type: 'Commits' }),
        createMockNode({ ref_id: 'node-4', node_type: 'TestType' }),
      ],
      edges: [],
    };

    store.getState().addNewNode(mockData);
    await new Promise(resolve => setTimeout(resolve, 1100));

    // Regular graph nodes
    expect(store.getState().dataInitial?.nodes.length).toBe(2);
    
    // Repository nodes
    expect(store.getState().repositoryNodes.length).toBe(2);
    expect(store.getState().repositoryNodes[0].node_type).toBe('GitHubRepo');
    expect(store.getState().repositoryNodes[1].node_type).toBe('Commits');
  });

  test('should handle all repository node types correctly', async () => {
    const store = createDataStore();
    const repoTypes = ['GitHubRepo', 'Commits', 'Stars', 'Issues', 'Age', 'Contributor'];
    
    const mockData = {
      nodes: repoTypes.map((type, i) => createMockNode({ ref_id: `node-${i}`, node_type: type })),
      edges: [],
    };

    store.getState().addNewNode(mockData);
    await new Promise(resolve => setTimeout(resolve, 1100));

    expect(store.getState().repositoryNodes.length).toBe(6);
    expect(store.getState().dataInitial?.nodes.length).toBe(0);
  });

  test('should not duplicate repository nodes on incremental updates', async () => {
    const store = createDataStore();
    const repoNode = createMockNode({ ref_id: 'repo-1', node_type: 'GitHubRepo' });

    store.getState().addNewNode({ nodes: [repoNode], edges: [] });
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    // Add same repo node again
    store.getState().addNewNode({ nodes: [repoNode], edges: [] });
    await new Promise(resolve => setTimeout(resolve, 1100));

    expect(store.getState().repositoryNodes.length).toBe(1);
  });

  test('should handle links between repository and regular nodes', async () => {
    const store = createDataStore();
    
    const mockData = {
      nodes: [
        createMockNode({ ref_id: 'node-regular', node_type: 'TestType' }),
        createMockNode({ ref_id: 'node-repo', node_type: 'GitHubRepo' }),
      ],
      edges: [
        createMockLink({ ref_id: 'link-1', source: 'node-regular', target: 'node-repo' }),
      ],
    };

    store.getState().addNewNode(mockData);
    await new Promise(resolve => setTimeout(resolve, 1100));

    // Link should be rejected because node-repo is not in nodesNormalized
    expect(store.getState().dataInitial?.links.length).toBe(0);
  });
});

/**
 * Node Type Ordering Tests
 */
describe.sequential('createDataStore - Node Type Ordering', () => {
  test('should apply custom node type ordering', async () => {
    const store = createDataStore();
    
    // Add nodes with unique IDs to avoid conflicts
    const mockData = {
      nodes: [
        createMockNode({ ref_id: 'ordering-node-1', node_type: 'TypeC' }),
        createMockNode({ ref_id: 'ordering-node-2', node_type: 'TypeA' }),
        createMockNode({ ref_id: 'ordering-node-3', node_type: 'TypeB' }),
      ],
      edges: [],
    };

    store.getState().addNewNode(mockData);
    
    // Wait for batch to be applied
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    // Verify data was applied
    expect(store.getState().dataInitial).not.toBeNull();
    expect(store.getState().dataInitial?.nodes.length).toBe(3);

    // Set custom order
    store.getState().setNodeTypeOrder([
      { type: 'TypeB', value: 0 },
      { type: 'TypeA', value: 1 },
      { type: 'TypeC', value: 2 },
    ]);

    // Verify order
    expect(store.getState().nodeTypes).toEqual(['TypeB', 'TypeA', 'TypeC']);
  });

  test('should re-sort existing nodeTypes when order changes', async () => {
    const store = createDataStore();
    
    const mockData = {
      nodes: [
        createMockNode({ ref_id: 'reorder-node-1', node_type: 'TypeC' }),
        createMockNode({ ref_id: 'reorder-node-2', node_type: 'TypeA' }),
      ],
      edges: [],
    };

    store.getState().addNewNode(mockData);
    
    // Wait for batch to be applied
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    // Verify data was applied
    expect(store.getState().dataInitial).not.toBeNull();
    expect(store.getState().dataInitial?.nodes.length).toBe(2);

    // Initial order (alphabetical)
    expect(store.getState().nodeTypes).toEqual(['TypeA', 'TypeC']);

    // Apply custom order
    store.getState().setNodeTypeOrder([
      { type: 'TypeC', value: 0 },
      { type: 'TypeA', value: 1 },
    ]);

    // Order should change
    expect(store.getState().nodeTypes).toEqual(['TypeC', 'TypeA']);
  });

  test('should update sidebarFilters when node type order changes', async () => {
    const store = createDataStore();
    
    const mockData = {
      nodes: [
        createMockNode({ ref_id: 'sidebar-node-1', node_type: 'TypeB' }),
        createMockNode({ ref_id: 'sidebar-node-2', node_type: 'TypeA' }),
      ],
      edges: [],
    };

    store.getState().addNewNode(mockData);
    
    // Wait for batch to be applied
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    // Verify data was applied
    expect(store.getState().dataInitial).not.toBeNull();
    expect(store.getState().dataInitial?.nodes.length).toBe(2);

    // Initial sidebar filters
    expect(store.getState().sidebarFilters).toEqual(['all', 'typea', 'typeb']);

    // Set custom order
    store.getState().setNodeTypeOrder([
      { type: 'TypeB', value: 0 },
      { type: 'TypeA', value: 1 },
    ]);

    // Sidebar filters should update order
    expect(store.getState().sidebarFilters).toEqual(['all', 'typeb', 'typea']);
  });
});

/**
 * updateNode Tests
 */
describe('createDataStore - updateNode', () => {
  test('should update existing node in nodesNormalized', async () => {
    const store = createDataStore();
    const node = createMockNode({ ref_id: 'node-1', name: 'Original Name' });

    store.getState().addNewNode({ nodes: [node], edges: [] });
    await new Promise(resolve => setTimeout(resolve, 1100));

    // Update node
    const updatedNode = { ...node, name: 'Updated Name' };
    store.getState().updateNode(updatedNode);

    const retrievedNode = store.getState().nodesNormalized.get('node-1');
    expect(retrievedNode?.name).toBe('Updated Name');
  });

  test('should preserve node relationships when updating', async () => {
    const store = createDataStore();
    
    const mockData = {
      nodes: [
        createMockNode({ ref_id: 'node-a' }),
        createMockNode({ ref_id: 'node-b' }),
      ],
      edges: [
        createMockLink({ ref_id: 'link-1', source: 'node-a', target: 'node-b' }),
      ],
    };

    store.getState().addNewNode(mockData);
    await new Promise(resolve => setTimeout(resolve, 1100));

    const nodeA = store.getState().nodesNormalized.get('node-a')!;
    
    // Update node - must spread existing properties to preserve relationships
    const updatedNodeA = { ...nodeA, name: 'Updated A' };
    store.getState().updateNode(updatedNodeA);

    const retrievedNode = store.getState().nodesNormalized.get('node-a')!;
    expect(retrievedNode.name).toBe('Updated A');
    expect(retrievedNode.targets).toContain('node-b');
  });

  test('should create new Map instance when updating node', async () => {
    const store = createDataStore();
    const node = createMockNode({ ref_id: 'node-1' });

    store.getState().addNewNode({ nodes: [node], edges: [] });
    await new Promise(resolve => setTimeout(resolve, 1100));

    const originalMap = store.getState().nodesNormalized;
    
    // Update node
    store.getState().updateNode({ ...node, name: 'Updated' });

    const updatedMap = store.getState().nodesNormalized;
    
    // Should be a new Map instance (immutability)
    expect(updatedMap).not.toBe(originalMap);
    expect(updatedMap.get('node-1')?.name).toBe('Updated');
  });
});

/**
 * Integration Tests
 */
describe('createDataStore - Integration Scenarios', () => {
  test('should handle complete graph lifecycle', async () => {
    const store = createDataStore();
    
    // 1. Initial data load
    store.getState().addNewNode(createMockFetchData(10, 5));
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(store.getState().dataInitial?.nodes.length).toBe(10);

    // 2. Incremental update
    store.getState().addNewNode(createMockFetchData(5, 3));
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(store.getState().dataInitial?.nodes.length).toBe(15);

    // 3. Filter application
    store.getState().setFilters({ limit: 20 });
    expect(store.getState().filters.limit).toBe(20);

    // 4. Node update
    const firstNode = store.getState().nodesNormalized.values().next().value;
    store.getState().updateNode({ ...firstNode, name: 'Updated Node' });
    expect(store.getState().nodesNormalized.get(firstNode.ref_id)?.name).toBe('Updated Node');

    // 5. Reset
    store.getState().resetData();
    expect(store.getState().dataInitial).toBeNull();
  });

  test('should handle concurrent operations safely', async () => {
    const store = createDataStore();
    
    // Concurrent addNewNode calls
    store.getState().addNewNode(createMockFetchData(5, 0));
    store.getState().setFilters({ limit: 50 });
    store.getState().addNewNode(createMockFetchData(3, 0));
    store.getState().setSidebarFilter('typea');
    
    await new Promise(resolve => setTimeout(resolve, 1100));

    // All operations should complete successfully
    expect(store.getState().dataInitial?.nodes.length).toBe(8);
    expect(store.getState().filters.limit).toBe(50);
    expect(store.getState().sidebarFilter).toBe('typea');
  });
});
