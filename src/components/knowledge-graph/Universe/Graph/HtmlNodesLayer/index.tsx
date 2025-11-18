import { useDataStore, useSimulationStore } from '@/stores/useStores'
import { NodeExtended } from '@Universe/types'
import { Html } from '@react-three/drei'
import { memo, useMemo } from 'react'

interface HtmlNodesLayerProps {
  nodeTypes: string[]
  enabled?: boolean
}

export const HtmlNodesLayer = memo<HtmlNodesLayerProps>(({ nodeTypes, enabled = true }) => {
  const { simulation } = useSimulationStore((s) => s)
  const nodesNormalized = useDataStore((s) => s.nodesNormalized)

  const simulationNodes = simulation?.nodes() || []

  // Filter nodes by the specified types
  const filteredNodes = useMemo(() => {
    if (!enabled || nodeTypes.length === 0) return []

    return simulationNodes.filter((node: NodeExtended) =>
      nodeTypes.includes(node.node_type)
    )
  }, [simulationNodes, nodeTypes, enabled])

  if (!enabled || filteredNodes.length === 0) return null

  return (
    <group name="html-nodes-layer">
      {filteredNodes.map((node) => (
        <Html
          key={`html-${node.ref_id}`}
          position={[node.x || 0, node.y || 0, node.z || 0]}
          center
          sprite
          zIndexRange={[0, 0]}
        >
          <div className="bg-background/95 text-foreground px-2 py-1 rounded border border-border shadow-sm backdrop-blur-sm text-xs max-w-[120px]">
            <div className="font-medium truncate">
              {node.name || node.properties?.name || node.properties?.title || node.node_type}
            </div>
          </div>
        </Html>
      ))}
    </group>
  )
})

HtmlNodesLayer.displayName = 'HtmlNodesLayer'