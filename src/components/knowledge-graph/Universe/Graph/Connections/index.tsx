import { useDataStore, useGraphStore, useSimulationStore } from '@/stores/useStores'
import { Segments } from '@react-three/drei'
import { Link, NodeExtended } from '@Universe/types'
import { memo } from 'react'
import { LinkPosition } from '..'
import { LineComponent } from './LineComponent'
import { LineInstance } from './LineInstance.tsx'

type Props = {
  linksPosition: Map<string, LinkPosition>
}

export const Connections = memo(({ linksPosition }: Props) => {

  const dataInitial = useDataStore((s) => s.dataInitial)


  const searchQuery = useGraphStore((s) => s.searchQuery)
  const selectedNodeTypes = useGraphStore((s) => s.selectedNodeTypes)
  const highlightNodes = useGraphStore((s) => s.highlightNodes)
  const hoveredNode = useGraphStore((s) => s.hoveredNode)
  const selectedNode = useGraphStore((s) => s.selectedNode)

  const simulationInProgress = useSimulationStore((s) => s.simulationInProgress)


  return (
    <>
      <group name="simulation-3d-group__connections">
        {dataInitial?.links?.length ? (
          <>
            {dataInitial?.links.map((l: Link<string | NodeExtended>) => {
              const position = linksPosition.get(l.ref_id) || {
                sx: 0,
                sy: 0,
                sz: 0,
                tx: 0,
                ty: 0,
                tz: 0,
              }

              const sourceId = typeof l.source === 'string' ? l.source : l.source?.ref_id || ''
              const targetId = typeof l.target === 'string' ? l.target : l.target?.ref_id || ''

              return (
                <LineComponent
                  key={l.ref_id}
                  label={l.edge_type}
                  source={sourceId}
                  sourceX={position.sx}
                  sourceY={position.sy}
                  sourceZ={position.sz}
                  target={targetId}
                  targetX={position.tx}
                  targetY={position.ty}
                  targetZ={position.tz}
                />
              )
            })}
          </>
        ) : null}
      </group>
      <group
        key={dataInitial?.links.length}
        visible={
          !simulationInProgress &&
          !searchQuery &&
          !selectedNodeTypes.length &&
          !highlightNodes.length &&
          !hoveredNode &&
          !selectedNode
        }
      >
        <Segments limit={1000} lineWidth={0.05}>
          {dataInitial?.links.map((l: Link) => {
            const position = linksPosition.get(l.ref_id) || {
              sx: 0,
              sy: 0,
              sz: 0,
              tx: 0,
              ty: 0,
              tz: 0,
            }

            const linkColor = 'rgba(97, 138, 255, 1)'

            return (
              <LineInstance
                key={l.ref_id}
                color={linkColor}
                sourceX={position.sx}
                sourceY={position.sy}
                sourceZ={position.sz}
                targetX={position.tx}
                targetY={position.ty}
                targetZ={position.tz}
              />
            )
          })}
        </Segments>
      </group>
    </>
  )
})

Connections.displayName = 'Connections'
