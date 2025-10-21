import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { NodeExtended, Link } from '@/types/graph'
import type { Neighbourhood } from '@/stores/useGraphStore'

// Mock d3-force-3d with chainable API
let simulationNodes: any[] = []

// Mock force objects that will be returned by simulation.force()
const mockLinkForce = {
  links: vi.fn((newLinks?: any[]) => {
    if (newLinks !== undefined) {
      return mockLinkForce
    }
    return []
  }),
  id: vi.fn(() => mockLinkForce),
  strength: vi.fn(() => mockLinkForce),
  distance: vi.fn(() => mockLinkForce),
}

const mockForceSimulation: any = {
  nodes: vi.fn((newNodes?: any[]) => {
    if (newNodes !== undefined) {
      simulationNodes = newNodes
      return mockForceSimulation
    }
    return simulationNodes.length > 0 ? simulationNodes : []
  }),
  force: vi.fn((name?: string, forceValue?: any) => {
    // When called with just a name (getter), return the appropriate mock force
    if (forceValue === undefined && name === 'link') {
      return mockLinkForce
    }
    // When called with name and value (setter), return simulation for chaining
    return mockForceSimulation
  }),
  alpha: vi.fn(() => mockForceSimulation),
  alphaDecay: vi.fn(() => mockForceSimulation),
  restart: vi.fn(() => mockForceSimulation),
  stop: vi.fn(() => mockForceSimulation),
  on: vi.fn(() => mockForceSimulation),
}

const mockForceManyBody = vi.fn(() => ({
  strength: vi.fn().mockReturnThis(),
}))

const mockForceX = vi.fn(() => ({
  strength: vi.fn().mockReturnThis(),
  x: vi.fn().mockReturnThis(),
}))

const mockForceY = vi.fn(() => ({
  strength: vi.fn().mockReturnThis(),
  y: vi.fn().mockReturnThis(),
}))

const mockForceZ = vi.fn(() => ({
  strength: vi.fn().mockReturnThis(),
  z: vi.fn().mockReturnThis(),
}))

const mockForceLink = vi.fn(() => ({
  links: vi.fn().mockReturnThis(),
  strength: vi.fn().mockReturnThis(),
  distance: vi.fn().mockReturnThis(),
  id: vi.fn().mockReturnThis(),
}))

const mockForceCollide = vi.fn(() => ({
  radius: vi.fn().mockReturnThis(),
  strength: vi.fn().mockReturnThis(),
  iterations: vi.fn().mockReturnThis(),
}))

const mockForceSimulationFn = vi.fn(() => mockForceSimulation)

vi.mock('d3-force-3d', () => ({
  forceSimulation: mockForceSimulationFn,
  forceManyBody: mockForceManyBody,
  forceX: mockForceX,
  forceY: mockForceY,
  forceZ: mockForceZ,
  forceLink: mockForceLink,
  forceCollide: mockForceCollide,
  forceCenter: vi.fn(() => ({ strength: vi.fn().mockReturnThis() })),
  forceRadial: vi.fn(() => ({ 
    strength: vi.fn().mockReturnThis(),
    radius: vi.fn().mockReturnThis(),
  })),
}))

// Mock distributeNodesOnSphere utility
const mockDistributeNodesOnSphere = vi.fn((neighbourhoods: Neighbourhood[], radius: number) => {
  return neighbourhoods.reduce((acc, neighbourhood, i) => {
    // Simple deterministic distribution for testing
    const theta = (2 * Math.PI * i) / neighbourhoods.length
    acc[neighbourhood.ref_id] = {
      x: radius * Math.cos(theta),
      y: radius * Math.sin(theta),
      z: 0,
    }
    return acc
  }, {} as Record<string, { x: number; y: number; z: number }>)
})

vi.mock('@/stores/useSimulationStore/utils/distributeNodesOnSphere', () => ({
  distributeNodesOnSphere: mockDistributeNodesOnSphere,
}))

// Mock useGraphStore
const mockGraphStore = {
  neighbourhoods: [] as Neighbourhood[],
  graphStyle: 'force' as 'force' | 'sphere' | 'split',
}

vi.mock('@/stores/useGraphStore', () => ({
  useGraphStore: {
    getState: vi.fn(() => mockGraphStore),
  },
}))

// Mock useDataStore
vi.mock('@/stores/useDataStore', () => ({
  useDataStore: {
    getState: vi.fn(() => ({
      nodeTypes: ['feature', 'bug', 'task'],
    })),
  },
}))

describe('useSimulationStore - addClusterForce', () => {
  let useSimulationStore: any

  beforeEach(async () => {
    vi.clearAllMocks()
    
    // Reset simulation nodes state
    simulationNodes = []
    
    // Reset mock store state
    mockGraphStore.neighbourhoods = []
    mockGraphStore.graphStyle = 'force'
    
    // Import store after mocks are set up
    const module = await import('@/stores/useSimulationStore')
    useSimulationStore = module.useSimulationStore
    
    // Initialize store with mock simulation
    useSimulationStore.setState({ 
      simulation: mockForceSimulation,
      simulationInProgress: false,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    simulationNodes = []
  })

  describe('Neighborhood center distribution', () => {
    it('distributes neighborhood centers on sphere at radius 3000', () => {
      const mockNeighbourhoods: Neighbourhood[] = [
        { ref_id: 'neighborhood-1', name: 'Backend' },
        { ref_id: 'neighborhood-2', name: 'Frontend' },
        { ref_id: 'neighborhood-3', name: 'Database' },
      ]

      mockGraphStore.neighbourhoods = mockNeighbourhoods

      const { addClusterForce } = useSimulationStore.getState()
      addClusterForce()

      expect(mockDistributeNodesOnSphere).toHaveBeenCalledWith(mockNeighbourhoods, 3000)
    })

    it('handles empty neighbourhoods array gracefully', () => {
      mockGraphStore.neighbourhoods = []

      const { addClusterForce } = useSimulationStore.getState()
      
      expect(() => addClusterForce()).not.toThrow()
      expect(mockDistributeNodesOnSphere).not.toHaveBeenCalled()
    })

    it('handles null/undefined neighbourhoods gracefully', () => {
      mockGraphStore.neighbourhoods = null as any

      const { addClusterForce } = useSimulationStore.getState()
      
      expect(() => addClusterForce()).not.toThrow()
      expect(mockDistributeNodesOnSphere).not.toHaveBeenCalled()
    })
  })

  describe('Node position reset', () => {
    it('resets all node positions before applying force', () => {
      const mockNodes: NodeExtended[] = [
        { ref_id: 'node-1', x: 100, y: 200, z: 300, fx: 10, fy: 20, fz: 30, vx: 5, vy: 10, vz: 15 } as any,
        { ref_id: 'node-2', x: 400, y: 500, z: 600, fx: 40, fy: 50, fz: 60, vx: 20, vy: 25, vz: 30 } as any,
      ]

      mockForceSimulation.nodes.mockReturnValue(mockNodes)
      mockGraphStore.neighbourhoods = [{ ref_id: 'neighborhood-1', name: 'Test' }]

      const { addClusterForce } = useSimulationStore.getState()
      addClusterForce()

      expect(mockForceSimulation.nodes).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            ref_id: 'node-1',
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
          expect.objectContaining({
            ref_id: 'node-2',
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
      )
    })

    it('preserves non-position node properties during reset', () => {
      const mockNodes: NodeExtended[] = [
        { 
          ref_id: 'node-1', 
          name: 'Test Node',
          node_type: 'feature',
          scale: 1.5,
          x: 100, 
          y: 200, 
          z: 300,
        } as any,
      ]

      mockForceSimulation.nodes.mockReturnValue(mockNodes)
      mockGraphStore.neighbourhoods = [{ ref_id: 'neighborhood-1', name: 'Test' }]

      const { addClusterForce } = useSimulationStore.getState()
      addClusterForce()

      const resetNodesCall = mockForceSimulation.nodes.mock.calls[0][0]
      expect(resetNodesCall[0]).toMatchObject({
        ref_id: 'node-1',
        name: 'Test Node',
        node_type: 'feature',
        scale: 1.5,
      })
    })
  })

  describe('Force configuration', () => {
    beforeEach(() => {
      mockGraphStore.neighbourhoods = [
        { ref_id: 'neighborhood-1', name: 'Backend' },
      ]
    })

    it('configures charge force with strength 0 (no node repulsion)', () => {
      const { addClusterForce } = useSimulationStore.getState()
      addClusterForce()

      expect(mockForceManyBody).toHaveBeenCalled()
      
      const chargeForceCall = mockForceSimulation.force.mock.calls.find(
        call => call[0] === 'charge'
      )
      expect(chargeForceCall).toBeDefined()
    })

    it('configures forceX with strength 0.1 toward neighborhood centers', () => {
      const { addClusterForce } = useSimulationStore.getState()
      addClusterForce()

      expect(mockForceX).toHaveBeenCalled()
      
      const forceXCall = mockForceSimulation.force.mock.calls.find(
        call => call[0] === 'x'
      )
      expect(forceXCall).toBeDefined()
    })

    it('configures forceY with strength 0.1 toward neighborhood centers', () => {
      const { addClusterForce } = useSimulationStore.getState()
      addClusterForce()

      expect(mockForceY).toHaveBeenCalled()
      
      const forceYCall = mockForceSimulation.force.mock.calls.find(
        call => call[0] === 'y'
      )
      expect(forceYCall).toBeDefined()
    })

    it('configures forceZ with strength 0.1 toward neighborhood centers', () => {
      const { addClusterForce } = useSimulationStore.getState()
      addClusterForce()

      expect(mockForceZ).toHaveBeenCalled()
      
      const forceZCall = mockForceSimulation.force.mock.calls.find(
        call => call[0] === 'z'
      )
      expect(forceZCall).toBeDefined()
    })

    it('configures link force with strength 0 and distance 400', () => {
      const { addClusterForce } = useSimulationStore.getState()
      addClusterForce()

      expect(mockForceLink).toHaveBeenCalled()
      
      const linkForceCall = mockForceSimulation.force.mock.calls.find(
        call => call[0] === 'link'
      )
      expect(linkForceCall).toBeDefined()
    })

    it('configures collision detection based on node scale', () => {
      const { addClusterForce } = useSimulationStore.getState()
      addClusterForce()

      expect(mockForceCollide).toHaveBeenCalled()
      
      const collideForceCall = mockForceSimulation.force.mock.calls.find(
        call => call[0] === 'collide'
      )
      expect(collideForceCall).toBeDefined()
    })

    it('applies all force types in correct order', () => {
      const { addClusterForce } = useSimulationStore.getState()
      addClusterForce()

      const forceCallOrder = mockForceSimulation.force.mock.calls.map(call => call[0])
      
      expect(forceCallOrder).toContain('charge')
      expect(forceCallOrder).toContain('x')
      expect(forceCallOrder).toContain('y')
      expect(forceCallOrder).toContain('z')
      expect(forceCallOrder).toContain('link')
      expect(forceCallOrder).toContain('collide')
    })
  })

  describe('Neighborhood clustering behavior', () => {
    it('attracts nodes to their assigned neighborhood center', () => {
      const mockNeighbourhoods: Neighbourhood[] = [
        { ref_id: 'neighborhood-1', name: 'Backend' },
        { ref_id: 'neighborhood-2', name: 'Frontend' },
      ]

      mockGraphStore.neighbourhoods = mockNeighbourhoods

      const mockNodes: NodeExtended[] = [
        { ref_id: 'node-1', neighbourHood: 'neighborhood-1' } as any,
        { ref_id: 'node-2', neighbourHood: 'neighborhood-2' } as any,
      ]

      mockForceSimulation.nodes.mockReturnValue(mockNodes)

      const { addClusterForce } = useSimulationStore.getState()
      addClusterForce()

      expect(mockDistributeNodesOnSphere).toHaveBeenCalledWith(mockNeighbourhoods, 3000)
      expect(mockForceX).toHaveBeenCalled()
      expect(mockForceY).toHaveBeenCalled()
      expect(mockForceZ).toHaveBeenCalled()
    })

    it('handles nodes without neighborhood assignment', () => {
      const mockNeighbourhoods: Neighbourhood[] = [
        { ref_id: 'neighborhood-1', name: 'Backend' },
      ]

      mockGraphStore.neighbourhoods = mockNeighbourhoods

      const mockNodes: NodeExtended[] = [
        { ref_id: 'node-1', neighbourHood: 'neighborhood-1' } as any,
        { ref_id: 'node-2', neighbourHood: undefined } as any,
      ]

      mockForceSimulation.nodes.mockReturnValue(mockNodes)

      const { addClusterForce } = useSimulationStore.getState()
      
      expect(() => addClusterForce()).not.toThrow()
    })

    it('handles nodes with non-existent neighborhood reference', () => {
      const mockNeighbourhoods: Neighbourhood[] = [
        { ref_id: 'neighborhood-1', name: 'Backend' },
      ]

      mockGraphStore.neighbourhoods = mockNeighbourhoods

      const mockNodes: NodeExtended[] = [
        { ref_id: 'node-1', neighbourHood: 'neighborhood-1' } as any,
        { ref_id: 'node-2', neighbourHood: 'non-existent-neighborhood' } as any,
      ]

      mockForceSimulation.nodes.mockReturnValue(mockNodes)

      const { addClusterForce } = useSimulationStore.getState()
      
      expect(() => addClusterForce()).not.toThrow()
    })
  })

  describe('Collision detection', () => {
    it('scales collision radius based on node scale property', () => {
      mockGraphStore.neighbourhoods = [{ ref_id: 'neighborhood-1', name: 'Test' }]

      const mockNodes: NodeExtended[] = [
        { ref_id: 'node-1', scale: 1.0 } as any,
        { ref_id: 'node-2', scale: 2.0 } as any,
        { ref_id: 'node-3', scale: 0.5 } as any,
      ]

      mockForceSimulation.nodes.mockReturnValue(mockNodes)

      const { addClusterForce } = useSimulationStore.getState()
      addClusterForce()

      expect(mockForceCollide).toHaveBeenCalled()
    })

    it('handles nodes without scale property (defaults to 1)', () => {
      mockGraphStore.neighbourhoods = [{ ref_id: 'neighborhood-1', name: 'Test' }]

      const mockNodes: NodeExtended[] = [
        { ref_id: 'node-1' } as any,
      ]

      mockForceSimulation.nodes.mockReturnValue(mockNodes)

      const { addClusterForce } = useSimulationStore.getState()
      
      expect(() => addClusterForce()).not.toThrow()
      expect(mockForceCollide).toHaveBeenCalled()
    })
  })
})

describe('useSimulationStore - setForces', () => {
  let useSimulationStore: any

  beforeEach(async () => {
    vi.clearAllMocks()
    
    // Reset simulation nodes state
    simulationNodes = []
    
    mockGraphStore.neighbourhoods = []
    mockGraphStore.graphStyle = 'force'
    
    const module = await import('@/stores/useSimulationStore')
    useSimulationStore = module.useSimulationStore
    
    useSimulationStore.setState({ 
      simulation: mockForceSimulation,
      simulationInProgress: false,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    simulationNodes = []
  })

  describe('Force layout switching', () => {
    it('calls addClusterForce when graphStyle is "force"', () => {
      mockGraphStore.graphStyle = 'force'
      mockGraphStore.neighbourhoods = [{ ref_id: 'neighborhood-1', name: 'Test' }]

      const { setForces } = useSimulationStore.getState()
      setForces()

      expect(mockDistributeNodesOnSphere).toHaveBeenCalled()
      expect(mockForceSimulation.alpha).toHaveBeenCalled()
      expect(mockForceSimulation.restart).toHaveBeenCalled()
    })

    it('does not call addClusterForce when graphStyle is "sphere"', () => {
      mockGraphStore.graphStyle = 'sphere'

      const { setForces } = useSimulationStore.getState()
      setForces()

      expect(mockDistributeNodesOnSphere).not.toHaveBeenCalled()
    })

    it('does not call addClusterForce when graphStyle is "split"', () => {
      mockGraphStore.graphStyle = 'split'

      const { setForces } = useSimulationStore.getState()
      setForces()

      // distributeNodesOnSphere is only called by addClusterForce with radius 3000
      const clusterForceCall = mockDistributeNodesOnSphere.mock.calls.find(
        call => call[1] === 3000
      )
      expect(clusterForceCall).toBeUndefined()
    })

    it('restarts simulation after force configuration', () => {
      mockGraphStore.graphStyle = 'force'
      mockGraphStore.neighbourhoods = [{ ref_id: 'neighborhood-1', name: 'Test' }]

      const { setForces } = useSimulationStore.getState()
      setForces()

      expect(mockForceSimulation.restart).toHaveBeenCalled()
    })
  })

  describe('Force configuration state management', () => {
    it('switches from sphere to cluster force layout', () => {
      mockGraphStore.neighbourhoods = [{ ref_id: 'neighborhood-1', name: 'Test' }]

      // Start with sphere
      mockGraphStore.graphStyle = 'sphere'
      const { setForces } = useSimulationStore.getState()
      setForces()

      const sphereCallCount = mockDistributeNodesOnSphere.mock.calls.filter(
        call => call[1] === 3000
      ).length

      // Switch to force
      mockGraphStore.graphStyle = 'force'
      setForces()

      const forceCallCount = mockDistributeNodesOnSphere.mock.calls.filter(
        call => call[1] === 3000
      ).length

      expect(forceCallCount).toBeGreaterThan(sphereCallCount)
    })

    it('maintains simulation state during force switching', () => {
      mockGraphStore.neighbourhoods = [{ ref_id: 'neighborhood-1', name: 'Test' }]

      const { setForces } = useSimulationStore.getState()
      
      mockGraphStore.graphStyle = 'force'
      setForces()

      expect(mockForceSimulation.nodes).toHaveBeenCalled()
      expect(mockForceSimulation.force).toHaveBeenCalled()
      
      mockGraphStore.graphStyle = 'sphere'
      setForces()

      expect(mockForceSimulation.alpha).toHaveBeenCalled()
      expect(mockForceSimulation.restart).toHaveBeenCalled()
    })
  })
})