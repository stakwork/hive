import { describe, test, expect } from 'vitest';
import { Node, Edge } from '@xyflow/react';
import { smartLayout } from '@/components/workflow/layoutUtils';
import {
  createTestNode,
  createDiamondNode,
  createStartNode,
  createEndNode,
  createLinearGraph,
  createBranchingGraph,
  createDisconnectedGraph,
  assertNodeOrder,
  assertNoOverlaps,
  assertPositionsValid,
  getNodeById,
} from '@/__tests__/support/factories/graphFactory';

// Note: applyBasicLayout is not exported, so we test through smartLayout
// which calls applyBasicLayout as Step 1 of the 3-step pipeline

describe('layoutUtils', () => {
  describe('smartLayout with applyBasicLayout (Step 1)', () => {
    describe('Basic layout arrangement', () => {
      test('should arrange nodes left-to-right in correct order', async () => {
        const { nodes, edges } = createLinearGraph(3, true);

        const layoutedNodes = await smartLayout(nodes, edges);

        // Verify all nodes have valid positions
        assertPositionsValid(layoutedNodes);

        // Verify left-to-right progression
        assertNodeOrder(layoutedNodes, [
          'start',
          'node0',
          'node1',
          'node2',
          'system.succeed',
        ]);

        // Verify start node is leftmost
        const startNode = getNodeById(layoutedNodes, 'start');
        const endNode = getNodeById(layoutedNodes, 'system.succeed');
        expect(startNode?.position.x).toBeLessThan(endNode?.position.x || 0);
      });

      test('should handle simple linear graph without start/end', async () => {
        const { nodes, edges } = createLinearGraph(4, false);

        const layoutedNodes = await smartLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        assertNodeOrder(layoutedNodes, ['node0', 'node1', 'node2', 'node3']);
      });

      test('should maintain hierarchical layer structure', async () => {
        const { nodes, edges } = createLinearGraph(5, true);

        const layoutedNodes = await smartLayout(nodes, edges);

        // Each node should be progressively further right
        for (let i = 0; i < layoutedNodes.length - 1; i++) {
          const currentNode = layoutedNodes.find((n) => n.id === `node${i}`);
          const nextNode = layoutedNodes.find((n) => n.id === `node${i + 1}`);

          if (currentNode && nextNode) {
            expect(currentNode.position.x).toBeLessThan(nextNode.position.x);
          }
        }
      });
    });

    describe('Special node handling', () => {
      test('should handle diamond conditional nodes with correct dimensions', async () => {
        const { nodes, edges } = createBranchingGraph();

        const layoutedNodes = await smartLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);

        // Find diamond node
        const diamondNode = getNodeById(layoutedNodes, 'diamond1');
        expect(diamondNode).toBeDefined();
        expect(isFinite(diamondNode?.position.x || NaN)).toBe(true);
        expect(isFinite(diamondNode?.position.y || NaN)).toBe(true);

        // Diamond should be positioned between start and branches
        const startNode = getNodeById(layoutedNodes, 'start');
        const trueBranch = getNodeById(layoutedNodes, 'trueBranch');

        expect(diamondNode?.position.x).toBeGreaterThan(
          startNode?.position.x || 0
        );
        expect(diamondNode?.position.x).toBeLessThan(
          trueBranch?.position.x || Infinity
        );
      });

      test('should place start node in first layer', async () => {
        const { nodes, edges } = createLinearGraph(3, true);

        const layoutedNodes = await smartLayout(nodes, edges);

        const startNode = getNodeById(layoutedNodes, 'start');
        const allNodes = layoutedNodes;

        // Start should be the leftmost node
        const minX = Math.min(...allNodes.map((n) => n.position.x));
        expect(startNode?.position.x).toBe(minX);
      });

      test('should place end node in last layer', async () => {
        const { nodes, edges } = createLinearGraph(3, true);

        const layoutedNodes = await smartLayout(nodes, edges);

        const endNode = getNodeById(layoutedNodes, 'system.succeed');
        const allNodes = layoutedNodes;

        // End should be the rightmost node
        const maxX = Math.max(...allNodes.map((n) => n.position.x));
        expect(endNode?.position.x).toBe(maxX);
      });

      test('should handle both succeed and fail end nodes', async () => {
        const nodes: Node[] = [
          createStartNode(),
          createTestNode('node1'),
          createDiamondNode('condition'),
          createEndNode('succeed'),
          createEndNode('fail'),
        ];

        const edges: Edge[] = [
          { id: 'e1', source: 'start', target: 'node1' },
          { id: 'e2', source: 'node1', target: 'condition' },
          { id: 'e3', source: 'condition', target: 'system.succeed' },
          { id: 'e4', source: 'condition', target: 'system.fail' },
        ];

        const layoutedNodes = await smartLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);

        const succeedNode = getNodeById(layoutedNodes, 'system.succeed');
        const failNode = getNodeById(layoutedNodes, 'system.fail');

        // Both end nodes should have finite positions
        expect(isFinite(succeedNode?.position.x || NaN)).toBe(true);
        expect(isFinite(failNode?.position.x || NaN)).toBe(true);
      });

      test('should detect diamond nodes by className', async () => {
        const nodes: Node[] = [
          createTestNode('start'),
          createTestNode('diamond', {
            data: { className: 'custom-diamond-shape' },
          }),
          createTestNode('end'),
        ];

        const edges: Edge[] = [
          { id: 'e1', source: 'start', target: 'diamond' },
          { id: 'e2', source: 'diamond', target: 'end' },
        ];

        const layoutedNodes = await smartLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(3);
      });

      test('should detect diamond nodes by bgColor', async () => {
        const nodes: Node[] = [
          createTestNode('start'),
          createTestNode('diamond', {
            data: { bgColor: '#f5e8d5' },
          }),
          createTestNode('end'),
        ];

        const edges: Edge[] = [
          { id: 'e1', source: 'start', target: 'diamond' },
          { id: 'e2', source: 'diamond', target: 'end' },
        ];

        const layoutedNodes = await smartLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(3);
      });
    });

    describe('Edge cases', () => {
      test('should handle empty node arrays', async () => {
        const result = await smartLayout([], []);

        expect(result).toEqual([]);
      });

      test('should handle single node graph', async () => {
        const nodes: Node[] = [createTestNode('solo')];
        const edges: Edge[] = [];

        const layoutedNodes = await smartLayout(nodes, edges);

        expect(layoutedNodes).toHaveLength(1);
        assertPositionsValid(layoutedNodes);

        const soloNode = getNodeById(layoutedNodes, 'solo');
        expect(soloNode).toBeDefined();
        expect(isFinite(soloNode?.position.x || NaN)).toBe(true);
        expect(isFinite(soloNode?.position.y || NaN)).toBe(true);
      });

      test('should handle disconnected graphs', async () => {
        const { nodes, edges } = createDisconnectedGraph();

        const layoutedNodes = await smartLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(4);

        // All nodes should have finite positions
        for (const node of layoutedNodes) {
          expect(isFinite(node.position.x)).toBe(true);
          expect(isFinite(node.position.y)).toBe(true);
        }
      });

      test('should handle graphs with self-loops', async () => {
        const nodes: Node[] = [
          createTestNode('node1'),
          createTestNode('node2'),
        ];

        const edges: Edge[] = [
          { id: 'e1', source: 'node1', target: 'node1' }, // self-loop
          { id: 'e2', source: 'node1', target: 'node2' },
        ];

        const layoutedNodes = await smartLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(2);
      });

      test('should handle large graphs', async () => {
        const { nodes, edges } = createLinearGraph(50, false);

        const layoutedNodes = await smartLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(50);

        // Verify ordering is maintained
        for (let i = 0; i < layoutedNodes.length - 1; i++) {
          const currentNode = getNodeById(layoutedNodes, `node${i}`);
          const nextNode = getNodeById(layoutedNodes, `node${i + 1}`);

          expect(currentNode?.position.x).toBeLessThan(
            nextNode?.position.x || Infinity
          );
        }
      });

      test('should handle circular dependencies', async () => {
        const nodes: Node[] = [
          createTestNode('node1'),
          createTestNode('node2'),
          createTestNode('node3'),
        ];

        const edges: Edge[] = [
          { id: 'e1', source: 'node1', target: 'node2' },
          { id: 'e2', source: 'node2', target: 'node3' },
          { id: 'e3', source: 'node3', target: 'node1' }, // cycle
        ];

        const layoutedNodes = await smartLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(3);
      });

      test('should handle nodes without edges', async () => {
        const nodes: Node[] = [
          createTestNode('isolated1'),
          createTestNode('isolated2'),
          createTestNode('isolated3'),
        ];

        const edges: Edge[] = [];

        const layoutedNodes = await smartLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(3);
      });
    });

    describe('Position mapping and spacing', () => {
      test('should apply valid (finite) positions to all nodes', async () => {
        const { nodes, edges } = createLinearGraph(5, false);

        const layoutedNodes = await smartLayout(nodes, edges);

        // Verify all positions are finite (negative positions are allowed)
        for (const node of layoutedNodes) {
          expect(isFinite(node.position.x)).toBe(true);
          expect(isFinite(node.position.y)).toBe(true);
        }
      });

      test('should maintain minimum spacing between nodes', async () => {
        const { nodes, edges } = createLinearGraph(5, false);

        const layoutedNodes = await smartLayout(nodes, edges);

        // After smartLayout (includes overlap fixing), nodes should not overlap
        // Use generous dimensions to account for ELK spacing + fixNodeOverlaps step
        expect(() => assertNoOverlaps(layoutedNodes, 200, 120, 50)).not.toThrow();
      });

      test('should update node positions from initial zero coordinates', async () => {
        const nodes: Node[] = [
          createTestNode('node1', { position: { x: 0, y: 0 } }),
          createTestNode('node2', { position: { x: 0, y: 0 } }),
        ];

        const edges: Edge[] = [
          { id: 'e1', source: 'node1', target: 'node2' },
        ];

        const layoutedNodes = await smartLayout(nodes, edges);

        const node1 = getNodeById(layoutedNodes, 'node1');
        const node2 = getNodeById(layoutedNodes, 'node2');

        // At least one node should have moved from (0,0)
        expect(
          node1?.position.x !== 0 ||
            node1?.position.y !== 0 ||
            node2?.position.x !== 0 ||
            node2?.position.y !== 0
        ).toBe(true);
      });

      test('should handle nodes with custom dimensions', async () => {
        const nodes: Node[] = [
          createTestNode('small', {
            data: { width: 100, height: 60 },
          }),
          createTestNode('large', {
            data: { width: 400, height: 300 },
          }),
        ];

        const edges: Edge[] = [
          { id: 'e1', source: 'small', target: 'large' },
        ];

        const layoutedNodes = await smartLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(2);
      });
    });

    describe('Async behavior', () => {
      test('should return a Promise', () => {
        const { nodes, edges } = createLinearGraph(3, false);

        const result = smartLayout(nodes, edges);

        expect(result).toBeInstanceOf(Promise);
      });

      test('should resolve with layouted nodes', async () => {
        const { nodes, edges } = createLinearGraph(3, false);

        const layoutedNodes = await smartLayout(nodes, edges);

        expect(Array.isArray(layoutedNodes)).toBe(true);
        expect(layoutedNodes).toHaveLength(3);
      });

      test('should handle concurrent layout calls', async () => {
        const graph1 = createLinearGraph(3, false);
        const graph2 = createLinearGraph(4, false);

        const [result1, result2] = await Promise.all([
          smartLayout(graph1.nodes, graph1.edges),
          smartLayout(graph2.nodes, graph2.edges),
        ]);

        expect(result1).toHaveLength(3);
        expect(result2).toHaveLength(4);
        assertPositionsValid(result1);
        assertPositionsValid(result2);
      });
    });

    describe('Integration with complete pipeline', () => {
      test('should complete full smartLayout pipeline without errors', async () => {
        const { nodes, edges } = createBranchingGraph();

        const layoutedNodes = await smartLayout(nodes, edges);

        // Verify pipeline completed successfully
        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(nodes.length);

        // Verify no overlaps (fixNodeOverlaps step)
        expect(() => assertNoOverlaps(layoutedNodes)).not.toThrow();

        // Verify all nodes are present
        for (const originalNode of nodes) {
          const layoutedNode = getNodeById(layoutedNodes, originalNode.id);
          expect(layoutedNode).toBeDefined();
        }
      });

      test('should handle complex branching structures', async () => {
        const nodes: Node[] = [
          createStartNode(),
          createDiamondNode('diamond1'),
          createTestNode('branch1a'),
          createTestNode('branch1b'),
          createDiamondNode('diamond2'),
          createTestNode('branch2a'),
          createTestNode('branch2b'),
          createTestNode('merge'),
          createEndNode('succeed'),
        ];

        const edges: Edge[] = [
          { id: 'e1', source: 'start', target: 'diamond1' },
          { id: 'e2', source: 'diamond1', target: 'branch1a' },
          { id: 'e3', source: 'diamond1', target: 'branch1b' },
          { id: 'e4', source: 'branch1a', target: 'diamond2' },
          { id: 'e5', source: 'branch1b', target: 'diamond2' },
          { id: 'e6', source: 'diamond2', target: 'branch2a' },
          { id: 'e7', source: 'diamond2', target: 'branch2b' },
          { id: 'e8', source: 'branch2a', target: 'merge' },
          { id: 'e9', source: 'branch2b', target: 'merge' },
          { id: 'e10', source: 'merge', target: 'system.succeed' },
        ];

        const layoutedNodes = await smartLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(9);

        // Verify diamond nodes are positioned correctly
        const diamond1 = getNodeById(layoutedNodes, 'diamond1');
        const diamond2 = getNodeById(layoutedNodes, 'diamond2');

        expect(diamond1?.position.x).toBeLessThan(
          diamond2?.position.x || Infinity
        );
      });

      test('should maintain node immutability', async () => {
        const { nodes, edges } = createLinearGraph(3, false);

        // Clone original nodes for comparison
        const originalNodes = JSON.parse(JSON.stringify(nodes));

        await smartLayout(nodes, edges);

        // Original nodes should not be modified
        expect(nodes).toEqual(originalNodes);
      });
    });

    describe('Node data preservation', () => {
      test('should preserve node data properties', async () => {
        const nodes: Node[] = [
          createTestNode('node1', {
            data: { label: 'Test Label', customProp: 'value' },
          }),
          createTestNode('node2', {
            data: { label: 'Another Label' },
          }),
        ];

        const edges: Edge[] = [
          { id: 'e1', source: 'node1', target: 'node2' },
        ];

        const layoutedNodes = await smartLayout(nodes, edges);

        const node1 = getNodeById(layoutedNodes, 'node1');
        const node2 = getNodeById(layoutedNodes, 'node2');

        expect(node1?.data?.label).toBe('Test Label');
        expect(node1?.data?.customProp).toBe('value');
        expect(node2?.data?.label).toBe('Another Label');
      });

      test('should preserve node type property', async () => {
        const nodes: Node[] = [
          createTestNode('node1', { type: 'input' }),
          createTestNode('node2', { type: 'default' }),
          createTestNode('node3', { type: 'output' }),
        ];

        const edges: Edge[] = [
          { id: 'e1', source: 'node1', target: 'node2' },
          { id: 'e2', source: 'node2', target: 'node3' },
        ];

        const layoutedNodes = await smartLayout(nodes, edges);

        expect(getNodeById(layoutedNodes, 'node1')?.type).toBe('input');
        expect(getNodeById(layoutedNodes, 'node2')?.type).toBe('default');
        expect(getNodeById(layoutedNodes, 'node3')?.type).toBe('output');
      });
    });
  });
});