import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'
import { useSimulationStore } from '@/stores/useSimulationStore'
import { useGraphStore } from '@/stores/useGraphStore'
import { distributeNodesOnSphere } from '@/stores/useSimulationStore/utils/distributeNodesOnSphere'
import type { NodeExtended, Link } from '@Universe/types'

// Create mock force object factory
const createMockForce = () => ({
  strength: vi.fn().mockReturnThis(),
  radius: vi.fn().mockReturnThis(),
  iterations: vi.fn().mockReturnThis(),
  distance: vi.fn().mockReturnThis(),
  links: vi.fn().mockReturnThis(),
  id: vi.fn().mockReturnThis(),
})

// Mock D3 force modules
vi.mock('d3-force-3d', () => {
  return {
    forceSimulation: vi.fn(() => ({
      numDimensions: vi.fn().mockReturnThis(),
      stop: vi.fn().mockReturnThis(),
      nodes: vi.fn().mockReturnThis(),
      force: vi.fn().mockReturnThis(),
      alpha: vi.fn().mockReturnThis(),
      restart: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
    })),
    forceManyBody: vi.fn(() => createMockForce()),
    forceLink: vi.fn(() => createMockForce()),
    forceCollide: vi.fn(() => createMockForce()),
    forceX: vi.fn(() => createMockForce()),
    forceY: vi.fn(() => createMockForce()),
    forceZ: vi.fn(() => createMockForce()),
    forceCenter: vi.fn(() => createMockForce()),
    forceRadial: vi.fn(() => createMockForce()),
  }
})

vi.mock('@/stores/useGraphStore')
vi.mock('@/stores/useSimulationStore/utils/distributeNodesOnSphere')

describe('useSimulationStore - addClusterForce', () => {
  // Test data fixtures
  const mockNeighborhoods = [
    { ref_id: 'n1', name: 'Neighborhood 1' },
    { ref_id: 'n2', name: 'Neighborhood 2' },
    { ref_id: 'n3', name: 'Neighborhood 3' },
  ]

  const mockNodes: NodeExtended[] = [
    {
      ref_id: 'node1',
      neighbourHood: 'n1',
      scale: 1.5,
      x: 100,
      y: 100,
      z: 100,
      node_type: 'test',
    } as NodeExtended,
    {
      ref_id: 'node2',
      neighbourHood: 'n2',
      scale: 1.0,
      x: 200,
      y: 200,
      z: 200,
      node_type: 'test',
    } as NodeExtended,
    {
      ref_id: 'node3',
      neighbourHood: 'n3',
      x: 300,
      y: 300,
      z: 300,
      node_type: 'test',
    } as NodeExtended,
  ]

  const mockLinks: Link<NodeExtended>[] = [
    {
      ref_id: 'link1',
      source: { ref_id: 'node1' } as NodeExtended,
      target: { ref_id: 'node2' } as NodeExtended,
    },
    {
      ref_id: 'link2',
      source: { ref_id: 'node2' } as NodeExtended,
      target: { ref_id: 'node3' } as NodeExtended,
    },
  ]

  const mockNeighborhoodCenters = {
    n1: { x: 1000, y: 500, z: -500 },
    n2: { x: -800, y: 1200, z: 300 },
    n3: { x: 200, y: -900, z: 1500 },
  }

  let mockSimulation: any
  let mockForceMethods: any

  beforeEach(() => {
    // Create mock force methods that chain
    mockForceMethods = {
      strength: vi.fn().mockReturnThis(),
      radius: vi.fn().mockReturnThis(),
      iterations: vi.fn().mockReturnThis(),
      distance: vi.fn().mockReturnThis(),
      links: vi.fn().mockReturnValue(mockLinks),
      id: vi.fn().mockReturnThis(),
    }

    //Store all force instances created (charge, x, y, z, link, collide)
    const forceInstances: Record<string, any> = {
      charge: mockForceMethods,
      x: mockForceMethods,
      y: mockForceMethods,
      z: mockForceMethods,
      link: mockForceMethods,
      collide: mockForceMethods,
    }

    // Create mock simulation with all required methods
    mockSimulation = {
      nodes: vi.fn(function (this: any, newNodes?: any) {
        if (newNodes !== undefined) {
          // Setting nodes, return this for chaining
          return this
        }
        // Getting nodes, return the current nodes array
        return [...mockNodes]
      }),
      force: vi.fn(function (this: any, forceName?: string, forceObj?: any) {
        // If getting a force (no second argument), return the stored force instance or mock link force
        if (arguments.length === 1) {
          if (forceName === 'link') {
            return {
              links: () => mockLinks,
            }
          }
          return forceInstances[forceName!] || null
        }
        // Setting a force with two arguments, store it and return this for chaining
        if (forceObj) {
          forceInstances[forceName!] = forceObj
        }
        return this
      }),
      alpha: vi.fn().mockReturnThis(),
      restart: vi.fn().mockReturnThis(),
      stop: vi.fn().mockReturnThis(),
      numDimensions: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
    }

    // Reset store state
    useSimulationStore.setState({
      simulation: mockSimulation,
      simulationVersion: 0,
      simulationInProgress: false,
    })

    // Mock useGraphStore.getState()
    vi.mocked(useGraphStore.getState).mockReturnValue({
      neighbourhoods: mockNeighborhoods,
      graphStyle: 'force',
    } as any)

    // Mock distributeNodesOnSphere utility
    vi.mocked(distributeNodesOnSphere).mockReturnValue(mockNeighborhoodCenters)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Neighborhood Distribution', () => {
    test('distributes neighborhood centers on sphere with radius 3000', () => {
      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      expect(distributeNodesOnSphere).toHaveBeenCalledWith(mockNeighborhoods, 3000)
    })

    test('handles empty neighborhoods array gracefully', () => {
      vi.mocked(useGraphStore.getState).mockReturnValue({
        neighbourhoods: [],
        graphStyle: 'force',
      } as any)

      const { addClusterForce } = useSimulationStore.getState()

      expect(() => {
        act(() => {
          addClusterForce()
        })
      }).not.toThrow()

      expect(distributeNodesOnSphere).not.toHaveBeenCalled()
    })

    test('handles single neighborhood', () => {
      const singleNeighborhood = [{ ref_id: 'n1', name: 'Solo' }]

      vi.mocked(useGraphStore.getState).mockReturnValue({
        neighbourhoods: singleNeighborhood,
        graphStyle: 'force',
      } as any)

      vi.mocked(distributeNodesOnSphere).mockReturnValue({
        n1: { x: 0, y: 0, z: 3000 },
      })

      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      expect(distributeNodesOnSphere).toHaveBeenCalledWith(singleNeighborhood, 3000)
    })

    test('handles null neighborhoods', () => {
      vi.mocked(useGraphStore.getState).mockReturnValue({
        neighbourhoods: null,
        graphStyle: 'force',
      } as any)

      const { addClusterForce } = useSimulationStore.getState()

      expect(() => {
        act(() => {
          addClusterForce()
        })
      }).not.toThrow()
    })
  })

  describe('Node Position Reset', () => {
    test('resets all node position properties to null', () => {
      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      const nodesCall = mockSimulation.nodes.mock.calls[0]
      const resetNodes = nodesCall[0]

      expect(resetNodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ref_id: 'node1',
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

    test('preserves node properties other than position', () => {
      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      const nodesCall = mockSimulation.nodes.mock.calls[0]
      const resetNodes = nodesCall[0]

      expect(resetNodes[0]).toMatchObject({
        ref_id: 'node1',
        neighbourHood: 'n1',
        scale: 1.5,
        node_type: 'test',
      })
    })
  })

  describe('Charge Force Configuration', () => {
    test('configures charge force with strength 0 (no repulsion)', () => {
      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      const chargeCall = mockSimulation.force.mock.calls.find((call: any) => call[0] === 'charge')
      expect(chargeCall).toBeDefined()
      expect(mockForceMethods.strength).toHaveBeenCalled()

      const strengthFn = mockForceMethods.strength.mock.calls[0][0]
      expect(typeof strengthFn).toBe('function')

      // Test with different node scales
      expect(strengthFn({ scale: 1.5 })).toBe(0)
      expect(strengthFn({ scale: 1.0 })).toBe(0)
      expect(strengthFn({ scale: 2.5 })).toBe(0)
      expect(strengthFn({})).toBe(0) // Node without scale
    })
  })

  describe('ForceX/Y/Z Configuration', () => {
    test('configures forceX with strength 0.1', () => {
      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      const forceXCall = mockSimulation.force.mock.calls.find((call: any) => call[0] === 'x')
      expect(forceXCall).toBeDefined()

      // Check that strength(0.1) was called for forceX
      const strengthCalls = mockForceMethods.strength.mock.calls
      expect(strengthCalls).toContainEqual([0.1])
    })

    test('configures forceY with strength 0.1', () => {
      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      const forceYCall = mockSimulation.force.mock.calls.find((call: any) => call[0] === 'y')
      expect(forceYCall).toBeDefined()

      const strengthCalls = mockForceMethods.strength.mock.calls
      expect(strengthCalls).toContainEqual([0.1])
    })

    test('configures forceZ with strength 0.1', () => {
      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      const forceZCall = mockSimulation.force.mock.calls.find((call: any) => call[0] === 'z')
      expect(forceZCall).toBeDefined()

      const strengthCalls = mockForceMethods.strength.mock.calls
      expect(strengthCalls).toContainEqual([0.1])
    })

    test('forceX returns correct x coordinate for neighborhood', () => {
      const { addClusterForce } = useSimulationStore.getState()
      const { forceX } = require('d3-force-3d')

      act(() => {
        addClusterForce()
      })

      // Get the target function passed to forceX
      const forceXCall = forceX.mock.calls[0]
      expect(forceXCall).toBeDefined()

      const targetFn = forceXCall[0]
      expect(typeof targetFn).toBe('function')

      // Test with node in neighborhood n1
      const result = targetFn({ neighbourHood: 'n1' })
      expect(result).toBe(mockNeighborhoodCenters.n1.x)
    })

    test('forceY returns correct y coordinate for neighborhood', () => {
      const { addClusterForce } = useSimulationStore.getState()
      const { forceY } = require('d3-force-3d')

      act(() => {
        addClusterForce()
      })

      const forceYCall = forceY.mock.calls[0]
      const targetFn = forceYCall[0]

      const result = targetFn({ neighbourHood: 'n2' })
      expect(result).toBe(mockNeighborhoodCenters.n2.y)
    })

    test('forceZ returns correct z coordinate for neighborhood', () => {
      const { addClusterForce } = useSimulationStore.getState()
      const { forceZ } = require('d3-force-3d')

      act(() => {
        addClusterForce()
      })

      const forceZCall = forceZ.mock.calls[0]
      const targetFn = forceZCall[0]

      const result = targetFn({ neighbourHood: 'n3' })
      expect(result).toBe(mockNeighborhoodCenters.n3.z)
    })

    test('force functions return 0 for nodes without neighborhood', () => {
      const { addClusterForce } = useSimulationStore.getState()
      const { forceX, forceY, forceZ } = require('d3-force-3d')

      act(() => {
        addClusterForce()
      })

      const forceXFn = forceX.mock.calls[0][0]
      const forceYFn = forceY.mock.calls[0][0]
      const forceZFn = forceZ.mock.calls[0][0]

      const orphanNode = { ref_id: 'orphan', node_type: 'test' }

      expect(forceXFn(orphanNode)).toBe(0)
      expect(forceYFn(orphanNode)).toBe(0)
      expect(forceZFn(orphanNode)).toBe(0)
    })
  })

  describe('Link Force Configuration', () => {
    test('configures link force with strength 0', () => {
      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      const linkCall = mockSimulation.force.mock.calls.find((call: any) => call[0] === 'link')
      expect(linkCall).toBeDefined()
      expect(mockForceMethods.strength).toHaveBeenCalledWith(0)
    })

    test('configures link force with distance 400', () => {
      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      expect(mockForceMethods.distance).toHaveBeenCalledWith(400)
    })

    test('transforms link source and target to ref_ids', () => {
      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      const linksCall = mockForceMethods.links.mock.calls[0]
      const transformedLinks = linksCall[0]

      expect(transformedLinks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'node1',
            target: 'node2',
          }),
        ])
      )
    })

    test('configures id accessor to use ref_id', () => {
      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      expect(mockForceMethods.id).toHaveBeenCalled()

      const idFn = mockForceMethods.id.mock.calls[0][0]
      expect(typeof idFn).toBe('function')

      expect(idFn({ ref_id: 'test123' })).toBe('test123')
      expect(idFn({ ref_id: 'another-id' })).toBe('another-id')
    })

    test('maintains all existing links', () => {
      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      const linksCall = mockForceMethods.links.mock.calls[0]
      expect(linksCall[0]).toHaveLength(mockLinks.length)
    })
  })

  describe('Collide Force Configuration', () => {
    test('configures collide force with strength 0.5', () => {
      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      const collideCall = mockSimulation.force.mock.calls.find((call: any) => call[0] === 'collide')
      expect(collideCall).toBeDefined()
      expect(mockForceMethods.strength).toHaveBeenCalledWith(0.5)
    })

    test('configures collide force with 1 iteration', () => {
      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      expect(mockForceMethods.iterations).toHaveBeenCalledWith(1)
    })

    test('calculates radius as 95 * node.scale', () => {
      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      const radiusCall = mockForceMethods.radius.mock.calls[0]
      const radiusFn = radiusCall[0]
      expect(typeof radiusFn).toBe('function')

      expect(radiusFn({ scale: 1.0 })).toBe(95)
      expect(radiusFn({ scale: 1.5 })).toBe(142.5)
      expect(radiusFn({ scale: 2.0 })).toBe(190)
      expect(radiusFn({ scale: 0.5 })).toBe(47.5)
    })

    test('defaults to radius 95 for nodes without scale', () => {
      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      const radiusCall = mockForceMethods.radius.mock.calls[0]
      const radiusFn = radiusCall[0]

      expect(radiusFn({})).toBe(95)
      expect(radiusFn({ ref_id: 'test' })).toBe(95)
    })
  })

  describe('Edge Cases', () => {
    test('handles nodes without neighborhood assignment', () => {
      const orphanNodes: NodeExtended[] = [
        { ref_id: 'orphan1', x: 100, y: 100, z: 100, node_type: 'test' } as NodeExtended,
        { ref_id: 'orphan2', x: 200, y: 200, z: 200, node_type: 'test' } as NodeExtended,
      ]

      // Re-implement the mock with new nodes
      mockSimulation.nodes = vi.fn(function (this: any, newNodes?: any) {
        if (newNodes !== undefined) {
          return this
        }
        return [...orphanNodes]
      })

      const { addClusterForce } = useSimulationStore.getState()

      expect(() => {
        act(() => {
          addClusterForce()
        })
      }).not.toThrow()
    })

    test('handles large number of neighborhoods', () => {
      const largeNeighborhoods = Array.from({ length: 100 }, (_, i) => ({
        ref_id: `n${i}`,
        name: `Neighborhood ${i}`,
      }))

      vi.mocked(useGraphStore.getState).mockReturnValue({
        neighbourhoods: largeNeighborhoods,
        graphStyle: 'force',
      } as any)

      const { addClusterForce } = useSimulationStore.getState()

      expect(() => {
        act(() => {
          addClusterForce()
        })
      }).not.toThrow()

      expect(distributeNodesOnSphere).toHaveBeenCalledWith(largeNeighborhoods, 3000)
    })

    test('handles mixed nodes with and without scale', () => {
      const mixedNodes: NodeExtended[] = [
        { ref_id: 'n1', scale: 1.5, node_type: 'test' } as NodeExtended,
        { ref_id: 'n2', node_type: 'test' } as NodeExtended,
        { ref_id: 'n3', scale: 2.0, node_type: 'test' } as NodeExtended,
        { ref_id: 'n4', node_type: 'test' } as NodeExtended,
      ]

      // Re-implement the mock with new nodes
      mockSimulation.nodes = vi.fn(function (this: any, newNodes?: any) {
        if (newNodes !== undefined) {
          return this
        }
        return [...mixedNodes]
      })

      const { addClusterForce } = useSimulationStore.getState()

      expect(() => {
        act(() => {
          addClusterForce()
        })
      }).not.toThrow()
    })

    test('handles empty simulation nodes', () => {
      // Re-implement the mock with empty nodes
      mockSimulation.nodes = vi.fn(function (this: any, newNodes?: any) {
        if (newNodes !== undefined) {
          return this
        }
        return []
      })

      const { addClusterForce } = useSimulationStore.getState()

      expect(() => {
        act(() => {
          addClusterForce()
        })
      }).not.toThrow()
    })

    test('handles links with string source/target (already transformed)', () => {
      const stringLinks = [
        { ref_id: 'link1', source: 'node1', target: 'node2' },
        { ref_id: 'link2', source: 'node2', target: 'node3' },
      ]

      mockForceMethods.links.mockReturnValue(stringLinks)

      const { addClusterForce } = useSimulationStore.getState()

      expect(() => {
        act(() => {
          addClusterForce()
        })
      }).not.toThrow()
    })
  })

  describe('Integration with useGraphStore', () => {
    test('reads neighborhoods from useGraphStore', () => {
      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      expect(useGraphStore.getState).toHaveBeenCalled()
    })

    test('handles when useGraphStore returns no neighborhoods', () => {
      vi.mocked(useGraphStore.getState).mockReturnValue({
        neighbourhoods: undefined,
        graphStyle: 'force',
      } as any)

      const { addClusterForce } = useSimulationStore.getState()

      expect(() => {
        act(() => {
          addClusterForce()
        })
      }).not.toThrow()
    })
  })

  describe('Force Application Order', () => {
    test('applies forces in correct sequence', () => {
      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      const forceCallOrder = mockSimulation.force.mock.calls.map((call: any) => call[0])

      expect(forceCallOrder).toContain('charge')
      expect(forceCallOrder).toContain('x')
      expect(forceCallOrder).toContain('y')
      expect(forceCallOrder).toContain('z')
      expect(forceCallOrder).toContain('link')
      expect(forceCallOrder).toContain('collide')
    })

    test('resets nodes before applying forces', () => {
      const { addClusterForce } = useSimulationStore.getState()

      act(() => {
        addClusterForce()
      })

      // nodes() should be called before force()
      const nodesCallIndex = mockSimulation.nodes.mock.invocationCallOrder[0]
      const firstForceCallIndex = mockSimulation.force.mock.invocationCallOrder[0]

      expect(nodesCallIndex).toBeLessThan(firstForceCallIndex)
    })
  })
})