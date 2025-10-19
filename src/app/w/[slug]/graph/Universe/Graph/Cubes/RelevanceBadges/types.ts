import { NodeExtended } from '@Universe/types'
import { Vector3 } from 'three'

export type BadgeProps = {
  color: string
  position: Vector3
  userData: NodeExtended
  // eslint-disable-next-line react/no-unused-prop-types
  relativeIds: string[]
}
