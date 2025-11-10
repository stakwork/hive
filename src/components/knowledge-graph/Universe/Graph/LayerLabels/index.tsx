import { useControlStore } from '@/stores/useControlStore'
import { useDataStore, useSimulationStore } from '@/stores/useStores'
import { Billboard, Text } from '@react-three/drei'
import { NodeExtended } from '@Universe/types'
import { useMemo, useState } from 'react'
import * as THREE from 'three'


// Helper function to distribute neighborhoods based on node_type positioning
const distributeNeighborhoodsByNodeType = (neighbourhoods: { ref_id: string; name?: string }[], nodeTypes: string[]) => {
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

export const LayerLabels = () => {
  const [selectedNodeTypeId, setSelectedNodeTypeId] = useState<string | null>(null)

  const nodeTypes = useDataStore((s) => s.nodeTypes)
  const simulation = useSimulationStore((s) => s.simulation)
  const simulationInProgress = useSimulationStore((s) => s.simulationInProgress)
  const cameraControlsRef = useControlStore((s) => s.cameraControlsRef)

  // For 'split' style, use node types as neighborhoods
  const { displayNodeTypes, nodeTypesWithPosition, nodeTypesBoundingBox } = useMemo(() => {
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
      displayNodeTypes: nodeTypeNeighbourhoods,
      nodeTypesWithPosition: positionsMap,
      nodeTypesBoundingBox: boundingBoxMap
    }
  }, [nodeTypes, simulation, simulationInProgress])

  const handleClick = (nodeTypeId: string, center: THREE.Vector3, size: THREE.Vector3) => {
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

    setSelectedNodeTypeId(nodeTypeId)
  }

  return (
    <group>
      {Object.entries(nodeTypesBoundingBox).map(([nodeTypeId, positions]) => {
        const labelCenter = nodeTypesWithPosition[nodeTypeId]
        const typedPositions = positions as { x: number; y: number; z: number }[]

        const rawName = displayNodeTypes.find((n) => n.ref_id === nodeTypeId)?.name || nodeTypeId
        const name = rawName.replace(/_/g, ' ')

        if (!labelCenter || typedPositions.length === 0) {
          return null
        }

        const points = typedPositions.map((p) => new THREE.Vector3(p.x, p.y, p.z))
        const box = new THREE.Box3().setFromPoints(points)

        const size = new THREE.Vector3()
        const geometricCenter = new THREE.Vector3()

        box.getSize(size)
        box.getCenter(geometricCenter)

        // const width = size.x + nodeSize
        // const height = size.y + nodeSize
        // const depth = size.z + nodeSize

        return (
          <Billboard key={nodeTypeId} position={[0, geometricCenter.y + 40, 0]}>
            {/* Simple rectangular border */}
            <lineLoop position={[0, 0, -0.1]}>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[new Float32Array([
                    -(name.length * 12.5 + 10), -35, 0,  // bottom-left
                    (name.length * 12.5 + 10), -35, 0,   // bottom-right
                    (name.length * 12.5 + 10), 35, 0,    // top-right
                    -(name.length * 12.5 + 10), 35, 0,   // top-left
                  ]), 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial color="grey" opacity={0.5} transparent />
            </lineLoop>
            <Text
              fontSize={35}
              color="grey"
              anchorX="center"
              anchorY="middle"
              position={[0, 0, 0]}
            >
              {name}
            </Text>
          </Billboard>
        )
      })}
    </group>
  )
}
