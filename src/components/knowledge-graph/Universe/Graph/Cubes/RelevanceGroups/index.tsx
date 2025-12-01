import { useWorkspace } from '@/hooks/useWorkspace'
import { useStoreId } from '@/stores/StoreProvider'
import { distributeNodesOnCircle } from '@/stores/useSimulationStore/utils/distributeNodesOnCircle/indes'
import { getLinksBetweenNodesInstance } from '@/stores/useStoreInstances'
import { Neighbourhood, useDataStore, useGraphStore, useSelectedNodeRelativeIds } from '@/stores/useStores'
import { Billboard, Html, Line } from '@react-three/drei'
import { NodeExtended } from '@Universe/types'
import { memo, useCallback, useMemo } from 'react'
import { Vector3 } from 'three'
import { useShallow } from 'zustand/react/shallow'
import { nodeSize } from '../constants'
import { GroupBadge } from './GroupBadge'

type TGroupsMap = Record<string, number>

export const RelevanceGroups = memo(() => {
  const { selectedNode, setSelectedNodeType, selectedNodeType } = useGraphStore(useShallow((s) => s))
  const { slug } = useWorkspace()
  const storeId = useStoreId()

  const nodesNormalized = useDataStore((s) => s.nodesNormalized)

  const handleSelect = useCallback(
    (type: string) => {
      if (type === selectedNodeType) {
        setSelectedNodeType('')

        return
      }

      setSelectedNodeType(type)
    },
    [selectedNodeType, setSelectedNodeType],
  )

  const selectedNodeRelativeIds = useSelectedNodeRelativeIds()

  const [nodeBadges, connectingLines] = useMemo(() => {
    if (!selectedNode) {
      return [[], []]
    }

    const childNodes: NodeExtended[] = selectedNodeRelativeIds
      .map((id: string) => nodesNormalized.get(id))
      .filter((i): i is NodeExtended => !!i)

    const edges = selectedNodeRelativeIds.map((id: string) => getLinksBetweenNodesInstance(storeId, id, selectedNode?.ref_id || ''))

    console.log(edges)

    const groupsMap: TGroupsMap = childNodes.reduce((acc: TGroupsMap, curr: NodeExtended) => {
      acc[curr.node_type] = (acc[curr.node_type] || 0) + 1

      return acc
    }, {})

    const groups: Neighbourhood[] = Object.keys(groupsMap).map((i) => ({ name: i, ref_id: i }))
    const groupsPositioned = distributeNodesOnCircle(groups, nodeSize * 5)

    const center = new Vector3(0, 0, -1)

    const badges: React.ReactElement[] = []

    const posStatic = new Vector3(nodeSize * 5, 0, 0)

    const lines: React.ReactElement[] = [
      <group key="line-menu">
        <Line color="white" lineWidth={2} opacity={0.5} points={[center, posStatic]} transparent />
      </group>,
    ]

    Object.keys(groupsMap).forEach((groupKey) => {
      const pos = new Vector3(groupsPositioned[groupKey].x, groupsPositioned[groupKey].y, groupsPositioned[groupKey].z)

      badges.push(
        <GroupBadge
          key={groupKey}
          count={groupsMap[groupKey]}
          isActive={selectedNodeType === groupKey}
          name={groupKey}
          onClick={() => handleSelect(groupKey)}
          position={pos}
        />,
      )

      lines.push(
        <group key={`line-${groupKey}`}>
          <Line color="white" lineWidth={2} opacity={0.5} points={[center, pos]} transparent />
        </group>,
      )
    })

    return [badges, lines]
  }, [selectedNode, selectedNodeRelativeIds, nodesNormalized, selectedNodeType, handleSelect, storeId])

  const centerPos = useMemo(
    () => [selectedNode?.x || 0, selectedNode?.y || 0, selectedNode?.z || 0] as [number, number, number],
    [selectedNode?.x, selectedNode?.y, selectedNode?.z],
  )

  return (
    <group>
      <Billboard key="node-badges" position={centerPos}>
        {nodeBadges.length ? nodeBadges : null}
        {connectingLines}
        <mesh>
          <ringGeometry args={[nodeSize / 2 + 1, nodeSize / 2 + 3, 64]} />
          <meshBasicMaterial color="white" opacity={0.5} side={2} transparent />
        </mesh>
        {/* Info box with HTML */}
        {<Html position={[0, -nodeSize - 20, 0]} center distanceFactor={250} sprite transform zIndexRange={[0, 0]}>
          <div className="relative bg-background/95 text-foreground px-3 py-2 rounded-lg border border-border shadow-lg backdrop-blur-sm">
            {/* Navigation icon button for Episode, Call, or Task nodes */}
            {selectedNode && (selectedNode.node_type === 'Episode' || selectedNode.node_type === 'Call' || selectedNode.node_type === 'Task') && (
              <button
                onClick={() => {
                  let url: string;
                  if (selectedNode.node_type === 'Task') {
                    url = `/w/${slug}/task/${selectedNode.ref_id}`;
                  } else {
                    url = `/w/${slug}/calls/${selectedNode.ref_id}`;
                  }
                  window.open(url, '_blank');
                }}
                className="absolute -top-3 -right-3 size-6 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full inline-flex items-center justify-center transition-all duration-200 hover:scale-110 shadow-md hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 z-10"
                title={selectedNode.node_type === 'Task' ? 'View Task Details' : 'View Call Details'}
              >
                <svg className="size-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </button>
            )}
            <div className="text-center">
              <div className="text-sm font-normal leading-tight mb-1 max-w-[200px]">
                {(() => {
                  if (selectedNode?.node_type === 'Episode' || selectedNode?.node_type === 'Call') {
                    const episodeTitle = selectedNode?.properties?.episode_title as string | undefined
                    if (episodeTitle && episodeTitle.includes('Meeting recording')) {
                      const isoDateMatch = episodeTitle.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
                      if (isoDateMatch) {
                        const date = new Date(isoDateMatch[1]);
                        const formattedDate = date.toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        });
                        const formattedTime = date.toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit'
                        });
                        return `Meeting recording from ${formattedDate} at ${formattedTime}`;
                      }
                    }
                    return episodeTitle || selectedNode?.node_type || 'Episode';
                  }
                  return selectedNode?.name || selectedNode?.properties?.name || selectedNode?.properties?.title || 'Unnamed Node'
                })()}
              </div>
            </div>
          </div>
        </Html>}
      </Billboard>
    </group>
  )
})

RelevanceGroups.displayName = 'RelevanceGroups'
