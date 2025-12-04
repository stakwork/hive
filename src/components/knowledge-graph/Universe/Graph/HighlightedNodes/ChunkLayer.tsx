import type { HighlightChunk } from '@/stores/graphStore.types'
import { useDataStore, useGraphStore, useSimulationStore } from '@/stores/useStores'
import { NodeExtended } from '@Universe/types'
import { Edges, Html, ScreenSizer } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Group, MeshBasicMaterial, Vector3 } from 'three'

// Simplified CalloutLabel component - clean box design
const CalloutLabel = ({
  node,
  title,
  baseColor = '#7DDCFF',
  onHover,
  onUnhover,
  onClick
}: {
  node?: NodeExtended;
  title: string;
  baseColor?: string;
  onHover?: (node: NodeExtended) => void;
  onUnhover?: () => void;
  onClick?: (nodeId: string) => void;
}) => {
  const labelHeight = 32;
  const lineLength = 60;
  const maxWidth = 250;
  const minWidth = 80;

  const displayTitle = title.slice(0, 60);

  const onPointerOver = () => {
    if (node && onHover) onHover(node);
  }

  const onPointerOut = () => {
    if (onUnhover) onUnhover();
  }

  const onPointerClick = () => {
    if (node && onClick) onClick(node.ref_id);
  }

  return (
    <div
      className="relative pointer-events-auto select-none"
      onMouseEnter={onPointerOver}
      onMouseLeave={onPointerOut}
      onClick={onPointerClick}
    >
      {/* Simple line from center (node) to center-left of label */}
      <svg
        className="absolute top-0 left-0 overflow-visible pointer-events-none"
        style={{ zIndex: -1 }}
      >
        <line
          x1="0"
          y1="0"
          x2={lineLength}
          y2={-labelHeight / 2}
          stroke="#666"
          strokeWidth="1"
          opacity="0.6"
        />
      </svg>

      {/* Label box */}
      <div
        className="absolute bg-gray-900/20 rounded px-3 py-2 backdrop-blur-sm"
        style={{
          left: `${lineLength}px`,
          top: `${-labelHeight}px`,
          minWidth: `${minWidth}px`,
          maxWidth: `${maxWidth}px`,
          minHeight: `${labelHeight}px`,
        }}
      >
        <div className="text-white text-xs font-medium whitespace-nowrap">
          {displayTitle}
        </div>
      </div>
    </div>
  );
};

// Simple configuration
const HIGHLIGHT_DURATION = 30000 // 30 seconds
const PULSE_SPEED = 2
const BASE_SCALE = 0.8
const PULSE_AMPLITUDE = 0.15

// Edge configuration
const EDGE_CONFIG = {
  color: '#08f6fb',
  width: 0.5,
  opacity: 0.6,
}

const COLORS = {
  highlight: '#7DDCFF',
  line: EDGE_CONFIG.color,
  text: '#FFFFFF',
}

interface ChunkLayerProps {
  chunk: HighlightChunk
}

export const ChunkLayer = memo<ChunkLayerProps>(({ chunk }) => {
  const groupRef = useRef<Group>(null)
  const edgeMeshRef = useRef<THREE.Mesh>(null)
  const htmlRef = useRef<THREE.Group>(null)
  const timeRef = useRef(0)
  const edgePositionsRef = useRef<Float32Array>(new Float32Array())
  const chunkCenterRef = useRef<Vector3>(new Vector3())

  const [chunkNodes, setChunkNodes] = useState<NodeExtended[]>([])

  const removeHighlightChunk = useGraphStore((s) => s.removeHighlightChunk)
  const nodesNormalized = useDataStore((s) => s.nodesNormalized)
  const simulation = useSimulationStore((s) => s.simulation)

  // Auto-remove this chunk after duration
  useEffect(() => {
    const timer = setTimeout(() => {
      removeHighlightChunk(chunk.chunkId)
    }, HIGHLIGHT_DURATION)
    return () => clearTimeout(timer)
  }, [chunk.chunkId, removeHighlightChunk])

  // Initialize nodes from normalized data
  useEffect(() => {
    // Include all chunk nodes plus the source node if specified
    const allRefIds = [...chunk.ref_ids]
    if (chunk.sourceNodeRefId && !allRefIds.includes(chunk.sourceNodeRefId)) {
      allRefIds.push(chunk.sourceNodeRefId)
    }

    const foundNodes = allRefIds
      .map(id => nodesNormalized.get(id))
      .filter((node): node is NodeExtended => Boolean(node))
    setChunkNodes(foundNodes)
  }, [chunk.ref_ids, chunk.sourceNodeRefId, nodesNormalized])

  // Create edge geometry for thick lines (similar to EdgeCpu)
  const { edgeGeometry, edgeMaterial } = useMemo(() => {
    if (chunkNodes.length === 0) return { edgeGeometry: null, edgeMaterial: null }

    const edgeCount = chunkNodes.length
    const vCount = edgeCount * 4 // 4 vertices per edge for thick lines
    const iCount = edgeCount * 6 // 6 indices per edge (2 triangles)

    const positions = new Float32Array(vCount * 3)
    const aStart = new Float32Array(vCount * 3)
    const aEnd = new Float32Array(vCount * 3)
    const aSide = new Float32Array(vCount)
    const aT = new Float32Array(vCount)
    const indices = new Uint32Array(iCount)

    edgePositionsRef.current = { aStart, aEnd }

    // Set up geometry attributes
    for (let e = 0; e < edgeCount; e++) {
      const v = e * 4
      const i = e * 6

      aSide[v] = -1
      aSide[v + 1] = +1
      aSide[v + 2] = -1
      aSide[v + 3] = +1

      aT[v] = 0
      aT[v + 1] = 0
      aT[v + 2] = 1
      aT[v + 3] = 1

      indices[i] = v
      indices[i + 1] = v + 2
      indices[i + 2] = v + 1
      indices[i + 3] = v + 2
      indices[i + 4] = v + 3
      indices[i + 5] = v + 1
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aStart', new THREE.BufferAttribute(aStart, 3))
    geometry.setAttribute('aEnd', new THREE.BufferAttribute(aEnd, 3))
    geometry.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1))
    geometry.setAttribute('aT', new THREE.BufferAttribute(aT, 1))

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(EDGE_CONFIG.color) },
        uOpacity: { value: EDGE_CONFIG.opacity },
        uLineWidth: { value: EDGE_CONFIG.width },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: `
        uniform vec2 uResolution;
        uniform float uLineWidth;

        attribute vec3 aStart;
        attribute vec3 aEnd;
        attribute float aSide;
        attribute float aT;

        void main() {
          vec4 sc = projectionMatrix * modelViewMatrix * vec4(aStart, 1.0);
          vec4 ec = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);

          vec4 clip = mix(sc, ec, aT);

          vec2 sN = sc.xy / sc.w;
          vec2 eN = ec.xy / ec.w;
          vec2 dir = normalize(eN - sN);
          vec2 normal = vec2(-dir.y, dir.x);

          float aspect = uResolution.x / uResolution.y;
          normal.x *= aspect;

          vec2 offset = normal * aSide * uLineWidth / uResolution.y * 2.0;

          vec2 ndc = clip.xy / clip.w;
          ndc += offset;

          clip.xy = ndc * clip.w;
          gl_Position = clip;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;

        void main() {
          gl_FragColor = vec4(uColor, uOpacity);
        }
      `,
    })

    return { edgeGeometry: geometry, edgeMaterial: material }
  }, [chunkNodes.length])

  // Update positions and animation
  useFrame(({ clock }) => {
    if (!simulation || !groupRef.current || chunkNodes.length === 0) return

    timeRef.current = clock.getElapsedTime()

    // Get current simulation positions
    const simulationNodes = simulation.nodes() || []
    const nodePositions: Vector3[] = []

    // Update group positions and collect positions for center calculation
    groupRef.current.children.forEach((child, index) => {
      if (child instanceof Group) {
        // Update position from simulation
        const chunkNode = chunkNodes[index]
        if (chunkNode) {
          const simulationNode = simulationNodes.find((node: NodeExtended) => node.ref_id === chunkNode.ref_id)
          if (simulationNode) {
            const pos = new Vector3(simulationNode.x, simulationNode.y, simulationNode.z)
            child.position.copy(pos)
            nodePositions.push(pos)
          }
        }

        // Pulse animation
        const pulseFactor = Math.sin(timeRef.current * PULSE_SPEED + index * 0.5) * PULSE_AMPLITUDE
        const scale = BASE_SCALE + pulseFactor
        child.scale.setScalar(scale)

        // Simple fade out near end of duration
        const elapsed = Date.now() - chunk.timestamp
        const fadeStart = HIGHLIGHT_DURATION * 0.8
        if (elapsed > fadeStart) {
          const fadeProgress = (elapsed - fadeStart) / (HIGHLIGHT_DURATION - fadeStart)
          const opacity = Math.max(0.1, 1 - fadeProgress)

          child.children.forEach(mesh => {
            if ('material' in mesh && mesh.material instanceof MeshBasicMaterial) {
              mesh.material.opacity = opacity
            }
          })
        }
      }
    })

    // Calculate positions and update edges
    if (nodePositions.length > 0 && edgeGeometry && edgePositionsRef.current) {
      // Calculate center position for edges
      const center = new Vector3()
      if (chunk.sourceNodeRefId) {
        // Use source node position if specified
        const sourceNode = chunkNodes.find(node => node.ref_id === chunk.sourceNodeRefId)
        if (sourceNode) {
          const simulationNode = simulationNodes.find((node: NodeExtended) => node.ref_id === sourceNode.ref_id)
          if (simulationNode) {
            center.set(simulationNode.x, simulationNode.y, simulationNode.z)
          }
        }
      } else {
        // Calculate average position
        nodePositions.forEach(pos => center.add(pos))
        center.divideScalar(nodePositions.length)
      }

      chunkCenterRef.current.copy(center)

      // Calculate label position (prefer source node position)
      const labelPosition = new Vector3()
      if (chunk.sourceNodeRefId) {
        // Use source node position for label
        const sourceNode = chunkNodes.find(node => node.ref_id === chunk.sourceNodeRefId)
        if (sourceNode) {
          const simulationNode = simulationNodes.find((node: NodeExtended) => node.ref_id === sourceNode.ref_id)
          if (simulationNode) {
            labelPosition.set(simulationNode.x, simulationNode.y, simulationNode.z)
          }
        }
      } else {
        // Use center position if no source node
        labelPosition.copy(center)
      }

      // Update thick line edge positions
      const { aStart, aEnd } = edgePositionsRef.current as any
      nodePositions.forEach((nodePos, i) => {
        const v = i * 4 // 4 vertices per edge

        // Set start and end positions for all 4 vertices of this edge
        for (let k = 0; k < 4; k++) {
          const idx = v + k
          // Start point (node position)
          aStart[idx * 3] = nodePos.x
          aStart[idx * 3 + 1] = nodePos.y
          aStart[idx * 3 + 2] = nodePos.z
          // End point (center position)
          aEnd[idx * 3] = center.x
          aEnd[idx * 3 + 1] = center.y
          aEnd[idx * 3 + 2] = center.z
        }
      })

      edgeGeometry.attributes.aStart.needsUpdate = true
      edgeGeometry.attributes.aEnd.needsUpdate = true

      // Update resolution for proper line width
      if (edgeMaterial && 'uniforms' in edgeMaterial) {
        edgeMaterial.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight)
      }

      // Update HTML label position at source node or center
      if (htmlRef.current) {
        htmlRef.current.position.copy(labelPosition)
      }
    }
  })

  const validNodes = chunkNodes

  if (validNodes.length === 0) return null

  console.log('Valid nodes debug:', validNodes)

  return (
    <>
      {/* HIGHLIGHT SPHERES */}
      <group ref={groupRef} name={`chunk-${chunk.chunkId}`}>
        {validNodes.map((node, nodeIndex) => (
          <group
            key={`chunk-${chunk.chunkId}-node-${node.ref_id}-${nodeIndex}`}
            position={[0, 0, 0]}
          >
            <ScreenSizer
              scale={0.5} // scale factor
            >
              <mesh>
                <octahedronGeometry args={[10, 0]} /> {/* diamond / rhombus */}
                <meshBasicMaterial
                  color="transparent"
                  transparent
                  opacity={0}
                />

                <Edges
                  color={COLORS.highlight}
                  threshold={1}   // lower = more edges
                  linewidth={2}
                />
              </mesh>
            </ScreenSizer>
          </group>
        ))}
      </group>

      {/* CHUNK LABEL */}
      {chunk.title && (
        <group ref={htmlRef} position={[0, 0, 0]}>
          <Html
            center
            zIndexRange={[100, 101]}
            style={{
              transition: 'opacity 0.2s',
              pointerEvents: 'none',
              willChange: 'transform'
            }}
          >
            <CalloutLabel
              title={chunk.title}
              baseColor={COLORS.highlight}
              node={chunk.sourceNodeRefId ? validNodes.find(node => node.ref_id === chunk.sourceNodeRefId) : undefined}
            />
          </Html>
        </group>
      )}

      {/* DYNAMIC THICK EDGES */}
      {edgeGeometry && edgeMaterial && (
        <mesh
          ref={edgeMeshRef}
          geometry={edgeGeometry}
          material={edgeMaterial}
          frustumCulled={false}
        />
      )}
    </>
  )
})

ChunkLayer.displayName = 'ChunkLayer'