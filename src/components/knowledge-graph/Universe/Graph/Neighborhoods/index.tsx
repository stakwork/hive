import { useControlStore } from '@/stores/useControlStore'
import { useDataStore, useGraphStore, useSimulationStore } from '@/stores/useStores'
import { distributeNodesOnSphere } from '@/stores/useSimulationStore/utils/distributeNodesOnSphere'
import { Billboard, Edges, Html } from '@react-three/drei'
import { NodeExtended } from '@Universe/types'
import { useMemo, useState } from 'react'
import * as THREE from 'three'
import { nodeSize } from '../Cubes/constants'

// Helper function to distribute neighborhoods based on node_type positioning
const distributeNeighborhoodsByNodeType = (neighbourhoods: { ref_id: string; name?: string }[], _nodeTypes: string[]) => {
  return neighbourhoods.reduce((acc: Record<string, { x: number; y: number; z: number }>, neighbourhood, i) => {
    // Use the same logic as addSplitForce for consistent positioning
    const index = i + 1
    const yOffset = Math.floor(index / 2) * 500
    const y = index % 2 === 0 ? yOffset : -yOffset

    // Distribute on X-Z plane in a circle for each Y level
    const angle = (i * 2 * Math.PI) / Math.max(neighbourhoods.length, 4)
    const radius = 800

    acc[neighbourhood.ref_id] = {
      x: radius * Math.cos(angle),
      y,
      z: radius * Math.sin(angle),
    }

    return acc
  }, {})
}

export const Neighbourhoods = () => {
  const [selectedNeighbourhoodId, setSelectedNeighbourhoodId] = useState<string | null>(null)

  console.log(selectedNeighbourhoodId)

  const graphStyle = useGraphStore((s) => s.graphStyle)
  const neighbourhoods = useGraphStore((s) => s.neighbourhoods)
  const nodeTypes = useDataStore((s) => s.nodeTypes)
  const simulation = useSimulationStore((s) => s.simulation)
  const simulationInProgress = useSimulationStore((s) => s.simulationInProgress)
  const cameraControlsRef = useControlStore((s) => s.cameraControlsRef)

  // Choose neighborhoods and positioning based on graph style
  const { displayNeighbourhoods, neighbourhoodsWithPosition, neigboorHoodsBoundingBox } = useMemo(() => {
    if (graphStyle === 'split') {
      // For 'split' style, use node types as neighborhoods
      const nodeTypeNeighbourhoods = nodeTypes.map(nodeType => ({
        ref_id: nodeType,
        name: nodeType
      }))

      const positionsMap = distributeNeighborhoodsByNodeType(nodeTypeNeighbourhoods, nodeTypes)

      const boundingBoxMap = simulationInProgress
        ? {}
        : simulation
          ?.nodes()
          .reduce((acc: Record<string, { x: number; y: number; z: number }[]>, node: NodeExtended) => {
            if (node.node_type) {
              acc[node.node_type] = [...(acc[node.node_type] || []), { x: node.x, y: node.y, z: node.z }]
            }
            return acc
          }, {}) || {}

      return {
        displayNeighbourhoods: nodeTypeNeighbourhoods,
        neighbourhoodsWithPosition: positionsMap,
        neigboorHoodsBoundingBox: boundingBoxMap
      }
    } else {
      // For 'force' style, use original neighborhood-based approach
      const positionsMap = distributeNodesOnSphere(neighbourhoods, 3000)

      const boundingBoxMap = simulationInProgress
        ? {}
        : simulation
          ?.nodes()
          .reduce((acc: Record<string, { x: number; y: number; z: number }[]>, node: NodeExtended) => {
            if (node.neighbourHood) {
              acc[node.neighbourHood] = [...(acc[node.neighbourHood] || []), { x: node.x, y: node.y, z: node.z }]
            }
            return acc
          }, {}) || {}

      return {
        displayNeighbourhoods: neighbourhoods,
        neighbourhoodsWithPosition: positionsMap,
        neigboorHoodsBoundingBox: boundingBoxMap
      }
    }
  }, [graphStyle, nodeTypes, neighbourhoods, simulation, simulationInProgress])

  const handleClick = (neighbourhoodId: string, center: THREE.Vector3, size: THREE.Vector3) => {
    const distance = size.length() * 1.5
    const direction = new THREE.Vector3(1, 1, 1).normalize()
    const cameraPosition = new THREE.Vector3().copy(center).addScaledVector(direction, distance)

    cameraControlsRef?.setLookAt(
      cameraPosition.x,
      cameraPosition.y,
      cameraPosition.z,
      center.x,
      center.y,
      center.z,
      true,
    )

    setSelectedNeighbourhoodId(neighbourhoodId)
  }

  return (
    <group>
      {Object.entries(neigboorHoodsBoundingBox).map(([neighbourhoodId, positions]) => {
        const labelCenter = neighbourhoodsWithPosition[neighbourhoodId]
        const typedPositions = positions as { x: number; y: number; z: number }[]

        const name = displayNeighbourhoods.find((n) => n.ref_id === neighbourhoodId)?.name || neighbourhoodId

        if (!labelCenter || typedPositions.length === 0) {
          return null
        }

        const points = typedPositions.map((p) => new THREE.Vector3(p.x, p.y, p.z))
        const box = new THREE.Box3().setFromPoints(points)

        const size = new THREE.Vector3()
        const geometricCenter = new THREE.Vector3()

        box.getSize(size)
        box.getCenter(geometricCenter)

        const width = size.x + nodeSize
        const height = size.y + nodeSize
        const depth = size.z + nodeSize

        return (
          <Billboard key={neighbourhoodId} position={geometricCenter.toArray()}>
            <mesh>
              <boxGeometry args={[width, height, depth]} />
              <meshBasicMaterial color="orange" opacity={0.1} transparent />
              <Edges color="#8c6a97" />
              <Html center>
                <div
                  onClick={() => handleClick(neighbourhoodId, geometricCenter, size)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      handleClick(neighbourhoodId, geometricCenter, size)
                    }
                  }}
                  role="button"
                  style={{
                    color: 'white',
                    background: 'rgba(0, 0, 0, 0.7)',
                    borderRadius: '6px',
                    boxShadow: '0 0 8px rgba(0,0,0,0.5)',
                    fontWeight: '600',
                    fontSize: '10px',
                    border: '1px solid white',
                    width: '100px',
                    wordBreak: 'break-word',
                    padding: '5px',
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                  tabIndex={0}
                >
                  {name}
                </div>
              </Html>
            </mesh>
          </Billboard>
        )
      })}
    </group>
  )
}
