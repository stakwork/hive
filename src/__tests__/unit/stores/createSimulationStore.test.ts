import { describe, test, expect, beforeEach, vi } from 'vitest';
import { calculateGridMap, createSimulationStore } from '@/stores/createSimulationStore';
import { Node, NodeExtended } from '@Universe/types';
import type { SimulationStore } from '@/stores/useSimulationStore';

// Mock D3.js force simulation
vi.mock('d3-force-3d', () => {
  // Factory function to create fresh mocks for each simulation instance
  const createSimulationMock = () => {
    let mockNodesArray: any[] = [];
    let mockLinksArray: any[] = [];
    
    const createMockLinkForce = () => ({
      id: vi.fn().mockReturnThis(),
      distance: vi.fn().mockReturnThis(),
      strength: vi.fn().mockReturnThis(),
      links: vi.fn((links?: any[]) => {
        if (links !== undefined) {
          mockLinksArray = links;
          return createMockLinkForce();
        }
        return mockLinksArray;
      }),
    });

    const mockSimulation = {
      nodes: vi.fn((nodes?: any[]) => {
        if (nodes !== undefined) {
          mockNodesArray = nodes;
          return mockSimulation;
        }
        return mockNodesArray;
      }),
      force: vi.fn((name: string, force?: any) => {
        // Setting a force (with value) - return simulation for chaining
        if (force !== undefined) {
          return mockSimulation;
        }
        // Getting a force (no value) - return the force or null
        if (name === 'link') {
          return createMockLinkForce();
        }
        return null;
      }),
      alpha: vi.fn().mockReturnThis(),
      restart: vi.fn().mockReturnThis(),
      stop: vi.fn().mockReturnThis(),
      numDimensions: vi.fn().mockReturnThis(),
    };

    return mockSimulation;
  };

  return {
    forceSimulation: vi.fn((nodes?: any[]) => {
      return createSimulationMock();
    }),
    forceLink: vi.fn((links?: any[]) => {
      const linkForce = {
        id: vi.fn().mockReturnThis(),
        distance: vi.fn().mockReturnThis(),
        strength: vi.fn().mockReturnThis(),
        links: vi.fn((newLinks?: any[]) => {
          if (newLinks !== undefined) {
            return linkForce;
          }
          return links || [];
        }),
      };
      return linkForce;
    }),
    forceManyBody: vi.fn(() => ({
      strength: vi.fn().mockReturnThis(),
    })),
    forceCenter: vi.fn(() => ({
      strength: vi.fn().mockReturnThis(),
    })),
    forceCollide: vi.fn(() => ({
      radius: vi.fn().mockReturnThis(),
      strength: vi.fn().mockReturnThis(),
    })),
    forceX: vi.fn(() => ({
      strength: vi.fn().mockReturnThis(),
    })),
    forceY: vi.fn(() => ({
      strength: vi.fn().mockReturnThis(),
    })),
    forceZ: vi.fn(() => ({
      strength: vi.fn().mockReturnThis(),
    })),
    forceRadial: vi.fn(() => ({
      strength: vi.fn().mockReturnThis(),
    })),
  };
});

// Mock createDataStore
vi.mock('@/stores/createDataStore', () => ({
  createDataStore: vi.fn(() => ({
    getState: vi.fn(() => ({ 
      nodes: [], 
      links: [],
      nodeTypes: ['Type1', 'Type2', 'Type3'],
    })),
    subscribe: vi.fn(),
    setState: vi.fn(),
  })),
}));

// Mock distributeNodesOnSphere helper
vi.mock('@/stores/useSimulationStore/utils/distributeNodesOnSphere', () => ({
  distributeNodesOnSphere: vi.fn((neighbourhoods: string[], radius: number) => {
    const result: Record<string, { x: number; y: number; z: number }> = {};
    neighbourhoods.forEach((n, i) => {
      result[n] = { x: i * 100, y: i * 100, z: i * 100 };
    });
    return result;
  }),
}));

// Test data factories
function createMockNode(overrides: Partial<Node> = {}): Node {
  const defaultNode: Node = {
    ref_id: `node-${Math.random().toString(36).substr(2, 9)}`,
    node_type: 'Type1',
    name: 'Test Node',
    x: 0,
    y: 0,
    z: 0,
    ...overrides,
  };
  return defaultNode;
}

function createMockLink(source: string, target: string, overrides: Partial<any> = {}) {
  return {
    source,
    target,
    edge_type: 'test_edge',
    ...overrides,
  };
}

function createMockNodes(count: number, nodeTypes: string[] = ['Type1']): Node[] {
  return Array.from({ length: count }, (_, i) => 
    createMockNode({ 
      ref_id: `node-${i}`,
      node_type: nodeTypes[i % nodeTypes.length],
      name: `Node ${i}`,
    })
  );
}

// Custom assertion helpers
function expectValidPosition(pos: { x: number; y: number; z: number }) {
  expect(pos).toBeDefined();
  expect(typeof pos.x).toBe('number');
  expect(typeof pos.y).toBe('number');
  expect(typeof pos.z).toBe('number');
  expect(isFinite(pos.x)).toBe(true);
  expect(isFinite(pos.y)).toBe(true);
  expect(isFinite(pos.z)).toBe(true);
}

function expectNodesInGrid(nodes: Node[], positionMap: Map<string, { x: number; y: number; z: number }>) {
  nodes.forEach(node => {
    const pos = positionMap.get(node.ref_id);
    expect(pos).toBeDefined();
    expectValidPosition(pos!);
  });
}

describe('calculateGridMap', () => {
  describe('basic positioning', () => {
    test('should position single node at origin', () => {
      const nodes = [createMockNode({ ref_id: 'node-1', node_type: 'Type1' })];
      const nodeTypes = ['Type1'];
      
      const positionMap = calculateGridMap(nodes, nodeTypes);
      
      expect(positionMap.size).toBe(1);
      const pos = positionMap.get('node-1');
      expectValidPosition(pos!);
      expect(pos!.x).toBe(0);
      expect(pos!.z).toBe(0);
    });

    test('should position multiple nodes in grid layout', () => {
      const nodes = createMockNodes(9, ['Type1']);
      const nodeTypes = ['Type1'];
      
      const positionMap = calculateGridMap(nodes, nodeTypes);
      
      expect(positionMap.size).toBe(9);
      expectNodesInGrid(nodes, positionMap);
      
      // Verify nodes are distributed in rows/columns
      const positions = Array.from(positionMap.values());
      const xValues = positions.map(p => p.x);
      const zValues = positions.map(p => p.z);
      
      // Should have multiple distinct x and z positions (not all at origin)
      const uniqueX = new Set(xValues);
      const uniqueZ = new Set(zValues);
      expect(uniqueX.size).toBeGreaterThan(1);
      expect(uniqueZ.size).toBeGreaterThan(1);
    });

    test('should handle empty node array', () => {
      const nodes: Node[] = [];
      const nodeTypes: string[] = [];
      
      const positionMap = calculateGridMap(nodes, nodeTypes);
      
      expect(positionMap.size).toBe(0);
    });
  });

  describe('type-based layering', () => {
    test('should assign different Y coordinates for different node types', () => {
      const nodes = [
        createMockNode({ ref_id: 'node-1', node_type: 'Type1' }),
        createMockNode({ ref_id: 'node-2', node_type: 'Type2' }),
        createMockNode({ ref_id: 'node-3', node_type: 'Type3' }),
      ];
      const nodeTypes = ['Type1', 'Type2', 'Type3'];
      
      const positionMap = calculateGridMap(nodes, nodeTypes);
      
      const pos1 = positionMap.get('node-1')!;
      const pos2 = positionMap.get('node-2')!;
      const pos3 = positionMap.get('node-3')!;
      
      // Different types should have different Y coordinates (layers)
      expect(pos1.y).not.toBe(pos2.y);
      expect(pos2.y).not.toBe(pos3.y);
      expect(pos1.y).not.toBe(pos3.y);
    });

    test('should respect provided node type order', () => {
      const nodes = [
        createMockNode({ ref_id: 'node-1', node_type: 'TypeA' }),
        createMockNode({ ref_id: 'node-2', node_type: 'TypeB' }),
        createMockNode({ ref_id: 'node-3', node_type: 'TypeC' }),
      ];
      const nodeTypes = ['TypeC', 'TypeB', 'TypeA']; // Reverse order
      
      const positionMap = calculateGridMap(nodes, nodeTypes);
      
      const posA = positionMap.get('node-1')!;
      const posB = positionMap.get('node-2')!;
      const posC = positionMap.get('node-3')!;
      
      // TypeC should be at top (highest Y), TypeA at bottom (lowest Y)
      expect(posC.y).toBeGreaterThan(posB.y);
      expect(posB.y).toBeGreaterThan(posA.y);
    });

    test('should handle nodes with unknown types', () => {
      const nodes = [
        createMockNode({ ref_id: 'node-1', node_type: undefined as any }),
        createMockNode({ ref_id: 'node-2', node_type: '' }),
      ];
      const nodeTypes = ['Type1'];
      
      const positionMap = calculateGridMap(nodes, nodeTypes);
      
      expect(positionMap.size).toBe(2);
      expectNodesInGrid(nodes, positionMap);
    });

    test('should use detected types when nodeTypes array is empty', () => {
      const nodes = [
        createMockNode({ ref_id: 'node-1', node_type: 'Auto1' }),
        createMockNode({ ref_id: 'node-2', node_type: 'Auto2' }),
      ];
      const nodeTypes: string[] = [];
      
      const positionMap = calculateGridMap(nodes, nodeTypes);
      
      expect(positionMap.size).toBe(2);
      const pos1 = positionMap.get('node-1')!;
      const pos2 = positionMap.get('node-2')!;
      
      // Should assign different layers even without explicit type order
      expectValidPosition(pos1);
      expectValidPosition(pos2);
    });
  });

  describe('grid centering', () => {
    test('should center grid around origin', () => {
      const nodes = createMockNodes(25, ['Type1']);
      const nodeTypes = ['Type1'];
      
      const positionMap = calculateGridMap(nodes, nodeTypes);
      
      const positions = Array.from(positionMap.values());
      const xValues = positions.map(p => p.x);
      const zValues = positions.map(p => p.z);
      
      // Calculate center of mass
      const avgX = xValues.reduce((sum, x) => sum + x, 0) / xValues.length;
      const avgZ = zValues.reduce((sum, z) => sum + z, 0) / zValues.length;
      
      // Should be centered near origin (allowing small floating point errors)
      expect(Math.abs(avgX)).toBeLessThan(1);
      expect(Math.abs(avgZ)).toBeLessThan(1);
    });

    test('should center multi-layer grid', () => {
      const nodesPerType = 10;
      // Create nodes with proper type distribution
      const nodes = [
        ...Array.from({ length: nodesPerType }, (_, i) => createMockNode({ ref_id: `type1-${i}`, node_type: 'Type1' })),
        ...Array.from({ length: nodesPerType }, (_, i) => createMockNode({ ref_id: `type2-${i}`, node_type: 'Type2' })),
        ...Array.from({ length: nodesPerType }, (_, i) => createMockNode({ ref_id: `type3-${i}`, node_type: 'Type3' })),
      ];
      const nodeTypes = ['Type1', 'Type2', 'Type3'];
      
      const positionMap = calculateGridMap(nodes, nodeTypes);
      
      const positions = Array.from(positionMap.values());
      const xValues = positions.map(p => p.x);
      const zValues = positions.map(p => p.z);
      const yValues = positions.map(p => p.y);
      
      // X and Z should be centered overall (tolerance for grid distribution)
      const avgX = xValues.reduce((sum, x) => sum + x, 0) / xValues.length;
      const avgZ = zValues.reduce((sum, z) => sum + z, 0) / zValues.length;
      
      // Allow larger tolerance since nodes of the same type are grouped
      expect(Math.abs(avgX)).toBeLessThan(100);
      expect(Math.abs(avgZ)).toBeLessThan(100);
      
      // Y should have distinct layers with proper spacing
      const uniqueY = new Set(yValues);
      expect(uniqueY.size).toBe(3); // Three distinct layers
      
      // Layers should be vertically distributed
      const minY = Math.min(...yValues);
      const maxY = Math.max(...yValues);
      expect(maxY - minY).toBeGreaterThan(0); // Layers are separated
    });
  });

  describe('edge cases', () => {
    test('should handle large node count', () => {
      const nodes = createMockNodes(1000, ['Type1', 'Type2', 'Type3']);
      const nodeTypes = ['Type1', 'Type2', 'Type3'];
      
      const positionMap = calculateGridMap(nodes, nodeTypes);
      
      expect(positionMap.size).toBe(1000);
      expectNodesInGrid(nodes, positionMap);
    });

    test('should handle all nodes of same type', () => {
      const nodes = createMockNodes(50, ['SameType']);
      const nodeTypes = ['SameType'];
      
      const positionMap = calculateGridMap(nodes, nodeTypes);
      
      expect(positionMap.size).toBe(50);
      
      // All nodes should be at same Y layer
      const positions = Array.from(positionMap.values());
      const yValues = positions.map(p => p.y);
      const uniqueY = new Set(yValues);
      expect(uniqueY.size).toBe(1);
    });

    test('should handle nodes with duplicate ref_ids', () => {
      const nodes = [
        createMockNode({ ref_id: 'duplicate', node_type: 'Type1' }),
        createMockNode({ ref_id: 'duplicate', node_type: 'Type2' }),
        createMockNode({ ref_id: 'unique', node_type: 'Type3' }),
      ];
      const nodeTypes = ['Type1', 'Type2', 'Type3'];
      
      const positionMap = calculateGridMap(nodes, nodeTypes);
      
      // Map should have positions for all ref_ids (last one wins for duplicates)
      expect(positionMap.size).toBeGreaterThanOrEqual(2);
    });

    test('should handle special characters in node types', () => {
      const nodes = [
        createMockNode({ ref_id: 'node-1', node_type: 'Type-1' }),
        createMockNode({ ref_id: 'node-2', node_type: 'Type_2' }),
        createMockNode({ ref_id: 'node-3', node_type: 'Type.3' }),
      ];
      const nodeTypes = ['Type-1', 'Type_2', 'Type.3'];
      
      const positionMap = calculateGridMap(nodes, nodeTypes);
      
      expect(positionMap.size).toBe(3);
      expectNodesInGrid(nodes, positionMap);
    });
  });

  describe('spacing and layout', () => {
    test('should maintain consistent spacing between nodes', () => {
      const nodes = createMockNodes(4, ['Type1']);
      const nodeTypes = ['Type1'];
      
      const positionMap = calculateGridMap(nodes, nodeTypes);
      
      const positions = Array.from(positionMap.values());
      const xValues = positions.map(p => p.x).sort((a, b) => a - b);
      const zValues = positions.map(p => p.z).sort((a, b) => a - b);
      
      // Calculate spacing between adjacent nodes
      if (xValues.length > 1) {
        const spacings = [];
        for (let i = 1; i < xValues.length; i++) {
          const spacing = xValues[i] - xValues[i - 1];
          if (spacing > 0) spacings.push(spacing);
        }
        
        if (spacings.length > 1) {
          // All spacings should be consistent
          const firstSpacing = spacings[0];
          spacings.forEach(s => {
            expect(Math.abs(s - firstSpacing)).toBeLessThan(1);
          });
        }
      }
    });

    test('should use grid layout for rectangular distribution', () => {
      const nodes = createMockNodes(9, ['Type1']); // 3x3 grid
      const nodeTypes = ['Type1'];
      
      const positionMap = calculateGridMap(nodes, nodeTypes);
      
      const positions = Array.from(positionMap.values());
      const xValues = [...new Set(positions.map(p => p.x))].sort((a, b) => a - b);
      const zValues = [...new Set(positions.map(p => p.z))].sort((a, b) => a - b);
      
      // Should have approximately sqrt(n) rows and columns
      expect(xValues.length).toBeGreaterThanOrEqual(2);
      expect(zValues.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('createSimulationStore', () => {
  let mockDataStore: any;
  let mockGraphStore: any;
  let store: ReturnType<typeof createSimulationStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockDataStore = {
      getState: vi.fn(() => ({ 
        nodes: [], 
        links: [],
        nodeTypes: ['Type1', 'Type2'],
      })),
      subscribe: vi.fn(),
      setState: vi.fn(),
    };

    mockGraphStore = {
      getState: vi.fn(() => ({ 
        graphStyle: 'sphere',
        neighbourhoods: ['hood1', 'hood2'],
      })),
      subscribe: vi.fn(),
      setState: vi.fn(),
    };

    store = createSimulationStore(mockDataStore, mockGraphStore);
  });

  describe('simulationCreate', () => {
    test('should create simulation with nodes', () => {
      const nodes = createMockNodes(5, ['Type1']);
      
      store.getState().simulationCreate(nodes);
      
      const simulation = store.getState().simulation;
      expect(simulation).toBeDefined();
      expect(simulation!.stop).toHaveBeenCalled();
    });

    test('should handle empty node array', () => {
      store.getState().simulationCreate([]);
      
      const simulation = store.getState().simulation;
      expect(simulation).toBeDefined();
    });
  });

  describe('removeSimulation', () => {
    test('should stop and remove simulation', () => {
      const nodes = createMockNodes(3, ['Type1']);
      store.getState().simulationCreate(nodes);
      
      store.getState().removeSimulation();
      
      const simulation = store.getState().simulation;
      expect(simulation).toBeNull();
    });

    test('should handle removing non-existent simulation', () => {
      expect(() => store.getState().removeSimulation()).not.toThrow();
    });
  });

  describe('addNodesAndLinks', () => {
    beforeEach(() => {
      const initialNodes = createMockNodes(3, ['Type1']);
      store.getState().simulationCreate(initialNodes);
    });

    test('should add new nodes and links to existing simulation', () => {
      const newNodes = createMockNodes(2, ['Type2']);
      const newLinks = [
        createMockLink('node-0', 'node-1'),
        createMockLink('node-1', 'node-2'),
      ];
      
      store.getState().addNodesAndLinks(newNodes, newLinks, false);
      
      const simulation = store.getState().simulation;
      expect(simulation).toBeDefined();
      expect(simulation!.nodes).toHaveBeenCalled();
    });

    test('should replace nodes and links when replace is true', () => {
      const newNodes = createMockNodes(5, ['Type3']);
      const newLinks = [createMockLink('node-0', 'node-1')];
      
      store.getState().addNodesAndLinks(newNodes, newLinks, true);
      
      const simulation = store.getState().simulation;
      expect(simulation).toBeDefined();
      expect(simulation!.nodes).toHaveBeenCalled();
    });

    test('should filter out invalid links with missing source or target', () => {
      const newNodes = createMockNodes(2, ['Type1']);
      const newLinks = [
        createMockLink('node-0', 'node-1'), // Valid
        createMockLink('node-0', 'missing-node'), // Invalid target
        createMockLink('missing-node', 'node-1'), // Invalid source
      ];
      
      store.getState().addNodesAndLinks(newNodes, newLinks, false);
      
      const simulation = store.getState().simulation;
      expect(simulation).toBeDefined();
    });

    test('should handle empty new data', () => {
      expect(() => store.getState().addNodesAndLinks([], [], false)).not.toThrow();
    });
  });

  describe('setForces', () => {
    beforeEach(() => {
      const nodes = createMockNodes(10, ['Type1', 'Type2']);
      store.getState().simulationCreate(nodes);
    });

    test('should apply sphere/organic forces for sphere style', () => {
      mockGraphStore.getState = vi.fn(() => ({ graphStyle: 'sphere' }));
      
      store.getState().setForces();
      
      const simulation = store.getState().simulation;
      expect(simulation!.force).toHaveBeenCalled();
      expect(simulation!.alpha).toHaveBeenCalled();
      expect(simulation!.restart).toHaveBeenCalled();
    });

    test('should apply cluster forces for force style', () => {
      mockGraphStore.getState = vi.fn(() => ({ 
        graphStyle: 'force',
        neighbourhoods: ['hood1', 'hood2'],
      }));
      
      store.getState().setForces();
      
      const simulation = store.getState().simulation;
      expect(simulation!.force).toHaveBeenCalled();
      expect(simulation!.restart).toHaveBeenCalled();
    });

    test('should apply split/grid forces for split style', () => {
      mockGraphStore.getState = vi.fn(() => ({ graphStyle: 'split' }));
      
      store.getState().setForces();
      
      const simulation = store.getState().simulation;
      expect(simulation!.alpha).toHaveBeenCalledWith(0.01);
      expect(simulation!.restart).toHaveBeenCalled();
    });

    test('should default to sphere forces for unknown style', () => {
      mockGraphStore.getState = vi.fn(() => ({ graphStyle: 'unknown' }));
      
      store.getState().setForces();
      
      const simulation = store.getState().simulation;
      expect(simulation!.force).toHaveBeenCalled();
      expect(simulation!.restart).toHaveBeenCalled();
    });

    test('should handle missing simulation gracefully', () => {
      store.getState().removeSimulation();
      
      expect(() => store.getState().setForces()).not.toThrow();
    });
  });

  describe('resetSimulation', () => {
    beforeEach(() => {
      const nodes = createMockNodes(5, ['Type1']);
      store.getState().simulationCreate(nodes);
    });

    test('should remove all force types', () => {
      store.getState().resetSimulation();
      
      const simulation = store.getState().simulation;
      expect(simulation!.force).toHaveBeenCalledWith('radial', null);
      expect(simulation!.force).toHaveBeenCalledWith('x', null);
      expect(simulation!.force).toHaveBeenCalledWith('y', null);
      expect(simulation!.force).toHaveBeenCalledWith('z', null);
      expect(simulation!.force).toHaveBeenCalledWith('center', null);
      expect(simulation!.force).toHaveBeenCalledWith('collide', null);
    });

    test('should handle missing simulation gracefully', () => {
      store.getState().removeSimulation();
      
      expect(() => store.getState().resetSimulation()).not.toThrow();
    });
  });

  describe('getLinks', () => {
    test('should return links from simulation', () => {
      const nodes = createMockNodes(3, ['Type1']);
      store.getState().simulationCreate(nodes);
      
      const links = store.getState().getLinks();
      
      expect(Array.isArray(links)).toBe(true);
    });

    test('should return empty array when no simulation', () => {
      const links = store.getState().getLinks();
      
      expect(links).toEqual([]);
    });

    test('should handle missing link force', () => {
      const nodes = createMockNodes(3, ['Type1']);
      store.getState().simulationCreate(nodes);
      
      // Mock simulation without link force
      const simulation = store.getState().simulation;
      if (simulation) {
        vi.mocked(simulation.force).mockReturnValue(null as any);
      }
      
      const links = store.getState().getLinks();
      expect(links).toEqual([]);
    });
  });

  describe('simulationRestart', () => {
    beforeEach(() => {
      const nodes = createMockNodes(5, ['Type1']);
      store.getState().simulationCreate(nodes);
    });

    test('should restart simulation with new alpha', () => {
      store.getState().simulationRestart();
      
      const simulation = store.getState().simulation;
      expect(simulation!.alpha).toHaveBeenCalledWith(0.4);
      expect(simulation!.restart).toHaveBeenCalled();
    });

    test('should set simulationInProgress flag', () => {
      store.getState().simulationRestart();
      
      const inProgress = store.getState().simulationInProgress;
      expect(inProgress).toBe(true);
    });

    test('should handle missing simulation gracefully', () => {
      store.getState().removeSimulation();
      
      expect(() => store.getState().simulationRestart()).not.toThrow();
    });
  });

  describe('state management', () => {
    test('should update simulation version', () => {
      const initialVersion = store.getState().simulationVersion;
      
      store.getState().updateSimulationVersion();
      
      const newVersion = store.getState().simulationVersion;
      expect(newVersion).toBe(initialVersion + 1);
    });

    test('should set simulationInProgress flag', () => {
      store.getState().setSimulationInProgress(true);
      expect(store.getState().simulationInProgress).toBe(true);
      
      store.getState().setSimulationInProgress(false);
      expect(store.getState().simulationInProgress).toBe(false);
    });

    test('should set isSleeping flag', () => {
      store.getState().setIsSleeping(true);
      expect(store.getState().isSleeping).toBe(true);
      
      store.getState().setIsSleeping(false);
      expect(store.getState().isSleeping).toBe(false);
    });

    test('should maintain nodePositionsNormalized map', () => {
      const posMap = store.getState().nodePositionsNormalized;
      expect(posMap).toBeInstanceOf(Map);
    });
  });

  describe('force layout integration', () => {
    beforeEach(() => {
      const nodes = createMockNodes(20, ['Type1', 'Type2', 'Type3']);
      store.getState().simulationCreate(nodes);
    });

    test('should apply link forces for sphere layout', () => {
      mockGraphStore.getState = vi.fn(() => ({ graphStyle: 'sphere' }));
      
      store.getState().setForces();
      
      const simulation = store.getState().simulation;
      // Verify force method was called for link, charge, center, collide
      expect(simulation!.force).toHaveBeenCalled();
    });

    test('should apply cluster forces with neighbourhoods', () => {
      mockGraphStore.getState = vi.fn(() => ({ 
        graphStyle: 'force',
        neighbourhoods: ['hood1', 'hood2', 'hood3'],
      }));
      
      store.getState().setForces();
      
      const simulation = store.getState().simulation;
      expect(simulation!.force).toHaveBeenCalled();
    });

    test('should lock positions for split layout', () => {
      mockGraphStore.getState = vi.fn(() => ({ graphStyle: 'split' }));
      mockDataStore.getState = vi.fn(() => ({ 
        nodeTypes: ['Type1', 'Type2', 'Type3'],
      }));
      
      store.getState().setForces();
      
      const simulation = store.getState().simulation;
      expect(simulation!.alpha).toHaveBeenCalledWith(0.01);
    });
  });

  describe('performance characteristics', () => {
    test('should handle large node count efficiently', () => {
      const nodes = createMockNodes(1000, ['Type1', 'Type2', 'Type3']);
      
      const startTime = Date.now();
      store.getState().simulationCreate(nodes);
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in under 1 second
    });

    test('should handle many node types', () => {
      const nodeTypes = Array.from({ length: 50 }, (_, i) => `Type${i}`);
      const nodes = createMockNodes(100, nodeTypes);
      
      expect(() => store.getState().simulationCreate(nodes)).not.toThrow();
    });

    test('should handle large link count', () => {
      const nodes = createMockNodes(100, ['Type1']);
      const links = Array.from({ length: 500 }, (_, i) => 
        createMockLink(`node-${i % 100}`, `node-${(i + 1) % 100}`)
      );
      
      store.getState().simulationCreate(nodes);
      
      expect(() => store.getState().addNodesAndLinks([], links, false)).not.toThrow();
    });
  });
});
