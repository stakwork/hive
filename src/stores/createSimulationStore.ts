import { Link, Node, NodeExtended } from '@Universe/types';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  forceX,
  forceY,
  forceZ,
} from 'd3-force-3d';
import { create } from "zustand";
import { createDataStore } from "./createDataStore";
// Removed circular import - graphStore will be passed as parameter
import { type SimulationStore } from "./useSimulationStore";
import { distributeNodesOnSphere } from './useSimulationStore/utils/distributeNodesOnSphere';


const resetPosition = {
  fx: null,
  fy: null,
  fz: null,
  x: null,
  y: null,
  z: null,
  vx: null,
  vy: null,
  vz: null,
}

export const createSimulationStore = (
  dataStore: ReturnType<typeof createDataStore>,
  graphStore: any
) =>
  create<SimulationStore>((set, get) => ({
    simulation: null,
    simulationVersion: 0,
    simulationInProgress: false,
    isSleeping: false,
    simulationCreate: (nodes) => {
      const structuredNodes = structuredClone(nodes)

      const simulation = forceSimulation([])
        .numDimensions(3)
        .stop()
        .nodes(structuredNodes)
        .force(
          'link',
          forceLink()
            .strength(0)
            .links([])
            .id((d: Node) => d.ref_id),
        )

      set({ simulation })
    },

    removeSimulation: () => set({ simulation: null }),

    addNodesAndLinks: (newNodes, newLinks, replace) => {
      const { simulation, simulationRestart } = get()
      const { graphStyle } = graphStore.getState()
      const { nodeTypes } = dataStore.getState()

      if (!simulation) {
        return
      }

      simulation.stop()

      const nodes = replace ? [] : simulation.nodes()

      const links = replace
        ? []
        : simulation
          .force('link')
          .links()
          .map((i: Link<NodeExtended>) => ({ ...i, source: i.source.ref_id, target: i.target.ref_id }))

      nodes.push(...structuredClone(newNodes))
      links.push(...structuredClone(newLinks))

      const filteredLinks = links.filter(
        (i: Link) =>
          nodes.some((n: NodeExtended) => n.ref_id === i.source) &&
          nodes.some((n: NodeExtended) => n.ref_id === i.target),
      )

      const nodesPositioned = graphStyle === 'split' ? (() => {
        // Group nodes by type for grid positioning
        const nodesByType: Record<string, Node[]> = {}
        nodes.forEach((node: Node) => {
          if (!nodesByType[node.node_type]) {
            nodesByType[node.node_type] = []
          }
          nodesByType[node.node_type].push(node)
        })

        return nodes.map((n: Node) => {
          const typeIndex = nodeTypes.indexOf(n.node_type) + 1
          const yLayer = Math.floor(typeIndex / 2) * 500
          const isEvenLayer = typeIndex % 2 === 0
          const yOffset = isEvenLayer ? yLayer : -yLayer

          // Get nodes of same type for grid positioning
          const sameTypeNodes = nodesByType[n.node_type]
          const nodeIndexInType = sameTypeNodes.findIndex(node => node.ref_id === n.ref_id)

          // Grid layout calculations
          const nodesPerRow = Math.ceil(Math.sqrt(sameTypeNodes.length))
          const row = Math.floor(nodeIndexInType / nodesPerRow)
          const col = nodeIndexInType % nodesPerRow

          // Grid spacing
          const spacing = 300
          const gridWidth = (nodesPerRow - 1) * spacing
          const gridHeight = (Math.ceil(sameTypeNodes.length / nodesPerRow) - 1) * spacing

          // Center the grid around origin
          const x = col * spacing - gridWidth / 2
          const z = row * spacing - gridHeight / 2

          return {
            ...n,
            fx: x,
            fy: yOffset,
            fz: z,
            x: x,
            y: yOffset,
            z: z,
          }
        })
      })() : nodes;

      try {
        simulation.nodes(nodesPositioned)

        // For split mode, disable links to avoid positioning conflicts
        if (graphStyle === 'split') {
          simulation.force('link').links([])
        } else {
          simulation.force('link').links(filteredLinks)
        }

        simulationRestart()
      } catch (error) {
        console.error('Error in addNodesAndLinks:', error)
        // Fallback: try without links if there's an error
        simulation.force('link').links([])
        simulationRestart()
      }
    },

    setForces: () => {
      const { simulationRestart, addRadialForce, addClusterForce, addSplitForce } = get()
      const { graphStyle } = graphStore.getState()

      switch (graphStyle) {
        case 'sphere':
          addRadialForce()
          break
        case 'force':
          addClusterForce()
          break
        case 'split':
          addSplitForce()
          break
        default:
          addRadialForce()
          break
      }

      simulationRestart()
    },

    addRadialForce: () => {
      const { simulation } = get()

      simulation
        .nodes(simulation.nodes().map((n: Node) => ({ ...n, ...resetPosition })))
        .force('y', null)
        .force('radial', forceRadial(900, 0, 0, 0).strength(0.1))
        .force('center', forceCenter().strength(1))
        .force(
          'charge',
          forceManyBody().strength((node: NodeExtended) => (node.scale || 1) * -100),
        )
        .force('x', forceX().strength(0))
        .force('y', forceY().strength(0))
        .force('z', forceZ().strength(0))
        .force(
          'link',
          forceLink()
            .links(
              simulation
                .force('link')
                .links()
                .map((i: Link<NodeExtended>) => ({ ...i, source: i.source.ref_id, target: i.target.ref_id })),
            )
            .strength(1)
            .distance(300)
            .id((d: Node) => d.ref_id),
        )
        .force(
          'collide',
          forceCollide()
            .radius((node: NodeExtended) => (node.scale || 1) * 80)
            .strength(0.5)
            .iterations(1),
        )
    },

    addClusterForce: () => {
      const { simulation } = get()
      const { neighbourhoods } = graphStore.getState()
      const neighborhoodCenters = neighbourhoods?.length ? distributeNodesOnSphere(neighbourhoods, 3000) : null

      simulation
        .nodes(simulation.nodes().map((n: Node) => ({ ...n, ...resetPosition })))
        .force(
          'charge',
          forceManyBody().strength((node: NodeExtended) => (node.scale || 1) * 0),
        )
        .force(
          'x',
          forceX((n: NodeExtended) => {
            const neighborhood = neighborhoodCenters && n.neighbourHood ? neighborhoodCenters[n.neighbourHood] : null

            return neighborhood?.x || 0
          }).strength(0.1),
        )
        .force(
          'y',
          forceY((n: NodeExtended) => {
            const neighborhood = neighborhoodCenters && n.neighbourHood ? neighborhoodCenters[n.neighbourHood] : null

            return neighborhood?.y || 0
          }).strength(0.1),
        )
        .force(
          'z',
          forceZ((n: NodeExtended) => {
            const neighborhood = neighborhoodCenters && n.neighbourHood ? neighborhoodCenters[n.neighbourHood] : null

            return neighborhood?.z || 0
          }).strength(0.1),
        )
        .force(
          'link',
          forceLink()
            .links(
              simulation
                .force('link')
                .links()
                .map((i: Link<NodeExtended>) => ({ ...i, source: i.source.ref_id, target: i.target.ref_id })),
            )
            .strength(0)
            .distance(400)
            .id((d: NodeExtended) => d.ref_id),
        )
        .force(
          'collide',
          forceCollide()
            .radius((node: NodeExtended) => (node.scale || 1) * 95)
            .strength(0.5)
            .iterations(1),
        )
    },

    addSplitForce: () => {
      const { simulation } = get()

      // Disable all forces for fixed positioning (nodes already positioned in addNodesAndLinks)
      simulation
        .force('center', null)
        .force('charge', null)
        .force('link', forceLink().strength(0).links([]))
        .force('collide', null)
        .force('x', null)
        .force('y', null)
        .force('z', null)
        .alpha(0.1) // Low alpha for quick settling
    },

    getLinks: () => {
      const { simulation } = get()

      return simulation ? simulation.force('link').links() : []
    },

    simulationRestart: () => {
      const { simulation, setSimulationInProgress } = get()

      if (!simulation) {
        return
      }

      setSimulationInProgress(true)

      simulation.alpha(0.4).restart()
    },

    updateSimulationVersion: () => {
      set((state) => ({ simulationVersion: state.simulationVersion + 1 }))
    },

    setSimulationInProgress: (simulationInProgress: boolean) => {
      set({ simulationInProgress })
    },

    setIsSleeping: (isSleeping: boolean) => {
      set({ isSleeping })
    },
  }));