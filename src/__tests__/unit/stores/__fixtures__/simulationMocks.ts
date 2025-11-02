import { vi } from 'vitest'
import * as d3Force from 'd3-force-3d'
import { useGraphStore } from '@/stores/useGraphStore'
import { distributeNodesOnSphere } from '@/stores/useSimulationStore/utils/distributeNodesOnSphere'

/**
 * Creates mock node data for testing simulation
 */
export const createMockNodes = () => [
  { ref_id: 'node1', x: 100, y: 200, z: 300, fx: 10, fy: 20, fz: 30, vx: 5, vy: 10, vz: 15 },
  { ref_id: 'node2', x: 400, y: 500, z: 600, fx: 40, fy: 50, fz: 60, vx: 25, vy: 30, vz: 35 },
]

/**
 * Creates mock forces object with chained return values
 */
export const createMockForces = () => ({
  charge: vi.fn().mockReturnThis(),
  x: vi.fn().mockReturnThis(),
  y: vi.fn().mockReturnThis(),
  z: vi.fn().mockReturnThis(),
  link: vi.fn().mockReturnThis(),
  collide: vi.fn().mockReturnThis(),
  radial: vi.fn().mockReturnThis(),
  center: vi.fn().mockReturnThis(),
})

/**
 * Creates mock link force with test links
 */
export const createMockLinkForce = () => ({
  links: vi.fn().mockReturnValue([
    { source: { ref_id: 'node1' }, target: { ref_id: 'node2' } },
  ]),
})

/**
 * Creates mock link force instance with chainable methods
 */
export const createMockLinkForceInstance = () => ({
  links: vi.fn().mockReturnThis(),
  strength: vi.fn().mockReturnThis(),
  distance: vi.fn().mockReturnThis(),
  id: vi.fn().mockReturnThis(),
})

/**
 * Creates mock simulation with all required methods
 */
export const createMockSimulation = (mockNodes: any[], mockLinkForce: any) => ({
  nodes: vi.fn().mockImplementation(function(nodes?: any) {
    // When called with argument, set nodes and return simulation (chaining)
    // When called without argument, return the current nodes array
    if (arguments.length === 0) {
      return mockNodes
    }
    return this
  }),
  force: vi.fn().mockImplementation(function(name: string, forceValue?: any) {
    // If called with 2 arguments, it's a setter - return simulation for chaining
    if (arguments.length === 2) {
      return this
    }
    // If called with 1 argument, it's a getter - return the force
    if (name === 'link') {
      return mockLinkForce
    }
    return null
  }),
  on: vi.fn().mockReturnThis(),
  alpha: vi.fn().mockReturnThis(),
  restart: vi.fn().mockReturnThis(),
})

/**
 * Setup D3 force mocks with proper chaining
 */
export const setupD3ForceMocks = (mockForces: any) => {
  vi.mocked(d3Force.forceManyBody).mockReturnValue({
    strength: vi.fn().mockReturnValue(mockForces.charge),
  } as any)
  
  vi.mocked(d3Force.forceX).mockReturnValue({
    strength: vi.fn().mockReturnValue(mockForces.x),
  } as any)
  
  vi.mocked(d3Force.forceY).mockReturnValue({
    strength: vi.fn().mockReturnValue(mockForces.y),
  } as any)
  
  vi.mocked(d3Force.forceZ).mockReturnValue({
    strength: vi.fn().mockReturnValue(mockForces.z),
  } as any)
  
  const mockLinkForceInstance = createMockLinkForceInstance()
  vi.mocked(d3Force.forceLink).mockReturnValue(mockLinkForceInstance as any)
  
  vi.mocked(d3Force.forceCollide).mockReturnValue({
    radius: vi.fn().mockReturnThis(),
    strength: vi.fn().mockReturnThis(),
    iterations: vi.fn().mockReturnValue(mockForces.collide),
  } as any)
  
  vi.mocked(d3Force.forceRadial).mockReturnValue({
    strength: vi.fn().mockReturnThis(),
  } as any)
  
  vi.mocked(d3Force.forceCenter).mockReturnValue({
    strength: vi.fn().mockReturnThis(),
  } as any)
}

/**
 * Setup mock for distributeNodesOnSphere utility
 */
export const setupDistributeNodesMock = () => {
  vi.mocked(distributeNodesOnSphere).mockReturnValue({
    'hood1': { x: 1000, y: 2000, z: 3000 },
    'hood2': { x: -1000, y: -2000, z: -3000 },
  })
}

/**
 * Setup mock for useGraphStore with default values
 */
export const setupGraphStoreMock = (graphStyle: string = 'force') => {
  vi.mocked(useGraphStore.getState).mockReturnValue({
    neighbourhoods: [
      { ref_id: 'hood1', name: 'Neighborhood 1' },
      { ref_id: 'hood2', name: 'Neighborhood 2' },
    ],
    graphStyle,
    setGraphRadius: vi.fn(),
    setGraphStyle: vi.fn(),
    highlightNodes: [],
  } as any)
}

/**
 * Complete setup for simulation store tests
 */
export const setupSimulationMocks = (graphStyle: string = 'force') => {
  const mockForces = createMockForces()
  const mockNodes = createMockNodes()
  const mockLinkForce = createMockLinkForce()
  const mockSimulation = createMockSimulation(mockNodes, mockLinkForce)
  
  setupD3ForceMocks(mockForces)
  setupDistributeNodesMock()
  setupGraphStoreMock(graphStyle)
  
  return {
    mockSimulation,
    mockForces,
    mockNodes,
    mockLinkForce,
  }
}
