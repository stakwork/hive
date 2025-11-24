import { useGraphStore, useSimulationStore } from '@/stores/useStores'
import { NodeExtended } from '@Universe/types'
import { Html, Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Group, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three'
import type { HighlightChunk } from '@/stores/graphStore.types'

const PULSE_SPEED = 3
const BASE_SCALE = 0.8
const PULSE_AMPLITUDE = 0.1
const HIGHLIGHT_DURATION = 15000

const particleRadius = 4
const particleSpeed = 0.8

// NEURON_PULSE highlight configuration
const NEURON_PULSE = {
  color: '#00ff88', // Electric green
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

interface ChunkLayerProps {
  chunk: HighlightChunk
}

export const ChunkLayer = memo<ChunkLayerProps>(({ chunk }) => {
  const groupRef = useRef<Group>(null)
  const particlesGroupRef = useRef<Group>(null)
  const timeRef = useRef(0)

  const { simulation } = useSimulationStore((s) => s)
  const { removeHighlightChunk } = useGraphStore((s) => s)

  // Auto-remove this chunk after duration
  useEffect(() => {
    const timer = setTimeout(() => {
      removeHighlightChunk(chunk.chunkId)
    }, HIGHLIGHT_DURATION)

    return () => clearTimeout(timer)
  }, [chunk.chunkId, removeHighlightChunk])

  // Track chunk nodes state
  const [chunkNodes, setChunkNodes] = useState<NodeExtended[]>([])

  // Update nodes when simulation changes using useFrame
  useFrame(() => {
    const simulationNodes = simulation?.nodes() || []
    const foundNodes = chunk.ref_ids
      .map(id => simulationNodes.find((node: NodeExtended) => node.ref_id === id))
      .filter(Boolean) as NodeExtended[]

    // Only update state if nodes have changed
    if (foundNodes.length !== chunkNodes.length ||
        foundNodes.some((node, i) => chunkNodes[i]?.ref_id !== node.ref_id)) {
      setChunkNodes(foundNodes)
    }
  })

  // Calculate chunk center
  const chunkCenter = useMemo(() => {
    if (chunkNodes.length === 0) return null

    const sum = chunkNodes.reduce(
      (acc, n) => {
        acc.x += n.x || 0
        acc.y += n.y || 0
        acc.z += n.z || 0
        return acc
      },
      { x: 0, y: 0, z: 0 }
    )

    return [
      sum.x / chunkNodes.length,
      sum.y / chunkNodes.length,
      sum.z / chunkNodes.length,
    ] as [number, number, number]
  }, [chunkNodes])

  // Particle system
  const particles = useRef<
    { node: NodeExtended; mesh: Mesh; t: number; speed: number }[]
  >([])

  // Initialize particles
  useEffect(() => {
    if (!particlesGroupRef.current) return

    particles.current = []
    particlesGroupRef.current.clear()

    chunkNodes.forEach((node) => {
      for (let i = 0; i < 2; i++) {
        const mesh = new Mesh(
          new SphereGeometry(particleRadius, 16, 16),
          new MeshBasicMaterial({
            color: COLORS.particle,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
          })
        )

        particlesGroupRef.current!.add(mesh)

        particles.current.push({
          node,
          mesh,
          t: Math.random(),
          speed: particleSpeed,
        })
      }
    })
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
      ;(p.mesh.material as MeshBasicMaterial).opacity = 0.2 + fade * 0.8
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
        {chunkNodes.map((node, nodeIndex) => (
          <group
            key={`chunk-${chunk.chunkId}-node-${node.ref_id}-${nodeIndex}`}
            position={[node.x || 0, node.y || 0, node.z || 0]}
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
        <Html position={chunkCenter}>
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                padding: '8px 10px',
                background: 'rgba(0,0,0,0.45)',
                position: 'relative',
                marginBottom: '10px',
              }}
            >
              {/* Corners */}
              <div style={{
                position: 'absolute', top: 0, left: 0, width: 6, height: 6,
                borderTop: `2px solid ${COLORS.labelBorder}`,
                borderLeft: `2px solid ${COLORS.labelBorder}`,
              }} />
              <div style={{
                position: 'absolute', top: 0, right: 0, width: 6, height: 6,
                borderTop: `2px solid ${COLORS.labelBorder}`,
                borderRight: `2px solid ${COLORS.labelBorder}`,
              }} />
              <div style={{
                position: 'absolute', bottom: 0, left: 0, width: 6, height: 6,
                borderBottom: `2px solid ${COLORS.labelBorder}`,
                borderLeft: `2px solid ${COLORS.labelBorder}`,
              }} />
              <div style={{
                position: 'absolute', bottom: 0, right: 0, width: 6, height: 6,
                borderBottom: `2px solid ${COLORS.labelBorder}`,
                borderRight: `2px solid ${COLORS.labelBorder}`,
              }} />

              <div
                style={{
                  color: COLORS.text,
                  fontSize: 14,
                  fontWeight: 600,
                  textShadow: '0 0 8px rgba(255,255,255,0.5)',
                  whiteSpace: 'nowrap',
                  maxWidth: '200px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {chunk.title}
              </div>
            </div>
          </div>
        </Html>
      )}

      {/* CHUNK LINES */}
      {chunkCenter &&
        chunkNodes.map((node, nodeIndex) => (
          <Line
            key={`chunk-line-${chunk.chunkId}-${node.ref_id}-${nodeIndex}`}
            points={[
              [node.x || 0, node.y || 0, node.z || 0],
              chunkCenter,
            ]}
            color={COLORS.pulse}
            opacity={0.55}
            transparent
            lineWidth={1.2}
            depthWrite={false}
          />
        ))}
    </>
  )
})

ChunkLayer.displayName = 'ChunkLayer'