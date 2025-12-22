import { describe, test, expect } from 'vitest';
import { Node, Edge } from '@xyflow/react';
import { smartLayout, applyBasicLayout } from '@/components/workflow/layoutUtils';
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

describe('layoutUtils', () => {
  describe('applyBasicLayout', () => {
    describe('Basic layout functionality', () => {
      test('should arrange nodes left-to-right using ELK layered algorithm', async () => {
        const { nodes, edges } = createLinearGraph(3, false);

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        assertNodeOrder(layoutedNodes, ['node0', 'node1', 'node2']);
      });

      test('should apply positions to all nodes', async () => {
        const { nodes, edges } = createLinearGraph(4, false);

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        expect(layoutedNodes).toHaveLength(4);
        for (const node of layoutedNodes) {
          expect(isFinite(node.position.x)).toBe(true);
          expect(isFinite(node.position.y)).toBe(true);
        }
      });

      test('should preserve node count', async () => {
        const { nodes, edges } = createLinearGraph(5, true);

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        expect(layoutedNodes).toHaveLength(nodes.length);
      });

      test('should preserve node IDs', async () => {
        const { nodes, edges } = createLinearGraph(3, false);
        const originalIds = nodes.map((n) => n.id);

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        const resultIds = layoutedNodes.map((n) => n.id);
        expect(resultIds.sort()).toEqual(originalIds.sort());
      });

      test('should preserve node data', async () => {
        const nodes: Node[] = [
          createTestNode('node1', { data: { label: 'Label 1', custom: 'value' } }),
          createTestNode('node2', { data: { label: 'Label 2' } }),
        ];
        const edges: Edge[] = [{ id: 'e1', source: 'node1', target: 'node2' }];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        const node1 = getNodeById(layoutedNodes, 'node1');
        const node2 = getNodeById(layoutedNodes, 'node2');

        expect(node1?.data?.label).toBe('Label 1');
        expect(node1?.data?.custom).toBe('value');
        expect(node2?.data?.label).toBe('Label 2');
      });
    });

    describe('Special node detection and handling', () => {
      test('should detect diamond nodes by stepType IfCondition', async () => {
        const nodes: Node[] = [
          createTestNode('start'),
          createTestNode('diamond', { data: { stepType: 'IfCondition' } }),
          createTestNode('end'),
        ];
        const edges: Edge[] = [
          { id: 'e1', source: 'start', target: 'diamond' },
          { id: 'e2', source: 'diamond', target: 'end' },
        ];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(3);
      });

      test('should detect diamond nodes by stepType IfElseCondition', async () => {
        const nodes: Node[] = [
          createTestNode('start'),
          createTestNode('diamond', { data: { stepType: 'IfElseCondition' } }),
          createTestNode('end'),
        ];
        const edges: Edge[] = [
          { id: 'e1', source: 'start', target: 'diamond' },
          { id: 'e2', source: 'diamond', target: 'end' },
        ];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(3);
      });

      test('should detect diamond nodes by className containing diamond', async () => {
        const nodes: Node[] = [
          createTestNode('start'),
          createTestNode('diamond', { data: { className: 'custom-diamond-shape' } }),
          createTestNode('end'),
        ];
        const edges: Edge[] = [
          { id: 'e1', source: 'start', target: 'diamond' },
          { id: 'e2', source: 'diamond', target: 'end' },
        ];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(3);
      });

      test('should detect diamond nodes by bgColor', async () => {
        const nodes: Node[] = [
          createTestNode('start'),
          createTestNode('diamond', { data: { bgColor: '#f5e8d5' } }),
          createTestNode('end'),
        ];
        const edges: Edge[] = [
          { id: 'e1', source: 'start', target: 'diamond' },
          { id: 'e2', source: 'diamond', target: 'end' },
        ];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(3);
      });

      test('should detect start node by id', async () => {
        const { nodes, edges } = createLinearGraph(3, true);

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        const startNode = getNodeById(layoutedNodes, 'start');
        expect(startNode).toBeDefined();
        assertPositionsValid(layoutedNodes);
      });

      test('should detect end nodes by id (system.succeed)', async () => {
        const { nodes, edges } = createLinearGraph(3, true);

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        const endNode = getNodeById(layoutedNodes, 'system.succeed');
        expect(endNode).toBeDefined();
        assertPositionsValid(layoutedNodes);
      });

      test('should detect end nodes by id (system.fail)', async () => {
        const nodes: Node[] = [
          createStartNode(),
          createTestNode('node1'),
          createEndNode('fail'),
        ];
        const edges: Edge[] = [
          { id: 'e1', source: 'start', target: 'node1' },
          { id: 'e2', source: 'node1', target: 'system.fail' },
        ];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        const endNode = getNodeById(layoutedNodes, 'system.fail');
        expect(endNode).toBeDefined();
        assertPositionsValid(layoutedNodes);
      });
    });

    describe('Node dimensions', () => {
      test('should use default dimensions for regular nodes (200x120)', async () => {
        const nodes: Node[] = [createTestNode('node1')];
        const edges: Edge[] = [];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(1);
      });

      test('should use diamond dimensions (170x170) for conditional nodes', async () => {
        const nodes: Node[] = [createDiamondNode('diamond1')];
        const edges: Edge[] = [];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(1);
      });

      test('should use custom width and height from node data', async () => {
        const nodes: Node[] = [
          createTestNode('custom', {
            data: { width: 300, height: 200 },
          }),
        ];
        const edges: Edge[] = [];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(1);
      });

      test('should handle mixed node dimensions', async () => {
        const nodes: Node[] = [
          createTestNode('regular'),
          createDiamondNode('diamond'),
          createTestNode('custom', { data: { width: 400, height: 300 } }),
        ];
        const edges: Edge[] = [
          { id: 'e1', source: 'regular', target: 'diamond' },
          { id: 'e2', source: 'diamond', target: 'custom' },
        ];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(3);
      });
    });

    describe('Layer constraints', () => {
      test('should place start node in first layer (leftmost)', async () => {
        const { nodes, edges } = createLinearGraph(3, true);

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        const startNode = getNodeById(layoutedNodes, 'start');
        const minX = Math.min(...layoutedNodes.map((n) => n.position.x));

        expect(startNode?.position.x).toBe(minX);
      });

      test('should place end node in last layer (rightmost)', async () => {
        const { nodes, edges } = createLinearGraph(3, true);

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        const endNode = getNodeById(layoutedNodes, 'system.succeed');
        const maxX = Math.max(...layoutedNodes.map((n) => n.position.x));

        expect(endNode?.position.x).toBe(maxX);
      });

      test('should handle multiple end nodes (succeed and fail)', async () => {
        const nodes: Node[] = [
          createStartNode(),
          createDiamondNode('condition'),
          createEndNode('succeed'),
          createEndNode('fail'),
        ];
        const edges: Edge[] = [
          { id: 'e1', source: 'start', target: 'condition' },
          { id: 'e2', source: 'condition', target: 'system.succeed' },
          { id: 'e3', source: 'condition', target: 'system.fail' },
        ];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);

        const succeedNode = getNodeById(layoutedNodes, 'system.succeed');
        const failNode = getNodeById(layoutedNodes, 'system.fail');
        const startNode = getNodeById(layoutedNodes, 'start');

        expect(succeedNode?.position.x).toBeGreaterThan(startNode?.position.x || 0);
        expect(failNode?.position.x).toBeGreaterThan(startNode?.position.x || 0);
      });
    });

    describe('Edge handling', () => {
      test('should handle graphs with no edges', async () => {
        const nodes: Node[] = [
          createTestNode('isolated1'),
          createTestNode('isolated2'),
          createTestNode('isolated3'),
        ];
        const edges: Edge[] = [];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(3);
      });

      test('should handle single edge', async () => {
        const nodes: Node[] = [
          createTestNode('node1'),
          createTestNode('node2'),
        ];
        const edges: Edge[] = [
          { id: 'e1', source: 'node1', target: 'node2' },
        ];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        assertNodeOrder(layoutedNodes, ['node1', 'node2']);
      });

      test('should handle multiple edges from same node (branching)', async () => {
        const { nodes, edges } = createBranchingGraph();

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(nodes.length);
      });

      test('should handle converging edges (multiple sources to one target)', async () => {
        const nodes: Node[] = [
          createTestNode('node1'),
          createTestNode('node2'),
          createTestNode('merge'),
        ];
        const edges: Edge[] = [
          { id: 'e1', source: 'node1', target: 'merge' },
          { id: 'e2', source: 'node2', target: 'merge' },
        ];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(3);
      });

      test('should handle self-loops', async () => {
        const nodes: Node[] = [
          createTestNode('node1'),
          createTestNode('node2'),
        ];
        const edges: Edge[] = [
          { id: 'e1', source: 'node1', target: 'node1' },
          { id: 'e2', source: 'node1', target: 'node2' },
        ];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(2);
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
          { id: 'e3', source: 'node3', target: 'node1' },
        ];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(3);
      });
    });

    describe('Edge cases', () => {
      test('should handle empty node array', async () => {
        const result = await applyBasicLayout([], []);

        expect(result).toEqual([]);
      });

      test('should handle single node with no edges', async () => {
        const nodes: Node[] = [createTestNode('solo')];
        const edges: Edge[] = [];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        expect(layoutedNodes).toHaveLength(1);
        assertPositionsValid(layoutedNodes);
      });

      test('should handle disconnected graph components', async () => {
        const { nodes, edges } = createDisconnectedGraph();

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(4);
      });

      test('should handle large graphs efficiently', async () => {
        const { nodes, edges } = createLinearGraph(100, false);

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(100);
      });

      test('should handle nodes with missing data properties', async () => {
        const nodes: Node[] = [
          { id: 'node1', position: { x: 0, y: 0 }, data: {} },
          { id: 'node2', position: { x: 0, y: 0 }, data: {} },
        ];
        const edges: Edge[] = [
          { id: 'e1', source: 'node1', target: 'node2' },
        ];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(2);
      });

      test('should handle nodes with undefined data', async () => {
        const nodes: Node[] = [
          { id: 'node1', position: { x: 0, y: 0 }, data: undefined },
          { id: 'node2', position: { x: 0, y: 0 }, data: undefined },
        ];
        const edges: Edge[] = [
          { id: 'e1', source: 'node1', target: 'node2' },
        ];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(2);
      });
    });

    describe('Position mapping', () => {
      test('should map ELK positions to node positions', async () => {
        const { nodes, edges } = createLinearGraph(3, false);

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        // All nodes should have updated positions
        for (const node of layoutedNodes) {
          expect(node.position).toBeDefined();
          expect(typeof node.position.x).toBe('number');
          expect(typeof node.position.y).toBe('number');
        }
      });

      test('should not modify original nodes', async () => {
        const { nodes, edges } = createLinearGraph(3, false);
        const originalNodes = JSON.parse(JSON.stringify(nodes));

        await applyBasicLayout(nodes, edges);

        expect(nodes).toEqual(originalNodes);
      });

      test('should update positions from initial (0,0)', async () => {
        const nodes: Node[] = [
          createTestNode('node1', { position: { x: 0, y: 0 } }),
          createTestNode('node2', { position: { x: 0, y: 0 } }),
        ];
        const edges: Edge[] = [
          { id: 'e1', source: 'node1', target: 'node2' },
        ];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        const node1 = getNodeById(layoutedNodes, 'node1');
        const node2 = getNodeById(layoutedNodes, 'node2');

        // At least one should have non-zero position
        expect(
          node1?.position.x !== 0 ||
            node1?.position.y !== 0 ||
            node2?.position.x !== 0 ||
            node2?.position.y !== 0
        ).toBe(true);
      });

      test('should handle missing layouted node gracefully', async () => {
        // Create a scenario where ELK might not return a position for a node
        const nodes: Node[] = [createTestNode('node1')];
        const edges: Edge[] = [];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        // Should still return the node even if layout fails
        expect(layoutedNodes).toHaveLength(1);
        expect(getNodeById(layoutedNodes, 'node1')).toBeDefined();
      });
    });

    describe('Complex graph structures', () => {
      test('should handle diamond with multiple branches', async () => {
        const { nodes, edges } = createBranchingGraph();

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);

        const diamond = getNodeById(layoutedNodes, 'diamond1');
        const trueBranch = getNodeById(layoutedNodes, 'trueBranch');
        const falseBranch = getNodeById(layoutedNodes, 'falseBranch');

        expect(diamond?.position.x).toBeLessThan(trueBranch?.position.x || Infinity);
        expect(diamond?.position.x).toBeLessThan(falseBranch?.position.x || Infinity);
      });

      test('should handle nested conditionals', async () => {
        const nodes: Node[] = [
          createStartNode(),
          createDiamondNode('diamond1'),
          createTestNode('node1'),
          createDiamondNode('diamond2'),
          createTestNode('node2'),
          createTestNode('node3'),
          createEndNode('succeed'),
        ];
        const edges: Edge[] = [
          { id: 'e1', source: 'start', target: 'diamond1' },
          { id: 'e2', source: 'diamond1', target: 'node1' },
          { id: 'e3', source: 'diamond1', target: 'diamond2' },
          { id: 'e4', source: 'diamond2', target: 'node2' },
          { id: 'e5', source: 'diamond2', target: 'node3' },
          { id: 'e6', source: 'node1', target: 'system.succeed' },
          { id: 'e7', source: 'node2', target: 'system.succeed' },
          { id: 'e8', source: 'node3', target: 'system.succeed' },
        ];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(7);
      });

      test('should handle parallel branches with merge', async () => {
        const nodes: Node[] = [
          createStartNode(),
          createTestNode('parallel1'),
          createTestNode('parallel2'),
          createTestNode('merge'),
          createEndNode('succeed'),
        ];
        const edges: Edge[] = [
          { id: 'e1', source: 'start', target: 'parallel1' },
          { id: 'e2', source: 'start', target: 'parallel2' },
          { id: 'e3', source: 'parallel1', target: 'merge' },
          { id: 'e4', source: 'parallel2', target: 'merge' },
          { id: 'e5', source: 'merge', target: 'system.succeed' },
        ];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        assertPositionsValid(layoutedNodes);
        expect(layoutedNodes).toHaveLength(5);
      });
    });

    describe('Async behavior', () => {
      test('should return a Promise', () => {
        const { nodes, edges } = createLinearGraph(3, false);

        const result = applyBasicLayout(nodes, edges);

        expect(result).toBeInstanceOf(Promise);
      });

      test('should resolve with layouted nodes', async () => {
        const { nodes, edges } = createLinearGraph(3, false);

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        expect(Array.isArray(layoutedNodes)).toBe(true);
        expect(layoutedNodes).toHaveLength(3);
      });

      test('should handle concurrent calls', async () => {
        const graph1 = createLinearGraph(3, false);
        const graph2 = createLinearGraph(5, false);

        const [result1, result2] = await Promise.all([
          applyBasicLayout(graph1.nodes, graph1.edges),
          applyBasicLayout(graph2.nodes, graph2.edges),
        ]);

        expect(result1).toHaveLength(3);
        expect(result2).toHaveLength(5);
        assertPositionsValid(result1);
        assertPositionsValid(result2);
      });
    });

    describe('Type handling', () => {
      test('should handle nodes with type property', async () => {
        const nodes: Node[] = [
          createTestNode('node1', { type: 'input' }),
          createTestNode('node2', { type: 'default' }),
          createTestNode('node3', { type: 'output' }),
        ];
        const edges: Edge[] = [
          { id: 'e1', source: 'node1', target: 'node2' },
          { id: 'e2', source: 'node2', target: 'node3' },
        ];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        expect(getNodeById(layoutedNodes, 'node1')?.type).toBe('input');
        expect(getNodeById(layoutedNodes, 'node2')?.type).toBe('default');
        expect(getNodeById(layoutedNodes, 'node3')?.type).toBe('output');
      });

      test('should preserve all node properties', async () => {
        const nodes: Node[] = [
          createTestNode('node1', {
            type: 'custom',
            data: { foo: 'bar', nested: { prop: 'value' } },
            draggable: false,
            selectable: true,
          }),
        ];
        const edges: Edge[] = [];

        const layoutedNodes = await applyBasicLayout(nodes, edges);

        const node1 = getNodeById(layoutedNodes, 'node1');
        expect(node1?.type).toBe('custom');
        expect(node1?.data?.foo).toBe('bar');
        expect(node1?.data?.nested?.prop).toBe('value');
        expect(node1?.draggable).toBe(false);
        expect(node1?.selectable).toBe(true);
      });
    });
  });

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
