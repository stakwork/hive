import { vi } from 'vitest'
import * as d3Force from 'd3-force-3d'
import { useGraphStore } from '@/stores/useGraphStore'

/**
 * Creates a mock simulation object with chained methods for testing
 */
export function createMockSimulation(mockNodes: any[] = [], mockLinks: any[] = []) {
  const mockLinkForce = {
    links: vi.fn().mockReturnValue(mockLinks),
  }

  return {
    nodes: vi.fn().mockImplementation(function(nodes?: any) {
      if (arguments.length === 0) {
        return mockNodes
      }
      return this
    }),
    force: vi.fn().mockImplementation(function(name: string, forceValue?: any) {
      if (arguments.length === 2) {
        return this
      }
      if (name === 'link') {
        return mockLinkForce
      }
      return null
    }),
    on: vi.fn().mockReturnThis(),
    alpha: vi.fn().mockReturnThis(),
    restart: vi.fn().mockReturnThis(),
  }
}

/**
 * Creates mock force objects that can be chained
 */
export function createMockForces() {
  return {
    charge: vi.fn().mockReturnThis(),
    x: vi.fn().mockReturnThis(),
    y: vi.fn().mockReturnThis(),
    z: vi.fn().mockReturnThis(),
    link: vi.fn().mockReturnThis(),
    collide: vi.fn().mockReturnThis(),
    radial: vi.fn().mockReturnThis(),
    center: vi.fn().mockReturnThis(),
  }
}

/**
 * Creates mock node data for testing
 */
export function createMockNodes(count: number = 2) {
  return Array.from({ length: count }, (_, i) => ({
    ref_id: `node${i + 1}`,
    x: 100 * (i + 1),
    y: 200 * (i + 1),
    z: 300 * (i + 1),
    fx: 10 * (i + 1),
    fy: 20 * (i + 1),
    fz: 30 * (i + 1),
    vx: 5 * (i + 1),
    vy: 10 * (i + 1),
    vz: 15 * (i + 1),
  }))
}

/**
 * Creates mock link data for testing
 */
export function createMockLinks(nodeIds: string[] = ['node1', 'node2']) {
  return [
    { source: { ref_id: nodeIds[0] }, target: { ref_id: nodeIds[1] } },
  ]
}

/**
 * Sets up all D3 force mocks with proper chaining
 */
export function setupD3ForceMocks(mockForces: ReturnType<typeof createMockForces>) {
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

  const mockLinkForceInstance = {
    links: vi.fn().mockReturnThis(),
    strength: vi.fn().mockReturnThis(),
    distance: vi.fn().mockReturnThis(),
    id: vi.fn().mockReturnThis(),
  }

  vi.mocked(d3Force.forceLink).mockReturnValue(mockLinkForceInstance as any)

  vi.mocked(d3Force.forceCollide).mockReturnValue({
    radius: vi.fn().mockReturnThis(),
    strength: vi.fn().mockReturnThis(),
    iterations: vi.fn().mockReturnValue(mockForces.collide),
  } as any)

  vi.mocked(d3Force.forceRadial).mockReturnValue({
    strength: vi.fn().mockReturnValue(mockForces.radial),
  } as any)

  vi.mocked(d3Force.forceCenter).mockReturnValue({
    strength: vi.fn().mockReturnValue(mockForces.center),
  } as any)
}

/**
 * Sets up mock graph store with neighbourhoods and graph style
 */
export function setupMockGraphStore(
  neighbourhoods: any[] = [],
  graphStyle: string = 'force'
) {
  vi.mocked(useGraphStore.getState).mockReturnValue({
    neighbourhoods,
    graphStyle,
    setGraphRadius: vi.fn(),
    setGraphStyle: vi.fn(),
    highlightNodes: [],
  } as any)
}

/**
 * Creates a complete mock setup for simulation store tests
 * This is a convenience function that combines all the individual setup functions
 */
export function setupSimulationStoreMocks(options: {
  nodeCount?: number
  graphStyle?: string
  neighbourhoods?: any[]
} = {}) {
  const mockNodes = createMockNodes(options.nodeCount || 2)
  const mockLinks = createMockLinks()
  const mockForces = createMockForces()
  const mockSimulation = createMockSimulation(mockNodes, mockLinks)

  setupD3ForceMocks(mockForces)
  setupMockGraphStore(options.neighbourhoods || [], options.graphStyle || 'force')

  return {
    mockSimulation,
    mockForces,
    mockNodes,
    mockLinks,
  }
}
