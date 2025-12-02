import type { HighlightChunk } from '@/stores/graphStore.types'
import { useControlStore } from '@/stores/useControlStore'
import { useDataStore, useGraphStore, useSimulationStore } from '@/stores/useStores'
import { NodeExtended } from '@Universe/types'
import { Html, Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Group, Mesh, MeshBasicMaterial, Sphere, Vector3 } from 'three'

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
  const [hovered, setHovered] = useState(false);

  const labelHeight = 32;
  const lineLength = 60;
  const maxWidth = 250;
  const minWidth = 80;

  const displayTitle = title.slice(0, 60);

  const onPointerOver = () => {
    setHovered(true);
    if (node && onHover) onHover(node);
  }

  const onPointerOut = () => {
    setHovered(false);
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

const PULSE_SPEED = 3
const BASE_SCALE = 0.8
const PULSE_AMPLITUDE = 0.1
const HIGHLIGHT_DURATION = 25000

// Edge animation speed controls
const EDGE_ANIMATION_CONFIG = {
  chunkEdgeDelay: 0.5,      // Delay between chunk edges (in seconds)
  connectedEdgeDelay: 0.5,  // Delay between connected edges (in seconds)
  wavePause: 1.0,           // Pause between chunk and connected waves (in seconds)
  growthDuration: 1.0,      // How long each edge takes to grow (in seconds)
}

// Camera animation configuration
const CAMERA_CONFIG = {
  speed: 1.0, // Animation duration multiplier (lower = faster)
  radius: 200, // View radius around target
  trajectory: {
    type: 'spiral' as 'direct' | 'arc' | 'spiral',
    arcHeight: 0.3, // For arc trajectory (0-1, height of arc)
    spiralRotations: 0.5, // For spiral trajectory
  }
}

// NEURON_PULSE highlight configuration
const NEURON_PULSE = {
  color: '#7DDCFF', // Electric green
  pulseSpeed: PULSE_SPEED,
  amplitude: PULSE_AMPLITUDE,
}

// Colors
const COLORS = {
  pulse: NEURON_PULSE.color,
  particle: '#7DDCFF',
  labelBorder: '#7DDCFF',
  text: '#FFFFFF',
}

interface CameraConfig {
  speed: number
  radius: number
  trajectory: {
    type: 'direct' | 'arc' | 'spiral'
    arcHeight?: number
    spiralRotations?: number
  }
}

interface ChunkLayerProps {
  chunk: HighlightChunk
  cameraConfig?: Partial<CameraConfig>
}

// Camera trajectory helpers
const animateCamera = {
  direct: (cameraControls: any, target: Vector3, radius: number) => {
    const sphere = new Sphere(target, radius)
    cameraControls.fitToSphere(sphere, true)
  },

  arc: (cameraControls: any, target: Vector3, radius: number, arcHeight: number = 0.3) => {
    const currentPos = cameraControls.getPosition(new Vector3())

    // Calculate arc midpoint
    const midPoint = new Vector3()
      .addVectors(currentPos, target)
      .multiplyScalar(0.5)

    const distance = currentPos.distanceTo(target)
    midPoint.y += distance * arcHeight

    // First move to arc peak, then to target
    const tempTarget = midPoint.clone()
    tempTarget.y -= radius

    cameraControls.setLookAt(
      midPoint.x, midPoint.y, midPoint.z,
      tempTarget.x, tempTarget.y, tempTarget.z,
      true
    ).then(() => {
      const finalSphere = new Sphere(target, radius)
      cameraControls.fitToSphere(finalSphere, true)
    })
  },

  spiral: (cameraControls: any, target: Vector3, radius: number, rotations: number = 1) => {
    const currentPos = cameraControls.getPosition(new Vector3())
    const distance = currentPos.distanceTo(target)

    // Create spiral path points
    const steps = 20
    const angleStep = (Math.PI * 2 * rotations) / steps

    let currentStep = 0
    const spiralStep = () => {
      if (currentStep >= steps) {
        const finalSphere = new Sphere(target, radius)
        cameraControls.fitToSphere(finalSphere, true)
        return
      }

      const progress = currentStep / steps
      const angle = angleStep * currentStep
      const spiralRadius = distance * (1 - progress) + radius * progress

      const spiralX = target.x + Math.cos(angle) * spiralRadius
      const spiralZ = target.z + Math.sin(angle) * spiralRadius
      const spiralY = currentPos.y + (target.y - currentPos.y) * progress

      cameraControls.setLookAt(
        spiralX, spiralY, spiralZ,
        target.x, target.y, target.z,
        false
      )

      currentStep++
      setTimeout(spiralStep, 50) // 50ms between steps
    }

    spiralStep()
  }
}

export const ChunkLayer = memo<ChunkLayerProps>(({ chunk, cameraConfig: customConfig }) => {
  const groupRef = useRef<Group>(null)
  const particlesGroupRef = useRef<Group>(null)
  const timeRef = useRef(0)




  const simulation = useSimulationStore((s) => s.simulation)
  const removeHighlightChunk = useGraphStore((s) => s.removeHighlightChunk)
  const nodesNormalized = useDataStore((s) => s.nodesNormalized)
  const linksNormalized = useDataStore((s) => s.linksNormalized)
  const cameraControlsRef = useControlStore((s) => s.cameraControlsRef)
  const automaticAnimationsDisabled = useControlStore((s) => s.automaticAnimationsDisabled)

  // Auto-remove this chunk after duration
  useEffect(() => {
    const timer = setTimeout(() => {
      removeHighlightChunk(chunk.chunkId)
    }, HIGHLIGHT_DURATION)

    return () => clearTimeout(timer)
  }, [chunk.chunkId, removeHighlightChunk])

  // Track chunk nodes state
  const [chunkNodes, setChunkNodes] = useState<NodeExtended[]>([])
  const hasCameraMoved = useRef(false)
  const cameraAnimationRef = useRef<{ isAnimating: boolean; startTime?: number }>({ isAnimating: false })
  const lastValidPositionsTime = useRef<number | null>(null)

  // Edge animation state
  const [edgeAnimations, setEdgeAnimations] = useState<Map<string, { progress: number; delay: number }>>(new Map())
  const edgeAnimationStartTime = useRef<number | null>(null)
  const frameTimeRef = useRef<number>(0)

  // Initialize nodes from nodesNormalized
  useEffect(() => {
    const foundNodes = chunk.ref_ids
      .map(id => nodesNormalized.get(id))
      .filter(Boolean) as NodeExtended[]

    setChunkNodes(foundNodes)

    // Initialize edge animations if we have a source node
    if (chunk.sourceNodeRefId && foundNodes.length > 1) {
      const sourceNode = foundNodes.find(node => node.ref_id === chunk.sourceNodeRefId)
      if (sourceNode) {
        const otherNodes = foundNodes.filter(node => node.ref_id !== chunk.sourceNodeRefId)
        const connectedNodes = getConnectedNodes(chunk.ref_ids)
        const newAnimations = new Map<string, { progress: number; delay: number }>()

        let delayIndex = 0

        // First wave: Animate to chunk nodes
        otherNodes.forEach((node) => {
          const edgeKey = `chunk-${chunk.sourceNodeRefId}-${node.ref_id}`
          newAnimations.set(edgeKey, {
            progress: 0,
            delay: delayIndex * EDGE_ANIMATION_CONFIG.chunkEdgeDelay
          })
          delayIndex++
        })

        // Second wave: Animate to connected nodes (with longer delay)
        connectedNodes.forEach((node) => {
          const edgeKey = `connected-${chunk.sourceNodeRefId}-${node.ref_id}`
          newAnimations.set(edgeKey, {
            progress: 0,
            delay: delayIndex * EDGE_ANIMATION_CONFIG.connectedEdgeDelay + EDGE_ANIMATION_CONFIG.wavePause
          })
          delayIndex++
        })

        console.log(`Initializing ${otherNodes.length} chunk edges + ${connectedNodes.length} connected edges`)
        setEdgeAnimations(newAnimations)
        edgeAnimationStartTime.current = null // Will be set in useFrame
      }
    }
  }, [nodesNormalized, chunk.ref_ids, chunk.sourceNodeRefId, linksNormalized])

  // Helper function to find connected nodes from links
  const getConnectedNodes = (nodeIds: string[]): NodeExtended[] => {
    const connectedNodeIds = new Set<string>()

    // Find all links where source or target is in our node list
    Array.from(linksNormalized.values()).forEach(link => {
      if (nodeIds.includes(link.source) && !nodeIds.includes(link.target)) {
        connectedNodeIds.add(link.target)
      }
      if (nodeIds.includes(link.target) && !nodeIds.includes(link.source)) {
        connectedNodeIds.add(link.source)
      }
    })

    // Convert node IDs to NodeExtended objects
    const connectedNodes: NodeExtended[] = []
    connectedNodeIds.forEach(nodeId => {
      const node = nodesNormalized.get(nodeId)
      if (node) {
        connectedNodes.push(node)
      }
    })

    return connectedNodes
  }

  // Update node positions from simulation and handle camera movement
  useFrame((_, delta) => {
    if (!simulation || chunkNodes.length === 0) return

    // Update frame time for animations
    frameTimeRef.current += delta

    const simulationNodes = simulation.nodes() || []
    const updatedNodes = chunkNodes.map(chunkNode => {
      const simulationNode = simulationNodes.find((node: NodeExtended) => node.ref_id === chunkNode.ref_id)
      if (simulationNode) {
        return {
          ...chunkNode,
          x: simulationNode.x,
          y: simulationNode.y,
          z: simulationNode.z,
        }
      }
      return chunkNode
    })

    // Only update if positions have changed
    const positionsChanged = updatedNodes.some((node, i) =>
      node.x !== chunkNodes[i]?.x ||
      node.y !== chunkNodes[i]?.y ||
      node.z !== chunkNodes[i]?.z
    )

    if (positionsChanged) {
      setChunkNodes(updatedNodes)
      // Update timestamp for valid positions
      lastValidPositionsTime.current = Date.now()
    }

    // Move camera to fit all chunk nodes once when positions are available
    // Skip if automatic animations are disabled due to user interaction
    if (cameraControlsRef && !hasCameraMoved.current && chunkNodes.length > 0 && !automaticAnimationsDisabled) {
      console.log('Camera debug - checking chunk nodes:', {
        chunkNodesCount: chunkNodes.length,
        hasCameraMoved: hasCameraMoved.current,
        cameraControlsRef: !!cameraControlsRef,
        automaticAnimationsDisabled
      })

      // Check if all nodes have valid positions
      const nodesWithPositions = chunkNodes.filter(node =>
        typeof node.x === 'number' && !isNaN(node.x) &&
        typeof node.y === 'number' && !isNaN(node.y) &&
        typeof node.z === 'number' && !isNaN(node.z)
      )

      console.log('Camera debug - positions:', {
        totalNodes: chunkNodes.length,
        nodesWithPositions: nodesWithPositions.length,
        positions: nodesWithPositions.map(n => ({ id: n.ref_id, x: n.x, y: n.y, z: n.z }))
      })

      if (nodesWithPositions.length > 0 && nodesWithPositions.length >= Math.min(chunkNodes.length, 1)) {
        const config: CameraConfig = {
          ...CAMERA_CONFIG,
          ...customConfig,
          trajectory: {
            ...CAMERA_CONFIG.trajectory,
            ...customConfig?.trajectory,
          }
        }

        // Calculate bounding sphere for all chunk nodes
        const positions = nodesWithPositions.map(node => new Vector3(node.x!, node.y!, node.z!))

        // Calculate center point
        const center = new Vector3(0, 0, 0)
        positions.forEach(pos => center.add(pos))
        center.divideScalar(positions.length)

        // Calculate radius to encompass all nodes
        let maxDistance = 0
        positions.forEach(pos => {
          const distance = pos.distanceTo(center)
          maxDistance = Math.max(maxDistance, distance)
        })

        // Ensure minimum radius for very close nodes or single nodes
        const minRadius = 150 // Minimum radius for good visibility
        const padding = Math.max(100, maxDistance * 0.3) // Dynamic padding based on spread
        const radius = Math.max(config.radius, maxDistance + padding, minRadius)

        // Validate center and radius before proceeding
        if (isNaN(center.x) || isNaN(center.y) || isNaN(center.z) || isNaN(radius)) {
          console.warn('Camera debug - invalid center or radius calculated, skipping camera movement', { center, radius })
          return
        }
        const boundingSphere = new Sphere(center, radius)

        console.log('Camera debug - moving camera:', {
          center: { x: center.x, y: center.y, z: center.z },
          radius,
          maxDistance,
          trajectoryType: config.trajectory.type,
          boundingSphere: { center: boundingSphere.center, radius: boundingSphere.radius }
        })

        // Set camera animation speed
        if (cameraControlsRef.smoothTime) {
          cameraControlsRef.smoothTime = config.speed
        }

        // Execute trajectory based on configuration
        switch (config.trajectory.type) {
          case 'arc':
            console.log('Using arc trajectory')
            animateCamera.arc(cameraControlsRef, center, radius, config.trajectory.arcHeight)
            break
          case 'spiral':
            console.log('Using spiral trajectory')
            animateCamera.spiral(cameraControlsRef, center, radius, config.trajectory.spiralRotations)
            break
          case 'direct':
          default:
            console.log('Using direct trajectory (fitToSphere)')
            cameraControlsRef.fitToSphere(boundingSphere, true)
            break
        }

        hasCameraMoved.current = true
        cameraAnimationRef.current = { isAnimating: true, startTime: Date.now() }
        console.log('Camera debug - movement triggered successfully')
      }
    } else if (cameraControlsRef && !hasCameraMoved.current && chunkNodes.length > 0 && automaticAnimationsDisabled) {
      console.log('🚫 Camera animation skipped - automatic animations disabled due to user interaction')
    }

    // Animate edge growth
    if (edgeAnimations.size > 0) {
      // Initialize animation start time on first frame
      if (edgeAnimationStartTime.current === null) {
        edgeAnimationStartTime.current = frameTimeRef.current
        console.log('Edge animation started at frame time:', frameTimeRef.current)
      }

      const elapsed = frameTimeRef.current - edgeAnimationStartTime.current
      let hasUpdates = false

      const newAnimations = new Map(edgeAnimations)

      newAnimations.forEach((animation, edgeKey) => {
        const timeSinceStart = elapsed - animation.delay
        if (timeSinceStart > 0) {
          // Animation duration: configurable
          const animationDuration = EDGE_ANIMATION_CONFIG.growthDuration
          const newProgress = Math.min(1, timeSinceStart / animationDuration)

          if (Math.abs(newProgress - animation.progress) > 0.01) { // Avoid tiny updates
            // Ease-out cubic for smooth animation
            const easedProgress = 1 - Math.pow(1 - newProgress, 3)
            newAnimations.set(edgeKey, { ...animation, progress: easedProgress })
            hasUpdates = true

            // Debug log for first few updates
            if (animation.progress < 0.1) {
              console.log(`Edge ${edgeKey}: delay=${animation.delay}s, elapsed=${elapsed.toFixed(2)}s, timeSinceStart=${timeSinceStart.toFixed(2)}s, progress=${easedProgress.toFixed(2)}`)
            }
          }
        }
      })

      if (hasUpdates) {
        setEdgeAnimations(newAnimations)
      }
    }
  })

  // Calculate chunk center
  const chunkCenter = useMemo(() => {
    if (chunkNodes.length === 0) return null

    const hasValidPosition = (node: NodeExtended) =>
      Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z)

    // If chunk.sourceNodeRefId is provided, use that node's position as center
    if (chunk.sourceNodeRefId) {
      const sourceNode = chunkNodes.find(node => node.ref_id === chunk.sourceNodeRefId)
      if (sourceNode && hasValidPosition(sourceNode)) {
        return [
          sourceNode.x,
          sourceNode.y,
          sourceNode.z,
        ] as [number, number, number]
      }
    }

    const positionedNodes = chunkNodes.filter(hasValidPosition)

    if (positionedNodes.length === 0) {
      return null
    }

    // Otherwise, calculate center as average of valid node positions
    const sum = positionedNodes.reduce(
      (acc, n) => {
        acc.x += n.x
        acc.y += n.y
        acc.z += n.z
        return acc
      },
      { x: 0, y: 0, z: 0 }
    )

    return [
      sum.x / positionedNodes.length,
      sum.y / positionedNodes.length,
      sum.z / positionedNodes.length,
    ] as [number, number, number]
  }, [chunkNodes, chunk.sourceNodeRefId])

  // Helper function to get animated line points
  const getAnimatedLinePoints = (sourceNode: NodeExtended, targetNode: NodeExtended, progress: number): [number, number, number][] => {
    const hasValidPosition = (node: NodeExtended) =>
      Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z)

    if (!hasValidPosition(sourceNode) || !hasValidPosition(targetNode)) {
      return []
    }

    const startPoint: [number, number, number] = [sourceNode.x, sourceNode.y, sourceNode.z]
    const endPoint: [number, number, number] = [targetNode.x, targetNode.y, targetNode.z]

    if (progress <= 0) {
      return [startPoint, startPoint] // Line hasn't started growing
    }

    if (progress >= 1) {
      return [startPoint, endPoint] // Line is fully grown
    }

    // Interpolate the end point based on progress
    const currentEndPoint: [number, number, number] = [
      startPoint[0] + (endPoint[0] - startPoint[0]) * progress,
      startPoint[1] + (endPoint[1] - startPoint[1]) * progress,
      startPoint[2] + (endPoint[2] - startPoint[2]) * progress,
    ]

    return [startPoint, currentEndPoint]
  }

  // Particle system
  const particles = useRef<
    { node: NodeExtended; mesh: Mesh; t: number; speed: number }[]
  >([])

  // Initialize particles
  useEffect(() => {
    if (!particlesGroupRef.current) return

    particles.current = []
    particlesGroupRef.current.clear()

    console.log(chunkNodes)

    // chunkNodes.forEach((node) => {
    //   for (let i = 0; i < 2; i++) {
    //     const mesh = new Mesh(
    //       new SphereGeometry(particleRadius, 16, 16),
    //       new MeshBasicMaterial({
    //         color: COLORS.particle,
    //         transparent: true,
    //         opacity: 0.9,
    //         depthWrite: false,
    //       })
    //     )

    //     particlesGroupRef.current!.add(mesh)

    //     particles.current.push({
    //       node,
    //       mesh,
    //       t: Math.random(),
    //       speed: particleSpeed,
    //     })
    //   }
    // })
  }, [chunkNodes])

  // Animate particles
  useFrame((_, delta) => {
    if (!particlesGroupRef.current || !chunkCenter) return

    const center = new Vector3(...chunkCenter)

    particles.current.forEach((p) => {
      p.t += delta * p.speed * 0.5

      if (p.t > 1) p.t = 0

      const start = new Vector3(p.node.x, p.node.y, p.node.z)
      const pos = start.clone().lerp(center, p.t)

      p.mesh.position.copy(pos)

      const fade = Math.sin(p.t * Math.PI)
        ; (p.mesh.material as MeshBasicMaterial).opacity = 0.2 + fade * 0.8
    })
  })

  // Pulse animation for spheres
  useFrame(({ clock }) => {
    if (!groupRef.current || chunkNodes.length === 0) return

    timeRef.current = clock.getElapsedTime()

    groupRef.current.children.forEach((child, index) => {
      if (child instanceof Group) {
        const pulseFactor = Math.sin(timeRef.current * NEURON_PULSE.pulseSpeed + index * 0.5) * NEURON_PULSE.amplitude
        const scale = BASE_SCALE + pulseFactor
        child.scale.setScalar(scale)

        // Fade out effect as we approach auto-clear
        const elapsed = Date.now() - chunk.timestamp
        const fadeStart = HIGHLIGHT_DURATION * 0.8
        if (elapsed > fadeStart) {
          const fadeProgress = (elapsed - fadeStart) / (HIGHLIGHT_DURATION - fadeStart)
          const opacity = Math.max(0.1, 1 - fadeProgress)

          child.children.forEach(mesh => {
            if (mesh instanceof Mesh && mesh.material instanceof MeshBasicMaterial) {
              mesh.material.opacity = opacity
            }
          })
        }
      }
    })
  })

  if (chunkNodes.length === 0) return null

  return (
    <>
      {/* HIGHLIGHT SPHERES */}
      <group ref={groupRef} name={`chunk-${chunk.chunkId}`}>
        {chunkNodes
          .filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z))
          .map((node, nodeIndex) => (
            <group
              key={`chunk-${chunk.chunkId}-node-${node.ref_id}-${nodeIndex}`}
              position={[node.x, node.y, node.z]}
            >
              <mesh>
                <sphereGeometry args={[25, 32, 16]} />
                <meshBasicMaterial
                  color={NEURON_PULSE.color}
                  transparent
                  opacity={0.6}
                  depthWrite={false}
                />
              </mesh>
            </group>
          ))}
      </group>

      {/* PARTICLES */}
      <group ref={particlesGroupRef} />

      {/* CHUNK LABEL */}
      {chunkCenter && chunk.title && (
        <Html
          position={chunkCenter}
          center
          zIndexRange={[100, 101]}
          // occlude="blending"
          style={{
            transition: 'opacity 0.2s',
            pointerEvents: 'none',
            willChange: 'transform'
          }}
        >
          <CalloutLabel
            title={chunk.title}
            baseColor={COLORS.labelBorder}
            node={chunk.sourceNodeRefId ? chunkNodes.find(node => node.ref_id === chunk.sourceNodeRefId) : undefined}
          />
        </Html>
      )}

      {/* CHUNK LINES */}
      {chunk.sourceNodeRefId ? (
        // Animated edges growing from source node
        (() => {
          const sourceNode = chunkNodes.find(node => node.ref_id === chunk.sourceNodeRefId && Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z))
          if (!sourceNode) return null

          const otherNodes = chunkNodes.filter(node =>
            node.ref_id !== chunk.sourceNodeRefId &&
            Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z)
          )
          const connectedNodes = getConnectedNodes(chunk.ref_ids)
          const allEdges: React.JSX.Element[] = []

          // Chunk edges (bright green)
          otherNodes.forEach((targetNode, nodeIndex) => {
            const edgeKey = `chunk-${chunk.sourceNodeRefId}-${targetNode.ref_id}`
            const animation = edgeAnimations.get(edgeKey)
            const progress = animation?.progress || 0
            // const opacity = 0.7 * Math.min(1, progress + 0.2)

            const points = getAnimatedLinePoints(sourceNode, targetNode, progress)
            if (points.length) {
              allEdges.push(
                <Line
                  key={`chunk-edge-${chunk.chunkId}-${edgeKey}-${nodeIndex}`}
                  points={points}
                  color={COLORS.pulse} // Bright green for chunk edges
                  opacity={0.2}
                  transparent
                  lineWidth={2.0}
                  depthWrite={false}
                />
              )
            }
          })

          // Connected edges (dimmer blue)
          connectedNodes.forEach((targetNode, nodeIndex) => {
            const edgeKey = `connected-${chunk.sourceNodeRefId}-${targetNode.ref_id}`
            const animation = edgeAnimations.get(edgeKey)
            const progress = animation?.progress || 0
            const opacity = 0.4 * Math.min(1, progress + 0.2)

            const points = getAnimatedLinePoints(sourceNode, targetNode, progress)
            if (points.length) {
              allEdges.push(
                <Line
                  key={`connected-edge-${chunk.chunkId}-${edgeKey}-${nodeIndex}`}
                  points={points}
                  color="#4A90E2" // Blue for connected edges
                  opacity={opacity}
                  transparent
                  lineWidth={1.2}
                  depthWrite={false}
                />
              )
            }
          })

          return allEdges
        })()
      ) : (
        // Fallback to center-based lines if no source node
        chunkCenter &&
        chunkNodes.map((node, nodeIndex) => (
          Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z) ? (
            <Line
              key={`chunk-line-${chunk.chunkId}-${node.ref_id}-${nodeIndex}`}
              points={[
                [node.x, node.y, node.z],
                chunkCenter,
              ]}
              color={COLORS.pulse}
              opacity={0.55}
              transparent
              lineWidth={1.2}
              depthWrite={false}
            />
          ) : null
        ))
      )}
    </>
  )
})

ChunkLayer.displayName = 'ChunkLayer'
