import { describe, test, expect, beforeEach } from 'vitest';
import { calculateGridMap } from '@/stores/createSimulationStore';

/**
 * Test utilities and mock data factories
 */

interface TestNode {
  ref_id: string;
  node_type: string;
  x?: number;
  y?: number;
  z?: number;
}

// Factory for creating mock nodes with node_type
const createMockNode = (overrides: Partial<TestNode> = {}): TestNode => ({
  ref_id: `node-${Math.random().toString(36).substr(2, 9)}`,
  node_type: 'DefaultType',
  x: 0,
  y: 0,
  z: 0,
  ...overrides,
});

// Factory for creating multiple nodes of specific types
const createMockNodesWithTypes = (
  counts: Record<string, number>
): { nodes: TestNode[]; nodeTypes: string[] } => {
  const nodes: TestNode[] = [];
  const nodeTypes: string[] = Object.keys(counts);

  nodeTypes.forEach((type) => {
    const count = counts[type];
    for (let i = 0; i < count; i++) {
      nodes.push(
        createMockNode({
          ref_id: `${type.toLowerCase()}-${i}`,
          node_type: type,
        })
      );
    }
  });

  return { nodes, nodeTypes };
};

/**
 * Unit tests for calculateGridMap
 */
describe('calculateGridMap', () => {
  describe('Basic Grid Layout', () => {
    test('should return a Map with all node ref_ids as keys', () => {
      const { nodes, nodeTypes } = createMockNodesWithTypes({
        TypeA: 3,
      });

      const gridMap = calculateGridMap(nodes, nodeTypes);

      expect(gridMap).toBeInstanceOf(Map);
      expect(gridMap.size).toBe(3);
      nodes.forEach((node) => {
        expect(gridMap.has(node.ref_id)).toBe(true);
      });
    });

    test('should return position objects with x, y, z coordinates', () => {
      const { nodes, nodeTypes } = createMockNodesWithTypes({
        TypeA: 2,
      });

      const gridMap = calculateGridMap(nodes, nodeTypes);

      gridMap.forEach((position) => {
        expect(position).toHaveProperty('x');
        expect(position).toHaveProperty('y');
        expect(position).toHaveProperty('z');
        expect(typeof position.x).toBe('number');
        expect(typeof position.y).toBe('number');
        expect(typeof position.z).toBe('number');
      });
    });

    test('should arrange nodes in square grid pattern', () => {
      // 4 nodes should form 2x2 grid
      const { nodes, nodeTypes } = createMockNodesWithTypes({
        TypeA: 4,
      });

      const gridMap = calculateGridMap(nodes, nodeTypes);
      const positions = Array.from(gridMap.values());

      // Check that we have 4 unique positions
      const uniqueXZ = new Set(positions.map((p) => `${p.x},${p.z}`));
      expect(uniqueXZ.size).toBe(4);

      // All nodes should be on the same Y layer
      const yValues = positions.map((p) => p.y);
      expect(new Set(yValues).size).toBe(1);
    });
  });

  describe('Node Type Grouping', () => {
    test('should separate different node types into different Y layers', () => {
      const { nodes, nodeTypes } = createMockNodesWithTypes({
        TypeA: 2,
        TypeB: 2,
      });

      const gridMap = calculateGridMap(nodes, nodeTypes);

      const typeANodes = nodes.filter((n) => n.node_type === 'TypeA');
      const typeBNodes = nodes.filter((n) => n.node_type === 'TypeB');

      const typeAPositions = typeANodes.map((n) => gridMap.get(n.ref_id)!);
      const typeBPositions = typeBNodes.map((n) => gridMap.get(n.ref_id)!);

      // All nodes of same type should have same Y coordinate
      const typeAYs = new Set(typeAPositions.map((p) => p.y));
      const typeBYs = new Set(typeBPositions.map((p) => p.y));

      expect(typeAYs.size).toBe(1);
      expect(typeBYs.size).toBe(1);

      // Different types should have different Y coordinates
      const [typeAY] = typeAYs;
      const [typeBY] = typeBYs;
      expect(typeAY).not.toBe(typeBY);
    });

    test('should maintain Y-layer separation of 500 units between types', () => {
      const { nodes, nodeTypes } = createMockNodesWithTypes({
        TypeA: 2,
        TypeB: 2,
      });

      const gridMap = calculateGridMap(nodes, nodeTypes);

      const typeANode = nodes.find((n) => n.node_type === 'TypeA')!;
      const typeBNode = nodes.find((n) => n.node_type === 'TypeB')!;

      const typeAPos = gridMap.get(typeANode.ref_id)!;
      const typeBPos = gridMap.get(typeBNode.ref_id)!;

      // Y difference should be 500 units
      expect(Math.abs(typeAPos.y - typeBPos.y)).toBe(500);
    });

    test('should position layers from top to bottom in order', () => {
      const { nodes, nodeTypes } = createMockNodesWithTypes({
        TypeA: 1, // typeIndex 0 -> y = +750 (top)
        TypeB: 1, // typeIndex 1 -> y = +250
        TypeC: 1, // typeIndex 2 -> y = -250
        TypeD: 1, // typeIndex 3 -> y = -750 (bottom)
      });

      const gridMap = calculateGridMap(nodes, nodeTypes);

      const positions = nodeTypes.map((type) => {
        const node = nodes.find((n) => n.node_type === type)!;
        return gridMap.get(node.ref_id)!;
      });

      // Top-to-bottom positioning: first type at top, last at bottom
      // With 4 types, startOffset = ((4-1)/2) * 500 = 750
      // TypeA (index 0): y = 750 - (0 * 500) = 750
      // TypeB (index 1): y = 750 - (1 * 500) = 250
      // TypeC (index 2): y = 750 - (2 * 500) = -250
      // TypeD (index 3): y = 750 - (3 * 500) = -750
      expect(positions[0].y).toBe(750);  // TypeA: top
      expect(positions[1].y).toBe(250);  // TypeB
      expect(positions[2].y).toBe(-250); // TypeC
      expect(positions[3].y).toBe(-750); // TypeD: bottom
    });
  });

  describe('Grid Spacing', () => {
    test('should use 300-unit spacing between adjacent nodes', () => {
      // 2 nodes in a row should be 300 units apart
      const { nodes, nodeTypes } = createMockNodesWithTypes({
        TypeA: 2,
      });

      const gridMap = calculateGridMap(nodes, nodeTypes);
      const positions = Array.from(gridMap.values());

      // Sort by x to get adjacent nodes
      positions.sort((a, b) => a.x - b.x);

      const distance = Math.abs(positions[1].x - positions[0].x);
      expect(distance).toBe(300);
    });

    test('should arrange 9 nodes in 3x3 grid with proper spacing', () => {
      const { nodes, nodeTypes } = createMockNodesWithTypes({
        TypeA: 9,
      });

      const gridMap = calculateGridMap(nodes, nodeTypes);
      const positions = Array.from(gridMap.values());

      // Count unique X and Z coordinates
      const uniqueXs = new Set(positions.map((p) => p.x));
      const uniqueZs = new Set(positions.map((p) => p.z));

      expect(uniqueXs.size).toBe(3); // 3 columns
      expect(uniqueZs.size).toBe(3); // 3 rows

      // Verify spacing between columns and rows
      const sortedXs = Array.from(uniqueXs).sort((a, b) => a - b);
      const sortedZs = Array.from(uniqueZs).sort((a, b) => a - b);

      for (let i = 1; i < sortedXs.length; i++) {
        expect(sortedXs[i] - sortedXs[i - 1]).toBe(300);
      }
      for (let i = 1; i < sortedZs.length; i++) {
        expect(sortedZs[i] - sortedZs[i - 1]).toBe(300);
      }
    });
  });

  describe('Grid Centering', () => {
    test('should center grid around origin for single type', () => {
      const { nodes, nodeTypes } = createMockNodesWithTypes({
        TypeA: 4, // 2x2 grid
      });

      const gridMap = calculateGridMap(nodes, nodeTypes);
      const positions = Array.from(gridMap.values());

      // Calculate center of mass
      const avgX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
      const avgZ = positions.reduce((sum, p) => sum + p.z, 0) / positions.length;

      // Center should be close to (0, 0) in X-Z plane
      expect(Math.abs(avgX)).toBeLessThan(1);
      expect(Math.abs(avgZ)).toBeLessThan(1);
    });

    test('should center grid around origin for multiple types', () => {
      const { nodes, nodeTypes } = createMockNodesWithTypes({
        TypeA: 4,
        TypeB: 4,
      });

      const gridMap = calculateGridMap(nodes, nodeTypes);
      const positions = Array.from(gridMap.values());

      // Calculate center of mass in X-Z plane
      const avgX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
      const avgZ = positions.reduce((sum, p) => sum + p.z, 0) / positions.length;

      expect(Math.abs(avgX)).toBeLessThan(1);
      expect(Math.abs(avgZ)).toBeLessThan(1);
    });

    test('should maintain Y-axis centering around 0 with positive and negative layers', () => {
      // Need at least 3 types to get both positive and negative Y values
      // TypeA: y=0, TypeB: y=500, TypeC: y=-500
      const { nodes, nodeTypes } = createMockNodesWithTypes({
        TypeA: 2,
        TypeB: 2,
        TypeC: 2,
      });

      const gridMap = calculateGridMap(nodes, nodeTypes);
      const positions = Array.from(gridMap.values());

      const yValues = positions.map((p) => p.y);
      const hasNegative = yValues.some((y) => y < 0);
      const hasPositive = yValues.some((y) => y > 0);

      // Should have both positive and negative Y values
      expect(hasNegative).toBe(true);
      expect(hasPositive).toBe(true);

      // Y values should be symmetric (balanced around 0)
      const avgY = yValues.reduce((sum, y) => sum + y, 0) / yValues.length;
      expect(Math.abs(avgY)).toBeLessThan(1);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty nodes array', () => {
      const gridMap = calculateGridMap([], []);

      expect(gridMap).toBeInstanceOf(Map);
      expect(gridMap.size).toBe(0);
    });

    test('should handle single node', () => {
      const nodes = [createMockNode({ ref_id: 'single', node_type: 'TypeA' })];
      const nodeTypes = ['TypeA'];

      const gridMap = calculateGridMap(nodes, nodeTypes);

      expect(gridMap.size).toBe(1);
      const position = gridMap.get('single')!;

      // Single node should be centered at origin
      expect(position.x).toBe(0);
      expect(position.z).toBe(0);
      expect(position.y).toBe(0); // Single type is centered at Y=0
    });

    test('should handle single type with multiple nodes', () => {
      const { nodes, nodeTypes } = createMockNodesWithTypes({
        TypeA: 5,
      });

      const gridMap = calculateGridMap(nodes, nodeTypes);

      expect(gridMap.size).toBe(5);

      // All nodes should be on same Y layer
      const positions = Array.from(gridMap.values());
      const yValues = new Set(positions.map((p) => p.y));
      expect(yValues.size).toBe(1);
    });

    test('should handle many types with different node counts', () => {
      const { nodes, nodeTypes } = createMockNodesWithTypes({
        TypeA: 1,
        TypeB: 4,
        TypeC: 9,
        TypeD: 2,
      });

      const gridMap = calculateGridMap(nodes, nodeTypes);

      expect(gridMap.size).toBe(16);

      // Each type should have its own Y layer
      const typeYMapping = new Map<string, number>();
      nodes.forEach((node) => {
        const pos = gridMap.get(node.ref_id)!;
        if (!typeYMapping.has(node.node_type)) {
          typeYMapping.set(node.node_type, pos.y);
        } else {
          // All nodes of same type should have same Y
          expect(pos.y).toBe(typeYMapping.get(node.node_type));
        }
      });

      expect(typeYMapping.size).toBe(4);
    });

    test('should handle non-square grids correctly', () => {
      // 6 nodes should form 3x2 grid (ceil(sqrt(6)) = 3)
      const { nodes, nodeTypes } = createMockNodesWithTypes({
        TypeA: 6,
      });

      const gridMap = calculateGridMap(nodes, nodeTypes);
      const positions = Array.from(gridMap.values());

      const uniqueXs = new Set(positions.map((p) => p.x));
      const uniqueZs = new Set(positions.map((p) => p.z));

      expect(uniqueXs.size).toBe(3); // 3 columns
      expect(uniqueZs.size).toBe(2); // 2 rows
    });

    test('should handle type not in nodeTypes array', () => {
      const nodes = [
        createMockNode({ ref_id: 'node1', node_type: 'TypeX' }), // TypeX not in nodeTypes
      ];
      const nodeTypes = ['TypeA', 'TypeB'];

      const gridMap = calculateGridMap(nodes, nodeTypes);

      expect(gridMap.size).toBe(1);
      // Should still create position even if type not found (indexOf returns -1, +1 = 0)
      const position = gridMap.get('node1')!;
      expect(position).toBeDefined();
      expect(typeof position.x).toBe('number');
      expect(typeof position.y).toBe('number');
      expect(typeof position.z).toBe('number');
    });
  });

  describe('Position Calculation Accuracy', () => {
    test('should calculate correct typeIndex for position calculations', () => {
      const { nodes, nodeTypes } = createMockNodesWithTypes({
        TypeA: 1,
        TypeB: 1,
        TypeC: 1,
      });

      const gridMap = calculateGridMap(nodes, nodeTypes);

      // Top-to-bottom positioning with 3 types:
      // startOffset = ((3-1)/2) * 500 = 500
      // TypeA (index 0): y = 500 - (0 * 500) = 500 (top)
      // TypeB (index 1): y = 500 - (1 * 500) = 0 (center)
      // TypeC (index 2): y = 500 - (2 * 500) = -500 (bottom)

      const typeAPos = gridMap.get(nodes.find(n => n.node_type === 'TypeA')!.ref_id)!;
      const typeBPos = gridMap.get(nodes.find(n => n.node_type === 'TypeB')!.ref_id)!;
      const typeCPos = gridMap.get(nodes.find(n => n.node_type === 'TypeC')!.ref_id)!;

      expect(typeAPos.y).toBe(500);  // TypeA: top
      expect(typeBPos.y).toBe(0);    // TypeB: center
      expect(typeCPos.y).toBe(-500); // TypeC: bottom
    });

    test('should maintain consistent positions for same node configuration', () => {
      const { nodes, nodeTypes } = createMockNodesWithTypes({
        TypeA: 4,
      });

      const gridMap1 = calculateGridMap(nodes, nodeTypes);
      const gridMap2 = calculateGridMap(nodes, nodeTypes);

      // Should produce identical results
      expect(gridMap1.size).toBe(gridMap2.size);
      nodes.forEach((node) => {
        const pos1 = gridMap1.get(node.ref_id)!;
        const pos2 = gridMap2.get(node.ref_id)!;
        expect(pos1.x).toBe(pos2.x);
        expect(pos1.y).toBe(pos2.y);
        expect(pos1.z).toBe(pos2.z);
      });
    });
  });

  describe('Performance', () => {
    test('should handle large node counts efficiently', () => {
      const { nodes, nodeTypes } = createMockNodesWithTypes({
        TypeA: 100,
        TypeB: 100,
        TypeC: 100,
      });

      const startTime = performance.now();
      const gridMap = calculateGridMap(nodes, nodeTypes);
      const endTime = performance.now();

      const duration = endTime - startTime;

      expect(gridMap.size).toBe(300);
      // Should complete in reasonable time (< 100ms for 300 nodes)
      expect(duration).toBeLessThan(100);
    });

    test('should maintain O(1) lookup performance', () => {
      const { nodes, nodeTypes } = createMockNodesWithTypes({
        TypeA: 100,
      });

      const gridMap = calculateGridMap(nodes, nodeTypes);

      const startTime = performance.now();

      // Test 100 random lookups
      for (let i = 0; i < 100; i++) {
        const randomNode = nodes[Math.floor(Math.random() * nodes.length)];
        const position = gridMap.get(randomNode.ref_id);
        expect(position).toBeDefined();
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // 100 lookups should be fast (< 100ms in test environments)
      // Note: Test environments are slower than production, adjusted threshold
      expect(duration).toBeLessThan(100);
    });
  });
});
