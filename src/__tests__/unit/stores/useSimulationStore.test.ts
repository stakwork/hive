import { describe, test, expect, beforeEach, vi } from 'vitest';
import { useSimulationStore } from '@/stores/useSimulationStore';
import type { NodeExtended, Link } from '@Universe/types';

// Mock d3-force-3d
const mockSimulation = {
  stop: vi.fn(),
  nodes: vi.fn(() => []),
  force: vi.fn(() => ({
    links: vi.fn(() => []),
  })),
  restart: vi.fn(),
  alpha: vi.fn(() => mockSimulation),
};

vi.mock('d3-force-3d', () => ({
  forceSimulation: vi.fn(() => mockSimulation),
  forceCenter: vi.fn(),
  forceCollide: vi.fn(),
  forceLink: vi.fn(),
  forceManyBody: vi.fn(),
  forceRadial: vi.fn(),
  forceX: vi.fn(),
  forceY: vi.fn(),
  forceZ: vi.fn(),
}));

// Mock peer stores
vi.mock('@/stores/useGraphStore', () => ({
  useGraphStore: vi.fn(() => ({
    graphStyle: 'force',
    setGraphRadius: vi.fn(),
    neighbourhoods: [],
    highlightNodes: [],
    selectedNode: null,
  })),
}));

vi.mock('@/stores/useDataStore', () => ({
  useDataStore: vi.fn(() => ({
    dataInitial: null,
    dataNew: null,
    resetDataNew: vi.fn(),
  })),
}));

vi.mock('@/stores/useSchemaStore', () => ({
  useSchemaStore: vi.fn(() => ({
    normalizedSchemasByType: {},
  })),
}));

vi.mock('@/stores/useControlStore', () => ({
  useControlStore: vi.fn(() => ({})),
}));

describe('useSimulationStore - addNodesAndLinks', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    
    // Reset the store state
    useSimulationStore.setState({
      simulation: mockSimulation as any,
      simulationInProgress: false,
    });
    
    // Reset mock implementation to default behavior
    mockSimulation.nodes.mockReturnValue([]);
    mockSimulation.force.mockReturnValue({
      links: vi.fn(() => []),
    });
  });

  describe('Link Filtering', () => {
    test('should filter out links with non-existent source nodes', () => {
      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
        { ref_id: 'node-2', name: 'Node 2', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const links: Link[] = [
        { ref_id: 'link-1', source: 'node-1', target: 'node-2' },
        { ref_id: 'link-2', source: 'non-existent', target: 'node-2' }, // Invalid source
      ];

      const mockLinkForce = {
        links: vi.fn(),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      // Should only add the valid link
      expect(mockLinkForce.links).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ ref_id: 'link-1' }),
        ])
      );
      
      // Should not include the invalid link
      const calledLinks = mockLinkForce.links.mock.calls[0][0];
      expect(calledLinks).toHaveLength(1);
      expect(calledLinks.find((l: Link) => l.ref_id === 'link-2')).toBeUndefined();
    });

    test('should filter out links with non-existent target nodes', () => {
      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
        { ref_id: 'node-2', name: 'Node 2', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const links: Link[] = [
        { ref_id: 'link-1', source: 'node-1', target: 'node-2' },
        { ref_id: 'link-2', source: 'node-1', target: 'non-existent' }, // Invalid target
      ];

      const mockLinkForce = {
        links: vi.fn(),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      const calledLinks = mockLinkForce.links.mock.calls[0][0];
      expect(calledLinks).toHaveLength(1);
      expect(calledLinks[0].ref_id).toBe('link-1');
    });

    test('should filter out links where both source and target are missing', () => {
      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const links: Link[] = [
        { ref_id: 'link-1', source: 'missing-source', target: 'missing-target' },
      ];

      const mockLinkForce = {
        links: vi.fn(),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      const calledLinks = mockLinkForce.links.mock.calls[0][0];
      expect(calledLinks).toHaveLength(0);
    });

    test('should accept self-referencing links if node exists', () => {
      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const links: Link[] = [
        { ref_id: 'link-1', source: 'node-1', target: 'node-1' }, // Self-reference
      ];

      const mockLinkForce = {
        links: vi.fn(),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      const calledLinks = mockLinkForce.links.mock.calls[0][0];
      expect(calledLinks).toHaveLength(1);
      expect(calledLinks[0].source).toBe('node-1');
      expect(calledLinks[0].target).toBe('node-1');
    });

    test('should preserve valid links when filtering out invalid ones', () => {
      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
        { ref_id: 'node-2', name: 'Node 2', node_type: 'function', x: 0, y: 0, z: 0 },
        { ref_id: 'node-3', name: 'Node 3', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const links: Link[] = [
        { ref_id: 'link-1', source: 'node-1', target: 'node-2' },
        { ref_id: 'link-2', source: 'invalid', target: 'node-2' },
        { ref_id: 'link-3', source: 'node-2', target: 'node-3' },
        { ref_id: 'link-4', source: 'node-1', target: 'invalid' },
      ];

      const mockLinkForce = {
        links: vi.fn(),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      const calledLinks = mockLinkForce.links.mock.calls[0][0];
      expect(calledLinks).toHaveLength(2);
      expect(calledLinks.map((l: Link) => l.ref_id)).toEqual(['link-1', 'link-3']);
    });
  });

  describe('Replace vs Append Mode', () => {
    test('should replace existing nodes and links when replace=true', () => {
      // Setup existing simulation state
      const existingNodes = [
        { ref_id: 'old-node', name: 'Old Node', node_type: 'function', x: 0, y: 0, z: 0 },
      ];
      const existingLinks = [
        { ref_id: 'old-link', source: 'old-node', target: 'old-node' },
      ];

      mockSimulation.nodes.mockReturnValue(existingNodes);
      mockSimulation.force.mockReturnValue({
        links: vi.fn(() => existingLinks),
      });

      const newNodes: NodeExtended[] = [
        { ref_id: 'new-node', name: 'New Node', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const newLinks: Link[] = [
        { ref_id: 'new-link', source: 'new-node', target: 'new-node' },
      ];

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(newNodes, newLinks, true);

      // Should only have new nodes
      expect(mockSimulation.nodes).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ ref_id: 'new-node' }),
        ])
      );

      const calledNodes = mockSimulation.nodes.mock.calls[mockSimulation.nodes.mock.calls.length - 1][0];
      expect(calledNodes).toHaveLength(1);
      expect(calledNodes.find((n: NodeExtended) => n.ref_id === 'old-node')).toBeUndefined();
    });

    test('should append to existing nodes and links when replace=false', () => {
      // Setup existing simulation state
      const existingNodes = [
        { ref_id: 'old-node', name: 'Old Node', node_type: 'function', x: 0, y: 0, z: 0 },
      ];
      const existingLinks = [
        { ref_id: 'old-link', source: 'old-node', target: 'old-node' },
      ];

      mockSimulation.nodes.mockReturnValue(existingNodes);
      mockSimulation.force.mockReturnValue({
        links: vi.fn(() => existingLinks.map(l => ({ ...l, source: { ref_id: l.source }, target: { ref_id: l.target } }))),
      });

      const newNodes: NodeExtended[] = [
        { ref_id: 'new-node', name: 'New Node', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const newLinks: Link[] = [
        { ref_id: 'new-link', source: 'new-node', target: 'new-node' },
      ];

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(newNodes, newLinks, false);

      // Should have both old and new nodes
      const calledNodes = mockSimulation.nodes.mock.calls[mockSimulation.nodes.mock.calls.length - 1][0];
      expect(calledNodes).toHaveLength(2);
      expect(calledNodes.find((n: NodeExtended) => n.ref_id === 'old-node')).toBeDefined();
      expect(calledNodes.find((n: NodeExtended) => n.ref_id === 'new-node')).toBeDefined();
    });
  });

  describe('Null Simulation Guard', () => {
    test('should return early when simulation is null', () => {
      useSimulationStore.setState({ simulation: null });

      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const links: Link[] = [];

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      // Should not call any simulation methods
      expect(mockSimulation.stop).not.toHaveBeenCalled();
      expect(mockSimulation.nodes).not.toHaveBeenCalled();
    });

    test('should return early when simulation is undefined', () => {
      useSimulationStore.setState({ simulation: undefined as any });

      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const links: Link[] = [];

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      expect(mockSimulation.stop).not.toHaveBeenCalled();
    });
  });

  describe('Simulation Control', () => {
    test('should stop simulation before updating', () => {
      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const links: Link[] = [];

      const mockLinkForce = {
        links: vi.fn(),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      expect(mockSimulation.stop).toHaveBeenCalledTimes(1);
      
      // Stop should be called before nodes update
      const stopCallOrder = mockSimulation.stop.mock.invocationCallOrder[0];
      const nodesCallOrder = mockSimulation.nodes.mock.invocationCallOrder[0];
      expect(stopCallOrder).toBeLessThan(nodesCallOrder);
    });

    test('should restart simulation after successful update', () => {
      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const links: Link[] = [];

      const mockLinkForce = {
        links: vi.fn(),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      // simulationRestart() sets simulationInProgress and calls simulation.alpha(0.4).restart()
      expect(mockSimulation.alpha).toHaveBeenCalledWith(0.4);
      expect(mockSimulation.restart).toHaveBeenCalled();
    });

    test('should update simulation nodes with new data', () => {
      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
        { ref_id: 'node-2', name: 'Node 2', node_type: 'class', x: 0, y: 0, z: 0 },
      ];

      const links: Link[] = [];

      const mockLinkForce = {
        links: vi.fn(),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      expect(mockSimulation.nodes).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ ref_id: 'node-1', node_type: 'function' }),
          expect.objectContaining({ ref_id: 'node-2', node_type: 'class' }),
        ])
      );
    });

    test('should update link force with filtered links', () => {
      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
        { ref_id: 'node-2', name: 'Node 2', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const links: Link[] = [
        { ref_id: 'link-1', source: 'node-1', target: 'node-2' },
      ];

      const mockLinkForce = {
        links: vi.fn(),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      expect(mockLinkForce.links).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ ref_id: 'link-1' }),
        ])
      );
    });
  });

  describe('Error Handling', () => {
    test('should catch and log errors when simulation update fails', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const links: Link[] = [];

      // Simulate error in nodes() call
      mockSimulation.nodes.mockImplementation(() => {
        throw new Error('Simulation update failed');
      });

      const { addNodesAndLinks } = useSimulationStore.getState();
      
      // Should not throw, error should be caught
      expect(() => addNodesAndLinks(nodes, links, true)).not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(Error));

      consoleErrorSpy.mockRestore();
    });

    test('should catch errors from link force update', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const links: Link[] = [];

      const mockLinkForce = {
        links: vi.fn(() => {
          throw new Error('Link force update failed');
        }),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      
      expect(() => addNodesAndLinks(nodes, links, true)).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Edge Cases - Empty Data', () => {
    test('should handle empty nodes array', () => {
      const nodes: NodeExtended[] = [];
      const links: Link[] = [];

      const mockLinkForce = {
        links: vi.fn(),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      expect(mockSimulation.nodes).toHaveBeenCalledWith([]);
      expect(mockLinkForce.links).toHaveBeenCalledWith([]);
    });

    test('should handle empty links array with valid nodes', () => {
      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
      ];
      const links: Link[] = [];

      const mockLinkForce = {
        links: vi.fn(),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      expect(mockSimulation.nodes).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ ref_id: 'node-1' })])
      );
      expect(mockLinkForce.links).toHaveBeenCalledWith([]);
    });

    test('should filter all links when nodes array is empty', () => {
      const nodes: NodeExtended[] = [];
      const links: Link[] = [
        { ref_id: 'link-1', source: 'node-1', target: 'node-2' },
      ];

      const mockLinkForce = {
        links: vi.fn(),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      const calledLinks = mockLinkForce.links.mock.calls[0][0];
      expect(calledLinks).toHaveLength(0);
    });
  });

  describe('Edge Cases - Duplicate Nodes', () => {
    test('should handle duplicate node ref_ids by keeping both', () => {
      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
        { ref_id: 'node-1', name: 'Node 1 Duplicate', node_type: 'class', x: 0, y: 0, z: 0 },
      ];

      const links: Link[] = [];

      const mockLinkForce = {
        links: vi.fn(),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      // Both nodes should be added (D3 simulation will handle duplicates internally)
      const calledNodes = mockSimulation.nodes.mock.calls[mockSimulation.nodes.mock.calls.length - 1][0];
      expect(calledNodes).toHaveLength(2);
    });

    test('should correctly filter links with duplicate nodes', () => {
      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
        { ref_id: 'node-1', name: 'Node 1 Duplicate', node_type: 'class', x: 0, y: 0, z: 0 },
        { ref_id: 'node-2', name: 'Node 2', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const links: Link[] = [
        { ref_id: 'link-1', source: 'node-1', target: 'node-2' },
      ];

      const mockLinkForce = {
        links: vi.fn(),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      // Link should be valid since at least one node with ref_id 'node-1' exists
      const calledLinks = mockLinkForce.links.mock.calls[0][0];
      expect(calledLinks).toHaveLength(1);
      expect(calledLinks[0].ref_id).toBe('link-1');
    });
  });

  describe('Edge Cases - Data Cloning', () => {
    test('should not mutate original nodes array', () => {
      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const originalNodesString = JSON.stringify(nodes);

      const links: Link[] = [];

      const mockLinkForce = {
        links: vi.fn(),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      // Original array should remain unchanged
      expect(JSON.stringify(nodes)).toBe(originalNodesString);
    });

    test('should not mutate original links array', () => {
      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
        { ref_id: 'node-2', name: 'Node 2', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const links: Link[] = [
        { ref_id: 'link-1', source: 'node-1', target: 'node-2' },
      ];

      const originalLinksString = JSON.stringify(links);

      const mockLinkForce = {
        links: vi.fn(),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      expect(JSON.stringify(links)).toBe(originalLinksString);
    });
  });

  describe('Edge Cases - Complex Link Structures', () => {
    test('should handle links with D3-transformed object references in append mode', () => {
      // Setup existing simulation with D3-transformed links
      const existingNodes = [
        { ref_id: 'old-node-1', name: 'Old Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
        { ref_id: 'old-node-2', name: 'Old Node 2', node_type: 'function', x: 0, y: 0, z: 0 },
      ];
      
      const existingLinks = [
        {
          ref_id: 'old-link',
          source: { ref_id: 'old-node-1', name: 'Old Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
          target: { ref_id: 'old-node-2', name: 'Old Node 2', node_type: 'function', x: 0, y: 0, z: 0 },
        },
      ];

      const newNodes: NodeExtended[] = [
        { ref_id: 'new-node', name: 'New Node', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const newLinks: Link[] = [
        { ref_id: 'new-link', source: 'new-node', target: 'old-node-1' },
      ];

      const mockLinkForce = {
        links: vi.fn((newLinks) => {
          // If called with argument, it's a setter - return for chaining
          if (newLinks !== undefined) {
            return mockLinkForce;
          }
          // If called without argument, it's a getter - return existing links
          return existingLinks;
        }),
      };

      mockSimulation.nodes.mockReturnValue(existingNodes);
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(newNodes, newLinks, false);

      // Should normalize D3 object references to ref_id strings
      const calledLinks = mockLinkForce.links.mock.calls[1][0]; // Second call is the setter
      expect(calledLinks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ref_id: 'old-link', source: 'old-node-1', target: 'old-node-2' }),
          expect.objectContaining({ ref_id: 'new-link', source: 'new-node', target: 'old-node-1' }),
        ])
      );
    });

    test('should handle multiple links between same nodes', () => {
      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
        { ref_id: 'node-2', name: 'Node 2', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const links: Link[] = [
        { ref_id: 'link-1', source: 'node-1', target: 'node-2' },
        { ref_id: 'link-2', source: 'node-1', target: 'node-2' },
        { ref_id: 'link-3', source: 'node-1', target: 'node-2' },
      ];

      const mockLinkForce = {
        links: vi.fn(),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      const calledLinks = mockLinkForce.links.mock.calls[0][0];
      expect(calledLinks).toHaveLength(3);
      expect(calledLinks.every((l: Link) => l.source === 'node-1' && l.target === 'node-2')).toBe(true);
    });
  });

  describe('Integration with simulationRestart', () => {
    test('should set simulationInProgress to true when restarting', () => {
      const nodes: NodeExtended[] = [
        { ref_id: 'node-1', name: 'Node 1', node_type: 'function', x: 0, y: 0, z: 0 },
      ];

      const links: Link[] = [];

      const mockLinkForce = {
        links: vi.fn(),
      };
      mockSimulation.force.mockReturnValue(mockLinkForce);

      const { addNodesAndLinks } = useSimulationStore.getState();
      addNodesAndLinks(nodes, links, true);

      const state = useSimulationStore.getState();
      expect(state.simulationInProgress).toBe(true);
    });
  });
});