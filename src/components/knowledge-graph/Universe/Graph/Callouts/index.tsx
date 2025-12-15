import { useStoreId } from '@/stores/StoreProvider'
import { getStoreBundle } from '@/stores/createStoreFactory'
import type { GraphCallout } from '@/stores/graphStore.types'
import { useDataStore, useGraphStore, useSimulationStore } from '@/stores/useStores'
import { NodeExtended } from '@Universe/types'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef } from 'react'
import { Group } from 'three'
import { CalloutLabel } from '../HighlightedNodes/ChunkLayer/CalloutLabel'

const CALLOUT_COLOR = '#7DDCFF'
const CALLOUT_TTL_MS = 15 * 60 * 1000
const CALLOUT_SWEEP_MS = 30 * 1000

const CalloutInstance = memo(({ callout }: { callout: GraphCallout }) => {
  const htmlRef = useRef<Group>(null)
  const storeId = useStoreId()
  const nodesNormalized = useDataStore((s) => s.nodesNormalized)
  const simulation = useSimulationStore((s) => s.simulation)

  const node = useMemo(
    () => nodesNormalized.get(callout.nodeRefId),
    [callout.nodeRefId, nodesNormalized]
  )

  useFrame(() => {
    if (!htmlRef.current) return

    const { nodePositionsNormalized } = getStoreBundle(storeId).simulation.getState()
    let nodePosition = nodePositionsNormalized.get(callout.nodeRefId)

    if (!nodePosition && nodePositionsNormalized.size === 0 && simulation) {
      const simulationNodes = simulation.nodes?.() || []
      const simNode = simulationNodes.find((simNode: NodeExtended) => simNode.ref_id === callout.nodeRefId)
      if (simNode) {
        nodePosition = { x: simNode.x, y: simNode.y, z: simNode.z }
      }
    }

    if (nodePosition) {
      htmlRef.current.position.set(nodePosition.x, nodePosition.y, nodePosition.z)
      htmlRef.current.visible = true
    } else {
      htmlRef.current.visible = false
    }
  })

  return (
    <group ref={htmlRef} visible={false}>
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
          title={callout.title}
          baseColor={CALLOUT_COLOR}
          node={node}
        />
      </Html>
    </group>
  )
})

CalloutInstance.displayName = 'CalloutInstance'

export const CalloutsLayer = memo(() => {
  const callouts = useGraphStore((s) => s.callouts)
  const pruneExpiredCallouts = useGraphStore((s) => s.pruneExpiredCallouts)
  const nodesNormalized = useDataStore((s) => s.nodesNormalized)

  // Keep callout state clean while this layer is mounted
  useEffect(() => {
    const interval = setInterval(() => {
      pruneExpiredCallouts(CALLOUT_TTL_MS)
    }, CALLOUT_SWEEP_MS)
    return () => clearInterval(interval)
  }, [pruneExpiredCallouts])

  const activeCallouts = useMemo(
    () =>
      callouts.filter(
        (callout) =>
          Date.now() - callout.addedAt < CALLOUT_TTL_MS &&
          nodesNormalized.has(callout.nodeRefId)
      ),
    [callouts, nodesNormalized]
  )

  if (activeCallouts.length === 0) return null

  return (
    <group name="callouts-layer">
      {activeCallouts.map((callout) => (
        <CalloutInstance
          key={callout.id}
          callout={callout}
        />
      ))}
    </group>
  )
})

CalloutsLayer.displayName = 'CalloutsLayer'
