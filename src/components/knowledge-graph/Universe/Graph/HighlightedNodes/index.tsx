'use client'

import { useWorkspace } from '@/hooks/useWorkspace'
import { useDataStore, useGraphStore, useSimulationStore } from '@/stores/useStores'
import { NodeExtended } from '@Universe/types'
import { Html, Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef } from 'react'
import { Group, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three'

const HIGHLIGHT_DURATION = 45000
const PULSE_SPEED = 3
const BASE_SCALE = 1.5
const PULSE_AMPLITUDE = 0.4

const particleRadius = 4
const particleSpeed = 0.8

// Colors
const COLORS = {
  pulse: '#4CC6FF',
  particle: '#7DDCFF',
  labelBorder: '#7DDCFF',
  text: '#FFFFFF',
}

export const HighlightedNodesLayer = memo(() => {
  const groupRef = useRef<Group>(null)
  const particlesGroupRef = useRef<Group>(null)
  const timeRef = useRef(0)

  const { workspace } = useWorkspace()
  const { webhookHighlightNodes, webhookHighlightChunks, highlightTimestamp, clearWebhookHighlights } =
    useGraphStore((s) => s)
  const { simulation } = useSimulationStore((s) => s)
  const nodesNormalized = useDataStore((s) => s.nodesNormalized)
  const addNewNode = useDataStore((s) => s.addNewNode)

  /* -------------------------------
      AUTO CLEAR HIGHLIGHT
  --------------------------------*/
  useEffect(() => {
    if (!highlightTimestamp || (webhookHighlightNodes.length === 0 && webhookHighlightChunks.length === 0)) return
    const now = Date.now()
    const remaining = HIGHLIGHT_DURATION - (now - highlightTimestamp)
    if (remaining <= 0) return clearWebhookHighlights()
    const timeout = setTimeout(clearWebhookHighlights, remaining)
    return () => clearTimeout(timeout)
  }, [highlightTimestamp, webhookHighlightNodes.length, webhookHighlightChunks.length])

  // Combine nodeIds from legacy webhookHighlightNodes and new chunks
  const allNodeIds = useMemo(() => {
    const legacyNodeIds = webhookHighlightNodes || []
    const chunkNodeIds = webhookHighlightChunks.flatMap(chunk => chunk.nodeIds)
    return [...new Set([...legacyNodeIds, ...chunkNodeIds])]
  }, [webhookHighlightNodes, webhookHighlightChunks])

  const nodeIdsToHighlight = allNodeIds
  const simulationNodes = useMemo(() => simulation?.nodes() || [], [simulation])

  /* -------------------------------
      FETCH MISSING NODES
  --------------------------------*/
  useEffect(() => {
    const missing = nodeIdsToHighlight.filter(id => !nodesNormalized?.get(id))
    if (!missing.length || !workspace?.slug) return

    const controller = new AbortController()

      ; (async () => {
        try {
          const r = await fetch(
            `/api/workspaces/${workspace.slug}/graph/nodes?ref_ids=${missing.join(',')}`,
            { signal: controller.signal }
          )
          if (r.ok) {
            const json = await r.json()
            addNewNode({ nodes: json.data || [], edges: [] })
          }
        } catch { }
      })()

    return () => controller.abort()
  }, [nodeIdsToHighlight, nodesNormalized, workspace?.slug])

  /* -------------------------------
      FIND REAL NODE OBJECTS
  --------------------------------*/
  const highlightedNodes = useMemo(
    () =>
      nodeIdsToHighlight
        .map(id => simulationNodes.find((n: NodeExtended) => n.ref_id === id))
        .filter(Boolean) as NodeExtended[],
    [nodeIdsToHighlight, simulationNodes]
  )

  /* -------------------------------
      COMPUTE CENTER OF MASS (for legacy support)
  --------------------------------*/
  const highlightCenter = useMemo(() => {
    if (!highlightedNodes.length) return null
    const sum = highlightedNodes.reduce(
      (acc, n) => {
        acc.x += n.x || 0
        acc.y += n.y || 0
        acc.z += n.z || 0
        return acc
      },
      { x: 0, y: 0, z: 0 }
    )
    return [
      sum.x / highlightedNodes.length,
      sum.y / highlightedNodes.length,
      sum.z / highlightedNodes.length,
    ] as [number, number, number]
  }, [highlightedNodes])

  /* -------------------------------
      PARTICLE INITIALIZATION
  --------------------------------*/
  const particles = useRef<
    { node: NodeExtended; mesh: Mesh; t: number; speed: number }[]
  >([])

  // create particles once
  useEffect(() => {
    if (!particlesGroupRef.current) return

    particles.current = []
    particlesGroupRef.current.clear()

    highlightedNodes.forEach((node) => {
      // Create 1–2 particles per node
      for (let i = 0; i < 2; i++) {
        const m = new Mesh(
          new SphereGeometry(particleRadius, 16, 16),  // PARTICLE SIZE
          new MeshBasicMaterial({
            color: COLORS.particle,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
          })
        )

        particlesGroupRef.current!.add(m)

        particles.current.push({
          node,
          mesh: m,
          t: Math.random(),       // random start offset
          speed: particleSpeed,  // <<< PARTICLE SPEED
        })
      }
    })
  }, [highlightedNodes])

  /* -------------------------------
      ANIMATE PARTICLES
  --------------------------------*/
  useFrame((_, delta) => {
    if (!particlesGroupRef.current) return

    particles.current.forEach((p) => {
      p.t += delta * p.speed * 0.5  // <<< GLOBAL SPEED MULTIPLIER

      if (p.t > 1) p.t = 0 // reset loop

      const start = new Vector3(p.node.x, p.node.y, p.node.z)

      // Find which chunk this node belongs to for particle targeting
      let targetCenter = highlightCenter

      for (const chunk of webhookHighlightChunks) {
        if (chunk.nodeIds.includes(p.node.ref_id)) {
          // Calculate center for this chunk
          const chunkNodes = chunk.nodeIds
            .map((id: string) => simulationNodes.find((n: NodeExtended) => n.ref_id === id))
            .filter(Boolean) as NodeExtended[]

          if (chunkNodes.length > 0) {
            const chunkSum = chunkNodes.reduce(
              (acc, n) => {
                acc.x += n.x || 0
                acc.y += n.y || 0
                acc.z += n.z || 0
                return acc
              },
              { x: 0, y: 0, z: 0 }
            )
            targetCenter = [
              chunkSum.x / chunkNodes.length,
              chunkSum.y / chunkNodes.length,
              chunkSum.z / chunkNodes.length,
            ] as [number, number, number]
          }
          break
        }
      }

      if (!targetCenter) return

      const center = new Vector3(...targetCenter)

      // Interpolate position
      const pos = start.clone().lerp(center, p.t)

      // Move particle
      p.mesh.position.copy(pos)

      // Fade particle in/out for nice effect
      const fade = Math.sin(p.t * Math.PI)
      ;(p.mesh.material as MeshBasicMaterial).opacity = 0.2 + fade * 0.8
    })
  })

  /* -------------------------------
      PULSE HIGHLIGHT SPHERES
  --------------------------------*/
  useFrame(({ clock }) => {
    if (!groupRef.current) return

    timeRef.current = clock.getElapsedTime()

    groupRef.current.children.forEach((child, index) => {
      if (!(child instanceof Group)) return

      const pulse = Math.sin(timeRef.current * PULSE_SPEED + index * 0.5) * PULSE_AMPLITUDE
      child.scale.setScalar(BASE_SCALE + pulse)
    })
  })

  if (!highlightedNodes.length) return null

  return (
    <>
      {/* HIGHLIGHT SPHERES */}
      <group ref={groupRef}>
        {highlightedNodes.map((node) => (
          <group key={node.ref_id} position={[node.x, node.y, node.z]}>
            <mesh>
              <sphereGeometry args={[25, 32, 16]} />
              <meshBasicMaterial
                color={COLORS.pulse}
                transparent
                opacity={0.5}
                depthWrite={false}
              />
            </mesh>
          </group>
        ))}
      </group>

      {/* PARTICLES */}
      <group ref={particlesGroupRef} />

      {/* CHUNK LABELS */}
      {webhookHighlightChunks.map((chunk: any, index: number) => {
        // Calculate chunk center for each chunk's nodes
        const chunkNodes = chunk.nodeIds
          .map((id: string) => simulationNodes.find((n: NodeExtended) => n.ref_id === id))
          .filter(Boolean) as NodeExtended[]

        if (chunkNodes.length === 0) return null

        const chunkCenter = chunkNodes.reduce(
          (acc, n) => {
            acc.x += n.x || 0
            acc.y += n.y || 0
            acc.z += n.z || 0
            return acc
          },
          { x: 0, y: 0, z: 0 }
        )

        const centerPosition: [number, number, number] = [
          chunkCenter.x / chunkNodes.length,
          chunkCenter.y / chunkNodes.length + (index * 60), // Offset vertically for multiple chunks
          chunkCenter.z / chunkNodes.length,
        ]

        return (
          <Html key={chunk.id} position={centerPosition}>
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
        )
      })}

      {/* LEGACY LABEL - for backward compatibility */}
      {highlightCenter && webhookHighlightNodes.length > 0 && webhookHighlightChunks.length === 0 && (
        <Html position={highlightCenter}>
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
                padding: '10px 12px',
                background: 'rgba(0,0,0,0.45)',
                position: 'relative',
              }}
            >
              {/* Corners */}
              <div style={{
                position: 'absolute', top: 0, left: 0, width: 8, height: 8,
                borderTop: `2px solid ${COLORS.labelBorder}`,
                borderLeft: `2px solid ${COLORS.labelBorder}`,
              }} />
              <div style={{
                position: 'absolute', top: 0, right: 0, width: 8, height: 8,
                borderTop: `2px solid ${COLORS.labelBorder}`,
                borderRight: `2px solid ${COLORS.labelBorder}`,
              }} />
              <div style={{
                position: 'absolute', bottom: 0, left: 0, width: 8, height: 8,
                borderBottom: `2px solid ${COLORS.labelBorder}`,
                borderLeft: `2px solid ${COLORS.labelBorder}`,
              }} />
              <div style={{
                position: 'absolute', bottom: 0, right: 0, width: 8, height: 8,
                borderBottom: `2px solid ${COLORS.labelBorder}`,
                borderRight: `2px solid ${COLORS.labelBorder}`,
              }} />

              <div
                style={{
                  color: COLORS.text,
                  fontSize: 16,
                  fontWeight: 600,
                  textShadow: '0 0 8px rgba(255,255,255,0.5)',
                }}
              >
                Generating unit tests
              </div>
            </div>
          </div>
        </Html>
      )}
      {/* CHUNK LINES */}
      {webhookHighlightChunks.map((chunk) => {
        const chunkNodes = chunk.nodeIds
          .map((id: string) => simulationNodes.find((n: NodeExtended) => n.ref_id === id))
          .filter(Boolean) as NodeExtended[]

        if (chunkNodes.length === 0) return null

        const chunkCenter = chunkNodes.reduce(
          (acc, n) => {
            acc.x += n.x || 0
            acc.y += n.y || 0
            acc.z += n.z || 0
            return acc
          },
          { x: 0, y: 0, z: 0 }
        )

        const centerPosition: [number, number, number] = [
          chunkCenter.x / chunkNodes.length,
          chunkCenter.y / chunkNodes.length,
          chunkCenter.z / chunkNodes.length,
        ]

        return chunkNodes.map((node) => (
          <Line
            key={`chunk-line-${chunk.id}-${node.ref_id}`}
            points={[
              [node.x || 0, node.y || 0, node.z || 0],
              centerPosition,
            ]}
            color={COLORS.pulse}
            opacity={0.55}
            transparent
            lineWidth={1.2}
            depthWrite={false}
          />
        ))
      })}

      {/* LEGACY LINES - for backward compatibility */}
      {highlightCenter && webhookHighlightNodes.length > 0 && webhookHighlightChunks.length === 0 &&
        highlightedNodes.map((node) => (
          <Line
            key={`highlight-line-${node.ref_id}`}
            points={[
              [node.x || 0, node.y || 0, node.z || 0],
              highlightCenter,
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

HighlightedNodesLayer.displayName = 'HighlightedNodesLayer'