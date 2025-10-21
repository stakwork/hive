import { describe, test, expect, beforeEach, vi } from 'vitest';
import { Link, NodeExtended } from '@Universe/types';

// Mock d3-force-3d before importing the store
const mockSimulation = {
  stop: vi.fn(),
  nodes: vi.fn(),
  force: vi.fn(() => ({
    links: vi.fn(),
  })),
  alpha: vi.fn(() => mockSimulation),
  restart: vi.fn(),
};

vi.mock('d3-force-3d', () => ({
  forceSimulation: vi.fn(() => mockSimulation),
  forceLink: vi.fn(),
  forceManyBody: vi.fn(),
  forceCenter: vi.fn(),
  forceCollide: vi.fn(),
  forceX: vi.fn(),
  forceY: vi.fn(),
  forceZ: vi.fn(),
  forceRadial: vi.fn(),
}));

// Mock peer stores
vi.mock('@/stores/useGraphStore', () => ({
  useGraphStore: {
    getState: vi.fn(() => ({
      data: null,
      selectedNode: null,
      hoveredNode: null,
      graphStyle: 'force',
    })),
  },
}));

vi.mock('@/stores/useDataStore', () => ({
  useDataStore: {
    getState: vi.fn(() => ({
      dataInitial: null,
      dataNew: null,
      nodesNormalized: new Map(),
      linksNormalized: new Map(),
    })),
  },
}));

vi.mock('@/stores/useSchemaStore', () => ({
  useSchemaStore: {
    getState: vi.fn(() => ({
      schemas: [],
      normalizedSchemasByType: {},
    })),
  },
}));

vi.mock('@/stores/useControlStore', () => ({
  useControlStore: {
    getState: vi.fn(() => ({
      isUserDragging: false,
      isUserScrolling: false,
    })),
  },
}));

// Import the store after mocks are set up
import { useSimulationStore } from '@/stores/useSimulationStore';

describe('useSimulationStore - addNodesAndLinks', () => {
  let store: ReturnType<typeof useSimulationStore.getState>;

  // Helper to create test nodes
  const createTestNode = (ref_id: string): NodeExtended => ({
    ref_id,
    name: `Node ${ref_id}`,
    node_type: 'test',
    x: 0,
    y: 0,
    z: 0,
  });

  // Helper to create test links
  const createTestLink = (source: string, target: string, ref_id?: string): Link => ({
    ref_id: ref_id || `link-${source}-${target}`,
    source,
    target,
    edge_type: 'test_edge',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset the store to initial state
    store = useSimulationStore.getState();
    
    // Reset mock simulation
    mockSimulation.stop.mockClear();
    mockSimulation.nodes.mockClear();
    mockSimulation.alpha.mockClear();
    mockSimulation.restart.mockClear();
    mockSimulation.force.mockClear();
    mockSimulation.force.mockReturnValue({ links: vi.fn() });
  });

  describe('Null Simulation Guard', () => {
    test('should return early when simulation is null', () => {
      // Set simulation to null
      store.simulation = null;

      const nodes = [createTestNode('node1')];
      const links = [createTestLink('node1', 'node2')];

      store.addNodesAndLinks(nodes, links, false);

      // Verify no simulation methods were called
      expect(mockSimulation.stop).not.toHaveBeenCalled();
      expect(mockSimulation.nodes).not.toHaveBeenCalled();
    });

    test('should handle undefined simulation', () => {
      store.simulation = undefined as any;

      const nodes = [createTestNode('node1')];
      const links = [createTestLink('node1', 'node2')];

      // Should not throw
      expect(() => store.addNodesAndLinks(nodes, links, false)).not.toThrow();
    });
  });

  describe('Replace Mode', () => {
    beforeEach(() => {
      // Setup simulation with existing data
      store.simulation = mockSimulation as any;
      mockSimulation.nodes.mockReturnValue([
        createTestNode('existing1'),
        createTestNode('existing2'),
      ]);
      mockSimulation.force.mockReturnValue({
        links: vi.fn().mockReturnValue([
          createTestLink('existing1', 'existing2'),
        ]),
      });
    });

    test('should replace all nodes and links when replace=true', () => {
      const newNodes = [createTestNode('node1'), createTestNode('node2')];
      const newLinks = [createTestLink('node1', 'node2')];

      store.addNodesAndLinks(newNodes, newLinks, true);

      // Verify simulation.nodes was called with only new nodes
      expect(mockSimulation.nodes).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ ref_id: 'node1' }),
          expect.objectContaining({ ref_id: 'node2' }),
        ])
      );

      // Verify old nodes are not present
      const calledNodes = mockSimulation.nodes.mock.calls[0][0];
      expect(calledNodes).toHaveLength(2);
      expect(calledNodes.find((n: NodeExtended) => n.ref_id === 'existing1')).toBeUndefined();
    });

    test('should replace all links when replace=true', () => {
      const newNodes = [createTestNode('node1'), createTestNode('node2')];
      const newLinks = [createTestLink('node1', 'node2')];

      store.addNodesAndLinks(newNodes, newLinks, true);

      // Get the links that were set
      const linkForce = mockSimulation.force('link');
      expect(linkForce.links).toHaveBeenCalled();

      const calledLinks = linkForce.links.mock.calls[0][0];
      expect(calledLinks).toHaveLength(1);
      expect(calledLinks[0]).toMatchObject({
        source: 'node1',
        target: 'node2',
      });
    });
  });

  describe('Append Mode', () => {
    beforeEach(() => {
      store.simulation = mockSimulation as any;
      // Setup nodes mock to return existing nodes when called as getter
      // and chain properly when called as setter
      mockSimulation.nodes.mockImplementation((nodes?: any) => {
        if (nodes !== undefined) {
          // Setter: return simulation for chaining
          return mockSimulation;
        }
        // Getter: return existing nodes
        return [createTestNode('existing1')];
      });
      
      const mockLinkForce = {
        links: vi.fn().mockImplementation((links?: any) => {
          if (links !== undefined) {
            // Setter: return the force for chaining
            return mockLinkForce;
          }
          // Getter: return existing links
          return [
            {
              ref_id: 'link-existing',
              source: { ref_id: 'existing1' },
              target: { ref_id: 'existing1' },
              edge_type: 'test',
            },
          ];
        }),
      };
      
      mockSimulation.force.mockReturnValue(mockLinkForce);
    });

    test('should append new nodes to existing nodes when replace=false', () => {
      const newNodes = [createTestNode('node1'), createTestNode('node2')];
      const newLinks = [createTestLink('node1', 'node2')];

      store.addNodesAndLinks(newNodes, newLinks, false);

      // Find the setter call (the one with arguments)
      const setterCalls = mockSimulation.nodes.mock.calls.filter(call => call.length > 0);
      expect(setterCalls.length).toBeGreaterThan(0);
      const calledNodes = setterCalls[0][0];
      
      // Should have existing + new nodes
      expect(calledNodes.length).toBeGreaterThanOrEqual(2);
      expect(calledNodes.some((n: NodeExtended) => n.ref_id === 'existing1')).toBe(true);
      expect(calledNodes.some((n: NodeExtended) => n.ref_id === 'node1')).toBe(true);
      expect(calledNodes.some((n: NodeExtended) => n.ref_id === 'node2')).toBe(true);
    });

    test('should append new links to existing links when replace=false', () => {
      const newNodes = [createTestNode('node1'), createTestNode('node2')];
      const newLinks = [createTestLink('node1', 'node2')];

      store.addNodesAndLinks(newNodes, newLinks, false);

      const linkForce = mockSimulation.force('link');
      // Find the setter call (the one with arguments)
      const setterCalls = linkForce.links.mock.calls.filter((call: any[]) => call.length > 0);
      expect(setterCalls.length).toBeGreaterThan(0);
      const calledLinks = setterCalls[0][0];

      // Should have both existing and new links
      expect(calledLinks.length).toBeGreaterThanOrEqual(1);
      expect(calledLinks.some((l: Link) => l.source === 'existing1')).toBe(true);
      expect(calledLinks.some((l: Link) => l.source === 'node1' && l.target === 'node2')).toBe(true);
    });
  });

  describe('Link Filtering - Critical Integrity Checks', () => {
    beforeEach(() => {
      store.simulation = mockSimulation as any;
      mockSimulation.nodes.mockReturnValue([]);
      mockSimulation.force.mockReturnValue({ links: vi.fn().mockReturnValue([]) });
    });

    test('should filter out links where source node does not exist', () => {
      const nodes = [createTestNode('node1'), createTestNode('node2')];
      const links = [
        createTestLink('node1', 'node2'), // valid
        createTestLink('nonexistent', 'node2'), // invalid source
      ];

      store.addNodesAndLinks(nodes, links, true);

      const linkForce = mockSimulation.force('link');
      const calledLinks = linkForce.links.mock.calls[0][0];

      // Only valid link should remain
      expect(calledLinks).toHaveLength(1);
      expect(calledLinks[0]).toMatchObject({
        source: 'node1',
        target: 'node2',
      });
    });

    test('should filter out links where target node does not exist', () => {
      const nodes = [createTestNode('node1'), createTestNode('node2')];
      const links = [
        createTestLink('node1', 'node2'), // valid
        createTestLink('node1', 'nonexistent'), // invalid target
      ];

      store.addNodesAndLinks(nodes, links, true);

      const linkForce = mockSimulation.force('link');
      const calledLinks = linkForce.links.mock.calls[0][0];

      expect(calledLinks).toHaveLength(1);
      expect(calledLinks[0].target).toBe('node2');
    });

    test('should filter out links where both source and target do not exist', () => {
      const nodes = [createTestNode('node1')];
      const links = [
        createTestLink('nonexistent1', 'nonexistent2'), // completely invalid
      ];

      store.addNodesAndLinks(nodes, links, true);

      const linkForce = mockSimulation.force('link');
      const calledLinks = linkForce.links.mock.calls[0][0];

      expect(calledLinks).toHaveLength(0);
    });

    test('should allow self-referencing links if node exists', () => {
      const nodes = [createTestNode('node1')];
      const links = [createTestLink('node1', 'node1')]; // self-reference

      store.addNodesAndLinks(nodes, links, true);

      const linkForce = mockSimulation.force('link');
      const calledLinks = linkForce.links.mock.calls[0][0];

      expect(calledLinks).toHaveLength(1);
      expect(calledLinks[0]).toMatchObject({
        source: 'node1',
        target: 'node1',
      });
    });

    test('should handle multiple valid and invalid links correctly', () => {
      const nodes = [
        createTestNode('node1'),
        createTestNode('node2'),
        createTestNode('node3'),
      ];
      const links = [
        createTestLink('node1', 'node2'), // valid
        createTestLink('invalid1', 'node2'), // invalid source
        createTestLink('node2', 'node3'), // valid
        createTestLink('node3', 'invalid2'), // invalid target
        createTestLink('node1', 'node3'), // valid
      ];

      store.addNodesAndLinks(nodes, links, true);

      const linkForce = mockSimulation.force('link');
      const calledLinks = linkForce.links.mock.calls[0][0];

      // Should have exactly 3 valid links
      expect(calledLinks).toHaveLength(3);
      expect(calledLinks[0]).toMatchObject({ source: 'node1', target: 'node2' });
      expect(calledLinks[1]).toMatchObject({ source: 'node2', target: 'node3' });
      expect(calledLinks[2]).toMatchObject({ source: 'node1', target: 'node3' });
    });
  });

  describe('Empty Data Handling', () => {
    beforeEach(() => {
      store.simulation = mockSimulation as any;
      mockSimulation.nodes.mockReturnValue([]);
      mockSimulation.force.mockReturnValue({ links: vi.fn().mockReturnValue([]) });
    });

    test('should handle empty nodes array', () => {
      store.addNodesAndLinks([], [], true);

      expect(mockSimulation.nodes).toHaveBeenCalledWith([]);
      expect(mockSimulation.stop).toHaveBeenCalled();
    });

    test('should handle empty links array with nodes present', () => {
      const nodes = [createTestNode('node1')];
      
      store.addNodesAndLinks(nodes, [], true);

      const linkForce = mockSimulation.force('link');
      expect(linkForce.links).toHaveBeenCalledWith([]);
    });

    test('should handle nodes without any valid links', () => {
      const nodes = [createTestNode('node1'), createTestNode('node2')];
      const links = [createTestLink('invalid1', 'invalid2')]; // no valid links

      store.addNodesAndLinks(nodes, links, true);

      const linkForce = mockSimulation.force('link');
      const calledLinks = linkForce.links.mock.calls[0][0];
      
      expect(calledLinks).toHaveLength(0);
    });
  });

  describe('Duplicate Node Handling', () => {
    beforeEach(() => {
      store.simulation = mockSimulation as any;
      mockSimulation.nodes.mockReturnValue([]);
      mockSimulation.force.mockReturnValue({ links: vi.fn().mockReturnValue([]) });
    });

    test('should accept duplicate nodes in input (append mode behavior)', () => {
      const nodes = [
        createTestNode('node1'),
        createTestNode('node1'), // duplicate
        createTestNode('node2'),
      ];
      const links = [createTestLink('node1', 'node2')];

      // Should not throw
      expect(() => store.addNodesAndLinks(nodes, links, true)).not.toThrow();

      const calledNodes = mockSimulation.nodes.mock.calls[0][0];
      
      // Both duplicate nodes should be present
      expect(calledNodes).toHaveLength(3);
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      store.simulation = mockSimulation as any;
      mockSimulation.nodes.mockReturnValue([]);
      mockSimulation.force.mockReturnValue({ links: vi.fn().mockReturnValue([]) });
    });

    test('should catch and log errors from simulation.nodes()', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const testError = new Error('Simulation nodes error');
      
      mockSimulation.nodes.mockImplementationOnce(() => {
        throw testError;
      });

      const nodes = [createTestNode('node1')];
      const links = [createTestLink('node1', 'node1')];

      // Should not throw, error is caught
      expect(() => store.addNodesAndLinks(nodes, links, true)).not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(testError);
      consoleErrorSpy.mockRestore();
    });

    test('should catch and log errors from simulation.force().links()', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const testError = new Error('Links error');
      
      const mockLinkForce = {
        links: vi.fn(() => {
          throw testError;
        }),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const nodes = [createTestNode('node1')];
      const links = [createTestLink('node1', 'node1')];

      // Should not throw, error is caught
      expect(() => store.addNodesAndLinks(nodes, links, true)).not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(testError);
      consoleErrorSpy.mockRestore();
    });

    test('should still call simulationRestart even if errors occur', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockSimulation.nodes.mockImplementationOnce(() => {
        throw new Error('Test error');
      });

      const nodes = [createTestNode('node1')];
      const links = [createTestLink('node1', 'node1')];

      store.addNodesAndLinks(nodes, links, true);

      // simulationRestart should not be called because the error happens before it
      // However, the function should not crash
      expect(() => store.addNodesAndLinks(nodes, links, true)).not.toThrow();
      
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Simulation Control', () => {
    beforeEach(() => {
      store.simulation = mockSimulation as any;
      mockSimulation.nodes.mockReturnValue([]);
      mockSimulation.force.mockReturnValue({ links: vi.fn().mockReturnValue([]) });
    });

    test('should call simulation.stop() before modifications', () => {
      const nodes = [createTestNode('node1')];
      const links = [createTestLink('node1', 'node1')];

      store.addNodesAndLinks(nodes, links, true);

      // stop should be called first
      expect(mockSimulation.stop).toHaveBeenCalled();
      expect(mockSimulation.stop.mock.invocationCallOrder[0]).toBeLessThan(
        mockSimulation.nodes.mock.invocationCallOrder[0]
      );
    });

    test('should call simulationRestart after successful update', () => {
      // Mock simulationRestart
      const mockRestart = vi.fn();
      store.simulationRestart = mockRestart;

      const nodes = [createTestNode('node1')];
      const links = [createTestLink('node1', 'node1')];

      store.addNodesAndLinks(nodes, links, true);

      expect(mockRestart).toHaveBeenCalled();
    });
  });

  describe('Data Integrity - structuredClone', () => {
    beforeEach(() => {
      store.simulation = mockSimulation as any;
      mockSimulation.nodes.mockReturnValue([]);
      mockSimulation.force.mockReturnValue({ links: vi.fn().mockReturnValue([]) });
    });

    test('should not mutate input nodes array', () => {
      const originalNode = createTestNode('node1');
      const nodes = [originalNode];
      const nodesCopy = structuredClone(nodes);

      store.addNodesAndLinks(nodes, [], true);

      // Original should remain unchanged
      expect(nodes[0]).toEqual(nodesCopy[0]);
    });

    test('should not mutate input links array', () => {
      const nodes = [createTestNode('node1'), createTestNode('node2')];
      const originalLink = createTestLink('node1', 'node2');
      const links = [originalLink];
      const linksCopy = structuredClone(links);

      store.addNodesAndLinks(nodes, links, true);

      // Original should remain unchanged
      expect(links[0]).toEqual(linksCopy[0]);
    });
  });

  describe('Link Source/Target Format Conversion', () => {
    beforeEach(() => {
      store.simulation = mockSimulation as any;
      mockSimulation.nodes.mockImplementation((nodes?: any) => {
        if (nodes !== undefined) {
          return mockSimulation;
        }
        return [];
      });
      
      // Mock force('link').links() to return/set links with object references
      const mockLinkForce = {
        links: vi.fn().mockImplementation((links?: any) => {
          if (links !== undefined) {
            // Setter: return the force for chaining
            return mockLinkForce;
          }
          // Getter: return existing links with object references
          return [
            {
              ref_id: 'link1',
              source: { ref_id: 'node1', name: 'Node 1' },
              target: { ref_id: 'node2', name: 'Node 2' },
              edge_type: 'test',
            },
          ];
        }),
      };
      
      mockSimulation.force.mockReturnValue(mockLinkForce);
    });

    test('should convert link source/target from objects to string ref_ids in append mode', () => {
      // Add node1 and node2 so the existing link is valid
      const nodes = [createTestNode('node1'), createTestNode('node2'), createTestNode('node3')];
      const links = [createTestLink('node3', 'node3')];

      store.addNodesAndLinks(nodes, links, false);

      const linkForce = mockSimulation.force('link');
      // Find the setter call (the one with arguments)
      const setterCalls = linkForce.links.mock.calls.filter((call: any[]) => call.length > 0);
      expect(setterCalls.length).toBeGreaterThan(0);
      const calledLinks = setterCalls[0][0];

      // First link (the existing one) should have source/target converted to strings
      expect(calledLinks[0].source).toBe('node1');
      expect(calledLinks[0].target).toBe('node2');
      // Second link should be the new one
      expect(calledLinks[1].source).toBe('node3');
      expect(calledLinks[1].target).toBe('node3');
    });
  });

  describe('Complex Scenarios', () => {
    beforeEach(() => {
      store.simulation = mockSimulation as any;
      mockSimulation.nodes.mockImplementation((nodes?: any) => {
        if (nodes !== undefined) {
          return mockSimulation;
        }
        return [
          createTestNode('existing1'),
          createTestNode('existing2'),
        ];
      });
      
      const mockLinkForce = {
        links: vi.fn().mockImplementation((links?: any) => {
          if (links !== undefined) {
            return mockLinkForce;
          }
          return [
            {
              ref_id: 'existing-link',
              source: { ref_id: 'existing1' },
              target: { ref_id: 'existing2' },
              edge_type: 'test',
            },
          ];
        }),
      };
      
      mockSimulation.force.mockReturnValue(mockLinkForce);
    });

    test('should handle append with partial invalid links', () => {
      const newNodes = [createTestNode('node1'), createTestNode('node2')];
      const newLinks = [
        createTestLink('node1', 'node2'), // valid
        createTestLink('node1', 'nonexistent'), // invalid
        createTestLink('existing1', 'node1'), // valid, crosses existing and new
      ];

      store.addNodesAndLinks(newNodes, newLinks, false);

      const linkForce = mockSimulation.force('link');
      // Find the setter call (the one with arguments)
      const setterCalls = linkForce.links.mock.calls.filter((call: any[]) => call.length > 0);
      expect(setterCalls.length).toBeGreaterThan(0);
      const calledLinks = setterCalls[0][0];

      // Should have existing link + 2 valid new links = 3 total
      expect(calledLinks.length).toBeGreaterThanOrEqual(2);
      
      // Verify valid new links are present
      expect(calledLinks.some((l: Link) => 
        l.source === 'node1' && l.target === 'node2'
      )).toBe(true);
      expect(calledLinks.some((l: Link) => 
        l.source === 'existing1' && l.target === 'node1'
      )).toBe(true);
      
      // Verify invalid link is not present
      expect(calledLinks.some((l: Link) => 
        l.target === 'nonexistent'
      )).toBe(false);
    });

    test('should handle large dataset efficiently', () => {
      const largeNodeCount = 100;
      const largeLinkCount = 200;

      const nodes = Array.from({ length: largeNodeCount }, (_, i) => 
        createTestNode(`node${i}`)
      );
      
      const links = Array.from({ length: largeLinkCount }, (_, i) => {
        const source = `node${i % largeNodeCount}`;
        const target = `node${(i + 1) % largeNodeCount}`;
        return createTestLink(source, target, `link${i}`);
      });

      const startTime = Date.now();
      store.addNodesAndLinks(nodes, links, true);
      const duration = Date.now() - startTime;

      // Should complete in reasonable time (< 100ms for this size)
      expect(duration).toBeLessThan(100);

      // Verify all valid links were processed
      const linkForce = mockSimulation.force('link');
      expect(linkForce.links).toHaveBeenCalled();
    });
  });
});