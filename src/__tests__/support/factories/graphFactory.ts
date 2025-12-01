import { Node, Edge } from '@xyflow/react';

/**
 * Test data factories for graph layout testing
 */

/**
 * Create a basic test node with configurable properties
 */
export const createTestNode = (
  id: string,
  overrides: Partial<Node> = {}
): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: {},
  ...overrides,
});

/**
 * Create a diamond/conditional node with proper stepType and dimensions
 */
export const createDiamondNode = (
  id: string,
  overrides: Partial<Node> = {}
): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: {
    stepType: 'IfCondition',
    width: 170,
    height: 170,
    bgColor: '#f5e8d5',
  },
  ...overrides,
});

/**
 * Create a start node with FIRST layer constraint
 */
export const createStartNode = (overrides: Partial<Node> = {}): Node => ({
  id: 'start',
  position: { x: 0, y: 0 },
  data: {},
  ...overrides,
});

/**
 * Create an end node (succeed or fail)
 */
export const createEndNode = (
  type: 'succeed' | 'fail' = 'succeed',
  overrides: Partial<Node> = {}
): Node => ({
  id: type === 'succeed' ? 'system.succeed' : 'system.fail',
  position: { x: 0, y: 0 },
  data: {},
  ...overrides,
});

/**
 * Create a linear graph with sequential nodes
 */
export const createLinearGraph = (
  nodeCount: number,
  includeStartEnd: boolean = false
): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  if (includeStartEnd && nodeCount > 0) {
    // Add start node
    nodes.push(createStartNode());

    // Add middle nodes
    for (let i = 0; i < nodeCount; i++) {
      nodes.push(createTestNode(`node${i}`));
    }

    // Add end node
    nodes.push(createEndNode('succeed'));

    // Create edges connecting all nodes
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({
        id: `e${i}`,
        source: nodes[i].id,
        target: nodes[i + 1].id,
      });
    }
  } else {
    // Create simple linear graph without start/end
    for (let i = 0; i < nodeCount; i++) {
      nodes.push(createTestNode(`node${i}`));
    }

    // Create edges
    for (let i = 0; i < nodeCount - 1; i++) {
      edges.push({
        id: `e${i}`,
        source: `node${i}`,
        target: `node${i + 1}`,
      });
    }
  }

  return { nodes, edges };
};

/**
 * Create a branching graph with a diamond conditional node
 */
export const createBranchingGraph = (): {
  nodes: Node[];
  edges: Edge[];
} => {
  const nodes: Node[] = [
    createStartNode(),
    createTestNode('node1'),
    createDiamondNode('diamond1'),
    createTestNode('trueBranch'),
    createTestNode('falseBranch'),
    createTestNode('merge'),
    createEndNode('succeed'),
  ];

  const edges: Edge[] = [
    { id: 'e1', source: 'start', target: 'node1' },
    { id: 'e2', source: 'node1', target: 'diamond1' },
    { id: 'e3', source: 'diamond1', target: 'trueBranch' },
    { id: 'e4', source: 'diamond1', target: 'falseBranch' },
    { id: 'e5', source: 'trueBranch', target: 'merge' },
    { id: 'e6', source: 'falseBranch', target: 'merge' },
    { id: 'e7', source: 'merge', target: 'system.succeed' },
  ];

  return { nodes, edges };
};

/**
 * Create a disconnected graph with multiple subgraphs
 */
export const createDisconnectedGraph = (): {
  nodes: Node[];
  edges: Edge[];
} => {
  const nodes: Node[] = [
    createTestNode('a1'),
    createTestNode('a2'),
    createTestNode('b1'),
    createTestNode('b2'),
  ];

  const edges: Edge[] = [
    { id: 'ea1', source: 'a1', target: 'a2' },
    { id: 'eb1', source: 'b1', target: 'b2' },
  ];

  return { nodes, edges };
};

/**
 * Assert that nodes are ordered left-to-right as expected
 */
export const assertNodeOrder = (
  layoutedNodes: Node[],
  expectedOrder: string[]
): void => {
  const sortedByX = [...layoutedNodes].sort(
    (a, b) => a.position.x - b.position.x
  );
  const actualOrder = sortedByX.map((n) => n.id);

  if (JSON.stringify(actualOrder) !== JSON.stringify(expectedOrder)) {
    throw new Error(
      `Node order mismatch.\nExpected: ${expectedOrder.join(' → ')}\nActual: ${actualOrder.join(' → ')}`
    );
  }
};

/**
 * Assert that no nodes overlap with each other
 */
export const assertNoOverlaps = (
  nodes: Node[],
  nodeWidth: number = 200,
  nodeHeight: number = 120,
  padding: number = 50
): void => {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const nodeA = nodes[i];
      const nodeB = nodes[j];

      const xOverlap =
        Math.abs(nodeA.position.x - nodeB.position.x) < nodeWidth + padding;
      const yOverlap =
        Math.abs(nodeA.position.y - nodeB.position.y) < nodeHeight + padding;

      if (xOverlap && yOverlap) {
        throw new Error(
          `Overlap detected between ${nodeA.id} (${nodeA.position.x}, ${nodeA.position.y}) and ${nodeB.id} (${nodeB.position.x}, ${nodeB.position.y})`
        );
      }
    }
  }
};

/**
 * Assert all node positions are valid (defined and finite)
 * Note: Negative positions are allowed - the layout algorithm may position nodes
 * in negative space, which is valid for SVG/canvas rendering
 */
export const assertPositionsValid = (nodes: Node[]): void => {
  for (const node of nodes) {
    if (
      node.position.x === undefined ||
      node.position.y === undefined ||
      !isFinite(node.position.x) ||
      !isFinite(node.position.y)
    ) {
      throw new Error(
        `Invalid position for node ${node.id}: (${node.position.x}, ${node.position.y})`
      );
    }
  }
};

/**
 * Get node by id from array
 */
export const getNodeById = (nodes: Node[], id: string): Node | undefined => {
  return nodes.find((n) => n.id === id);
};