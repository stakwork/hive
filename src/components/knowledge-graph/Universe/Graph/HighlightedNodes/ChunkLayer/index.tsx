import { useStoreId } from '@/stores/StoreProvider'
import { getStoreBundle } from '@/stores/createStoreFactory'
import type { HighlightChunk } from '@/stores/graphStore.types'
import { useDataStore, useGraphStore, useSimulationStore } from '@/stores/useStores'
import { NodeExtended } from '@Universe/types'
import { Edges, Html, ScreenSizer } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Group, MeshBasicMaterial, Vector3 } from 'three'
import { CalloutLabel } from './CalloutLabel'
import { findConnectedNodesAtDepth } from './utils'


// Simple configuration
const HIGHLIGHT_DURATION = 30000 // 30 seconds
const PULSE_SPEED = 2
const BASE_SCALE = 0.8
const PULSE_AMPLITUDE = 0.15

// Depth configuration - can be easily modified
const DEPTH_CONFIG = {
  maxDepth: 2, // Maximum depth to explore
  useRandomDepth: true, // Whether to use random depth assignment
  includeConnectedNodes: true, // Whether to include connected nodes at depth
}

// Edge configuration
const EDGE_CONFIG = {
  color: '#08f6fb',
  width: 1,
  opacity: 0.3,
}

// Growth animation configuration
const EDGE_GROWTH = {
  levelDuration: 4, // seconds per depth level
  speed: 8,         // global speed multiplier
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
  const edgePositionsRef = useRef<{ aStart: Float32Array; aEnd: Float32Array } | null>(null)
  const growthTimeRef = useRef(0)

  const [chunkNodes, setChunkNodes] = useState<NodeExtended[]>([])
  const [depthConnections, setDepthConnections] = useState<Array<{ from: string; to: string; level: number }>>([])
  const [nodesByLevel, setNodesByLevel] = useState<Map<number, Set<string>>>(new Map())
  const [chunkCreationTime] = useState(Date.now())

  const removeHighlightChunk = useGraphStore((s) => s.removeHighlightChunk)
  const nodesNormalized = useDataStore((s) => s.nodesNormalized)
  const simulation = useSimulationStore((s) => s.simulation)
  const storeId = useStoreId()

  // Auto-remove this chunk after duration
  useEffect(() => {
    const timer = setTimeout(() => {
      removeHighlightChunk(chunk.chunkId)
    }, HIGHLIGHT_DURATION)
    return () => clearTimeout(timer)
  }, [chunk.chunkId, removeHighlightChunk])

  // Initialize nodes from normalized data with depth-based discovery
  useEffect(() => {
    // Include all chunk nodes plus the source node if specified
    let allRefIds = [...chunk.ref_ids]
    if (chunk.sourceNodeRefId && !allRefIds.includes(chunk.sourceNodeRefId)) {
      allRefIds.push(chunk.sourceNodeRefId)
    }

    // Create hierarchical connections: source → ref_ids → related nodes
    const hierarchicalConnections: Array<{ from: string; to: string; level: number }> = []
    const finalNodesByLevel = new Map<number, Set<string>>()

    // Step 1: Create connections from source to ref_ids
    if (chunk.sourceNodeRefId) {
      const sourceNodeId = chunk.sourceNodeRefId
      chunk.ref_ids.forEach(refId => {
        if (refId !== sourceNodeId) {
          hierarchicalConnections.push({
            from: sourceNodeId,
            to: refId,
            level: 0 // Source to ref_ids are level 0
          })
        }
      })

      // Add source and ref_ids to level mapping
      finalNodesByLevel.set(0, new Set([sourceNodeId, ...chunk.ref_ids]))
    } else {
      // No source node, just use ref_ids at level 0
      finalNodesByLevel.set(0, new Set(chunk.ref_ids))
    }

    // Step 2: If depth discovery is enabled, find related nodes from ref_ids (and source if provided)
    if (DEPTH_CONFIG.includeConnectedNodes && DEPTH_CONFIG.maxDepth > 1) {
      const discoverySeeds = [
        ...chunk.ref_ids,
        ...(chunk.sourceNodeRefId ? [chunk.sourceNodeRefId] : []),
      ]
      const depthResult = findConnectedNodesAtDepth(
        discoverySeeds, // Start discovery from ref_ids plus source if available
        nodesNormalized,
        DEPTH_CONFIG.maxDepth,
        undefined, // No specific source for depth discovery
        DEPTH_CONFIG.useRandomDepth
      )

      // Add depth connections (ref_ids → related nodes)
      hierarchicalConnections.push(...depthResult.connections)

      // Merge level mappings (shift depth levels by 1 since ref_ids are level 0)
      for (const [level, nodes] of depthResult.nodesByLevel.entries()) {
        if (level > 0) { // Skip level 0 from depth result since we already have our hierarchy
          const adjustedLevel = level
          if (!finalNodesByLevel.has(adjustedLevel)) {
            finalNodesByLevel.set(adjustedLevel, new Set())
          }
          for (const node of nodes) {
            finalNodesByLevel.get(adjustedLevel)!.add(node)
          }
        }
      }

      // Update allRefIds to include all discovered nodes
      const allDiscoveredNodes = new Set(allRefIds)
      for (const nodeSet of finalNodesByLevel.values()) {
        for (const node of nodeSet) {
          allDiscoveredNodes.add(node)
        }
      }
      allRefIds = Array.from(allDiscoveredNodes)
    }

    // Ensure connections are sorted by level for deterministic growth order
    setDepthConnections([...hierarchicalConnections].sort((a, b) => a.level - b.level))
    setNodesByLevel(finalNodesByLevel)

    const foundNodes = allRefIds
      .map(id => nodesNormalized.get(id))
      .filter((node): node is NodeExtended => Boolean(node))
    setChunkNodes(foundNodes)
  }, [chunk.ref_ids, chunk.sourceNodeRefId, nodesNormalized])

  // Create edge geometry for multi-level connections
  const { edgeGeometry, edgeMaterial } = useMemo(() => {
    if (depthConnections.length === 0) return { edgeGeometry: null, edgeMaterial: null }

    const edgeCount = depthConnections.length
    const vCount = edgeCount * 4 // 4 vertices per edge for thick lines
    const iCount = edgeCount * 6 // 6 indices per edge (2 triangles)

    const positions = new Float32Array(vCount * 3)
    const aStart = new Float32Array(vCount * 3)
    const aEnd = new Float32Array(vCount * 3)
    const aSide = new Float32Array(vCount)
    const aT = new Float32Array(vCount)
    const aLevel = new Float32Array(vCount) // integer level per connection
    const indices = new Uint32Array(iCount)

    const maxLevel = depthConnections.reduce((max, c) => Math.max(max, c.level), 0)

    edgePositionsRef.current = { aStart, aEnd }

    // Set up geometry attributes
    for (let e = 0; e < edgeCount; e++) {
      const v = e * 4
      const i = e * 6
      const connection = depthConnections[e]

      aSide[v] = -1
      aSide[v + 1] = +1
      aSide[v + 2] = -1
      aSide[v + 3] = +1

      aT[v] = 0
      aT[v + 1] = 0
      aT[v + 2] = 1
      aT[v + 3] = 1

      // Store integer level for timing; opacity uses uniform maxLevel
      aLevel[v] = connection.level
      aLevel[v + 1] = connection.level
      aLevel[v + 2] = connection.level
      aLevel[v + 3] = connection.level

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
    geometry.setAttribute('aLevel', new THREE.BufferAttribute(aLevel, 1))

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(EDGE_CONFIG.color) },
        uOpacity: { value: EDGE_CONFIG.opacity },
        uLineWidth: { value: EDGE_CONFIG.width },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uGrowthSpeed: { value: EDGE_GROWTH.speed },
        uLevelDuration: { value: EDGE_GROWTH.levelDuration },
        uMaxLevel: { value: Math.max(maxLevel, 1) },
      },
      vertexShader: `
        uniform vec2 uResolution;
        uniform float uLineWidth;
        uniform float uTime;
        uniform float uGrowthSpeed;
        uniform float uLevelDuration;

        attribute vec3 aStart;
        attribute vec3 aEnd;
        attribute float aSide;
        attribute float aT;
        attribute float aLevel;

        varying float vLevel;
        varying float vGrowthProgress;

        void main() {
          vLevel = aLevel;

          // Calculate growth progress for sequential level animation
          float totalTime = uTime * uGrowthSpeed; // Total elapsed time
          float levelStartTime = aLevel * uLevelDuration; // When this level should start

          float growthProgress = 0.0;
          if (totalTime >= levelStartTime) {
            float timeIntoLevel = totalTime - levelStartTime;
            growthProgress = clamp(timeIntoLevel / uLevelDuration, 0.0, 1.0);
          }

          // Ease growth for smoother ramp
          growthProgress = smoothstep(0.0, 1.0, growthProgress);
          vGrowthProgress = growthProgress;

          vec4 sc = projectionMatrix * modelViewMatrix * vec4(aStart, 1.0);
          vec4 ec = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);

          // Animate the end point - lines grow from start to end
          float animatedT = aT * growthProgress;
          vec4 clip = mix(sc, ec, animatedT);

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
        uniform float uMaxLevel;

        varying float vLevel;
        varying float vGrowthProgress;

        void main() {
          // Fade opacity based on level (deeper levels are more transparent)
          float levelOpacity = mix(1.0, 0.3, vLevel / max(uMaxLevel, 1.0));

          // Soft fade-in with growth progress
          float edgeAlpha = smoothstep(0.0, 0.2, vGrowthProgress);

          gl_FragColor = vec4(uColor, uOpacity * levelOpacity * edgeAlpha);
        }
      `,
    })

    return { edgeGeometry: geometry, edgeMaterial: material }
  }, [depthConnections])

  // Update positions and animation
  useFrame(({ clock }) => {
    if (!simulation || !groupRef.current || chunkNodes.length === 0) return

    const { nodePositionsNormalized } = getStoreBundle(storeId).simulation.getState()

    // Drive growth time based on frame delta for smoother ramp instead of wall clock
    growthTimeRef.current += clock.getDelta()
    timeRef.current = clock.getElapsedTime()

    const nodePositions: Vector3[] = []

    // Debug: Check if nodePositionsNormalized is populated
    if (chunkNodes.length > 0 && nodePositionsNormalized.size === 0) {
      console.warn('nodePositionsNormalized is empty, positions may not be ready yet')
    }

    // Update group positions and collect positions for center calculation
    groupRef.current.children.forEach((child, index) => {
      if (child instanceof Group) {
        // Update position from simulation using optimized position lookup
        const chunkNode = chunkNodes[index]
        if (chunkNode) {
          const nodePosition = nodePositionsNormalized.get(chunkNode.ref_id)
          if (nodePosition) {
            const pos = new Vector3(nodePosition.x, nodePosition.y, nodePosition.z)
            child.position.copy(pos)
            nodePositions.push(pos)
          } else if (nodePositionsNormalized.size === 0) {
            // Fallback to original approach if positions map is not ready
            const simulationNodes = simulation.nodes() || []
            const simulationNode = simulationNodes.find((node: NodeExtended) => node.ref_id === chunkNode.ref_id)
            if (simulationNode) {
              const pos = new Vector3(simulationNode.x, simulationNode.y, simulationNode.z)
              child.position.copy(pos)
              nodePositions.push(pos)
            }
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

    // Calculate positions and update edges for depth-based connections
    if (nodePositions.length > 0 && edgeGeometry && edgePositionsRef.current && depthConnections.length > 0) {
      // Calculate label position (prefer source node position)
      const labelPosition = new Vector3()
      let positionFound = false

      if (chunk.sourceNodeRefId) {
        // Use source node position for label
        let nodePosition = nodePositionsNormalized.get(chunk.sourceNodeRefId)

        // Fallback to simulation nodes if positions map is not ready
        if (!nodePosition && nodePositionsNormalized.size === 0) {
          const simulationNodes = simulation.nodes() || []
          const simNode = simulationNodes.find((node: NodeExtended) => node.ref_id === chunk.sourceNodeRefId)
          if (simNode) {
            nodePosition = { x: simNode.x, y: simNode.y, z: simNode.z }
          }
        }

        if (nodePosition) {
          labelPosition.set(nodePosition.x, nodePosition.y, nodePosition.z)
          positionFound = true
        }
      }

      // Fallback to first ref_id if sourceNodeRefId position not found
      if (!positionFound && chunk.ref_ids.length > 0) {
        const firstRefId = chunk.ref_ids[0]
        if (firstRefId) {
          let nodePosition = nodePositionsNormalized.get(firstRefId)

          // Fallback to simulation nodes if positions map is not ready
          if (!nodePosition && nodePositionsNormalized.size === 0) {
            const simulationNodes = simulation.nodes() || []
            const simNode = simulationNodes.find((node: NodeExtended) => node.ref_id === firstRefId)
            if (simNode) {
              nodePosition = { x: simNode.x, y: simNode.y, z: simNode.z }
            }
          }

          if (nodePosition) {
            labelPosition.set(nodePosition.x, nodePosition.y, nodePosition.z)
            positionFound = true
          }
        }
      }

      // Update depth-based edge positions
      const { aStart, aEnd } = edgePositionsRef.current

      depthConnections.forEach((connection, i) => {
        const v = i * 4 // 4 vertices per edge

        // Find positions for start and end nodes using optimized lookup
        let startNodePosition = nodePositionsNormalized.get(connection.from)
        let endNodePosition = nodePositionsNormalized.get(connection.to)

        // Fallback to simulation nodes if positions map is not ready
        if ((!startNodePosition || !endNodePosition) && nodePositionsNormalized.size === 0) {
          const simulationNodes = simulation.nodes() || []
          if (!startNodePosition) {
            const startNode = simulationNodes.find((node: NodeExtended) => node.ref_id === connection.from)
            if (startNode) {
              startNodePosition = { x: startNode.x, y: startNode.y, z: startNode.z }
            }
          }
          if (!endNodePosition) {
            const endNode = simulationNodes.find((node: NodeExtended) => node.ref_id === connection.to)
            if (endNode) {
              endNodePosition = { x: endNode.x, y: endNode.y, z: endNode.z }
            }
          }
        }

        if (startNodePosition && endNodePosition) {
          // Set start and end positions for all 4 vertices of this edge
          for (let k = 0; k < 4; k++) {
            const idx = v + k
            // Start point (from node position)
            aStart[idx * 3] = startNodePosition.x
            aStart[idx * 3 + 1] = startNodePosition.y
            aStart[idx * 3 + 2] = startNodePosition.z
            // End point (to node position)
            aEnd[idx * 3] = endNodePosition.x
            aEnd[idx * 3 + 1] = endNodePosition.y
            aEnd[idx * 3 + 2] = endNodePosition.z
          }
        }
      })

      edgeGeometry.attributes.aStart.needsUpdate = true
      edgeGeometry.attributes.aEnd.needsUpdate = true

      // Update resolution and time for proper line width and animation
      if (edgeMaterial && 'uniforms' in edgeMaterial) {
        edgeMaterial.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight)
        edgeMaterial.uniforms.uTime.value = growthTimeRef.current
        edgeMaterial.uniforms.uGrowthSpeed.value = EDGE_GROWTH.speed
        edgeMaterial.uniforms.uLevelDuration.value = EDGE_GROWTH.levelDuration
      }

      // Update HTML label position
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
        {validNodes.map((node, nodeIndex) => {
          // Determine node level for visual differentiation
          let nodeLevel = 0
          let isSourceNode = false

          if (chunk.sourceNodeRefId === node.ref_id) {
            isSourceNode = true
          } else if (chunk.ref_ids.includes(node.ref_id)) {
            nodeLevel = 0 // Original ref_ids are level 0
          } else {
            // Find the level of this node in the depth structure
            for (const [level, nodes] of nodesByLevel.entries()) {
              if (nodes.has(node.ref_id)) {
                nodeLevel = level
                break
              }
            }
          }

          // Calculate visual properties based on level
          const levelScale = isSourceNode ? 0.6 : Math.max(0.3, 0.5 - (nodeLevel * 0.05)) // Source nodes larger
          const levelColor = '#4FC3F7' // Gold for source, blue variants for levels

          return (
            <group
              key={`chunk-${chunk.chunkId}-node-${node.ref_id}-${nodeIndex}`}
              position={[0, 0, 0]}
            >
              <ScreenSizer scale={levelScale}>
                <mesh>
                  <octahedronGeometry args={[10, 0]} /> {/* diamond / rhombus */}
                  <meshBasicMaterial
                    color="#000000"
                    transparent
                    opacity={0}
                  />

                  <Edges
                    color={levelColor}
                    threshold={1}   // lower = more edges
                    linewidth={isSourceNode ? 3 : 2}
                  />
                </mesh>
              </ScreenSizer>
            </group>
          )
        })}
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
      {edgeGeometry && edgeMaterial && depthConnections.length > 0 && (
        <mesh
          ref={edgeMeshRef}
          geometry={edgeGeometry}
          material={edgeMaterial}
          frustumCulled={false}
        />
      )}

      {/* FALLBACK: No edges rendered when depth discovery is disabled to maintain backward compatibility */}
    </>
  )
})

ChunkLayer.displayName = 'ChunkLayer'
