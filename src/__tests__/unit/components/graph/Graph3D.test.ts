import { describe, test, expect } from 'vitest';
// NOTE: assignNodesToLayers is not exported from Graph3D.tsx
// This test file requires the function to be exported in a separate PR
// TODO: Export assignNodesToLayers from src/app/w/[slug]/graph/Graph3D.tsx
// import { assignNodesToLayers } from '@/app/w/[slug]/graph/Graph3D';

// Test node factory
interface TestNode {
  id: string;
  name: string;
  type: string;
  x?: number;
  y?: number;
  z?: number;
}

function createTestNode(id: string, type: string): TestNode {
  return {
    id,
    name: `Test ${type} ${id}`,
    type,
  };
}

function createTestNodes(types: Array<{ type: string; count: number }>): TestNode[] {
  const nodes: TestNode[] = [];
  let idCounter = 1;

  types.forEach(({ type, count }) => {
    for (let i = 0; i < count; i++) {
      nodes.push(createTestNode(`node${idCounter++}`, type));
    }
  });

  return nodes;
}

// Skip entire test suite until assignNodesToLayers is exported
describe.skip('assignNodesToLayers', () => {
  describe('single node type', () => {
    test('assigns all nodes of single type to middle layer (layer 1)', () => {
      const nodes = createTestNodes([{ type: 'Repository', count: 5 }]);

      const result = assignNodesToLayers(nodes);

      expect(result.size).toBe(5);
      nodes.forEach((node) => {
        expect(result.get(node.id)).toBe(1);
      });
    });

    test('assigns single node to middle layer', () => {
      const nodes = [createTestNode('node1', 'Class')];

      const result = assignNodesToLayers(nodes);

      expect(result.size).toBe(1);
      expect(result.get('node1')).toBe(1);
    });
  });

  describe('two node types', () => {
    test('assigns higher priority type to back layer (0) and lower priority to front layer (2)', () => {
      // Repository has priority 1 (high), Unittest has priority 17 (low)
      const nodes = createTestNodes([
        { type: 'Repository', count: 3 },
        { type: 'Unittest', count: 3 },
      ]);

      const result = assignNodesToLayers(nodes);

      expect(result.size).toBe(6);

      // Repository (priority 1) should be in layer 0 (back)
      nodes
        .filter((n) => n.type === 'Repository')
        .forEach((node) => {
          expect(result.get(node.id)).toBe(0);
        });

      // Unittest (priority 17) should be in layer 2 (front)
      nodes
        .filter((n) => n.type === 'Unittest')
        .forEach((node) => {
          expect(result.get(node.id)).toBe(2);
        });
    });

    test('handles two types with similar priorities', () => {
      // Class (priority 10) vs Trait (priority 11)
      const nodes = createTestNodes([
        { type: 'Class', count: 2 },
        { type: 'Trait', count: 2 },
      ]);

      const result = assignNodesToLayers(nodes);

      expect(result.size).toBe(4);

      // Class (higher priority) should be in layer 0
      nodes
        .filter((n) => n.type === 'Class')
        .forEach((node) => {
          expect(result.get(node.id)).toBe(0);
        });

      // Trait (lower priority) should be in layer 2
      nodes
        .filter((n) => n.type === 'Trait')
        .forEach((node) => {
          expect(result.get(node.id)).toBe(2);
        });
    });
  });

  describe('three or more node types', () => {
    test('distributes three types across all three layers', () => {
      const nodes = createTestNodes([
        { type: 'Repository', count: 2 }, // Priority 1
        { type: 'Class', count: 2 }, // Priority 10
        { type: 'Unittest', count: 2 }, // Priority 17
      ]);

      const result = assignNodesToLayers(nodes);

      expect(result.size).toBe(6);

      // Verify all three layers are used
      const layersUsed = new Set(Array.from(result.values()));
      expect(layersUsed.size).toBe(3);
      expect(layersUsed.has(0)).toBe(true);
      expect(layersUsed.has(1)).toBe(true);
      expect(layersUsed.has(2)).toBe(true);
    });

    test('respects priority ordering - highest priority types assigned to earlier layers', () => {
      const nodes = createTestNodes([
        { type: 'Repository', count: 1 }, // Priority 1 (highest)
        { type: 'Language', count: 1 }, // Priority 2
        { type: 'Package', count: 1 }, // Priority 3
        { type: 'Class', count: 1 }, // Priority 10
        { type: 'Unittest', count: 1 }, // Priority 17
        { type: 'E2etest', count: 1 }, // Priority 18 (lowest)
      ]);

      const result = assignNodesToLayers(nodes);

      // Get layer assignments for each type
      const repositoryLayer = result.get('node1'); // Repository
      const languageLayer = result.get('node2'); // Language
      const packageLayer = result.get('node3'); // Package
      const classLayer = result.get('node4'); // Class
      const unittestLayer = result.get('node5'); // Unittest
      const e2etestLayer = result.get('node6'); // E2etest

      // Higher priority types should be in lower or equal layer numbers
      expect(repositoryLayer).toBeDefined();
      expect(languageLayer).toBeDefined();
      expect(packageLayer).toBeDefined();
      expect(classLayer).toBeDefined();
      expect(unittestLayer).toBeDefined();
      expect(e2etestLayer).toBeDefined();

      // Verify Repository (highest priority) is in layer 0
      expect(repositoryLayer).toBe(0);

      // Verify test types (lowest priority) tend toward higher layer numbers
      expect(unittestLayer).toBeGreaterThanOrEqual(1);
      expect(e2etestLayer).toBeGreaterThanOrEqual(1);
    });

    test('balances node counts across layers using greedy algorithm', () => {
      // Create uneven distribution: one type with many nodes, others with few
      const nodes = createTestNodes([
        { type: 'Repository', count: 10 }, // Priority 1
        { type: 'Class', count: 2 }, // Priority 10
        { type: 'Function', count: 2 }, // Priority 13
        { type: 'Unittest', count: 2 }, // Priority 17
      ]);

      const result = assignNodesToLayers(nodes);

      // Count nodes per layer
      const layerCounts = [0, 0, 0];
      result.forEach((layer) => {
        layerCounts[layer]++;
      });

      // All three layers should be used
      expect(layerCounts[0]).toBeGreaterThan(0);
      expect(layerCounts[1]).toBeGreaterThan(0);
      expect(layerCounts[2]).toBeGreaterThan(0);

      // Repository (10 nodes) should be split to balance, not all in one layer
      // The algorithm should distribute types to balance node counts
      const maxCount = Math.max(...layerCounts);
      const minCount = Math.min(...layerCounts);

      // Verify balancing - difference shouldn't be too extreme
      // (exact values depend on greedy algorithm implementation)
      expect(maxCount - minCount).toBeLessThanOrEqual(10);
    });

    test('ensures all layers get at least one type when 3+ types exist', () => {
      const nodes = createTestNodes([
        { type: 'Repository', count: 1 },
        { type: 'Class', count: 1 },
        { type: 'Unittest', count: 1 },
      ]);

      const result = assignNodesToLayers(nodes);

      const layersUsed = new Set(Array.from(result.values()));
      expect(layersUsed.size).toBe(3);
    });

    test('handles many types with varied node counts', () => {
      const nodes = createTestNodes([
        { type: 'Repository', count: 5 },
        { type: 'Language', count: 3 },
        { type: 'Package', count: 8 },
        { type: 'Directory', count: 2 },
        { type: 'File', count: 15 },
        { type: 'Class', count: 4 },
        { type: 'Function', count: 20 },
        { type: 'Unittest', count: 10 },
      ]);

      const result = assignNodesToLayers(nodes);

      expect(result.size).toBe(67);

      // Verify all nodes are assigned
      nodes.forEach((node) => {
        const layer = result.get(node.id);
        expect(layer).toBeDefined();
        expect(layer).toBeGreaterThanOrEqual(0);
        expect(layer).toBeLessThanOrEqual(2);
      });

      // Verify all three layers are used
      const layersUsed = new Set(Array.from(result.values()));
      expect(layersUsed.size).toBe(3);
    });
  });

  describe('edge cases', () => {
    test('handles empty node array', () => {
      const nodes: TestNode[] = [];

      const result = assignNodesToLayers(nodes);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    test('handles single node of any type', () => {
      const nodes = [createTestNode('single', 'Function')];

      const result = assignNodesToLayers(nodes);

      expect(result.size).toBe(1);
      expect(result.get('single')).toBe(1); // Single type → middle layer
    });

    test('handles unknown node types (not in NODE_TYPE_PRIORITIES)', () => {
      const nodes = createTestNodes([
        { type: 'UnknownType1', count: 2 },
        { type: 'UnknownType2', count: 2 },
      ]);

      const result = assignNodesToLayers(nodes);

      expect(result.size).toBe(4);

      // Unknown types should still be assigned to valid layers (0, 1, or 2)
      nodes.forEach((node) => {
        const layer = result.get(node.id);
        expect(layer).toBeDefined();
        expect(layer).toBeGreaterThanOrEqual(0);
        expect(layer).toBeLessThanOrEqual(2);
      });
    });

    test('handles mix of known and unknown types', () => {
      const nodes = createTestNodes([
        { type: 'Repository', count: 2 }, // Known, priority 1
        { type: 'UnknownType', count: 2 }, // Unknown, priority 999
        { type: 'Unittest', count: 2 }, // Known, priority 17
      ]);

      const result = assignNodesToLayers(nodes);

      expect(result.size).toBe(6);

      // Known types with defined priorities should still be ordered correctly
      const repositoryNodes = nodes.filter((n) => n.type === 'Repository');
      const repositoryLayer = result.get(repositoryNodes[0].id);

      expect(repositoryLayer).toBe(0); // Highest priority → layer 0
    });

    test('handles large number of nodes', () => {
      const nodes = createTestNodes([
        { type: 'Repository', count: 100 },
        { type: 'Class', count: 200 },
        { type: 'Function', count: 500 },
        { type: 'Unittest', count: 300 },
      ]);

      const result = assignNodesToLayers(nodes);

      expect(result.size).toBe(1100);

      // All nodes should be assigned to valid layers
      nodes.forEach((node) => {
        const layer = result.get(node.id);
        expect(layer).toBeGreaterThanOrEqual(0);
        expect(layer).toBeLessThanOrEqual(2);
      });
    });
  });

  describe('return type verification', () => {
    test('returns Map instance', () => {
      const nodes = createTestNodes([{ type: 'Class', count: 3 }]);

      const result = assignNodesToLayers(nodes);

      expect(result).toBeInstanceOf(Map);
    });

    test('Map keys are node IDs (strings)', () => {
      const nodes = createTestNodes([
        { type: 'Repository', count: 2 },
        { type: 'Unittest', count: 2 },
      ]);

      const result = assignNodesToLayers(nodes);

      expect(result.size).toBe(4);

      // Verify all keys are the node IDs
      nodes.forEach((node) => {
        expect(result.has(node.id)).toBe(true);
      });
    });

    test('Map values are layer numbers (0, 1, or 2)', () => {
      const nodes = createTestNodes([
        { type: 'Repository', count: 5 },
        { type: 'Class', count: 5 },
        { type: 'Unittest', count: 5 },
      ]);

      const result = assignNodesToLayers(nodes);

      // All values should be valid layer numbers
      result.forEach((layer, nodeId) => {
        expect(typeof layer).toBe('number');
        expect(layer).toBeGreaterThanOrEqual(0);
        expect(layer).toBeLessThanOrEqual(2);
        expect([0, 1, 2]).toContain(layer);
      });
    });

    test('each node ID appears exactly once in the result map', () => {
      const nodes = createTestNodes([
        { type: 'Repository', count: 3 },
        { type: 'Class', count: 3 },
      ]);

      const result = assignNodesToLayers(nodes);

      // Map size should equal number of input nodes
      expect(result.size).toBe(nodes.length);

      // Each node ID should appear exactly once
      const nodeIds = new Set(nodes.map((n) => n.id));
      const resultIds = new Set(result.keys());

      expect(resultIds.size).toBe(nodeIds.size);
      nodeIds.forEach((id) => {
        expect(resultIds.has(id)).toBe(true);
      });
    });
  });

  describe('deterministic behavior', () => {
    test('produces same result for identical input', () => {
      const nodes = createTestNodes([
        { type: 'Repository', count: 5 },
        { type: 'Class', count: 5 },
        { type: 'Function', count: 5 },
        { type: 'Unittest', count: 5 },
      ]);

      const result1 = assignNodesToLayers(nodes);
      const result2 = assignNodesToLayers(nodes);

      expect(result1.size).toBe(result2.size);

      // Verify each node gets the same layer assignment
      nodes.forEach((node) => {
        expect(result1.get(node.id)).toBe(result2.get(node.id));
      });
    });
  });
});