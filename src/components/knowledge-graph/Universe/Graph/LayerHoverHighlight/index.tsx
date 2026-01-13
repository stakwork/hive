import { useDataStore, useGraphStore, useSimulationStore } from '@/stores/useStores'
import { NodeExtended } from '@Universe/types'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'

const LAYER_SPACING = 500
const HOVER_THRESHOLD = 200 // Distance from layer center to trigger highlight
const PADDING = 100 // Padding around the node bounds

// Edge styling
const EDGE_COLOR = '#fff'
const EDGE_OPACITY = 0.5

type LayerBounds = {
  nodeType: string
  name: string
  yPosition: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

type HoveredLayer = LayerBounds | null

export const LayerHoverHighlight = () => {
  const graphStyle = useGraphStore((s) => s.graphStyle)
  const nodeTypes = useDataStore((s) => s.nodeTypes)
  const selectedNode = useGraphStore((s) => s.selectedNode)
  const simulation = useSimulationStore((s) => s.simulation)

  const [hoveredLayer, setHoveredLayer] = useState<HoveredLayer>(null)

  const { camera } = useThree()
  const mouseRef = useRef(new Vector2())
  const raycaster = useRef(new Raycaster())
  const intersectPlane = useRef(new Plane(new Vector3(0, 0, 1), 0))
  const intersectPoint = useRef(new Vector3())

  // Calculate layer positions and bounds from actual node positions
  const layerBounds = useMemo(() => {
    if (!simulation) return []

    const nodes = simulation.nodes() as NodeExtended[]
    const totalTypes = nodeTypes.length
    const startOffset = ((totalTypes - 1) / 2) * LAYER_SPACING

    return nodeTypes.map((nodeType, index) => {
      const yOffset = startOffset - index * LAYER_SPACING
      const name = nodeType.replace(/_/g, ' ')

      // Get all nodes of this type
      const layerNodes = nodes.filter((n) => n.node_type === nodeType)

      if (layerNodes.length === 0) {
        return {
          nodeType,
          name,
          yPosition: yOffset,
          minX: -500,
          maxX: 500,
          minZ: -300,
          maxZ: 300,
        }
      }

      // Calculate bounds from actual node positions
      let minX = Infinity
      let maxX = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity

      for (const node of layerNodes) {
        const x = node.x ?? 0
        const z = node.z ?? 0
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (z < minZ) minZ = z
        if (z > maxZ) maxZ = z
      }

      return {
        nodeType,
        name,
        yPosition: yOffset,
        minX: minX - PADDING,
        maxX: maxX + PADDING,
        minZ: minZ - PADDING,
        maxZ: maxZ + PADDING,
      }
    })
  }, [simulation, nodeTypes])

  useFrame(({ mouse }) => {
    // Only active in split view and when no node is selected
    if (graphStyle !== 'split' || selectedNode) {
      if (hoveredLayer) setHoveredLayer(null)
      return
    }

    // Convert mouse position to normalized device coordinates
    mouseRef.current.set(mouse.x, mouse.y)

    // Set up raycaster from camera through mouse position
    raycaster.current.setFromCamera(mouseRef.current, camera)

    // Find intersection with a plane at z=0
    const hasIntersection = raycaster.current.ray.intersectPlane(
      intersectPlane.current,
      intersectPoint.current
    )

    if (!hasIntersection) {
      if (hoveredLayer) setHoveredLayer(null)
      return
    }

    const worldY = intersectPoint.current.y

    // Find the closest layer to the cursor Y position
    let closestLayer: HoveredLayer = null
    let minDistance = HOVER_THRESHOLD

    for (const layer of layerBounds) {
      const distance = Math.abs(worldY - layer.yPosition)

      if (distance < minDistance) {
        minDistance = distance
        closestLayer = layer
      }
    }

    // Update state only if changed
    if (closestLayer?.nodeType !== hoveredLayer?.nodeType) {
      setHoveredLayer(closestLayer)
    }
  })

  // Don't render if not in split view or no hovered layer
  if (graphStyle !== 'split' || !hoveredLayer || selectedNode) {
    return null
  }

  const { name, yPosition, minX, maxX, minZ, maxZ } = hoveredLayer
  const width = maxX - minX
  const depth = maxZ - minZ
  const centerX = (minX + maxX) / 2
  const centerZ = (minZ + maxZ) / 2

  return (
    <group name="layer-hover-highlight">
      {/* Flat rectangular highlight - semi-transparent fill */}

      {/* Edge lines for the rectangle */}
      <lineLoop position={[centerX, yPosition, centerZ]}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[
              new Float32Array([
                -width / 2, 0, -depth / 2,
                width / 2, 0, -depth / 2,
                width / 2, 0, depth / 2,
                -width / 2, 0, depth / 2,
              ]),
              3,
            ]}
          />
        </bufferGeometry>
        <lineBasicMaterial color={EDGE_COLOR} transparent opacity={EDGE_OPACITY} />
      </lineLoop>

      {/* HTML label on the right side */}
      <Html
        position={[maxX + 80, yPosition, centerZ]}
        center
        sprite={false}
        style={{
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        <div className="flex items-center gap-2">
          <div className="bg-gradient-to-r from-violet-600/95 to-purple-700/95 text-white px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap shadow-xl shadow-purple-500/20 border border-violet-400/40 backdrop-blur-md">
            {name}
          </div>
        </div>
      </Html>
    </group>
  )
}
