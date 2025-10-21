import { useGraphStore } from '@/stores/useGraphStore'
import { useSchemaStore } from '@/stores/useSchemaStore'
import { Billboard, Html } from '@react-three/drei'
import { NodeExtended } from '@Universe/types'
import { useMemo } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { nodeSize } from '../constants'

const formatLabel = (label: string) => label.replaceAll('_', ' ').replaceAll(/\b\w/g, (char) => char.toUpperCase())

const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp * 1000)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

const NodeDetail = ({ label, value }: { label: string; value: unknown }) => {
  if (!value || value === '') {
    return null
  }

  const stringValue = String(value)
  const isLong = stringValue.length > 100
  const isCode = ['frame', 'code', 'body', 'content', 'interface'].includes(label.toLowerCase())
  const isDate = label.toLowerCase().includes('date') && !Number.isNaN(Number(value))

  let displayValue: string = stringValue
  if (isDate) {
    displayValue = formatDate(Number(value))
  }

  return (
    <div className="mb-3 pb-3 border-b border-gray-700/50 last:border-b-0">
      <div className="text-sm font-semibold text-gray-300 mb-2">
        {formatLabel(label)}
      </div>
      <div className="text-sm text-gray-100">
        {isCode && stringValue.length > 50 ? (
          <div className="rounded overflow-hidden">
            <SyntaxHighlighter
              language="javascript"
              style={vscDarkPlus}
              customStyle={{
                margin: 0,
                padding: '12px',
                fontSize: '11px',
                maxHeight: '200px',
                overflow: 'auto'
              }}
            >
              {displayValue}
            </SyntaxHighlighter>
          </div>
        ) : (
          <div className={`${isLong ? 'max-h-32 overflow-y-auto' : ''} whitespace-pre-wrap break-words`}>
            {displayValue}
          </div>
        )}
      </div>
    </div>
  )
}

export const RelevanceList = () => {
  const selectedNode = useGraphStore((s) => s.selectedNode)
  const { normalizedSchemasByType } = useSchemaStore((s) => s)

  const centerPos = useMemo(
    () => [selectedNode?.x || 0, selectedNode?.y || 0, selectedNode?.z || 0] as [number, number, number],
    [selectedNode?.x, selectedNode?.y, selectedNode?.z],
  )

  const nodeSchema = selectedNode ? normalizedSchemasByType[selectedNode.node_type] : null
  const nodeColor = nodeSchema?.primary_color || '#6b7280'

  const getDisplayName = (node: NodeExtended) => {
    return node.name ||
      node.properties?.name ||
      node.properties?.title ||
      node.properties?.text ||
      `${node.node_type} Node`
  }

  const getImageUrl = (node: NodeExtended) => {
    return node.properties?.image_url as string | undefined
  }

  const getSourceLink = (node: NodeExtended) => {
    return node.properties?.source_link as string | undefined
  }

  if (!selectedNode) {
    return null
  }

  const hasImage = !!getImageUrl(selectedNode)
  const sourceLink = getSourceLink(selectedNode)
  const properties = selectedNode.properties || {}

  // Filter out certain system properties that shouldn't be displayed
  const filteredProperties = Object.entries(properties).filter(([key]) =>
    !['image_url', 'source_link', 'media_url', 'audio_EN'].includes(key)
  )

  return (
    <Billboard position={centerPos}>
      <group position={[nodeSize * 5, 0, 0]}>
        <Html distanceFactor={100} sprite transform>
          <div
            className="text-white bg-black/95 backdrop-blur-sm rounded-lg border border-gray-700 max-w-[400px] max-h-[500px] overflow-hidden flex flex-col"
            onScroll={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            {/* Image Section */}
            {hasImage && (
              <div className="w-full h-48 p-4 flex justify-center items-center bg-gray-900/50">
                <img
                  src={getImageUrl(selectedNode)}
                  alt="Node content"
                  className="max-w-full max-h-full object-contain rounded"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              </div>
            )}

            {/* Content Section */}
            <div className="flex-1 overflow-y-auto p-4">
              {/* Header */}
              <div className="mb-4 pb-3 border-b border-gray-700">
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: nodeColor }}
                  />
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    {selectedNode.node_type}
                  </span>
                  {sourceLink && (
                    <a
                      href={sourceLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto text-gray-400 hover:text-gray-200 text-xs"
                    >
                      🔗 Source
                    </a>
                  )}
                </div>
                <h3 className="text-lg font-semibold text-white leading-tight">
                  {getDisplayName(selectedNode)}
                </h3>
                {selectedNode.ref_id && (
                  <p className="text-xs text-gray-500 mt-1 font-mono truncate">
                    ID: {selectedNode.ref_id}
                  </p>
                )}
              </div>

              {/* Properties */}
              <div className="space-y-1">
                {filteredProperties.length > 0 ? (
                  filteredProperties.map(([key, value]) => (
                    <NodeDetail key={key} label={key} value={value} />
                  ))
                ) : (
                  <div className="text-sm text-gray-400 text-center py-4">
                    No additional properties available
                  </div>
                )}
              </div>

              {/* Node Metadata */}
              <div className="mt-4 pt-3 border-t border-gray-700/50 text-xs text-gray-500 space-y-1">
                {selectedNode.edge_count !== undefined && (
                  <div>Connections: {selectedNode.edge_count}</div>
                )}
                {selectedNode.properties?.weight && (
                  <div>Weight: {selectedNode.properties.weight}</div>
                )}
                {selectedNode.x !== undefined && (
                  <div className="font-mono">
                    Position: ({selectedNode.x.toFixed(1)}, {selectedNode.y?.toFixed(1)}, {selectedNode.z?.toFixed(1)})
                  </div>
                )}
              </div>
            </div>
          </div>
        </Html>
      </group>
    </Billboard>
  )
}