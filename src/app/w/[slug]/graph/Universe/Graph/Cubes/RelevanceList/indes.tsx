import { useDataStore } from '@/stores/useDataStore'
import { useGraphStore, useSelectedNodeRelativeIds } from '@/stores/useGraphStore'
import { useSimulationStore } from '@/stores/useSimulationStore'
import { Billboard, Html } from '@react-three/drei'
import { useNodeNavigation } from '@Universe/useNodeNavigation'
import { useCallback, useMemo } from 'react'
import { nodeSize } from '../constants'

export const RelevanceList = () => {
  const selectedNode = useGraphStore((s) => s.selectedNode)
  const selectedNodeType = useGraphStore((s) => s.selectedNodeType)
  const setSelectedTimestamp = useDataStore((s) => s.setSelectedTimestamp)
  const simulation = useSimulationStore((s) => s.simulation)
  const selectedNodeRelativeIds = useSelectedNodeRelativeIds()
  const { navigateToNode } = useNodeNavigation()

  const centerPos = useMemo(
    () => [selectedNode?.x || 0, selectedNode?.y || 0, selectedNode?.z || 0] as [number, number, number],
    [selectedNode?.x, selectedNode?.y, selectedNode?.z],
  )

  const nodesData = simulation?.nodes() || []
  const nodes = nodesData

  const childNodes = nodes
    .filter((f: NodeExtended) => selectedNodeRelativeIds.includes(f?.ref_id || ''))
    .filter((i: NodeExtended) => i.node_type === selectedNodeType)

  const handleNodeClick = useCallback(
    (node: NodeExtended) => {
      setSelectedTimestamp(node)
      navigateToNode(node.ref_id)
    },
    [setSelectedTimestamp, navigateToNode],
  )

  return (
    <Billboard position={centerPos}>
      <group position={[nodeSize * 5, 0, 0]}>
        <Html distanceFactor={100} sprite transform>
          {selectedNodeType ? (
            <div className="text-white bg-black p-4 rounded-lg border border-gray-800"
              onScroll={(e) => {
                console.log(e)
                e.stopPropagation()
              }}
              onWheel={(e) => e.stopPropagation()}
            >
              {(childNodes ?? []).map((n: NodeExtended) => {

                const nodeType = n.node_type

                return nodeType ? (
                  <div>nodetype: {nodeType}</div>
                ) : null
              })}
            </div>
          ) : (
            <div className="text-white bg-black p-4 rounded-lg border border-gray-800"
              onScroll={(e) => {
                console.log(e)
                e.stopPropagation()
              }}
              onWheel={(e) => e.stopPropagation()}
            >
              <div>Selected node view</div>
            </div>
          )}
        </Html>
      </group>
    </Billboard>
  )
}


