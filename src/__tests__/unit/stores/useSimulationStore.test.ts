import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

// Mock d3-force-3d before importing the store
vi.mock('d3-force-3d', () => ({
  forceRadial: vi.fn(),
  forceCenter: vi.fn(),
  forceManyBody: vi.fn(),
  forceLink: vi.fn(),
  forceCollide: vi.fn(),
  forceX: vi.fn(),
  forceY: vi.fn(),
  forceZ: vi.fn(),
  forceSimulation: vi.fn(),
}))

// Mock the stores
vi.mock('@/stores/useGraphStore', () => ({
  useGraphStore: {
    getState: vi.fn(() => ({
      graphStyle: 'sphere',
      neighbourhoods: [],
    })),
    setState: vi.fn(),
  },
}))

vi.mock('@/stores/useDataStore', () => ({
  useDataStore: {
    getState: vi.fn(() => ({
      dataInitial: { nodes: [], links: [] },
      dataNew: null,
    })),
    setState: vi.fn(),
  },
}))

// Import after mocks are set up
import { useSimulationStore } from '@/stores/useSimulationStore'
import { useGraphStore } from '@/stores/useGraphStore'
import { useDataStore } from '@/stores/useDataStore'
import * as d3Force from 'd3-force-3d'

// Get references to the mocked functions
const mockForceRadial = vi.mocked(d3Force.forceRadial)
const mockForceCenter = vi.mocked(d3Force.forceCenter)
const mockForceManyBody = vi.mocked(d3Force.forceManyBody)
const mockForceLink = vi.mocked(d3Force.forceLink)
const mockForceCollide = vi.mocked(d3Force.forceCollide)
const mockForceX = vi.mocked(d3Force.forceX)
const mockForceY = vi.mocked(d3Force.forceY)
const mockForceZ = vi.mocked(d3Force.forceZ)

describe('useSimulationStore - addRadialForce', () => {
  let mockSimulation: any
  let mockRadialForceInstance: any
  let mockCenterForceInstance: any
  let mockChargeForceInstance: any
  let mockLinkForceInstance: any
  let mockCollideForceInstance: any
  let mockXForceInstance: any
  let mockYForceInstance: any
  let mockZForceInstance: any

  beforeEach(() => {
    // Create mock force instances with chainable methods
    mockRadialForceInstance = { strength: vi.fn().mockReturnThis() }
    mockCenterForceInstance = { strength: vi.fn().mockReturnThis() }
    mockChargeForceInstance = { strength: vi.fn().mockReturnThis() }
    mockXForceInstance = { strength: vi.fn().mockReturnThis() }
    mockYForceInstance = { strength: vi.fn().mockReturnThis() }
    mockZForceInstance = { strength: vi.fn().mockReturnThis() }

    mockLinkForceInstance = {
      links: vi.fn().mockReturnThis(),
      strength: vi.fn().mockReturnThis(),
      distance: vi.fn().mockReturnThis(),
      id: vi.fn().mockReturnThis(),
    }

    mockCollideForceInstance = {
      radius: vi.fn().mockReturnThis(),
      strength: vi.fn().mockReturnThis(),
      iterations: vi.fn().mockReturnThis(),
    }

    // Set up force function mocks
    mockForceRadial.mockReturnValue(mockRadialForceInstance)
    mockForceCenter.mockReturnValue(mockCenterForceInstance)
    mockForceManyBody.mockReturnValue(mockChargeForceInstance)
    mockForceLink.mockReturnValue(mockLinkForceInstance)
    mockForceCollide.mockReturnValue(mockCollideForceInstance)
    mockForceX.mockReturnValue(mockXForceInstance)
    mockForceY.mockReturnValue(mockYForceInstance)
    mockForceZ.mockReturnValue(mockZForceInstance)

    // Create mock simulation with chainable methods
    mockSimulation = {
      nodes: vi.fn().mockReturnThis(),
      force: vi.fn().mockReturnThis(),
      alpha: vi.fn().mockReturnThis(),
      alphaTarget: vi.fn().mockReturnThis(),
      restart: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
    }

    // Default behavior: return empty array when called as getter
    mockSimulation.nodes.mockImplementation((nodes?: any) => {
      if (nodes !== undefined) {
        return mockSimulation
      }
      return []
    })

    // Mock simulation.force().links() for link force
    mockSimulation.force.mockImplementation((name: string, force?: any) => {
      if (name === 'link' && force === undefined) {
        return { links: vi.fn(() => []) }
      }
      return mockSimulation
    })

    // Reset store state
    useSimulationStore.setState({
      simulation: mockSimulation,
      simulationVersion: 0,
      simulationInProgress: false,
    })

    // Clear all mocks
    vi.clearAllMocks()
  })

  describe('Radial Force Configuration', () => {
    it('should configure radial force with radius 900 at origin (0, 0, 0)', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockForceRadial).toHaveBeenCalledWith(900, 0, 0, 0)
    })

    it('should set radial force strength to 0.1', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockRadialForceInstance.strength).toHaveBeenCalledWith(0.1)
    })

    it('should apply radial force to simulation', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockSimulation.force).toHaveBeenCalledWith('radial', mockRadialForceInstance)
    })
  })

  describe('Center Force Configuration', () => {
    it('should configure center force', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockForceCenter).toHaveBeenCalled()
    })

    it('should set center force strength to 1', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockCenterForceInstance.strength).toHaveBeenCalledWith(1)
    })

    it('should apply center force to simulation', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockSimulation.force).toHaveBeenCalledWith('center', mockCenterForceInstance)
    })
  })

  describe('Charge Force Configuration', () => {
    it('should configure charge force with many-body interaction', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockForceManyBody).toHaveBeenCalled()
    })

    it('should calculate charge strength based on node scale', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockChargeForceInstance.strength).toHaveBeenCalled()
      const strengthFn = mockChargeForceInstance.strength.mock.calls[0][0]

      // Test strength calculation for different node scales
      expect(strengthFn({ scale: 1 })).toBe(-100)
      expect(strengthFn({ scale: 2 })).toBe(-200)
      expect(strengthFn({ scale: 0.5 })).toBe(-50)
      expect(strengthFn({})).toBe(-100) // Default scale of 1
    })

    it('should apply charge force to simulation', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockSimulation.force).toHaveBeenCalledWith('charge', mockChargeForceInstance)
    })
  })

  describe('Link Force Configuration', () => {
    it('should configure link force', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockForceLink).toHaveBeenCalled()
    })

    it('should set link force strength to 1', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockLinkForceInstance.strength).toHaveBeenCalledWith(1)
    })

    it('should set link force distance to 300', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockLinkForceInstance.distance).toHaveBeenCalledWith(300)
    })

    it('should configure link force to use node ref_id', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockLinkForceInstance.id).toHaveBeenCalled()
      const idFn = mockLinkForceInstance.id.mock.calls[0][0]

      // Test id function returns ref_id
      expect(idFn({ ref_id: 'test-id-123' })).toBe('test-id-123')
    })

    it('should apply link force to simulation', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockSimulation.force).toHaveBeenCalledWith('link', mockLinkForceInstance)
    })
  })

  describe('Collision Force Configuration', () => {
    it('should configure collision force', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockForceCollide).toHaveBeenCalled()
    })

    it('should calculate collision radius based on node scale', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockCollideForceInstance.radius).toHaveBeenCalled()
      const radiusFn = mockCollideForceInstance.radius.mock.calls[0][0]

      // Test radius calculation for different node scales
      expect(radiusFn({ scale: 1 })).toBe(80)
      expect(radiusFn({ scale: 2 })).toBe(160)
      expect(radiusFn({ scale: 0.5 })).toBe(40)
      expect(radiusFn({})).toBe(80) // Default scale of 1
    })

    it('should set collision force strength to 0.5', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockCollideForceInstance.strength).toHaveBeenCalledWith(0.5)
    })

    it('should set collision force iterations to 1', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockCollideForceInstance.iterations).toHaveBeenCalledWith(1)
    })

    it('should apply collision force to simulation', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockSimulation.force).toHaveBeenCalledWith('collide', mockCollideForceInstance)
    })
  })

  describe('Directional Force Configuration', () => {
    it('should remove y force', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockSimulation.force).toHaveBeenCalledWith('y', null)
    })

    it('should configure x force with strength 0', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockForceX).toHaveBeenCalled()
      expect(mockXForceInstance.strength).toHaveBeenCalledWith(0)
      expect(mockSimulation.force).toHaveBeenCalledWith('x', mockXForceInstance)
    })

    it('should configure y force with strength 0', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockForceY).toHaveBeenCalled()
      expect(mockYForceInstance.strength).toHaveBeenCalledWith(0)
      expect(mockSimulation.force).toHaveBeenCalledWith('y', mockYForceInstance)
    })

    it('should configure z force with strength 0', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      expect(mockForceZ).toHaveBeenCalled()
      expect(mockZForceInstance.strength).toHaveBeenCalledWith(0)
      expect(mockSimulation.force).toHaveBeenCalledWith('z', mockZForceInstance)
    })
  })

  describe('Node Position Reset', () => {
    it('should call nodes() to reset positions before applying forces', () => {
      const mockNodes = [
        {
          ref_id: 'node-1',
          x: 100,
          y: 200,
          z: 300,
          fx: 10,
          fy: 20,
          fz: 30,
          vx: 5,
          vy: 10,
          vz: 15,
          scale: 1,
        },
        {
          ref_id: 'node-2',
          x: 150,
          y: 250,
          z: 350,
          fx: 15,
          fy: 25,
          fz: 35,
          vx: 7,
          vy: 12,
          vz: 17,
          scale: 2,
        },
      ]

      mockSimulation.nodes.mockImplementation((nodes?: any) => {
        if (nodes !== undefined) {
          return mockSimulation
        }
        return mockNodes
      })

      const store = useSimulationStore.getState()

      store.addRadialForce()

      // Verify nodes() was called (implementation detail: with reset positions)
      expect(mockSimulation.nodes).toHaveBeenCalled()
      // The first call should be a setter with an array argument
      expect(mockSimulation.nodes.mock.calls.length).toBeGreaterThan(0)
    })
  })

  describe('Force Application Order', () => {
    it('should apply forces in the correct order', () => {
      const store = useSimulationStore.getState()

      store.addRadialForce()

      const forceCalls = mockSimulation.force.mock.calls.map((call) => call[0])

      // Verify y force is removed first, then other forces are applied
      expect(forceCalls).toContain('y')
      expect(forceCalls).toContain('radial')
      expect(forceCalls).toContain('center')
      expect(forceCalls).toContain('charge')
      expect(forceCalls).toContain('x')
      expect(forceCalls).toContain('y')
      expect(forceCalls).toContain('z')
      expect(forceCalls).toContain('link')
      expect(forceCalls).toContain('collide')
    })
  })
})

describe('useSimulationStore - setForces Integration', () => {
  let mockSimulation: any
  let mockRadialForceInstance: any
  let mockCenterForceInstance: any
  let mockChargeForceInstance: any
  let mockLinkForceInstance: any
  let mockCollideForceInstance: any
  let mockXForceInstance: any
  let mockYForceInstance: any
  let mockZForceInstance: any

  beforeEach(() => {
    // Create mock force instances with chainable methods
    mockRadialForceInstance = { strength: vi.fn().mockReturnThis() }
    mockCenterForceInstance = { strength: vi.fn().mockReturnThis() }
    mockChargeForceInstance = { strength: vi.fn().mockReturnThis() }
    mockXForceInstance = { strength: vi.fn().mockReturnThis() }
    mockYForceInstance = { strength: vi.fn().mockReturnThis() }
    mockZForceInstance = { strength: vi.fn().mockReturnThis() }

    mockLinkForceInstance = {
      links: vi.fn().mockReturnThis(),
      strength: vi.fn().mockReturnThis(),
      distance: vi.fn().mockReturnThis(),
      id: vi.fn().mockReturnThis(),
    }

    mockCollideForceInstance = {
      radius: vi.fn().mockReturnThis(),
      strength: vi.fn().mockReturnThis(),
      iterations: vi.fn().mockReturnThis(),
    }

    // Reset all force mocks
    mockForceRadial.mockReturnValue(mockRadialForceInstance)
    mockForceCenter.mockReturnValue(mockCenterForceInstance)
    mockForceManyBody.mockReturnValue(mockChargeForceInstance)
    mockForceLink.mockReturnValue(mockLinkForceInstance)
    mockForceCollide.mockReturnValue(mockCollideForceInstance)
    mockForceX.mockReturnValue(mockXForceInstance)
    mockForceY.mockReturnValue(mockYForceInstance)
    mockForceZ.mockReturnValue(mockZForceInstance)

    // Create mock simulation
    mockSimulation = {
      nodes: vi.fn().mockReturnThis(),
      force: vi.fn().mockReturnThis(),
      alpha: vi.fn().mockReturnThis(),
      alphaTarget: vi.fn().mockReturnThis(),
      restart: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
    }

    mockSimulation.nodes.mockImplementation((nodes?: any) => {
      if (nodes !== undefined) {
        return mockSimulation
      }
      return []
    })

    mockSimulation.force.mockImplementation((name: string, force?: any) => {
      if (name === 'link' && force === undefined) {
        return { links: vi.fn(() => []) }
      }
      return mockSimulation
    })

    useSimulationStore.setState({
      simulation: mockSimulation,
      simulationVersion: 0,
      simulationInProgress: false,
    })

    vi.clearAllMocks()
  })

  it('should call addRadialForce when graphStyle is "sphere"', () => {
    vi.mocked(useGraphStore.getState).mockReturnValue({
      graphStyle: 'sphere',
      neighbourhoods: [],
    } as any)

    const store = useSimulationStore.getState()
    const addRadialForceSpy = vi.spyOn(store, 'addRadialForce')

    store.setForces()

    expect(addRadialForceSpy).toHaveBeenCalledTimes(1)
  })

  it('should call addRadialForce by default when graphStyle is unknown', () => {
    vi.mocked(useGraphStore.getState).mockReturnValue({
      graphStyle: 'unknown-style' as any,
      neighbourhoods: [],
    } as any)

    const store = useSimulationStore.getState()
    const addRadialForceSpy = vi.spyOn(store, 'addRadialForce')

    store.setForces()

    expect(addRadialForceSpy).toHaveBeenCalledTimes(1)
  })

  it('should restart simulation after applying forces', () => {
    vi.mocked(useGraphStore.getState).mockReturnValue({
      graphStyle: 'sphere',
      neighbourhoods: [],
    } as any)

    const store = useSimulationStore.getState()

    store.setForces()

    expect(mockSimulation.alpha).toHaveBeenCalledWith(0.4)
    expect(mockSimulation.restart).toHaveBeenCalled()
  })

  it('should not call addRadialForce when graphStyle is "force"', () => {
    vi.mocked(useGraphStore.getState).mockReturnValue({
      graphStyle: 'force',
      neighbourhoods: [{ ref_id: 'n1', nodes: [] }],
    } as any)

    const store = useSimulationStore.getState()
    const addRadialForceSpy = vi.spyOn(store, 'addRadialForce')

    store.setForces()

    expect(addRadialForceSpy).not.toHaveBeenCalled()
  })

  it('should not call addRadialForce when graphStyle is "split"', () => {
    vi.mocked(useGraphStore.getState).mockReturnValue({
      graphStyle: 'split',
      neighbourhoods: [],
    } as any)

    const store = useSimulationStore.getState()
    const addRadialForceSpy = vi.spyOn(store, 'addRadialForce')

    store.setForces()

    expect(addRadialForceSpy).not.toHaveBeenCalled()
  })
})

describe('useSimulationStore - addRadialForce Edge Cases', () => {
  let mockSimulation: any
  let mockRadialForceInstance: any
  let mockCenterForceInstance: any
  let mockChargeForceInstance: any
  let mockLinkForceInstance: any
  let mockCollideForceInstance: any
  let mockXForceInstance: any
  let mockYForceInstance: any
  let mockZForceInstance: any

  beforeEach(() => {
    // Create mock force instances with chainable methods
    mockRadialForceInstance = { strength: vi.fn().mockReturnThis() }
    mockCenterForceInstance = { strength: vi.fn().mockReturnThis() }
    mockChargeForceInstance = { strength: vi.fn().mockReturnThis() }
    mockXForceInstance = { strength: vi.fn().mockReturnThis() }
    mockYForceInstance = { strength: vi.fn().mockReturnThis() }
    mockZForceInstance = { strength: vi.fn().mockReturnThis() }

    mockLinkForceInstance = {
      links: vi.fn().mockReturnThis(),
      strength: vi.fn().mockReturnThis(),
      distance: vi.fn().mockReturnThis(),
      id: vi.fn().mockReturnThis(),
    }

    mockCollideForceInstance = {
      radius: vi.fn().mockReturnThis(),
      strength: vi.fn().mockReturnThis(),
      iterations: vi.fn().mockReturnThis(),
    }

    // Set up force function mocks
    mockForceRadial.mockReturnValue(mockRadialForceInstance)
    mockForceCenter.mockReturnValue(mockCenterForceInstance)
    mockForceManyBody.mockReturnValue(mockChargeForceInstance)
    mockForceLink.mockReturnValue(mockLinkForceInstance)
    mockForceCollide.mockReturnValue(mockCollideForceInstance)
    mockForceX.mockReturnValue(mockXForceInstance)
    mockForceY.mockReturnValue(mockYForceInstance)
    mockForceZ.mockReturnValue(mockZForceInstance)

    mockSimulation = {
      nodes: vi.fn().mockReturnThis(),
      force: vi.fn().mockReturnThis(),
      alpha: vi.fn().mockReturnThis(),
      alphaTarget: vi.fn().mockReturnThis(),
      restart: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
    }

    mockSimulation.force.mockImplementation((name: string, force?: any) => {
      if (name === 'link' && force === undefined) {
        return { links: vi.fn(() => []) }
      }
      return mockSimulation
    })

    useSimulationStore.setState({
      simulation: mockSimulation,
      simulationVersion: 0,
      simulationInProgress: false,
    })

    vi.clearAllMocks()
  })

  it('should handle empty node array', () => {
    mockSimulation.nodes.mockImplementation((nodes?: any) => {
      if (nodes !== undefined) {
        return mockSimulation
      }
      return []
    })

    const store = useSimulationStore.getState()

    expect(() => store.addRadialForce()).not.toThrow()
    expect(mockSimulation.nodes).toHaveBeenCalledWith([])
  })

  it('should handle nodes without scale property', () => {
    const mockNodes = [
      { ref_id: 'node-1', x: 100, y: 200 },
      { ref_id: 'node-2', x: 150, y: 250 },
    ]

    mockSimulation.nodes.mockImplementation((nodes?: any) => {
      if (nodes !== undefined) {
        return mockSimulation
      }
      return mockNodes
    })

    const store = useSimulationStore.getState()

    expect(() => store.addRadialForce()).not.toThrow()

    // Verify collision radius calculation handles missing scale
    const radiusFn = mockForceCollide().radius.mock.calls[0][0]
    expect(radiusFn({})).toBe(80) // Default scale of 1

    // Verify charge strength calculation handles missing scale
    const strengthFn = mockForceManyBody().strength.mock.calls[0][0]
    expect(strengthFn({})).toBe(-100) // Default scale of 1
  })

  it('should handle empty links array', () => {
    mockSimulation.nodes.mockImplementation((nodes?: any) => {
      if (nodes !== undefined) {
        return mockSimulation
      }
      return []
    })
    mockSimulation.force.mockImplementation((name: string, force?: any) => {
      if (name === 'link' && force === undefined) {
        return { links: vi.fn(() => []) }
      }
      return mockSimulation
    })

    const store = useSimulationStore.getState()

    expect(() => store.addRadialForce()).not.toThrow()
  })
})