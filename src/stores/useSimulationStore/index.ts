import { Link, Node, NodeExtended } from '@Universe/types'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  forceZ,
} from 'd3-force-3d'
import { create } from 'zustand'
import { useDataStore } from '../useDataStore'
import { useGraphStore } from '../useGraphStore'
import { distributeNodesOnSphere } from './utils/distributeNodesOnSphere'

type ForceSimulation = typeof forceSimulation

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

export interface SimulationStore {
  simulation: ForceSimulation | null
  simulationVersion: number
  simulationInProgress: boolean
  isSleeping: boolean
  simulationCreate: (nodes: Node[]) => void
  removeSimulation: () => void
  addNodesAndLinks: (nodes: Node[], links: Link[], replace: boolean) => void
  setForces: () => void
  resetSimulation: () => void
  addLinkForce: () => void
  addSplitForce: () => void
  simulationRestart: () => void
  getLinks: () => Link<NodeExtended>[]
  updateSimulationVersion: () => void
  setSimulationInProgress: (simulationInProgress: boolean) => void
  setIsSleeping: (isSleeping: boolean) => void
}

export const useSimulationStore = create<SimulationStore>((set, get) => ({
  simulation: null,
  simulationVersion: 0,
  simulationInProgress: false,
  isSleeping: false,
  resetSimulation: () => {
    const { simulation } = get()
    if (!simulation) {
      return
    }
    simulation.stop()
    simulation.nodes([])
    simulation.force('link').links([])
  },
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
    const { graphStyle } = useGraphStore.getState()
    const { nodeTypes } = useDataStore.getState()

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

    const nodesPositioned = graphStyle === 'split' ? nodes.map((n: Node) => {
      const index = nodeTypes.indexOf(n.node_type) + 1
      const yOffset = Math.floor(index / 2) * 500

      return {
        ...n,
        fy: index % 2 === 0 ? yOffset : -yOffset,
      }
    }) : nodes;

    try {
      simulation.nodes(nodesPositioned)
      simulation.force('link').links(filteredLinks)

      simulationRestart()
    } catch (error) {
      console.error(error)
    }
  },

  setForces: () => {
    const { simulation, simulationRestart, addLinkForce, addSplitForce } = get()
    const { graphStyle } = useGraphStore.getState()

    if (!simulation) return

    // Unlock all nodes before applying new layout forces
    simulation.nodes().forEach((n: NodeExtended) => {
      n.fx = undefined
      n.fy = undefined
      n.fz = undefined
    })

    switch (graphStyle) {
      case 'sphere':
        addLinkForce()
        break
      case 'split':
        addSplitForce()
        break
      default:
        addLinkForce()
        break
    }

    simulationRestart()
  },

  addLinkForce: () => {
    const { simulation } = get()
    const nodes = simulation.nodes()
    const { activeFilterTab } = useGraphStore.getState()

    // Check if we're in concepts filter tab to enable Feature clustering
    const shouldUseFeatureClustering = activeFilterTab === 'concepts'

    if (shouldUseFeatureClustering) {
      // Find all Feature nodes to act as cluster centers
      const featureNodes = nodes.filter((node: NodeExtended) => node.node_type === 'Feature')

      if (featureNodes.length > 0) {
        // Create neighborhoods using Feature nodes as centers
        const featureNeighborhoods = featureNodes.map((node: NodeExtended) => ({ ref_id: node.ref_id, name: node.name }))
        const neighborhoodCenters = distributeNodesOnSphere(featureNeighborhoods, 3000)

        // Assign each non-Feature node to Feature nodes in a round-robin fashion for even distribution
        let nonFeatureIndex = 0
        const updatedNodes = simulation.nodes().map((node: NodeExtended) => {
          if (node.node_type === 'Feature') {
            // Feature nodes become neighborhood centers
            return { ...node, neighbourHood: node.ref_id }
          } else {
            // Distribute other nodes evenly across Feature nodes
            const assignedFeature = featureNodes[nonFeatureIndex % featureNodes.length]
            nonFeatureIndex++
            return { ...node, neighbourHood: assignedFeature.ref_id }
          }
        })

        simulation
          .nodes(updatedNodes)
          .force('y', null)
          .force('radial', null)
          .force('center', forceCenter().strength(0.1))
          .force(
            'charge',
            forceManyBody().strength((node: NodeExtended) => (node.scale || 1) * -50),
          )
          .force(
            'x',
            forceX((n: NodeExtended) => {
              const neighborhood = neighborhoodCenters[n.neighbourHood || '']
              return neighborhood?.x || 0
            }).strength(0.2),
          )
          .force(
            'y',
            forceY((n: NodeExtended) => {
              const neighborhood = neighborhoodCenters[n.neighbourHood || '']
              return neighborhood?.y || 0
            }).strength(0.2),
          )
          .force(
            'z',
            forceZ((n: NodeExtended) => {
              const neighborhood = neighborhoodCenters[n.neighbourHood || '']
              return neighborhood?.z || 0
            }).strength(0.2),
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
              .strength(0.3)
              .distance(400)
              .id((d: Node) => d.ref_id),
          )
          .force(
            'collide',
            forceCollide()
              .radius((node: NodeExtended) => (node.scale || 1) * 100)
              .strength(0.7)
              .iterations(2),
          )
      } else {
        // No Feature nodes in concepts mode - use compact layout
        simulation
          .nodes(simulation.nodes().map((n: Node) => ({ ...n, ...resetPosition })))
          .force('y', null)
          .force('radial', null)
          .force('center', forceCenter().strength(0.3))
          .force('charge', forceManyBody().strength(-200))
          .force('x', forceX().strength(0.1))
          .force('y', forceY().strength(0.1))
          .force('z', forceZ().strength(0.1))
          .force(
            'link',
            forceLink()
              .links(
                simulation
                  .force('link')
                  .links()
                  .map((i: Link<NodeExtended>) => ({ ...i, source: i.source.ref_id, target: i.target.ref_id })),
              )
              .strength(0.5)
              .distance(150)
              .id((d: Node) => d.ref_id),
          )
          .force(
            'collide',
            forceCollide()
              .radius((node: NodeExtended) => (node.scale || 1) * 60)
              .strength(0.8)
              .iterations(2),
          )
      }
    } else {
      // Fallback to regular link-based layout when not in concepts mode
      simulation
        .nodes(simulation.nodes().map((n: Node) => ({ ...n, ...resetPosition })))
        .force('y', null)
        .force('radial', null)
        .force('center', forceCenter().strength(0.2))
        .force('charge', forceManyBody().strength(-100))
        .force('x', forceX().strength(0.1))
        .force('y', forceY().strength(0.1))
        .force('z', forceZ().strength(0.1))
        .force(
          'link',
          forceLink()
            .links(
              simulation
                .force('link')
                .links()
                .map((i: Link<NodeExtended>) => ({ ...i, source: i.source.ref_id, target: i.target.ref_id })),
            )
            .strength(0.7)
            .distance(200)
            .id((d: Node) => d.ref_id),
        )
        .force(
          'collide',
          forceCollide()
            .radius((node: NodeExtended) => (node.scale || 1) * 80)
            .strength(0.8)
            .iterations(2),
        )
    }
  },

  addSplitForce: () => {
    const { simulation } = get()
    const { nodeTypes } = useDataStore.getState()

    simulation
      // .stop()
      .force('cluster', null)
      .nodes(
        simulation.nodes().map((n: Node) => {
          const index = nodeTypes.indexOf(n.node_type) + 1
          const yOffset = Math.floor(index / 2) * 500

          return {
            ...n,
            ...resetPosition,
            fy: index % 2 === 0 ? yOffset : -yOffset,
          }
        }),
      )
      // .force('radial', forceRadial(2000, 0, 0, 0).strength(0.1))
      .force('center', forceCenter().strength(1))
      .force('x', forceX().strength(1))
      .force('y', forceY().strength(1))
      .force('z', forceZ().strength(1))
      .force(
        'collide',
        forceCollide()
          .radius(() => 200)
          .strength(1)
          .iterations(1),
      )
  },

  getLinks: () => {
    const { simulation } = get()

    return simulation ? simulation.force('link').links() : []
  },

  simulationRestart: () => {
    console.log('simulationRestart-start')
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
}))
