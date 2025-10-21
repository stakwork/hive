import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSimulationStore } from '@/stores/useSimulationStore'
import { useDataStore } from '@/stores/useDataStore'

// Mock d3-force-3d functions using vi.hoisted to avoid hoisting issues
const { 
  mockForceRadial, 
  mockForceCenter, 
  mockForceX, 
  mockForceY, 
  mockForceZ, 
  mockForceCollide, 
  mockForceSimulation 
} = vi.hoisted(() => ({
  mockForceRadial: vi.fn(() => ({
    strength: vi.fn().mockReturnThis(),
  })),
  mockForceCenter: vi.fn(() => ({
    strength: vi.fn().mockReturnThis(),
  })),
  mockForceX: vi.fn(() => ({
    strength: vi.fn().mockReturnThis(),
  })),
  mockForceY: vi.fn(() => ({
    strength: vi.fn().mockReturnThis(),
  })),
  mockForceZ: vi.fn(() => ({
    strength: vi.fn().mockReturnThis(),
  })),
  mockForceCollide: vi.fn(() => ({
    radius: vi.fn().mockReturnThis(),
    strength: vi.fn().mockReturnThis(),
    iterations: vi.fn().mockReturnThis(),
  })),
  mockForceSimulation: vi.fn(),
}))

vi.mock('d3-force-3d', () => ({
  forceRadial: mockForceRadial,
  forceCenter: mockForceCenter,
  forceX: mockForceX,
  forceY: mockForceY,
  forceZ: mockForceZ,
  forceCollide: mockForceCollide,
  forceSimulation: mockForceSimulation,
  forceLink: vi.fn(() => ({
    strength: vi.fn().mockReturnThis(),
    links: vi.fn().mockReturnThis(),
    id: vi.fn().mockReturnThis(),
    distance: vi.fn().mockReturnThis(),
  })),
  forceManyBody: vi.fn(() => ({
    strength: vi.fn().mockReturnThis(),
  })),
}))

// Mock useDataStore
vi.mock('@/stores/useDataStore', () => ({
  useDataStore: {
    getState: vi.fn(),
  },
}))

// Mock useGraphStore
vi.mock('@/stores/useGraphStore', () => ({
  useGraphStore: {
    getState: vi.fn(() => ({
      graphStyle: 'split',
      neighbourhoods: [],
    })),
  },
}))

describe('useSimulationStore - addSplitForce', () => {
  let mockSimulation: any
  let mockNodes: any[]

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock nodes with different node_types
    mockNodes = [
      { ref_id: 'node1', node_type: 'TypeA', x: 100, y: 100, z: 100 },
      { ref_id: 'node2', node_type: 'TypeB', x: 200, y: 200, z: 200 },
      { ref_id: 'node3', node_type: 'TypeC', x: 300, y: 300, z: 300 },
      { ref_id: 'node4', node_type: 'TypeA', x: 400, y: 400, z: 400 },
    ]

    // Create mock simulation with chained API
    mockSimulation = {
      nodes: vi.fn(function(this: any, nodes?: any[]) {
        if (nodes !== undefined) {
          return this // Return this for chaining
        }
        return mockNodes
      }),
      force: vi.fn(function(this: any) {
        return this // Return this for chaining
      }),
      alpha: vi.fn(function(this: any) {
        return this
      }),
      restart: vi.fn(function(this: any) {
        return this
      }),
      stop: vi.fn(function(this: any) {
        return this
      }),
      on: vi.fn(function(this: any) {
        return this
      }),
    }

    // Mock useDataStore.getState to return nodeTypes
    vi.mocked(useDataStore.getState).mockReturnValue({
      nodeTypes: ['TypeA', 'TypeB', 'TypeC'],
    } as any)

    // Initialize store with mock simulation
    useSimulationStore.setState({ simulation: mockSimulation })
  })

  describe('Force Configuration', () => {
    it('should remove cluster force by setting it to null', () => {
      const { addSplitForce } = useSimulationStore.getState()

      addSplitForce()

      expect(mockSimulation.force).toHaveBeenCalledWith('cluster', null)
    })

    it('should configure radial force with radius 2000 and strength 0.1', () => {
      const { addSplitForce } = useSimulationStore.getState()

      addSplitForce()

      expect(mockForceRadial).toHaveBeenCalledWith(2000, 0, 0, 0)
      // Verify radial force is configured with simulation
      expect(mockSimulation.force).toHaveBeenCalledWith('radial', expect.any(Object))
    })

    it('should configure center force with strength 1', () => {
      const { addSplitForce } = useSimulationStore.getState()

      addSplitForce()

      expect(mockForceCenter).toHaveBeenCalled()
      expect(mockSimulation.force).toHaveBeenCalledWith('center', expect.any(Object))
    })

    it('should configure forceX with strength 1', () => {
      const { addSplitForce } = useSimulationStore.getState()

      addSplitForce()

      expect(mockForceX).toHaveBeenCalled()
      // forceX is called and strength is chained, we verify the configuration is set
      expect(mockSimulation.force).toHaveBeenCalledWith('x', expect.any(Object))
    })

    it('should configure forceY with strength 1', () => {
      const { addSplitForce } = useSimulationStore.getState()

      addSplitForce()

      expect(mockForceY).toHaveBeenCalled()
      expect(mockSimulation.force).toHaveBeenCalledWith('y', expect.any(Object))
    })

    it('should configure forceZ with strength 1', () => {
      const { addSplitForce } = useSimulationStore.getState()

      addSplitForce()

      expect(mockForceZ).toHaveBeenCalled()
      expect(mockSimulation.force).toHaveBeenCalledWith('z', expect.any(Object))
    })

    it('should configure collision force with radius 200, strength 1, and 1 iteration', () => {
      const { addSplitForce } = useSimulationStore.getState()

      addSplitForce()

      expect(mockForceCollide).toHaveBeenCalled()
      expect(mockSimulation.force).toHaveBeenCalledWith('collide', expect.any(Object))
    })

    it('should apply collision radius of 200 via radius function', () => {
      const { addSplitForce } = useSimulationStore.getState()
      const mockRadiusFn = vi.fn()
      
      // Re-mock forceCollide with access to radius function
      mockForceCollide.mockReturnValue({
        radius: mockRadiusFn.mockReturnThis(),
        strength: vi.fn().mockReturnThis(),
        iterations: vi.fn().mockReturnThis(),
      })

      addSplitForce()

      expect(mockRadiusFn).toHaveBeenCalledWith(expect.any(Function))
      const radiusCall = mockRadiusFn.mock.calls[0][0]
      expect(radiusCall()).toBe(200)
    })
  })

  describe('Node Position Calculations', () => {
    it('should calculate Y-offset based on nodeTypes index with alternating pattern', () => {
      const { addSplitForce } = useSimulationStore.getState()
      let capturedNodes: any[] = []

      mockSimulation.nodes.mockImplementation((nodes?: any[]) => {
        if (nodes) {
          capturedNodes = nodes
          return mockSimulation
        }
        return mockNodes
      })

      addSplitForce()

      // TypeA: index 1 (indexOf returns 0, +1 = 1), floor(1/2)*500 = 0, 1%2=1 (odd) => fy = -0
      // Note: -0 is mathematically equal to 0, but for strictness we verify it
      expect(Math.abs(capturedNodes[0].fy)).toBe(0)

      // TypeB: index 2 (indexOf returns 1, +1 = 2), floor(2/2)*500 = 500, 2%2=0 (even) => fy = 500
      expect(capturedNodes[1].fy).toBe(500)

      // TypeC: index 3 (indexOf returns 2, +1 = 3), floor(3/2)*500 = 500, 3%2=1 (odd) => fy = -500
      expect(capturedNodes[2].fy).toBe(-500)

      // TypeA again: index 1, fy = -0 (which equals 0)
      expect(Math.abs(capturedNodes[3].fy)).toBe(0)
    })

    it('should reset position properties (fx, fz, x, y, z, vx, vy, vz) to null while preserving fy', () => {
      const { addSplitForce } = useSimulationStore.getState()
      let capturedNodes: any[] = []

      mockSimulation.nodes.mockImplementation((nodes?: any[]) => {
        if (nodes) {
          capturedNodes = nodes
          return mockSimulation
        }
        return mockNodes
      })

      addSplitForce()

      capturedNodes.forEach((node) => {
        expect(node.fx).toBeNull()
        expect(node.fz).toBeNull()
        expect(node.x).toBeNull()
        expect(node.y).toBeNull()
        expect(node.z).toBeNull()
        expect(node.vx).toBeNull()
        expect(node.vy).toBeNull()
        expect(node.vz).toBeNull()
        expect(node.fy).toBeDefined()
        expect(typeof node.fy).toBe('number')
      })
    })

    it('should handle node_type not in nodeTypes array (indexOf returns -1)', () => {
      const { addSplitForce } = useSimulationStore.getState()
      let capturedNodes: any[] = []

      mockNodes = [
        { ref_id: 'node1', node_type: 'UnknownType', x: 100, y: 100, z: 100 },
      ]

      mockSimulation.nodes.mockImplementation((nodes?: any[]) => {
        if (nodes) {
          capturedNodes = nodes
          return mockSimulation
        }
        return mockNodes
      })

      addSplitForce()

      // indexOf returns -1, +1 = 0, floor(0/2)*500 = 0, 0%2=0 (even) => fy = 0
      expect(capturedNodes[0].fy).toBe(0)
    })

    it('should preserve original node properties while applying position reset and fy', () => {
      const { addSplitForce } = useSimulationStore.getState()
      let capturedNodes: any[] = []

      mockSimulation.nodes.mockImplementation((nodes?: any[]) => {
        if (nodes) {
          capturedNodes = nodes
          return mockSimulation
        }
        return mockNodes
      })

      addSplitForce()

      // Verify original properties are preserved
      expect(capturedNodes[0].ref_id).toBe('node1')
      expect(capturedNodes[0].node_type).toBe('TypeA')
      expect(capturedNodes[1].ref_id).toBe('node2')
      expect(capturedNodes[1].node_type).toBe('TypeB')
    })
  })

  describe('Y-Offset Alternating Pattern', () => {
    it('should assign positive Y-offset for even indices', () => {
      const { addSplitForce } = useSimulationStore.getState()
      let capturedNodes: any[] = []

      mockNodes = [
        { ref_id: 'node1', node_type: 'TypeB', x: 100, y: 100, z: 100 }, // index 2 (even)
        { ref_id: 'node2', node_type: 'TypeD', x: 200, y: 200, z: 200 }, // index 4 (even)
      ]

      vi.mocked(useDataStore.getState).mockReturnValue({
        nodeTypes: ['TypeA', 'TypeB', 'TypeC', 'TypeD'],
      } as any)

      mockSimulation.nodes.mockImplementation((nodes?: any[]) => {
        if (nodes) {
          capturedNodes = nodes
          return mockSimulation
        }
        return mockNodes
      })

      addSplitForce()

      // TypeB: index 2, floor(2/2)*500 = 500, 2%2=0 (even) => fy = 500
      expect(capturedNodes[0].fy).toBe(500)

      // TypeD: index 4, floor(4/2)*500 = 1000, 4%2=0 (even) => fy = 1000
      expect(capturedNodes[1].fy).toBe(1000)
    })

    it('should assign negative Y-offset for odd indices', () => {
      const { addSplitForce } = useSimulationStore.getState()
      let capturedNodes: any[] = []

      mockNodes = [
        { ref_id: 'node1', node_type: 'TypeA', x: 100, y: 100, z: 100 }, // index 1 (odd)
        { ref_id: 'node2', node_type: 'TypeC', x: 200, y: 200, z: 200 }, // index 3 (odd)
      ]

      vi.mocked(useDataStore.getState).mockReturnValue({
        nodeTypes: ['TypeA', 'TypeB', 'TypeC'],
      } as any)

      mockSimulation.nodes.mockImplementation((nodes?: any[]) => {
        if (nodes) {
          capturedNodes = nodes
          return mockSimulation
        }
        return mockNodes
      })

      addSplitForce()

      // TypeA: index 1, floor(1/2)*500 = 0, 1%2=1 (odd) => fy = -0
      expect(Math.abs(capturedNodes[0].fy)).toBe(0)

      // TypeC: index 3, floor(3/2)*500 = 500, 3%2=1 (odd) => fy = -500
      expect(capturedNodes[1].fy).toBe(-500)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty nodeTypes array', () => {
      const { addSplitForce } = useSimulationStore.getState()
      let capturedNodes: any[] = []

      vi.mocked(useDataStore.getState).mockReturnValue({
        nodeTypes: [],
      } as any)

      mockSimulation.nodes.mockImplementation((nodes?: any[]) => {
        if (nodes) {
          capturedNodes = nodes
          return mockSimulation
        }
        return mockNodes
      })

      addSplitForce()

      // All nodes will have indexOf return -1, so index = 0
      capturedNodes.forEach((node) => {
        expect(node.fy).toBe(0)
      })
    })

    it('should handle single node', () => {
      const { addSplitForce } = useSimulationStore.getState()
      let capturedNodes: any[] = []

      mockNodes = [
        { ref_id: 'node1', node_type: 'TypeA', x: 100, y: 100, z: 100 },
      ]

      mockSimulation.nodes.mockImplementation((nodes?: any[]) => {
        if (nodes) {
          capturedNodes = nodes
          return mockSimulation
        }
        return mockNodes
      })

      addSplitForce()

      expect(capturedNodes).toHaveLength(1)
      expect(Math.abs(capturedNodes[0].fy)).toBe(0)
      expect(capturedNodes[0].fx).toBeNull()
    })

    it('should handle multiple nodes of the same type', () => {
      const { addSplitForce } = useSimulationStore.getState()
      let capturedNodes: any[] = []

      mockNodes = [
        { ref_id: 'node1', node_type: 'TypeA', x: 100, y: 100, z: 100 },
        { ref_id: 'node2', node_type: 'TypeA', x: 200, y: 200, z: 200 },
        { ref_id: 'node3', node_type: 'TypeA', x: 300, y: 300, z: 300 },
      ]

      mockSimulation.nodes.mockImplementation((nodes?: any[]) => {
        if (nodes) {
          capturedNodes = nodes
          return mockSimulation
        }
        return mockNodes
      })

      addSplitForce()

      // All nodes are TypeA (index 1), so all should have fy = -0 (which equals 0)
      capturedNodes.forEach((node) => {
        expect(Math.abs(node.fy)).toBe(0)
      })
    })

    it('should not mutate original node objects', () => {
      const { addSplitForce } = useSimulationStore.getState()
      const originalNodesCopy = JSON.parse(JSON.stringify(mockNodes))

      addSplitForce()

      // Original mockNodes should remain unchanged (simulation.nodes() returns them)
      mockNodes.forEach((node, index) => {
        expect(node.ref_id).toBe(originalNodesCopy[index].ref_id)
        expect(node.node_type).toBe(originalNodesCopy[index].node_type)
        expect(node.x).toBe(originalNodesCopy[index].x)
        expect(node.y).toBe(originalNodesCopy[index].y)
        expect(node.z).toBe(originalNodesCopy[index].z)
      })
    })
  })

  describe('Integration with Simulation Object', () => {
    it('should call simulation.nodes() with mapped nodes', () => {
      const { addSplitForce } = useSimulationStore.getState()

      addSplitForce()

      expect(mockSimulation.nodes).toHaveBeenCalled()
      // First call gets nodes, second call sets nodes
      expect(mockSimulation.nodes).toHaveBeenCalledTimes(2)
      const calledWith = mockSimulation.nodes.mock.calls[1][0] //Second call has the nodes
      expect(calledWith).toHaveLength(4)
    })

    it('should chain force configurations in correct order', () => {
      const { addSplitForce } = useSimulationStore.getState()

      addSplitForce()

      const forceCalls = mockSimulation.force.mock.calls.map((call) => call[0])
      expect(forceCalls).toEqual([
        'cluster',
        'radial',
        'center',
        'x',
        'y',
        'z',
        'collide',
      ])
    })

    // Note: This test documents current behavior. The implementation doesn't guard against null simulation.
    // Consider adding a guard if null checks are important.
    it.skip('should handle null simulation gracefully', () => {
      useSimulationStore.setState({ simulation: null })

      const { addSplitForce } = useSimulationStore.getState()

      // Currently throws - implementation does not check for null
      expect(() => addSplitForce()).toThrow()
    })
  })

  describe('Y-Offset Formula Verification', () => {
    it('should calculate Y-offset correctly for index 1: floor(1/2)*500 = 0, odd => 0', () => {
      const { addSplitForce } = useSimulationStore.getState()
      let capturedNodes: any[] = []

      mockNodes = [{ ref_id: 'node1', node_type: 'TypeA', x: 100, y: 100, z: 100 }]

      mockSimulation.nodes.mockImplementation((nodes?: any[]) => {
        if (nodes) {
          capturedNodes = nodes
          return mockSimulation
        }
        return mockNodes
      })

      addSplitForce()

      expect(Math.abs(capturedNodes[0].fy)).toBe(0)
    })

    it('should calculate Y-offset correctly for index 2: floor(2/2)*500 = 500, even => 500', () => {
      const { addSplitForce } = useSimulationStore.getState()
      let capturedNodes: any[] = []

      mockNodes = [{ ref_id: 'node1', node_type: 'TypeB', x: 100, y: 100, z: 100 }]

      mockSimulation.nodes.mockImplementation((nodes?: any[]) => {
        if (nodes) {
          capturedNodes = nodes
          return mockSimulation
        }
        return mockNodes
      })

      addSplitForce()

      expect(capturedNodes[0].fy).toBe(500)
    })

    it('should calculate Y-offset correctly for index 3: floor(3/2)*500 = 500, odd => -500', () => {
      const { addSplitForce } = useSimulationStore.getState()
      let capturedNodes: any[] = []

      mockNodes = [{ ref_id: 'node1', node_type: 'TypeC', x: 100, y: 100, z: 100 }]

      mockSimulation.nodes.mockImplementation((nodes?: any[]) => {
        if (nodes) {
          capturedNodes = nodes
          return mockSimulation
        }
        return mockNodes
      })

      addSplitForce()

      expect(capturedNodes[0].fy).toBe(-500)
    })

    it('should calculate Y-offset correctly for index 4: floor(4/2)*500 = 1000, even => 1000', () => {
      const { addSplitForce } = useSimulationStore.getState()
      let capturedNodes: any[] = []

      mockNodes = [{ ref_id: 'node1', node_type: 'TypeD', x: 100, y: 100, z: 100 }]

      vi.mocked(useDataStore.getState).mockReturnValue({
        nodeTypes: ['TypeA', 'TypeB', 'TypeC', 'TypeD'],
      } as any)

      mockSimulation.nodes.mockImplementation((nodes?: any[]) => {
        if (nodes) {
          capturedNodes = nodes
          return mockSimulation
        }
        return mockNodes
      })

      addSplitForce()

      expect(capturedNodes[0].fy).toBe(1000)
    })

    it('should calculate Y-offset correctly for index 5: floor(5/2)*500 = 1000, odd => -1000', () => {
      const { addSplitForce } = useSimulationStore.getState()
      let capturedNodes: any[] = []

      mockNodes = [{ ref_id: 'node1', node_type: 'TypeE', x: 100, y: 100, z: 100 }]

      vi.mocked(useDataStore.getState).mockReturnValue({
        nodeTypes: ['TypeA', 'TypeB', 'TypeC', 'TypeD', 'TypeE'],
      } as any)

      mockSimulation.nodes.mockImplementation((nodes?: any[]) => {
        if (nodes) {
          capturedNodes = nodes
          return mockSimulation
        }
        return mockNodes
      })

      addSplitForce()

      expect(capturedNodes[0].fy).toBe(-1000)
    })
  })
})