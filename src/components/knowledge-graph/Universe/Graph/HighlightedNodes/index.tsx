import { useGraphStore, useSimulationStore } from '@/stores/useStores'
import { NodeExtended } from '@Universe/types'
import { Billboard } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { memo, useRef } from 'react'
import { Group, Mesh, MeshBasicMaterial } from 'three'

const HIGHLIGHT_DURATION = 15000 // 15 seconds
const PULSE_SPEED = 3
const BASE_SCALE = 1.5
const PULSE_AMPLITUDE = 0.4

// const MOCK_NODES = ["768a7859-5c49-4675-91b2-fc48dcd0b039"]

// NEURON_PULSE highlight configuration
const NEURON_PULSE = {
  color: '#00ff88', // Electric green
  pulseSpeed: PULSE_SPEED,
  amplitude: PULSE_AMPLITUDE,
  rings: 3,
}

export const HighlightedNodesLayer = memo(() => {
  const groupRef = useRef<Group>(null)
  const timeRef = useRef(0)

  const { webhookHighlightNodes, highlightTimestamp, clearWebhookHighlights } = useGraphStore((s) => s)
  const { simulation } = useSimulationStore((s) => s)

  // Auto-clear highlights after duration
  const shouldClear = highlightTimestamp && Date.now() - highlightTimestamp > HIGHLIGHT_DURATION
  if (shouldClear && webhookHighlightNodes.length > 0) {
    clearWebhookHighlights()
  }

  // Get highlighted nodes with current simulation positions
  const nodeIdsToHighlight = webhookHighlightNodes || []
  const simulationNodes = simulation?.nodes() || []

  const highlightedNodes = nodeIdsToHighlight
    .map(nodeId => simulationNodes.find((node: NodeExtended) => node.ref_id === nodeId))
    .filter(Boolean) as NodeExtended[]

  useFrame(({ clock }) => {
    if (!groupRef.current || highlightedNodes.length === 0) return

    timeRef.current = clock.getElapsedTime()

    // Animate each highlighted node
    groupRef.current.children.forEach((child, index) => {
      if (child instanceof Group) {
        const pulseFactor = Math.sin(timeRef.current * NEURON_PULSE.pulseSpeed + index * 0.5) * NEURON_PULSE.amplitude
        const scale = BASE_SCALE + pulseFactor
        child.scale.setScalar(scale)

        // Fade out effect as we approach auto-clear
        if (highlightTimestamp) {
          const elapsed = Date.now() - highlightTimestamp
          const fadeStart = HIGHLIGHT_DURATION * 0.8 // Start fading at 80% of duration
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
      }
    })
  })

  if (highlightedNodes.length === 0) return null

  return (
    <group ref={groupRef} name="highlighted-nodes-layer">
      {highlightedNodes.map((node, index) => (
        <group
          key={`highlight-${node.ref_id}`}
          position={[node.x || 0, node.y || 0, node.z || 0]}
        >
          <Billboard follow lockX={false} lockY={false} lockZ={false}>
            {/* Multiple concentric rings */}
            {[...Array(NEURON_PULSE.rings)].map((_, ringIndex) => (
              <mesh key={ringIndex} position={[0, 0, ringIndex * -0.5]}>
                <ringGeometry args={[30 + ringIndex * 15, 35 + ringIndex * 15, 32]} />
                <meshBasicMaterial
                  color={NEURON_PULSE.color}
                  transparent
                  opacity={0.4 - ringIndex * 0.1}
                  depthWrite={false}
                />
              </mesh>
            ))}
            {/* Core */}
            <mesh position={[0, 0, 1]}>
              <circleGeometry args={[12, 16]} />
              <meshBasicMaterial
                color={NEURON_PULSE.color}
                transparent
                opacity={0.9}
                depthWrite={false}
              />
            </mesh>
          </Billboard>
        </group>
      ))}
    </group>
  )
})

HighlightedNodesLayer.displayName = 'HighlightedNodesLayer'