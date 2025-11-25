import { useDataStore } from '@/stores/useStores'
import { Link, NodeExtended } from '@Universe/types'
import { memo } from 'react'
import { LinkPosition } from '..'
import { LineComponent } from './LineComponent'

type Props = {
  linksPosition: Map<string, LinkPosition>
}

export const Connections = memo(({ linksPosition }: Props) => {
  const dataInitial = useDataStore((s) => s.dataInitial)


  return (
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
  )
})

Connections.displayName = 'Connections'
