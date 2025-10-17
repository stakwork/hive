import { Html } from '@react-three/drei'
import { truncateText } from '@Universe/utils/truncateText'
import { BadgeProps } from '../types'

export const GroupBadge = ({ position, name, count, onClick, isActive }: BadgeProps) => (
  <group position={position}>
    <Html center distanceFactor={250} sprite transform zIndexRange={[0, 0]}>
      <div
        className="text-white bg-black p-4 rounded-lg border border-gray-800"
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
        onPointerOut={(e) => {
          e.stopPropagation()
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
        }}
      >
        {name ? <span>{truncateText(name, 20)}</span> : null}
        <div className="text-white">{count}</div>
      </div>
    </Html>
  </group>
)
