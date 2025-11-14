import { useWorkspace } from '@/hooks/useWorkspace'
import { useDataStore, useGraphStore, useSimulationStore } from '@/stores/useStores'
import { NodeExtended } from '@Universe/types'
import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef } from 'react'
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
}

export const HighlightedNodesLayer = memo(() => {
  const groupRef = useRef<Group>(null)
  const timeRef = useRef(0)

  const { workspace } = useWorkspace()
  const { webhookHighlightNodes, highlightTimestamp, clearWebhookHighlights } = useGraphStore((s) => s)
  const { simulation } = useSimulationStore((s) => s)
  const nodesNormalized = useDataStore((s) => s.nodesNormalized)
  const addNewNode = useDataStore((s) => s.addNewNode)

  // Auto-clear highlights after duration
  useEffect(() => {
    const shouldClear = highlightTimestamp && Date.now() - highlightTimestamp > HIGHLIGHT_DURATION
    if (shouldClear && webhookHighlightNodes.length > 0) {
      clearWebhookHighlights()
    }
  }, [highlightTimestamp, webhookHighlightNodes, clearWebhookHighlights])

  // Memoize node IDs to prevent unnecessary re-renders
  const nodeIdsToHighlight = useMemo(() => webhookHighlightNodes || [], [webhookHighlightNodes])
  const simulationNodes = simulation?.nodes() || []

  useEffect(() => {
    const foundNodeIds = new Set()
    const missingNodeIds: string[] = []

    nodeIdsToHighlight.forEach(nodeId => {
      const inNormalized = nodesNormalized?.get(nodeId)

      if (inNormalized) {
        foundNodeIds.add(nodeId)
      } else {
        missingNodeIds.push(nodeId)
      }
    })

    const fetchMissingNodes = async () => {
      if (missingNodeIds.length === 0 || !workspace?.slug) return

      try {
        const refIds = missingNodeIds.join(',')
        const response = await fetch(`/api/workspaces/${workspace.slug}/graph/nodes?ref_ids=${refIds}`)

        if (!response.ok) {
          console.error('Failed to fetch missing nodes:', response.statusText)
          return
        }

        const data = await response.json()
        const nodes = data.data || []

        console.log('missing added nodes:', nodes)

        if (nodes.length > 0) {
          addNewNode({ nodes, edges: [] })
        }
      } catch (error) {
        console.error('Error fetching missing nodes:', error)
      }
    }

    if (missingNodeIds.length > 0) {
      fetchMissingNodes()
    }
  }, [nodeIdsToHighlight, nodesNormalized, addNewNode, workspace?.slug])

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
      {highlightedNodes.map((node) => (
        <group
          key={`highlight-${node.ref_id}`}
          position={[node.x || 0, node.y || 0, node.z || 0]}
        >
          {/* Single pulsing sphere */}
          <mesh position={[0, 0, 0]}>
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
  )
})

HighlightedNodesLayer.displayName = 'HighlightedNodesLayer'