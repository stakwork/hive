import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSimulationStore } from '@/stores/useSimulationStore';
import { useGraphStore } from '@/stores/useGraphStore';
import { distributeNodesOnSphere } from '@/stores/useSimulationStore/utils/distributeNodesOnSphere';
import type { NodeExtended } from '@Universe/types';

// Setup hoisted mock that can be accessed in vi.mock()
const { mockSimulation } = vi.hoisted(() => {
  const mockSimulation = {
    nodes: vi.fn(),
    force: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    alpha: vi.fn(),
    numDimensions: vi.fn(),
    on: vi.fn(),
  };
  
  // Make all methods chainable by returning the simulation itself
  mockSimulation.nodes.mockReturnValue(mockSimulation);
  mockSimulation.force.mockReturnValue(mockSimulation);
  mockSimulation.stop.mockReturnValue(mockSimulation);
  mockSimulation.restart.mockReturnValue(mockSimulation);
  mockSimulation.alpha.mockReturnValue(mockSimulation);
  mockSimulation.numDimensions.mockReturnValue(mockSimulation);
  mockSimulation.on.mockReturnValue(mockSimulation);
  
  return { mockSimulation };
});

// Mock d3-force-3d - use arrow functions to ensure fresh mocks
vi.mock('d3-force-3d', () => ({
  forceSimulation: vi.fn(() => mockSimulation),
  forceManyBody: vi.fn(() => ({
    strength: vi.fn().mockReturnThis(),
    distance: vi.fn().mockReturnThis(),
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
  forceLink: vi.fn(() => ({
    strength: vi.fn().mockReturnThis(),
    distance: vi.fn().mockReturnThis(),
    links: vi.fn().mockReturnThis(),
    id: vi.fn().mockReturnThis(),
  })),
  forceCollide: vi.fn(() => ({
    strength: vi.fn().mockReturnThis(),
    radius: vi.fn().mockReturnThis(),
    iterations: vi.fn().mockReturnThis(),
  })),
  forceCenter: vi.fn(() => ({
    strength: vi.fn().mockReturnThis(),
  })),
  forceRadial: vi.fn(() => ({
    strength: vi.fn().mockReturnThis(),
  })),
}));

// Mock distributeNodesOnSphere utility
vi.mock('@/stores/useSimulationStore/utils/distributeNodesOnSphere', () => ({
  distributeNodesOnSphere: vi.fn(),
}));

// Mock useGraphStore
vi.mock('@/stores/useGraphStore', () => ({
  useGraphStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
    destroy: vi.fn(),
  },
}));

describe('useSimulationStore - addClusterForce', () => {
  const mockNeighbourhoods = [
    { name: 'Neighborhood A', ref_id: 'n1' },
    { name: 'Neighborhood B', ref_id: 'n2' },
    { name: 'Neighborhood C', ref_id: 'n3' },
  ];

  const mockNeighborhoodCenters = {
    n1: { x: 1000, y: 0, z: 0 },
    n2: { x: -500, y: 866, z: 0 },
    n3: { x: -500, y: -866, z: 0 },
  };

  const mockNodes: NodeExtended[] = [
    {
      ref_id: 'node1',
      node_type: 'test',
      name: 'Node 1',
      neighbourHood: 'n1',
      scale: 1.5,
      x: 100,
      y: 200,
      z: 300,
      fx: 100,
      fy: 200,
      fz: 300,
      vx: 10,
      vy: 20,
      vz: 30,
    },
    {
      ref_id: 'node2',
      node_type: 'test',
      name: 'Node 2',
      neighbourHood: 'n2',
      scale: 2.0,
      x: 400,
      y: 500,
      z: 600,
      fx: 400,
      fy: 500,
      fz: 600,
      vx: 40,
      vy: 50,
      vz: 60,
    },
    {
      ref_id: 'node3',
      node_type: 'test',
      name: 'Node 3',
      neighbourHood: 'n3',
      scale: 1.0,
      x: 700,
      y: 800,
      z: 900,
      fx: 700,
      fy: 800,
      fz: 900,
      vx: 70,
      vy: 80,
      vz: 90,
    },
  ];

  const mockLinks = [
    { source: 'node1', target: 'node2', ref_id: 'link1' },
    { source: 'node2', target: 'node3', ref_id: 'link2' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reconfigure mock simulation methods
    mockSimulation.nodes.mockReturnValue(mockSimulation);
    mockSimulation.force.mockReturnValue(mockSimulation);
    
    // Reset store state
    useSimulationStore.setState({
      simulation: null,
      simulationVersion: 0,
      simulationInProgress: false,
    });

    // Mock useGraphStore.getState to return test neighbourhoods
    vi.mocked(useGraphStore.getState).mockReturnValue({
      neighbourhoods: mockNeighbourhoods,
    } as any);

    // Mock distributeNodesOnSphere to return predictable centers
    vi.mocked(distributeNodesOnSphere).mockReturnValue(mockNeighborhoodCenters);

    // Setup mock simulation with nodes and links
    mockSimulation.nodes.mockReturnValue(mockNodes);
    mockSimulation.force.mockImplementation((forceName: string) => {
      if (forceName === 'link') {
        return {
          links: vi.fn().mockReturnValue(mockLinks.map(l => ({
            ...l,
            source: { ref_id: l.source },
            target: { ref_id: l.target },
          }))),
        };
      }
      return mockSimulation;
    });
  });

  test('calls distributeNodesOnSphere with neighbourhoods and radius 3000', () => {
    const { result } = renderHook(() => useSimulationStore());

    // Initialize simulation first
    act(() => {
      result.current.simulationCreate(mockNodes);
    });

    act(() => {
      result.current.addClusterForce();
    });

    expect(distributeNodesOnSphere).toHaveBeenCalledWith(mockNeighbourhoods, 3000);
    expect(distributeNodesOnSphere).toHaveBeenCalledTimes(1);
  });

  test('resets all node positions to null', () => {
    const { result } = renderHook(() => useSimulationStore());

    act(() => {
      result.current.simulationCreate(mockNodes);
    });

    act(() => {
      result.current.addClusterForce();
    });

    expect(mockSimulation.nodes).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          fx: null,
          fy: null,
          fz: null,
          x: null,
          y: null,
          z: null,
          vx: null,
          vy: null,
          vz: null,
        }),
      ])
    );
  });

  test('configures charge force with strength 0', () => {
    const { result } = renderHook(() => useSimulationStore());

    act(() => {
      result.current.simulationCreate(mockNodes);
    });

    const { forceManyBody } = require('d3-force-3d');
    const mockChargeForceFn = forceManyBody();

    act(() => {
      result.current.addClusterForce();
    });

    expect(mockSimulation.force).toHaveBeenCalledWith('charge', expect.anything());
    expect(mockChargeForceFn.strength).toHaveBeenCalled();
    
    // Verify strength function returns 0 for any node scale
    const strengthFn = mockChargeForceFn.strength.mock.calls[0][0];
    expect(strengthFn({ scale: 1.5 })).toBe(0);
    expect(strengthFn({ scale: 2.0 })).toBe(0);
  });

  test('configures forceX with strength 0.1 targeting neighborhood centers', () => {
    const { result } = renderHook(() => useSimulationStore());

    act(() => {
      result.current.simulationCreate(mockNodes);
    });

    const { forceX } = require('d3-force-3d');
    const mockForceXFn = forceX();

    act(() => {
      result.current.addClusterForce();
    });

    expect(mockSimulation.force).toHaveBeenCalledWith('x', expect.anything());
    expect(mockForceXFn.strength).toHaveBeenCalledWith(0.1);

    // Verify X position function returns correct neighborhood center X coordinate
    const xPositionFn = forceX.mock.calls[0][0];
    expect(xPositionFn({ neighbourHood: 'n1' })).toBe(1000);
    expect(xPositionFn({ neighbourHood: 'n2' })).toBe(-500);
    expect(xPositionFn({ neighbourHood: 'n3' })).toBe(-500);
    expect(xPositionFn({ neighbourHood: null })).toBe(0);
  });

  test('configures forceY with strength 0.1 targeting neighborhood centers', () => {
    const { result } = renderHook(() => useSimulationStore());

    act(() => {
      result.current.simulationCreate(mockNodes);
    });

    const { forceY } = require('d3-force-3d');
    const mockForceYFn = forceY();

    act(() => {
      result.current.addClusterForce();
    });

    expect(mockSimulation.force).toHaveBeenCalledWith('y', expect.anything());
    expect(mockForceYFn.strength).toHaveBeenCalledWith(0.1);

    // Verify Y position function returns correct neighborhood center Y coordinate
    const yPositionFn = forceY.mock.calls[0][0];
    expect(yPositionFn({ neighbourHood: 'n1' })).toBe(0);
    expect(yPositionFn({ neighbourHood: 'n2' })).toBe(866);
    expect(yPositionFn({ neighbourHood: 'n3' })).toBe(-866);
    expect(yPositionFn({ neighbourHood: null })).toBe(0);
  });

  test('configures forceZ with strength 0.1 targeting neighborhood centers', () => {
    const { result } = renderHook(() => useSimulationStore());

    act(() => {
      result.current.simulationCreate(mockNodes);
    });

    const { forceZ } = require('d3-force-3d');
    const mockForceZFn = forceZ();

    act(() => {
      result.current.addClusterForce();
    });

    expect(mockSimulation.force).toHaveBeenCalledWith('z', expect.anything());
    expect(mockForceZFn.strength).toHaveBeenCalledWith(0.1);

    // Verify Z position function returns correct neighborhood center Z coordinate
    const zPositionFn = forceZ.mock.calls[0][0];
    expect(zPositionFn({ neighbourHood: 'n1' })).toBe(0);
    expect(zPositionFn({ neighbourHood: 'n2' })).toBe(0);
    expect(zPositionFn({ neighbourHood: 'n3' })).toBe(0);
    expect(zPositionFn({ neighbourHood: null })).toBe(0);
  });

  test('configures link force with strength 0 and distance 400', () => {
    const { result } = renderHook(() => useSimulationStore());

    act(() => {
      result.current.simulationCreate(mockNodes);
    });

    const { forceLink } = require('d3-force-3d');
    const mockLinkForceFn = forceLink();

    act(() => {
      result.current.addClusterForce();
    });

    expect(mockSimulation.force).toHaveBeenCalledWith('link', expect.anything());
    expect(mockLinkForceFn.strength).toHaveBeenCalledWith(0);
    expect(mockLinkForceFn.distance).toHaveBeenCalledWith(400);
    expect(mockLinkForceFn.links).toHaveBeenCalled();
    expect(mockLinkForceFn.id).toHaveBeenCalled();
  });

  test('configures collision force with radius 95*scale and strength 0.5', () => {
    const { result } = renderHook(() => useSimulationStore());

    act(() => {
      result.current.simulationCreate(mockNodes);
    });

    const { forceCollide } = require('d3-force-3d');
    const mockCollideForceFn = forceCollide();

    act(() => {
      result.current.addClusterForce();
    });

    expect(mockSimulation.force).toHaveBeenCalledWith('collide', expect.anything());
    expect(mockCollideForceFn.strength).toHaveBeenCalledWith(0.5);
    expect(mockCollideForceFn.iterations).toHaveBeenCalledWith(1);

    // Verify radius function calculates correctly: scale * 95
    const radiusFn = mockCollideForceFn.radius.mock.calls[0][0];
    expect(radiusFn({ scale: 1.5 })).toBe(142.5); // 1.5 * 95
    expect(radiusFn({ scale: 2.0 })).toBe(190); // 2.0 * 95
    expect(radiusFn({ scale: 1.0 })).toBe(95); // 1.0 * 95
    expect(radiusFn({})).toBe(95); // default scale = 1
  });

  test('handles empty neighbourhoods array gracefully', () => {
    vi.mocked(useGraphStore.getState).mockReturnValue({
      neighbourhoods: [],
    } as any);

    vi.mocked(distributeNodesOnSphere).mockReturnValue(null);

    const { result } = renderHook(() => useSimulationStore());

    act(() => {
      result.current.simulationCreate(mockNodes);
    });

    act(() => {
      result.current.addClusterForce();
    });

    // Should still configure forces, just with null neighborhood centers
    expect(mockSimulation.force).toHaveBeenCalledWith('charge', expect.anything());
    expect(mockSimulation.force).toHaveBeenCalledWith('x', expect.anything());
    expect(mockSimulation.force).toHaveBeenCalledWith('y', expect.anything());
    expect(mockSimulation.force).toHaveBeenCalledWith('z', expect.anything());
  });

  test('returns 0 coordinates for nodes without neighbourhood property', () => {
    const { result } = renderHook(() => useSimulationStore());

    act(() => {
      result.current.simulationCreate(mockNodes);
    });

    const { forceX, forceY, forceZ } = require('d3-force-3d');

    act(() => {
      result.current.addClusterForce();
    });

    const xPositionFn = forceX.mock.calls[0][0];
    const yPositionFn = forceY.mock.calls[0][0];
    const zPositionFn = forceZ.mock.calls[0][0];

    // Node without neighbourhood property should return 0 for all coordinates
    const nodeWithoutNeighbourhood = { ref_id: 'orphan', name: 'Orphan Node' };
    expect(xPositionFn(nodeWithoutNeighbourhood)).toBe(0);
    expect(yPositionFn(nodeWithoutNeighbourhood)).toBe(0);
    expect(zPositionFn(nodeWithoutNeighbourhood)).toBe(0);
  });

  test('converts link source/target from objects to ref_id strings', () => {
    const { result } = renderHook(() => useSimulationStore());

    act(() => {
      result.current.simulationCreate(mockNodes);
    });

    const { forceLink } = require('d3-force-3d');
    const mockLinkForceFn = forceLink();

    // Mock links with object references (D3 format after initialization)
    const d3Links = mockLinks.map(l => ({
      ...l,
      source: { ref_id: l.source },
      target: { ref_id: l.target },
    }));

    mockSimulation.force.mockImplementation((forceName: string) => {
      if (forceName === 'link') {
        return {
          links: vi.fn().mockReturnValue(d3Links),
        };
      }
      return mockSimulation;
    });

    act(() => {
      result.current.addClusterForce();
    });

    // Verify links are converted back to string format
    const linksArg = mockLinkForceFn.links.mock.calls[0][0];
    expect(linksArg).toEqual([
      { source: 'node1', target: 'node2', ref_id: 'link1' },
      { source: 'node2', target: 'node3', ref_id: 'link2' },
    ]);
  });

  test('uses ref_id as link identifier function', () => {
    const { result } = renderHook(() => useSimulationStore());

    act(() => {
      result.current.simulationCreate(mockNodes);
    });

    const { forceLink } = require('d3-force-3d');
    const mockLinkForceFn = forceLink();

    act(() => {
      result.current.addClusterForce();
    });

    // Verify id function extracts ref_id from node
    const idFn = mockLinkForceFn.id.mock.calls[0][0];
    expect(idFn({ ref_id: 'test-node-id' })).toBe('test-node-id');
  });

  test('preserves node properties other than position', () => {
    const { result } = renderHook(() => useSimulationStore());

    act(() => {
      result.current.simulationCreate(mockNodes);
    });

    act(() => {
      result.current.addClusterForce();
    });

    const resetNodes = mockSimulation.nodes.mock.calls[0][0];
    
    // Verify non-position properties are preserved
    expect(resetNodes[0]).toMatchObject({
      ref_id: 'node1',
      node_type: 'test',
      name: 'Node 1',
      neighbourHood: 'n1',
      scale: 1.5,
    });

    expect(resetNodes[1]).toMatchObject({
      ref_id: 'node2',
      node_type: 'test',
      name: 'Node 2',
      neighbourHood: 'n2',
      scale: 2.0,
    });
  });
});
