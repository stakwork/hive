import { useDataStore, useGraphStore, useSelectedNodeRelativeIds, useSimulationStore } from '@/stores/useStores'
import { NodeExtended } from '@Universe/types'
import { useNodeNavigation } from '@Universe/useNodeNavigation'
import { useCallback } from 'react'
import { NodeCard } from './NodeCard'

export const NodeList = () => {
  const selectedNode = useGraphStore((s) => s.selectedNode)
  const selectedNodeType = useGraphStore((s) => s.selectedNodeType)
  const setSelectedTimestamp = useDataStore((s) => s.setSelectedTimestamp)
  const simulation = useSimulationStore((s) => s.simulation)
  const selectedNodeRelativeIds = useSelectedNodeRelativeIds()
  const { navigateToNode } = useNodeNavigation()


  const nodesData = simulation?.nodes() || []
  const nodes = nodesData

  const childNodes = nodes
    .filter((f: NodeExtended) => selectedNodeRelativeIds.includes(f?.ref_id || ''))
    .filter((i: NodeExtended) => selectedNodeType ? i.node_type === selectedNodeType : true)

  const handleNodeClick = useCallback(
    (node: NodeExtended) => {
      setSelectedTimestamp(node)
      navigateToNode(node.ref_id)
    },
    [setSelectedTimestamp, navigateToNode],
  )

  if (!selectedNode) {
    return null
  }

  return (
    <div
      className="text-white bg-black/95 backdrop-blur-sm rounded-lg border border-gray-700 max-w-[400px] max-h-[500px] overflow-hidden flex flex-col"
      onScroll={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <h3 className="text-lg font-semibold text-white mb-2">
          Related Nodes
        </h3>
        {selectedNodeType ? (
          <div className="text-sm text-gray-400">
            Showing {selectedNodeType} nodes ({childNodes.length})
          </div>
        ) : (
          <div className="text-sm text-gray-400">
            All connected nodes ({childNodes.length})
          </div>
        )}
      </div>

      {/* Node List */}
      <div className="flex-1 overflow-y-auto p-4">
        {childNodes.length > 0 ? (
          <div className="space-y-3">
            {childNodes.slice(0, 20).map((node: NodeExtended, index: number) => (
              <NodeCard
                key={node.ref_id || index}
                node={node}
                compact
                onClick={handleNodeClick}
              />
            ))}
            {childNodes.length > 20 && (
              <div className="text-xs text-gray-400 text-center py-2 border-t border-gray-700">
                ... and {childNodes.length - 20} more nodes
              </div>
            )}
          </div>
        ) : selectedNodeType ? (
          <div className="text-sm text-gray-400 text-center py-8">
            No related {selectedNodeType} nodes found
          </div>
        ) : (
          <div className="text-sm text-gray-400 text-center py-8">
            No connected nodes found
          </div>
        )}
      </div>

      {/* Footer */}
      {childNodes.length > 0 && (
        <div className="p-3 border-t border-gray-700 bg-gray-900/30">
          <div className="text-xs text-gray-400 text-center">
            Click any node to navigate to it
          </div>
        </div>
      )}
    </div>
  )
}