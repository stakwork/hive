import { Node, Edge } from '@xyflow/react';

/**
 * Graph Factory for Workflow Layout Testing
 * 
 * Provides test data factories and assertion helpers for testing workflow
 * layout algorithms, specifically the applyBasicLayout function in layoutUtils.ts.
 */

// ============================================================================
// Node Factories
// ============================================================================

/**
 * Creates a basic test node with customizable properties
 */
export function createTestNode(
  id: string,
  overrides?: Partial<Node>
): Node {
  return {
    id,
    type: 'stepNode',
    position: { x: 0, y: 0 },
    data: {
      label: id,
      ...overrides?.data,
    },
    ...overrides,
  };
}

/**
 * Creates a diamond/conditional node with proper dimensions and styling
 */
export function createDiamondNode(
  id: string,
  overrides?: Partial<Node>
): Node {
  return createTestNode(id, {
    data: {
      label: id,
      stepType: 'IfCondition',
      className: 'diamond',
      bgColor: '#f5e8d5',
      width: 170,
      height: 170,
      ...overrides?.data,
    },
    ...overrides,
  });
}

/**
 * Creates a start node (should be constrained to FIRST layer)
 */
export function createStartNode(overrides?: Partial<Node>): Node {
  return createTestNode('start', {
    data: {
      label: 'Start',
      ...overrides?.data,
    },
    ...overrides,
  });
}

/**
 * Creates an end node (should be constrained to LAST layer)
 */
export function createEndNode(
  type: 'succeed' | 'fail' = 'succeed',
  overrides?: Partial<Node>
): Node {
  const id = type === 'succeed' ? 'system.succeed' : 'system.fail';
  return createTestNode(id, {
    data: {
      label: type === 'succeed' ? 'Success' : 'Failure',
      ...overrides?.data,
    },
    ...overrides,
  });
}

// ============================================================================
// Graph Factories
// ============================================================================

/**
 * Creates a simple linear graph: node0 -> node1 -> ... -> nodeN
 * Optionally includes start and end nodes
 */
export function createLinearGraph(
  nodeCount: number,
  includeStartEnd: boolean = false
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Add start node if requested
  if (includeStartEnd) {
    nodes.push(createStartNode());
  }

  // Add regular nodes
  for (let i = 0; i < nodeCount; i++) {
    nodes.push(createTestNode(`node${i}`));
  }

  // Add end node if requested
  if (includeStartEnd) {
    nodes.push(createEndNode('succeed'));
  }

  // Create edges
  const allNodes = nodes;
  for (let i = 0; i < allNodes.length - 1; i++) {
    edges.push({
      id: `e${i}`,
      source: allNodes[i].id,
      target: allNodes[i + 1].id,
    });
  }

  return { nodes, edges };
}

/**
 * Creates a branching graph with a diamond conditional node:
 * start -> diamond -> trueBranch/falseBranch -> merge -> end
 */
export function createBranchingGraph(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    createStartNode(),
    createDiamondNode('diamond1'),
    createTestNode('trueBranch'),
    createTestNode('falseBranch'),
    createTestNode('merge'),
    createEndNode('succeed'),
  ];

  const edges: Edge[] = [
    { id: 'e1', source: 'start', target: 'diamond1' },
    { id: 'e2', source: 'diamond1', target: 'trueBranch' },
    { id: 'e3', source: 'diamond1', target: 'falseBranch' },
    { id: 'e4', source: 'trueBranch', target: 'merge' },
    { id: 'e5', source: 'falseBranch', target: 'merge' },
    { id: 'e6', source: 'merge', target: 'system.succeed' },
  ];

  return { nodes, edges };
}

/**
 * Creates a graph with disconnected components
 */
export function createDisconnectedGraph(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    createTestNode('isolated1'),
    createTestNode('isolated2'),
    createTestNode('connected1'),
    createTestNode('connected2'),
  ];

  const edges: Edge[] = [
    { id: 'e1', source: 'connected1', target: 'connected2' },
  ];

  return { nodes, edges };
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Asserts that all nodes have valid (finite) positions
 */
export function assertPositionsValid(nodes: Node[]): void {
  for (const node of nodes) {
    if (!isFinite(node.position.x)) {
      throw new Error(`Node ${node.id} has invalid x position: ${node.position.x}`);
    }
    if (!isFinite(node.position.y)) {
      throw new Error(`Node ${node.id} has invalid y position: ${node.position.y}`);
    }
  }
}

/**
 * Asserts that nodes are ordered left-to-right according to the given ID array
 */
export function assertNodeOrder(nodes: Node[], expectedOrder: string[]): void {
  const orderedNodes = expectedOrder
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is Node => n !== undefined);

  for (let i = 0; i < orderedNodes.length - 1; i++) {
    const current = orderedNodes[i];
    const next = orderedNodes[i + 1];

    if (current.position.x >= next.position.x) {
      throw new Error(
        `Node order violation: ${current.id} (x=${current.position.x}) should be left of ${next.id} (x=${next.position.x})`
      );
    }
  }
}

/**
 * Asserts that no nodes overlap (collision detection)
 * 
 * @param nodes - Array of nodes to check
 * @param defaultWidth - Default node width (200)
 * @param defaultHeight - Default node height (120)
 * @param minSpacing - Minimum spacing between nodes (50)
 */
export function assertNoOverlaps(
  nodes: Node[],
  defaultWidth: number = 200,
  defaultHeight: number = 120,
  minSpacing: number = 50
): void {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const nodeA = nodes[i];
      const nodeB = nodes[j];

      const widthA = (nodeA.data?.width as number) || defaultWidth;
      const heightA = (nodeA.data?.height as number) || defaultHeight;
      const widthB = (nodeB.data?.width as number) || defaultWidth;
      const heightB = (nodeB.data?.height as number) || defaultHeight;

      // Calculate bounding boxes with spacing buffer
      const aLeft = nodeA.position.x - minSpacing;
      const aRight = nodeA.position.x + widthA + minSpacing;
      const aTop = nodeA.position.y - minSpacing;
      const aBottom = nodeA.position.y + heightA + minSpacing;

      const bLeft = nodeB.position.x - minSpacing;
      const bRight = nodeB.position.x + widthB + minSpacing;
      const bTop = nodeB.position.y - minSpacing;
      const bBottom = nodeB.position.y + heightB + minSpacing;

      // Check for overlap
      const overlapsX = aLeft < bRight && aRight > bLeft;
      const overlapsY = aTop < bBottom && aBottom > bTop;

      if (overlapsX && overlapsY) {
        throw new Error(
          `Nodes ${nodeA.id} and ${nodeB.id} overlap! ` +
          `Node A: (${nodeA.position.x}, ${nodeA.position.y}) ${widthA}x${heightA}, ` +
          `Node B: (${nodeB.position.x}, ${nodeB.position.y}) ${widthB}x${heightB}`
        );
      }
    }
  }
}

/**
 * Gets a node by ID from an array of nodes
 */
export function getNodeById(nodes: Node[], id: string): Node | undefined {
  return nodes.find((n) => n.id === id);
}

/**
 * Calculates the distance between two nodes
 */
export function getNodeDistance(nodeA: Node, nodeB: Node): number {
  const dx = nodeA.position.x - nodeB.position.x;
  const dy = nodeA.position.y - nodeB.position.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Gets the bounding box of all nodes
 */
export function getGraphBounds(nodes: Node[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
} {
  if (nodes.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    const width = (node.data?.width as number) || 200;
    const height = (node.data?.height as number) || 120;

    minX = Math.min(minX, node.position.x);
    maxX = Math.max(maxX, node.position.x + width);
    minY = Math.min(minY, node.position.y);
    maxY = Math.max(maxY, node.position.y + height);
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
