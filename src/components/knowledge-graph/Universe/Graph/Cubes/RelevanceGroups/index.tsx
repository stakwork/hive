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
          <div className="bg-black/80 text-white px-3 py-2 rounded-lg border border-gray-600 shadow-lg backdrop-blur-sm">
            <div className="text-center">
              <div className="text-sm font-normal leading-tight mb-1 max-w-[200px]">
                {(() => {
                  if (selectedNode?.node_type === 'Episode') {
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
                    return episodeTitle || 'Episode';
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
