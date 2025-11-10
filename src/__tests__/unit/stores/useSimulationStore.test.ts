import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSimulationStore } from '@/stores/useSimulationStore'
import { useGraphStore } from '@/stores/useGraphStore'
import { distributeNodesOnSphere } from '@/stores/useSimulationStore/utils/distributeNodesOnSphere'
import * as d3Force from 'd3-force-3d'
import {
  setupSimulationStoreMocks,
  setupD3ForceMocks,
  setupMockGraphStore,
  createMockForces,
  createMockNodes,
} from '@/__tests__/support/helpers/simulation-store-mocks'

// Mock the dependencies
vi.mock('@/stores/useGraphStore')
vi.mock('@/stores/useSimulationStore/utils/distributeNodesOnSphere')
vi.mock('d3-force-3d', () => ({
  forceManyBody: vi.fn(),
  forceX: vi.fn(),
  forceY: vi.fn(),
  forceZ: vi.fn(),
  forceLink: vi.fn(),
  forceCollide: vi.fn(),
  forceSimulation: vi.fn(),
  forceCenter: vi.fn(),
  forceRadial: vi.fn(),
}))

describe('useSimulationStore - addClusterForce', () => {
  let mockSimulation: any
  let mockForces: any
  
  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()
    
    // Create mock force functions
    mockForces = {
      charge: vi.fn().mockReturnThis(),
      x: vi.fn().mockReturnThis(),
      y: vi.fn().mockReturnThis(),
      z: vi.fn().mockReturnThis(),
      link: vi.fn().mockReturnThis(),
      collide: vi.fn().mockReturnThis(),
    }
    
    // Mock nodes array
    const mockNodes = [
      { ref_id: 'node1', x: 100, y: 200, z: 300, fx: 10, fy: 20, fz: 30, vx: 5, vy: 10, vz: 15 },
      { ref_id: 'node2', x: 400, y: 500, z: 600, fx: 40, fy: 50, fz: 60, vx: 25, vy: 30, vz: 35 },
    ]
    
    // Mock link force that returns existing links
    const mockLinkForce = {
      links: vi.fn().mockReturnValue([
        { source: { ref_id: 'node1' }, target: { ref_id: 'node2' } },
      ]),
    }
    
    // Create mock simulation with chained methods
    mockSimulation = {
      nodes: vi.fn().mockImplementation(function(nodes?: any) {
        // When called with argument, set nodes and return simulation (chaining)
        // When called without argument, return the current nodes array
        if (arguments.length === 0) {
          return mockNodes
        }
        return mockSimulation
      }),
      force: vi.fn().mockImplementation(function(name: string, forceValue?: any) {
        // If called with 2 arguments, it's a setter - return simulation for chaining
        if (arguments.length === 2) {
          return mockSimulation
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
    }
    
    // Setup D3 force mocks with proper chaining
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
      strength: vi.fn().mockReturnThis(),
    } as any)
    
    vi.mocked(d3Force.forceCenter).mockReturnValue({
      strength: vi.fn().mockReturnThis(),
    } as any)
    
    // Mock distributeNodesOnSphere with golden ratio distributed positions
    vi.mocked(distributeNodesOnSphere).mockReturnValue({
      'hood1': { x: 1000, y: 2000, z: 3000 },
      'hood2': { x: -1000, y: -2000, z: -3000 },
    })
    
    // Mock useGraphStore.getState
    vi.mocked(useGraphStore.getState).mockReturnValue({
      neighbourhoods: [
        { ref_id: 'hood1', name: 'Neighborhood 1' },
        { ref_id: 'hood2', name: 'Neighborhood 2' },
      ],
      graphStyle: 'force',
      setGraphRadius: vi.fn(),
      setGraphStyle: vi.fn(),
      highlightNodes: [],
    } as any)
  })
  
  afterEach(() => {
    vi.restoreAllMocks()
  })
  
  describe('Cluster Center Distribution', () => {
    test('should call distributeNodesOnSphere with neighbourhoods and radius 3000', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addClusterForce()
      
      expect(distributeNodesOnSphere).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ ref_id: 'hood1' }),
          expect.objectContaining({ ref_id: 'hood2' }),
        ]),
        3000
      )
      expect(distributeNodesOnSphere).toHaveBeenCalledTimes(1)
    })
    
    test('should handle empty neighbourhoods array', () => {
      vi.mocked(useGraphStore.getState).mockReturnValue({
        neighbourhoods: [],
        graphStyle: 'force',
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      expect(() => store.addClusterForce()).not.toThrow()
      expect(distributeNodesOnSphere).not.toHaveBeenCalled()
    })
    
    test('should handle undefined neighbourhoods', () => {
      vi.mocked(useGraphStore.getState).mockReturnValue({
        neighbourhoods: undefined,
        graphStyle: 'force',
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      expect(() => store.addClusterForce()).not.toThrow()
      expect(distributeNodesOnSphere).not.toHaveBeenCalled()
    })
    
    test('should use golden ratio distribution at fixed radius', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addClusterForce()
      
      // Verify radius parameter is exactly 3000
      const [, radius] = vi.mocked(distributeNodesOnSphere).mock.calls[0]
      expect(radius).toBe(3000)
    })
  })
  
  describe('Node Position Reset', () => {
    test('should reset all node positions to null before applying forces', () => {
      const mockNodes = [
        { 
          ref_id: 'node1', 
          x: 100, y: 200, z: 300, 
          fx: 10, fy: 20, fz: 30, 
          vx: 5, vy: 10, vz: 15 
        },
        { 
          ref_id: 'node2', 
          x: 400, y: 500, z: 600, 
          fx: 40, fy: 50, fz: 60, 
          vx: 25, vy: 30, vz: 35 
        },
      ]
      
      let capturedNodes: any[] = []
      
      mockSimulation.nodes = vi.fn().mockImplementation((nodes) => {
        if (nodes) {
          capturedNodes = nodes
          return mockSimulation
        }
        return mockNodes
      })
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addClusterForce()
      
      // Verify all position properties are reset
      capturedNodes.forEach((node: any) => {
        expect(node.fx).toBeNull()
        expect(node.fy).toBeNull()
        expect(node.fz).toBeNull()
        expect(node.x).toBeNull()
        expect(node.y).toBeNull()
        expect(node.z).toBeNull()
        expect(node.vx).toBeNull()
        expect(node.vy).toBeNull()
        expect(node.vz).toBeNull()
      })
    })
    
    test('should preserve node ref_id and other properties during reset', () => {
      const mockNodes = [
        { 
          ref_id: 'node1', 
          scale: 2,
          neighbourHood: 'hood1',
          x: 100, y: 200, z: 300 
        },
      ]
      
      let capturedNodes: any[] = []
      
      mockSimulation.nodes = vi.fn().mockImplementation((nodes) => {
        if (nodes) {
          capturedNodes = nodes
          return mockSimulation
        }
        return mockNodes
      })
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addClusterForce()
      
      expect(capturedNodes[0].ref_id).toBe('node1')
      expect(capturedNodes[0].scale).toBe(2)
      expect(capturedNodes[0].neighbourHood).toBe('hood1')
    })
  })
  
  describe('D3 Force Configuration', () => {
    test('should configure charge force with strength 0', () => {
      const mockStrength = vi.fn().mockReturnValue(mockForces.charge)
      vi.mocked(d3Force.forceManyBody).mockReturnValue({
        strength: mockStrength,
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addClusterForce()
      
      expect(d3Force.forceManyBody).toHaveBeenCalled()
      expect(mockSimulation.force).toHaveBeenCalledWith('charge', mockForces.charge)
    })
    
    test('should configure forceX with strength 0.1', () => {
      const mockStrength = vi.fn().mockReturnValue(mockForces.x)
      vi.mocked(d3Force.forceX).mockReturnValue({
        strength: mockStrength,
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addClusterForce()
      
      expect(mockStrength).toHaveBeenCalledWith(0.1)
      expect(mockSimulation.force).toHaveBeenCalledWith('x', mockForces.x)
    })
    
    test('should configure forceY with strength 0.1', () => {
      const mockStrength = vi.fn().mockReturnValue(mockForces.y)
      vi.mocked(d3Force.forceY).mockReturnValue({
        strength: mockStrength,
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addClusterForce()
      
      expect(mockStrength).toHaveBeenCalledWith(0.1)
      expect(mockSimulation.force).toHaveBeenCalledWith('y', mockForces.y)
    })
    
    test('should configure forceZ with strength 0.1', () => {
      const mockStrength = vi.fn().mockReturnValue(mockForces.z)
      vi.mocked(d3Force.forceZ).mockReturnValue({
        strength: mockStrength,
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addClusterForce()
      
      expect(mockStrength).toHaveBeenCalledWith(0.1)
      expect(mockSimulation.force).toHaveBeenCalledWith('z', mockForces.z)
    })
    
    test('should configure link force with strength 0 and distance 400', () => {
      const mockStrength = vi.fn().mockReturnThis()
      const mockDistance = vi.fn().mockReturnThis()
      const mockId = vi.fn().mockReturnValue(mockForces.link)
      
      vi.mocked(d3Force.forceLink).mockReturnValue({
        links: vi.fn().mockReturnThis(),
        strength: mockStrength,
        distance: mockDistance,
        id: mockId,
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addClusterForce()
      
      expect(mockStrength).toHaveBeenCalledWith(0)
      expect(mockDistance).toHaveBeenCalledWith(400)
      expect(mockSimulation.force).toHaveBeenCalledWith('link', mockForces.link)
    })
    
    test('should configure collide force with proper parameters', () => {
      const mockRadius = vi.fn().mockReturnThis()
      const mockStrength = vi.fn().mockReturnThis()
      const mockIterations = vi.fn().mockReturnValue(mockForces.collide)
      
      vi.mocked(d3Force.forceCollide).mockReturnValue({
        radius: mockRadius,
        strength: mockStrength,
        iterations: mockIterations,
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addClusterForce()
      
      expect(mockStrength).toHaveBeenCalledWith(0.5)
      expect(mockIterations).toHaveBeenCalledWith(1)
      expect(mockSimulation.force).toHaveBeenCalledWith('collide', mockForces.collide)
    })
    
    test('should set all forces in correct order', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addClusterForce()
      
      // Filter out only the setter calls (2 arguments) to check order
      const forceSetterCalls = mockSimulation.force.mock.calls
        .filter((call: any) => call.length === 2)
        .map((call: any) => call[0])
      
      expect(forceSetterCalls).toEqual(['charge', 'x', 'y', 'z', 'link', 'collide'])
    })
  })
  
  describe('Neighbourhood Integration', () => {
    test('should pull nodes towards their neighbourhood centers', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      let forceXCallback: any
      let forceYCallback: any
      let forceZCallback: any
      
      vi.mocked(d3Force.forceX).mockImplementation((fn: any) => {
        forceXCallback = fn
        return {
          strength: vi.fn().mockReturnValue(mockForces.x),
        } as any
      })
      
      vi.mocked(d3Force.forceY).mockImplementation((fn: any) => {
        forceYCallback = fn
        return {
          strength: vi.fn().mockReturnValue(mockForces.y),
        } as any
      })
      
      vi.mocked(d3Force.forceZ).mockImplementation((fn: any) => {
        forceZCallback = fn
        return {
          strength: vi.fn().mockReturnValue(mockForces.z),
        } as any
      })
      
      store.addClusterForce()
      
      // Test node with neighbourhood - should use distributed positions
      const nodeWithHood = { ref_id: 'test', neighbourHood: 'hood1' }
      expect(forceXCallback(nodeWithHood)).toBe(1000)
      expect(forceYCallback(nodeWithHood)).toBe(2000)
      expect(forceZCallback(nodeWithHood)).toBe(3000)
      
      // Test node without neighbourhood - should default to origin
      const nodeWithoutHood = { ref_id: 'test2' }
      expect(forceXCallback(nodeWithoutHood)).toBe(0)
      expect(forceYCallback(nodeWithoutHood)).toBe(0)
      expect(forceZCallback(nodeWithoutHood)).toBe(0)
    })
    
    test('should access neighbourhoods from useGraphStore', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addClusterForce()
      
      expect(useGraphStore.getState).toHaveBeenCalled()
    })
    
    test('should handle nodes with invalid neighbourhood references', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      let forceXCallback: any
      
      vi.mocked(d3Force.forceX).mockImplementation((fn: any) => {
        forceXCallback = fn
        return {
          strength: vi.fn().mockReturnValue(mockForces.x),
        } as any
      })
      
      store.addClusterForce()
      
      // Node with non-existent neighbourhood
      const nodeWithInvalidHood = { ref_id: 'test', neighbourHood: 'nonexistent' }
      expect(forceXCallback(nodeWithInvalidHood)).toBe(0)
    })
  })
  
  describe('Collision Detection', () => {
    test('should calculate collide radius based on node scale', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      let radiusCallback: any
      
      vi.mocked(d3Force.forceCollide).mockReturnValue({
        radius: vi.fn().mockImplementation((fn: any) => {
          radiusCallback = fn
          return {
            strength: vi.fn().mockReturnThis(),
            iterations: vi.fn().mockReturnValue(mockForces.collide),
          }
        }),
      } as any)
      
      store.addClusterForce()
      
      // Test node with scale
      const nodeWithScale = { ref_id: 'test', scale: 2 }
      expect(radiusCallback(nodeWithScale)).toBe(190) // 2 * 95
      
      // Test node without scale (defaults to 1)
      const nodeWithoutScale = { ref_id: 'test2' }
      expect(radiusCallback(nodeWithoutScale)).toBe(95) // 1 * 95
    })
    
    test('should use scale of 1 for nodes without scale property', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      let radiusCallback: any
      
      vi.mocked(d3Force.forceCollide).mockReturnValue({
        radius: vi.fn().mockImplementation((fn: any) => {
          radiusCallback = fn
          return {
            strength: vi.fn().mockReturnThis(),
            iterations: vi.fn().mockReturnValue(mockForces.collide),
          }
        }),
      } as any)
      
      store.addClusterForce()
      
      const nodeWithNullScale = { ref_id: 'test', scale: null }
      expect(radiusCallback(nodeWithNullScale)).toBe(95)
    })
    
    test('should set collision strength to 0.5', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      const mockStrength = vi.fn().mockReturnThis()
      
      vi.mocked(d3Force.forceCollide).mockReturnValue({
        radius: vi.fn().mockReturnThis(),
        strength: mockStrength,
        iterations: vi.fn().mockReturnValue(mockForces.collide),
      } as any)
      
      store.addClusterForce()
      
      expect(mockStrength).toHaveBeenCalledWith(0.5)
    })
    
    test('should set collision iterations to 1', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      const mockIterations = vi.fn().mockReturnValue(mockForces.collide)
      
      vi.mocked(d3Force.forceCollide).mockReturnValue({
        radius: vi.fn().mockReturnThis(),
        strength: vi.fn().mockReturnThis(),
        iterations: mockIterations,
      } as any)
      
      store.addClusterForce()
      
      expect(mockIterations).toHaveBeenCalledWith(1)
    })
  })
  
  describe('Integration with setForces', () => {
    test('should be called when graphStyle is "force"', () => {
      vi.mocked(useGraphStore.getState).mockReturnValue({
        graphStyle: 'force',
        neighbourhoods: [],
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      const addClusterForceSpy = vi.spyOn(store, 'addClusterForce')
      const simulationRestartSpy = vi.spyOn(store, 'simulationRestart')
      
      store.setForces()
      
      expect(addClusterForceSpy).toHaveBeenCalled()
      expect(simulationRestartSpy).toHaveBeenCalled()
    })
    
    test('should not be called when graphStyle is "sphere"', () => {
      vi.mocked(useGraphStore.getState).mockReturnValue({
        graphStyle: 'sphere',
        neighbourhoods: [],
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      const addClusterForceSpy = vi.spyOn(store, 'addClusterForce')
      
      store.setForces()
      
      expect(addClusterForceSpy).not.toHaveBeenCalled()
    })
    
    test('should not be called when graphStyle is "split"', () => {
      vi.mocked(useGraphStore.getState).mockReturnValue({
        graphStyle: 'split',
        neighbourhoods: [],
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      const addClusterForceSpy = vi.spyOn(store, 'addClusterForce')
      
      store.setForces()
      
      expect(addClusterForceSpy).not.toHaveBeenCalled()
    })
  })
  
  describe('Link Force Configuration', () => {
    test('should preserve existing link references', () => {
      const mockLinks = [
        { source: { ref_id: 'node1' }, target: { ref_id: 'node2' }, ref_id: 'link1' },
        { source: { ref_id: 'node2' }, target: { ref_id: 'node3' }, ref_id: 'link2' },
      ]
      
      const mockLinkForce = {
        links: vi.fn().mockReturnValue(mockLinks),
      }
      
      mockSimulation.force = vi.fn().mockImplementation(function(name: string, forceValue?: any) {
        // If called with 2 arguments, it's a setter - return simulation for chaining
        if (arguments.length === 2) {
          return mockSimulation
        }
        // If called with 1 argument, it's a getter - return the force
        if (name === 'link') {
          return mockLinkForce
        }
        return null
      })
      
      const mockLinksMethod = vi.fn().mockReturnThis()
      
      vi.mocked(d3Force.forceLink).mockReturnValue({
        links: mockLinksMethod,
        strength: vi.fn().mockReturnThis(),
        distance: vi.fn().mockReturnThis(),
        id: vi.fn().mockReturnValue(mockForces.link),
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addClusterForce()
      
      // Verify links were retrieved and passed with ref_id mapping
      expect(mockLinkForce.links).toHaveBeenCalled()
      expect(mockLinksMethod).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ source: 'node1', target: 'node2' }),
          expect.objectContaining({ source: 'node2', target: 'node3' }),
        ])
      )
    })
    
    test('should use ref_id as link identifier', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      let idCallback: any
      
      vi.mocked(d3Force.forceLink).mockReturnValue({
        links: vi.fn().mockReturnThis(),
        strength: vi.fn().mockReturnThis(),
        distance: vi.fn().mockReturnThis(),
        id: vi.fn().mockImplementation((fn: any) => {
          idCallback = fn
          return mockForces.link
        }),
      } as any)
      
      store.addClusterForce()
      
      const testNode = { ref_id: 'test123' }
      expect(idCallback(testNode)).toBe('test123')
    })
  })
})

describe('useSimulationStore - addRadialForce', () => {
  let store: any
  let mockSimulation: any
  let mockForces: any
  
  beforeEach(() => {
    vi.clearAllMocks()
    
    mockForces = {
      radial: vi.fn().mockReturnThis(),
      center: vi.fn().mockReturnThis(),
      charge: vi.fn().mockReturnThis(),
      x: vi.fn().mockReturnThis(),
      y: vi.fn().mockReturnThis(),
      z: vi.fn().mockReturnThis(),
      link: vi.fn().mockReturnThis(),
      collide: vi.fn().mockReturnThis(),
    }
    
    const mockNodes = [
      { ref_id: 'node1', x: 100, y: 200, z: 300, fx: 10, fy: 20, fz: 30, vx: 5, vy: 10, vz: 15 },
      { ref_id: 'node2', x: 400, y: 500, z: 600, fx: 40, fy: 50, fz: 60, vx: 25, vy: 30, vz: 35 },
    ]
    
    const mockLinkForce = {
      links: vi.fn().mockReturnValue([
        { source: { ref_id: 'node1' }, target: { ref_id: 'node2' } },
      ]),
    }
    
    mockSimulation = {
      nodes: vi.fn().mockImplementation(function(nodes?: any) {
        if (arguments.length === 0) {
          return mockNodes
        }
        return mockSimulation
      }),
      force: vi.fn().mockImplementation(function(name: string, forceValue?: any) {
        if (arguments.length === 2) {
          return mockSimulation
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
    
    vi.mocked(d3Force.forceRadial).mockReturnValue({
      strength: vi.fn().mockReturnValue(mockForces.radial),
    } as any)
    
    vi.mocked(d3Force.forceCenter).mockReturnValue({
      strength: vi.fn().mockReturnValue(mockForces.center),
    } as any)
    
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
    
    vi.mocked(useGraphStore.getState).mockReturnValue({
      neighbourhoods: [],
      graphStyle: 'sphere',
    } as any)
  })
  
  afterEach(() => {
    vi.restoreAllMocks()
  })
  
  describe('Node Position Reset', () => {
    test('should reset all node positions and velocities to null', () => {
      const mockNodes = [
        { 
          ref_id: 'node1', 
          x: 100, y: 200, z: 300, 
          fx: 10, fy: 20, fz: 30, 
          vx: 5, vy: 10, vz: 15 
        },
        { 
          ref_id: 'node2', 
          x: 400, y: 500, z: 600, 
          fx: 40, fy: 50, fz: 60, 
          vx: 25, vy: 30, vz: 35 
        },
      ]
      
      let capturedNodes: any[] = []
      
      mockSimulation.nodes = vi.fn().mockImplementation((nodes) => {
        if (nodes) {
          capturedNodes = nodes
          return mockSimulation
        }
        return mockNodes
      })
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addRadialForce()
      
      capturedNodes.forEach((node: any) => {
        expect(node.fx).toBeNull()
        expect(node.fy).toBeNull()
        expect(node.fz).toBeNull()
        expect(node.x).toBeNull()
        expect(node.y).toBeNull()
        expect(node.z).toBeNull()
        expect(node.vx).toBeNull()
        expect(node.vy).toBeNull()
        expect(node.vz).toBeNull()
      })
    })
    
    test('should preserve node ref_id and other properties during reset', () => {
      const mockNodes = [
        { 
          ref_id: 'node1', 
          scale: 2,
          name: 'Test Node',
          x: 100, y: 200, z: 300 
        },
      ]
      
      let capturedNodes: any[] = []
      
      mockSimulation.nodes = vi.fn().mockImplementation((nodes) => {
        if (nodes) {
          capturedNodes = nodes
          return mockSimulation
        }
        return mockNodes
      })
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addRadialForce()
      
      expect(capturedNodes[0].ref_id).toBe('node1')
      expect(capturedNodes[0].scale).toBe(2)
      expect(capturedNodes[0].name).toBe('Test Node')
    })
  })
  
  describe('D3 Force Configuration', () => {
    test('should remove previous Y force by setting it to null', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addRadialForce()
      
      expect(mockSimulation.force).toHaveBeenCalledWith('y', null)
    })
    
    test('should configure radial force with radius 900 at center (0,0,0) and strength 0.1', () => {
      const mockStrength = vi.fn().mockReturnValue(mockForces.radial)
      vi.mocked(d3Force.forceRadial).mockReturnValue({
        strength: mockStrength,
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addRadialForce()
      
      expect(d3Force.forceRadial).toHaveBeenCalledWith(900, 0, 0, 0)
      expect(mockStrength).toHaveBeenCalledWith(0.1)
      expect(mockSimulation.force).toHaveBeenCalledWith('radial', mockForces.radial)
    })
    
    test('should configure center force with strength 1', () => {
      const mockStrength = vi.fn().mockReturnValue(mockForces.center)
      vi.mocked(d3Force.forceCenter).mockReturnValue({
        strength: mockStrength,
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addRadialForce()
      
      expect(d3Force.forceCenter).toHaveBeenCalled()
      expect(mockStrength).toHaveBeenCalledWith(1)
      expect(mockSimulation.force).toHaveBeenCalledWith('center', mockForces.center)
    })
    
    test('should configure forceX with strength 0', () => {
      const mockStrength = vi.fn().mockReturnValue(mockForces.x)
      vi.mocked(d3Force.forceX).mockReturnValue({
        strength: mockStrength,
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addRadialForce()
      
      expect(mockStrength).toHaveBeenCalledWith(0)
      expect(mockSimulation.force).toHaveBeenCalledWith('x', mockForces.x)
    })
    
    test('should configure forceY with strength 0', () => {
      const mockStrength = vi.fn().mockReturnValue(mockForces.y)
      vi.mocked(d3Force.forceY).mockReturnValue({
        strength: mockStrength,
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addRadialForce()
      
      expect(mockStrength).toHaveBeenCalledWith(0)
      // Note: force('y') is called twice - first to set null, then to set forceY
      const yForceCalls = mockSimulation.force.mock.calls.filter((call: any) => call[0] === 'y')
      expect(yForceCalls).toContainEqual(['y', mockForces.y])
    })
    
    test('should configure forceZ with strength 0', () => {
      const mockStrength = vi.fn().mockReturnValue(mockForces.z)
      vi.mocked(d3Force.forceZ).mockReturnValue({
        strength: mockStrength,
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addRadialForce()
      
      expect(mockStrength).toHaveBeenCalledWith(0)
      expect(mockSimulation.force).toHaveBeenCalledWith('z', mockForces.z)
    })
    
    test('should set all forces in correct order', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addRadialForce()
      
      const forceSetterCalls = mockSimulation.force.mock.calls
        .filter((call: any) => call.length === 2)
        .map((call: any) => call[0])
      
      expect(forceSetterCalls).toEqual(['y', 'radial', 'center', 'charge', 'x', 'y', 'z', 'link', 'collide'])
    })
  })
  
  describe('Charge Force Calculation', () => {
    test('should calculate charge strength based on node scale with formula -100 * scale', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      let strengthCallback: any
      
      vi.mocked(d3Force.forceManyBody).mockReturnValue({
        strength: vi.fn().mockImplementation((fn: any) => {
          strengthCallback = fn
          return mockForces.charge
        }),
      } as any)
      
      store.addRadialForce()
      
      const nodeWithScale = { ref_id: 'test', scale: 2 }
      expect(strengthCallback(nodeWithScale)).toBe(-200)
      
      const nodeWithScale5 = { ref_id: 'test2', scale: 5 }
      expect(strengthCallback(nodeWithScale5)).toBe(-500)
    })
    
    test('should use scale of 1 for nodes without scale property', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      let strengthCallback: any
      
      vi.mocked(d3Force.forceManyBody).mockReturnValue({
        strength: vi.fn().mockImplementation((fn: any) => {
          strengthCallback = fn
          return mockForces.charge
        }),
      } as any)
      
      store.addRadialForce()
      
      const nodeWithoutScale = { ref_id: 'test' }
      expect(strengthCallback(nodeWithoutScale)).toBe(-100)
      
      const nodeWithNullScale = { ref_id: 'test2', scale: null }
      expect(strengthCallback(nodeWithNullScale)).toBe(-100)
    })
  })
  
  describe('Link Force Configuration', () => {
    test('should configure link force with strength 1 and distance 300', () => {
      const mockStrength = vi.fn().mockReturnThis()
      const mockDistance = vi.fn().mockReturnThis()
      const mockId = vi.fn().mockReturnValue(mockForces.link)
      
      vi.mocked(d3Force.forceLink).mockReturnValue({
        links: vi.fn().mockReturnThis(),
        strength: mockStrength,
        distance: mockDistance,
        id: mockId,
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addRadialForce()
      
      expect(mockStrength).toHaveBeenCalledWith(1)
      expect(mockDistance).toHaveBeenCalledWith(300)
      expect(mockSimulation.force).toHaveBeenCalledWith('link', mockForces.link)
    })
    
    test('should preserve existing link references', () => {
      const mockLinks = [
        { source: { ref_id: 'node1' }, target: { ref_id: 'node2' }, ref_id: 'link1' },
        { source: { ref_id: 'node2' }, target: { ref_id: 'node3' }, ref_id: 'link2' },
      ]
      
      const mockLinkForce = {
        links: vi.fn().mockReturnValue(mockLinks),
      }
      
      mockSimulation.force = vi.fn().mockImplementation(function(name: string, forceValue?: any) {
        if (arguments.length === 2) {
          return mockSimulation
        }
        if (name === 'link') {
          return mockLinkForce
        }
        return null
      })
      
      const mockLinksMethod = vi.fn().mockReturnThis()
      
      vi.mocked(d3Force.forceLink).mockReturnValue({
        links: mockLinksMethod,
        strength: vi.fn().mockReturnThis(),
        distance: vi.fn().mockReturnThis(),
        id: vi.fn().mockReturnValue(mockForces.link),
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      store.addRadialForce()
      
      expect(mockLinkForce.links).toHaveBeenCalled()
      expect(mockLinksMethod).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ source: 'node1', target: 'node2' }),
          expect.objectContaining({ source: 'node2', target: 'node3' }),
        ])
      )
    })
    
    test('should use ref_id as link identifier', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      let idCallback: any
      
      vi.mocked(d3Force.forceLink).mockReturnValue({
        links: vi.fn().mockReturnThis(),
        strength: vi.fn().mockReturnThis(),
        distance: vi.fn().mockReturnThis(),
        id: vi.fn().mockImplementation((fn: any) => {
          idCallback = fn
          return mockForces.link
        }),
      } as any)
      
      store.addRadialForce()
      
      const testNode = { ref_id: 'test123' }
      expect(idCallback(testNode)).toBe('test123')
    })
  })
  
  describe('Collision Detection', () => {
    test('should calculate collision radius based on node scale with formula 80 * scale', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      let radiusCallback: any
      
      vi.mocked(d3Force.forceCollide).mockReturnValue({
        radius: vi.fn().mockImplementation((fn: any) => {
          radiusCallback = fn
          return {
            strength: vi.fn().mockReturnThis(),
            iterations: vi.fn().mockReturnValue(mockForces.collide),
          }
        }),
      } as any)
      
      store.addRadialForce()
      
      const nodeWithScale = { ref_id: 'test', scale: 2 }
      expect(radiusCallback(nodeWithScale)).toBe(160)
      
      const nodeWithScale3 = { ref_id: 'test2', scale: 3 }
      expect(radiusCallback(nodeWithScale3)).toBe(240)
    })
    
    test('should use scale of 1 for nodes without scale property', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      let radiusCallback: any
      
      vi.mocked(d3Force.forceCollide).mockReturnValue({
        radius: vi.fn().mockImplementation((fn: any) => {
          radiusCallback = fn
          return {
            strength: vi.fn().mockReturnThis(),
            iterations: vi.fn().mockReturnValue(mockForces.collide),
          }
        }),
      } as any)
      
      store.addRadialForce()
      
      const nodeWithoutScale = { ref_id: 'test' }
      expect(radiusCallback(nodeWithoutScale)).toBe(80)
      
      const nodeWithNullScale = { ref_id: 'test2', scale: null }
      expect(radiusCallback(nodeWithNullScale)).toBe(80)
    })
    
    test('should set collision strength to 0.5', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      const mockStrength = vi.fn().mockReturnThis()
      
      vi.mocked(d3Force.forceCollide).mockReturnValue({
        radius: vi.fn().mockReturnThis(),
        strength: mockStrength,
        iterations: vi.fn().mockReturnValue(mockForces.collide),
      } as any)
      
      store.addRadialForce()
      
      expect(mockStrength).toHaveBeenCalledWith(0.5)
    })
    
    test('should set collision iterations to 1', () => {
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      const mockIterations = vi.fn().mockReturnValue(mockForces.collide)
      
      vi.mocked(d3Force.forceCollide).mockReturnValue({
        radius: vi.fn().mockReturnThis(),
        strength: vi.fn().mockReturnThis(),
        iterations: mockIterations,
      } as any)
      
      store.addRadialForce()
      
      expect(mockIterations).toHaveBeenCalledWith(1)
    })
  })
  
  describe('Integration with setForces', () => {
    test('should be called when graphStyle is "sphere"', () => {
      vi.mocked(useGraphStore.getState).mockReturnValue({
        graphStyle: 'sphere',
        neighbourhoods: [],
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      const addRadialForceSpy = vi.spyOn(store, 'addRadialForce')
      const simulationRestartSpy = vi.spyOn(store, 'simulationRestart')
      
      store.setForces()
      
      expect(addRadialForceSpy).toHaveBeenCalled()
      expect(simulationRestartSpy).toHaveBeenCalled()
    })
    
    test('should be called as default when graphStyle is unknown', () => {
      vi.mocked(useGraphStore.getState).mockReturnValue({
        graphStyle: 'unknown' as any,
        neighbourhoods: [],
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      const addRadialForceSpy = vi.spyOn(store, 'addRadialForce')
      
      store.setForces()
      
      expect(addRadialForceSpy).toHaveBeenCalled()
    })
    
    test('should not be called when graphStyle is "force"', () => {
      vi.mocked(useGraphStore.getState).mockReturnValue({
        graphStyle: 'force',
        neighbourhoods: [],
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      const addRadialForceSpy = vi.spyOn(store, 'addRadialForce')
      
      store.setForces()
      
      expect(addRadialForceSpy).not.toHaveBeenCalled()
    })
    
    test('should not be called when graphStyle is "split"', () => {
      vi.mocked(useGraphStore.getState).mockReturnValue({
        graphStyle: 'split',
        neighbourhoods: [],
      } as any)
      
      const store = useSimulationStore.getState()
      store.simulation = mockSimulation
      
      const addRadialForceSpy = vi.spyOn(store, 'addRadialForce')
      
      store.setForces()
      
      expect(addRadialForceSpy).not.toHaveBeenCalled()
    })
  })
})