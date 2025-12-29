/**
 * Shared test utilities for DataStore tests
 * 
 * This module provides reusable factories and helpers for testing
 * graph node/link state management in createDataStore and useDataStore.
 */

import { FetchDataResponse, Node, Link } from '@Universe/types';
import { useDataStore } from '@/stores/useDataStore';

/**
 * Factory for creating mock graph nodes
 * 
 * @param overrides - Optional properties to override default values
 * @returns A mock Node object with test data
 * 
 * @example
 * const node = createMockNode({ ref_id: 'test-node-1', node_type: 'Function' });
 */
export const createMockNode = (overrides: Partial<Node> = {}): Node => ({
  ref_id: `node-${Math.random().toString(36).substr(2, 9)}`,
  name: 'Test Node',
  label: 'Test Label',
  node_type: 'TestType',
  x: 0,
  y: 0,
  z: 0,
  edge_count: 0,
  ...overrides,
});

/**
 * Factory for creating mock graph links/edges
 * 
 * @param overrides - Optional properties to override default values
 * @returns A mock Link object with test data
 * 
 * @example
 * const link = createMockLink({ source: 'node-a', target: 'node-b', edge_type: 'imports' });
 */
export const createMockLink = (overrides: Partial<Link> = {}): Link => ({
  ref_id: `link-${Math.random().toString(36).substr(2, 9)}`,
  source: 'node-source',
  target: 'node-target',
  edge_type: 'test_relation',
  ...overrides,
});

/**
 * Factory for creating mock FetchDataResponse with multiple nodes and edges
 * 
 * Creates realistic test data with proper relationships between nodes.
 * Nodes alternate between TypeA and TypeB, edges alternate between relation_a and relation_b.
 * 
 * @param nodeCount - Number of nodes to generate (default: 0)
 * @param edgeCount - Number of edges to generate (default: 0)
 * @param overrides - Optional properties to override response structure
 * @returns A mock FetchDataResponse with generated nodes and edges
 * 
 * @example
 * // Create 5 nodes with 3 edges
 * const data = createMockFetchData(5, 3);
 * 
 * // Create empty response
 * const empty = createMockFetchData();
 * 
 * // Create with custom overrides
 * const custom = createMockFetchData(2, 1, { custom_field: 'value' });
 */
export const createMockFetchData = (
  nodeCount: number = 0,
  edgeCount: number = 0,
  overrides: Partial<FetchDataResponse> = {}
): FetchDataResponse => {
  // Use timestamp + random to ensure unique IDs across all test calls
  const batchId = `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  
  const nodes: Node[] = Array(nodeCount)
    .fill(null)
    .map((_, i) =>
      createMockNode({
        ref_id: `node-${batchId}-${i}`,
        name: `Node ${i}`,
        node_type: i % 2 === 0 ? 'TypeA' : 'TypeB',
      })
    );

  const edges: Link[] = Array(edgeCount)
    .fill(null)
    .map((_, i) =>
      createMockLink({
        ref_id: `link-${batchId}-${i}`,
        source: `node-${batchId}-${i}`,
        target: `node-${batchId}-${Math.min(i + 1, nodeCount - 1)}`,
        edge_type: i % 2 === 0 ? 'relation_a' : 'relation_b',
      })
    );

  return {
    nodes,
    edges,
    ...overrides,
  };
};

/**
 * Helper to inspect DataStore state for testing
 * 
 * Provides a snapshot of key store metrics for assertions.
 * Useful for verifying state changes after operations.
 * 
 * @returns Object containing store state metrics
 * 
 * @example
 * const before = inspectDataStore();
 * store.addNewNode(data);
 * const after = inspectDataStore();
 * 
 * expect(after.nodeCount).toBeGreaterThan(before.nodeCount);
 */
export const inspectDataStore = () => {
  const state = useDataStore.getState();
  return {
    nodeCount: state.dataInitial?.nodes.length || 0,
    edgeCount: state.dataInitial?.links.length || 0,
    normalizedNodeCount: state.nodesNormalized.size,
    normalizedLinkCount: state.linksNormalized.size,
    nodeLinksKeys: Object.keys(state.nodeLinksNormalized).length,
    nodeTypes: state.nodeTypes,
    linkTypes: state.linkTypes,
    sidebarFilters: state.sidebarFilters,
    sidebarFilterCounts: state.sidebarFilterCounts,
    dataNew: state.dataNew,
    repositoryNodes: state.repositoryNodes,
  };
};
