import { Billboard, Instance } from '@react-three/drei'
import { NodeExtended } from '@Universe/types'
import { generatePalette } from '@Universe/utils/palleteGenerator'
import { memo, useRef } from 'react'
import { Group, Mesh } from 'three'
import { nodeSize } from '../../constants'

type Props = {
  color: string
  node: NodeExtended
  scale: number
}

export const Point = memo(({ color, node, scale }: Props) => {
  const nodeRef = useRef<Group | null>(null)
  const helperRef = useRef<Mesh | null>(null)

  const newColor = generatePalette(color, 3, 10)

  return (
    <Billboard ref={nodeRef} follow lockX={false} lockY={false} lockZ={false} name="group-name" visible={false}>
      <mesh ref={helperRef} name="instance-helper" userData={node}>
        <sphereGeometry args={[nodeSize / 2, 16, 16]} />
        <meshBasicMaterial color="white" opacity={1} transparent={false} />
      </mesh>
      <Instance color={newColor.at(3)} name="instance" scale={scale} />
    </Billboard>
  )
})

Point.displayName = 'Point'
