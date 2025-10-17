import { useDataStore } from '@/stores/useDataStore'
import { useGraphStore, useSelectedNodeRelativeIds } from '@/stores/useGraphStore'
import { useSimulationStore } from '@/stores/useSimulationStore'
import { Billboard, Html } from '@react-three/drei'
import { useNodeNavigation } from '@Universe/useNodeNavigation'
import { useCallback, useMemo } from 'react'
import { NodeExtended } from '~/types'
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
          {selectedNode ? (
            <div className="text-white bg-black/90 backdrop-blur-sm p-4 rounded-lg border border-gray-700 max-w-[300px] max-h-[400px] overflow-y-auto"
              onScroll={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              <div className="mb-3 border-b border-gray-700 pb-2">
                <h3 className="text-lg font-semibold text-white">
                  {selectedNode.name || 'Selected Node'}
                </h3>
                <p className="text-sm text-gray-400">
                  {selectedNode.node_type}
                </p>
              </div>

              {selectedNodeType && childNodes.length > 0 ? (
                <div>
                  <h4 className="text-sm font-medium text-gray-300 mb-2">
                    Related {selectedNodeType} nodes ({childNodes.length})
                  </h4>
                  <div className="space-y-2">
                    {childNodes.slice(0, 10).map((node: NodeExtended, index: number) => (
                      <div
                        key={node.ref_id || index}
                        className="p-2 bg-gray-800/50 rounded border border-gray-600 hover:bg-gray-700/50 cursor-pointer transition-colors"
                        onClick={() => handleNodeClick(node)}
                      >
                        <div className="text-sm font-medium text-white truncate">
                          {node.name || node.properties?.name || node.properties?.title || `${node.node_type} Node`}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                          {node.node_type}
                          {node.properties?.weight && (
                            <span className="ml-2">Weight: {node.properties.weight}</span>
                          )}
                        </div>
                      </div>
                    ))}
                    {childNodes.length > 10 && (
                      <div className="text-xs text-gray-400 text-center py-2">
                        ... and {childNodes.length - 10} more
                      </div>
                    )}
                  </div>
                </div>
              ) : selectedNodeType ? (
                <div className="text-sm text-gray-400">
                  No related {selectedNodeType} nodes found
                </div>
              ) : (
                <div className="text-sm text-gray-400">
                  Select a node type to see related nodes
                </div>
              )}
            </div>
          ) : (
            <div className="text-white bg-black/90 backdrop-blur-sm p-4 rounded-lg border border-gray-700"
              onScroll={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              <div className="text-center text-gray-400">
                No node selected
              </div>
            </div>
          )}
        </Html>
      </group>
    </Billboard>
  )
}


