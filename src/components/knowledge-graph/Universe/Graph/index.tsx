import { deepEqual } from '@/lib/utils/deepEqual'
import { getStoreBundle } from '@/stores/createStoreFactory'
import { useStoreId } from '@/stores/StoreProvider'
import { useSchemaStore } from '@/stores/useSchemaStore'
import { useDataStore, useGraphStore, useSimulationStore } from '@/stores/useStores'
import { useFrame } from '@react-three/fiber'
import { NodeExtended } from '@Universe/types'
import { useEffect, useRef } from 'react'
import { Group, Vector3 } from 'three'
import { Line2 } from 'three-stdlib'
import { RepositoryScene } from '../GitSeeScene'
import { CalloutsLayer } from './Callouts'
import { EdgesGPU } from './Connections/EdgeCpu'
import { Cubes } from './Cubes'
import { HighlightedNodesLayer } from './HighlightedNodes'
import { MockNodesLayer } from './HighlightedNodes/MockNodesLayer'
import { HtmlNodesLayer } from './HtmlNodesLayer'
import { LayerLabels } from './LayerLabels'
import { NodeDetailsPanel } from './UI'
import { calculateRadius } from './utils/calculateGroupRadius'

export type LinkPosition = {
  sx: number
  sy: number
  sz: number
  tx: number
  ty: number
  tz: number
}

export type NodePosition = {
  x: number
  y: number
  z: number
}

export const Graph = () => {
  const dataInitial = useDataStore((s) => s.dataInitial)
  const dataNew = useDataStore((s) => s.dataNew)
  const resetDataNew = useDataStore((s) => s.resetDataNew)
  const isOnboarding = useDataStore((s) => s.isOnboarding)
  const groupRef = useRef<Group>(null)
  const normalizedSchemasByType = useSchemaStore((s) => s.normalizedSchemasByType)
  const prevRadius = useRef(0)
  const storeId = useStoreId()
  const lerpVec = useRef(new Vector3())

  const linksPositionRef = useRef(new Map<string, LinkPosition>())
  const justWokeUpRef = useRef(false)

  const graphStyle = useGraphStore((s) => s.graphStyle)
  const setGraphRadius = useGraphStore((s) => s.setGraphRadius)
  const activeFilterTab = useGraphStore((s) => s.activeFilterTab)

  const simulation = useSimulationStore((s) => s.simulation)
  const simulationCreate = useSimulationStore((s) => s.simulationCreate)
  const addClusterForce = useSimulationStore((s) => s.addClusterForce)
  const addNodesAndLinks = useSimulationStore((s) => s.addNodesAndLinks)
  const simulationRestart = useSimulationStore((s) => s.simulationRestart)
  const updateSimulationVersion = useSimulationStore((s) => s.updateSimulationVersion)
  const setForces = useSimulationStore((s) => s.setForces)
  const setSimulationInProgress = useSimulationStore((s) => s.setSimulationInProgress)
  const isSleeping = useSimulationStore((s) => s.isSleeping)
  const setIsSleeping = useSimulationStore((s) => s.setIsSleeping)

  const highlightNodes = useGraphStore((s) => s.highlightNodes)

  // Wake up the simulation when component mounts
  useEffect(() => {
    // Check if we're returning from a sleeping state
    const wasSleeping = isSleeping

    if (wasSleeping) {
      // Mark that we just woke up to prevent immediate setForces()
      justWokeUpRef.current = true

      // If we have existing simulation and data, set alpha to almost min to quickly trigger end event
      if (simulation && dataInitial?.nodes?.length) {
        simulation.alpha(0.001).restart() // Almost minimum alpha to quickly trigger 'end' event
      }

      // Reset the flag after a brief delay to allow normal operation
      setTimeout(() => {
        justWokeUpRef.current = false
      }, 100)
    }

    // Always wake up the simulation
    setIsSleeping(false)

    // Clean up: put simulation to sleep when component unmounts
    return () => {
      setIsSleeping(true)
    }
  }, [setIsSleeping, isSleeping, simulation, dataInitial])

  useEffect(() => {
    if (highlightNodes.length) {
      addClusterForce()
      simulationRestart()
    }
  }, [highlightNodes, addClusterForce, simulationRestart])

  useEffect(() => {
    console.log('[adding new nodes] useEffect called dataNew', dataNew)

    if (!dataNew) {
      return
    }

    const nodes = dataNew.nodes || []
    const links = dataNew.links || []

    const nodesClone = structuredClone(nodes)
    const linksClone = structuredClone(links)

    if (simulation) {
      const replace = deepEqual(dataNew, dataInitial)

      addNodesAndLinks(nodesClone, linksClone, replace)
    }

    if (!simulation) {
      simulationCreate(nodesClone)
    }

    resetDataNew()
  }, [dataNew, simulation, simulationCreate, dataInitial, addNodesAndLinks, resetDataNew])

  // useEffect(() => {
  //   ; () => removeSimulation()
  // }, [removeSimulation])

  useEffect(() => {
    if (!simulation || isSleeping || justWokeUpRef.current) {
      return
    }

    setForces()
  }, [graphStyle, setForces, simulation, isSleeping])

  // Onboarding: smoothly lerp node positions from current to simulation targets each frame
  useFrame(() => {

    const { nodePositionsNormalized } = getStoreBundle(storeId).simulation.getState()
    if (!isOnboarding || !simulation || !groupRef.current) return

    const gr = groupRef.current.getObjectByName('simulation-3d-group__nodes') as Group
    const grPoints = groupRef.current.getObjectByName('simulation-3d-group__node-points') as Group
    const grConnections = groupRef.current.getObjectByName('simulation-3d-group__connections') as Group

    if (gr || grPoints) {
      const nodes = simulation.nodes()
      const maxLength = Math.max(gr?.children.length || grPoints?.children[0]?.children.length, 0)

      for (let index = 0; index < maxLength; index += 1) {
        const simulationNode = nodes[index]

        if (simulationNode) {
          const target = lerpVec.current.set(simulationNode.fx || simulationNode.x || 0, simulationNode.fy || simulationNode.y || 0, simulationNode.fz || simulationNode.z || 0)

          if (gr?.children[index]) {
            gr.children[index].position.lerp(target, 0.01)
          }

          if (grPoints?.children[0]?.children[index]) {
            grPoints.children[0].children[index].position.lerp(target, 0.01)
          }

          const applied = gr?.children?.[index]?.position || target
          nodePositionsNormalized.set(simulationNode.ref_id, { x: applied.x, y: applied.y, z: applied.z || 0 })
        }
      }
    }

    linksPositionRef.current.clear()

    dataInitial?.links.forEach((link) => {
      const sourceId = typeof link.source === 'string' ? link.source : (link.source as any)?.ref_id
      const targetId = typeof link.target === 'string' ? link.target : (link.target as any)?.ref_id

      const sourceNode = sourceId ? nodePositionsNormalized.get(sourceId) : { x: 0, y: 0, z: 0 }
      const targetNode = targetId ? nodePositionsNormalized.get(targetId) : { x: 0, y: 0, z: 0 }

      const { x: sx, y: sy, z: sz } = sourceNode || { x: 0, y: 0, z: 0 }
      const { x: tx, y: ty, z: tz } = targetNode || { x: 0, y: 0, z: 0 }

      linksPositionRef.current.set(link.ref_id, {
        sx: sx || 0,
        sy: sy || 0,
        sz: sz || 0,
        tx: tx || 0,
        ty: ty || 0,
        tz: tz || 0,
      })
    })

    if (grConnections) {
      grConnections.children.forEach((g, i) => {
        const r = g.children[0]
        const text = g.children[1]

        if (r instanceof Line2) {
          const Line = r as Line2
          const link = dataInitial?.links[i]

          if (link) {
            const sourceNode = (link.source as any).ref_id ? nodePositionsNormalized.get((link.source as any).ref_id as string) : { x: 0, y: 0, z: 0 }
            const targetNode = (link.target as any).ref_id ? nodePositionsNormalized.get((link.target as any).ref_id as string) : { x: 0, y: 0, z: 0 }

            if (!sourceNode || !targetNode) {
              return
            }

            const { x: sx, y: sy, z: sz } = sourceNode || { x: 0, y: 0, z: 0 }
            const { x: tx, y: ty, z: tz } = targetNode || { x: 0, y: 0, z: 0 }

            text.position.set((sx + tx) / 2, (sy + ty) / 2, (sz + tz) / 2)
            Line.geometry.setPositions([sx, sy, sz, tx, ty, tz])
            const { material } = Line
            material.transparent = true
            material.opacity = 0.3
          }
        }
      })
    }
  })

  useEffect(() => {
    if (!simulation || isOnboarding) {
      return
    }


    const { nodePositionsNormalized } = getStoreBundle(storeId).simulation.getState()
    if (!groupRef?.current) {
      return
    }

    const { selectedNode } = getStoreBundle(storeId).graph.getState()

    const gr = groupRef.current.getObjectByName('simulation-3d-group__nodes') as Group
    const grPoints = groupRef.current.getObjectByName('simulation-3d-group__node-points') as Group
    const grConnections = groupRef.current.getObjectByName('simulation-3d-group__connections') as Group

    simulation.on('tick', () => {
      if (groupRef?.current) {
        if (gr || grPoints) {
          const nodes = simulation.nodes()

          const maxLength = Math.max(gr?.children.length || grPoints?.children[0]?.children.length, 0)

          for (let index = 0; index < maxLength; index += 1) {
            const simulationNode = nodes[index]



            if (simulationNode) {
              if (gr?.children[index]) {
                gr.children[index].position.set(simulationNode.x, simulationNode.y, simulationNode.z)
              }

              if (grPoints?.children[0]?.children[index]) {
                grPoints.children[0].children[index].position.set(simulationNode.x, simulationNode.y, simulationNode.z)
              }

              nodePositionsNormalized.set(simulationNode.ref_id, { x: simulationNode.x, y: simulationNode.y, z: simulationNode.z || 0 })
            }
          }
        }


        linksPositionRef.current.clear()

        dataInitial?.links.forEach((link) => {
          const sourceId = typeof link.source === 'string' ? link.source : (link.source as any)?.ref_id
          const targetId = typeof link.target === 'string' ? link.target : (link.target as any)?.ref_id

          const sourceNode = sourceId ? nodePositionsNormalized.get(sourceId) : { x: 0, y: 0, z: 0 }
          const targetNode = targetId ? nodePositionsNormalized.get(targetId) : { x: 0, y: 0, z: 0 }

          const { x: sx, y: sy, z: sz } = sourceNode || { x: 0, y: 0, z: 0 }
          const { x: tx, y: ty, z: tz } = targetNode || { x: 0, y: 0, z: 0 }

          // Set positions for the link
          linksPositionRef.current.set(link.ref_id, {
            sx: sx || 0,
            sy: sy || 0,
            sz: sz || 0,
            tx: tx || 0,
            ty: ty || 0,
            tz: tz || 0,
          })
        })

        if (grConnections) {
          grConnections.children.forEach((g, i) => {
            const r = g.children[0] // Assuming Line is the first child
            const text = g.children[1] // Assuming Text is the second child

            if (r instanceof Line2) {
              // Ensure you have both Line and Text
              const Line = r as Line2
              const link = dataInitial?.links[i]

              if (link) {
                const sourceNode = (link.source as any).ref_id ? nodePositionsNormalized.get((link.source as any).ref_id as string) : { x: 0, y: 0, z: 0 }
                const targetNode = (link.target as any).ref_id ? nodePositionsNormalized.get((link.target as any).ref_id as string) : { x: 0, y: 0, z: 0 }

                if (!sourceNode || !targetNode) {
                  return
                }

                const { x: sx, y: sy, z: sz } = sourceNode || { x: 0, y: 0, z: 0 }
                const { x: tx, y: ty, z: tz } = targetNode || { x: 0, y: 0, z: 0 }


                text.position.set((sx + tx) / 2, (sy + ty) / 2, (sz + tz) / 2)

                // Set line color and properties
                // const lineColor = normalizedSchemasByType[sourceNode.node_type]?.primary_color || 'white'

                Line.geometry.setPositions([sx, sy, sz, tx, ty, tz])

                const { material } = Line

                // material.color = new Color(lineColor)
                material.transparent = true
                material.opacity = 0.3
              }
            }
          })
        }
      }
    })

    simulation.on('end', () => {

      simulation.nodes().forEach((i: NodeExtended) => {

        i.fx = i.x

        i.fy = i.y

        i.fz = i.z || 0
        nodePositionsNormalized.set(i.ref_id, { x: i.x, y: i.y, z: i.z || 0 })
      })

      if (groupRef?.current) {
        if (gr || grPoints) {
          const nodes = simulation.nodes()

          const maxLength = Math.max(gr?.children?.length || grPoints?.children[0]?.children?.length || 0, 0)

          for (let index = 0; index < maxLength; index += 1) {
            const simulationNode = nodes[index]

            if (simulationNode) {
              if (gr?.children?.[index]) {
                gr.children[index].position.set(simulationNode.x, simulationNode.y, simulationNode.z)
              }

              if (grPoints?.children[0]?.children[index]) {
                grPoints.children[0].children[index].position.set(simulationNode.x, simulationNode.y, simulationNode.z)
              }
            }
          }
        }

        linksPositionRef.current.clear()

        dataInitial?.links.forEach((link) => {
          const sourceId = typeof link.source === 'string' ? link.source : (link.source as any)?.ref_id
          const targetId = typeof link.target === 'string' ? link.target : (link.target as any)?.ref_id
          const sourceNode = sourceId ? nodePositionsNormalized.get(sourceId) : { x: 0, y: 0, z: 0 }
          const targetNode = targetId ? nodePositionsNormalized.get(targetId) : { x: 0, y: 0, z: 0 }

          const { x: sx, y: sy, z: sz } = sourceNode || { x: 0, y: 0, z: 0 }
          const { x: tx, y: ty, z: tz } = targetNode || { x: 0, y: 0, z: 0 }

          // Set positions for the link
          linksPositionRef.current.set(link.ref_id, {
            sx: sx || 0,
            sy: sy || 0,
            sz: sz || 0,
            tx: tx || 0,
            ty: ty || 0,
            tz: tz || 0,
          })
        })

        if (grConnections) {
          grConnections.children.forEach((g, i) => {
            const r = g.children[0] // Assuming Line is the first child
            const text = g.children[1] // Assuming Text is the second child

            if (r instanceof Line2) {
              // Ensure you have both Line and Text
              const Line = r as Line2
              const link = dataInitial?.links[i]

              if (link) {
                const sourceNode = (link.source as any).ref_id ? nodePositionsNormalized.get((link.source as any).ref_id as string) : { x: 0, y: 0, z: 0 }
                const targetNode = (link.target as any).ref_id ? nodePositionsNormalized.get((link.target as any).ref_id as string) : { x: 0, y: 0, z: 0 }

                if (!sourceNode || !targetNode) {
                  return
                }

                const { x: sx, y: sy, z: sz } = sourceNode || { x: 0, y: 0, z: 0 }
                const { x: tx, y: ty, z: tz } = targetNode || { x: 0, y: 0, z: 0 }


                text.position.set((sx + tx) / 2, (sy + ty) / 2, (sz + tz) / 2)

                // Set line color and properties
                // const lineColor = normalizedSchemasByType[sourceNode.node_type]?.primary_color || 'white'

                Line.geometry.setPositions([sx, sy, sz, tx, ty, tz])

                const { material } = Line

                // material.color = new Color(lineColor)
                material.transparent = true
                material.opacity = 0.3
              }
            }
          })
        }

        if (gr || grPoints) {
          if (selectedNode) {
            return
          }

          const newRadius = calculateRadius(gr || grPoints)

          if (prevRadius.current === 0 || Math.abs(prevRadius.current - newRadius) > 200) {
            setGraphRadius(newRadius)
            prevRadius.current = newRadius
          }
        }

        setSimulationInProgress(false)
        updateSimulationVersion()
      }
    })
  }, [
    dataInitial,
    simulation,
    setGraphRadius,
    normalizedSchemasByType,
    updateSimulationVersion,
    setSimulationInProgress,
    isOnboarding,
    storeId,
  ])

  // if (!simulation) {
  //   return null
  // }


  // console.log('activeFilterTab', activeFilterTab)
  // console.log('graphStyle', graphStyle)


  return (

    <group ref={groupRef}>
      <group>
        <Cubes />

        <EdgesGPU linksPosition={linksPositionRef.current} />
      </group>
      {!isOnboarding && <HighlightedNodesLayer />}
      {!isOnboarding && <CalloutsLayer />}
      {!isOnboarding && graphStyle === 'split' && activeFilterTab === 'all' && <MockNodesLayer />}
      {isOnboarding && <RepositoryScene />}
      {graphStyle === 'sphere' && activeFilterTab === 'concepts' && <HtmlNodesLayer nodeTypes={['Feature']} enabled />}
      {graphStyle === 'split' ? <LayerLabels /> : null}
      <NodeDetailsPanel />

    </group>
  )
}
