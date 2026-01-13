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

// Fill styling
const FILL_COLOR = '#fff'
const FILL_OPACITY = 0.06

type LayerInfo = {
  nodeType: string
  name: string
  yPosition: number
}

type Bounds = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

// Helper to calculate bounds for a specific node type
const calculateLayerBounds = (simulation: any, nodeType: string): Bounds => {
  if (!simulation) {
    return { minX: -500, maxX: 500, minZ: -300, maxZ: 300 }
  }

  const nodes = simulation.nodes() as NodeExtended[]
  const layerNodes = nodes.filter((n) => n.node_type === nodeType)

  if (layerNodes.length === 0) {
    return { minX: -500, maxX: 500, minZ: -300, maxZ: 300 }
  }

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
    minX: minX - PADDING,
    maxX: maxX + PADDING,
    minZ: minZ - PADDING,
    maxZ: maxZ + PADDING,
  }
}

export const LayerHoverHighlight = () => {
  const graphStyle = useGraphStore((s) => s.graphStyle)
  const nodeTypes = useDataStore((s) => s.nodeTypes)
  const selectedNode = useGraphStore((s) => s.selectedNode)
  const simulation = useSimulationStore((s) => s.simulation)

  const [hoveredLayer, setHoveredLayer] = useState<LayerInfo | null>(null)
  const [bounds, setBounds] = useState<Bounds | null>(null)

  const { camera } = useThree()
  const mouseRef = useRef(new Vector2())
  const raycaster = useRef(new Raycaster())
  const intersectPlane = useRef(new Plane(new Vector3(0, 0, 1), 0))
  const intersectPoint = useRef(new Vector3())
  const lastBoundsRef = useRef<string>('')

  // Calculate layer Y positions
  const layerPositions = useMemo(() => {
    const totalTypes = nodeTypes.length
    const startOffset = ((totalTypes - 1) / 2) * LAYER_SPACING

    return nodeTypes.map((nodeType, index) => {
      const yOffset = startOffset - index * LAYER_SPACING
      const name = nodeType.replace(/_/g, ' ')

      return {
        nodeType,
        name,
        yPosition: yOffset,
      }
    })
  }, [nodeTypes])

  useFrame(({ mouse }) => {
    // Only active in split view and when no node is selected
    if (graphStyle !== 'split' || selectedNode) {
      if (hoveredLayer) {
        setHoveredLayer(null)
        setBounds(null)
        lastBoundsRef.current = ''
      }
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
      if (hoveredLayer) {
        setHoveredLayer(null)
        setBounds(null)
        lastBoundsRef.current = ''
      }
      return
    }

    const worldY = intersectPoint.current.y

    // Find the closest layer to the cursor Y position
    let closestLayer: LayerInfo | null = null
    let minDistance = HOVER_THRESHOLD

    for (const layer of layerPositions) {
      const distance = Math.abs(worldY - layer.yPosition)

      if (distance < minDistance) {
        minDistance = distance
        closestLayer = layer
      }
    }

    if (!closestLayer) {
      if (hoveredLayer) {
        setHoveredLayer(null)
        setBounds(null)
        lastBoundsRef.current = ''
      }
      return
    }

    // Calculate current bounds
    const currentBounds = calculateLayerBounds(simulation, closestLayer.nodeType)
    const boundsKey = `${Math.round(currentBounds.minX)}-${Math.round(currentBounds.maxX)}-${Math.round(currentBounds.minZ)}-${Math.round(currentBounds.maxZ)}`

    // Update layer if changed
    if (closestLayer.nodeType !== hoveredLayer?.nodeType) {
      setHoveredLayer(closestLayer)
      setBounds(currentBounds)
      lastBoundsRef.current = boundsKey
    } else if (boundsKey !== lastBoundsRef.current) {
      // Update bounds if they changed significantly
      setBounds(currentBounds)
      lastBoundsRef.current = boundsKey
    }
  })

  // Don't render if not in split view or no hovered layer
  if (graphStyle !== 'split' || !hoveredLayer || !bounds || selectedNode) {
    return null
  }

  const { name, yPosition } = hoveredLayer
  const { minX, maxX, minZ, maxZ } = bounds
  const width = maxX - minX
  const depth = maxZ - minZ
  const centerX = (minX + maxX) / 2
  const centerZ = (minZ + maxZ) / 2

  // Create a key based on bounds to force geometry recreation
  const boundsKey = `${hoveredLayer.nodeType}-${Math.round(minX)}-${Math.round(maxX)}-${Math.round(minZ)}-${Math.round(maxZ)}`

  return (
    <group name="layer-hover-highlight" key={boundsKey}>
      {/* Transparent fill */}
      <mesh position={[centerX, yPosition, centerZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial
          color={FILL_COLOR}
          transparent
          opacity={FILL_OPACITY}
          depthWrite={false}
          side={2}
        />
      </mesh>

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
