import { useSchemaStore } from '@/stores/useSchemaStore'
import { Billboard } from '@react-three/drei'
import { NodeExtended } from '@Universe/types'
import { removeEmojis } from '@Universe/utils/removeEmojisFromText'
import { removeLeadingMentions } from '@Universe/utils/removeLeadingMentions'
import { truncateText } from '@Universe/utils/truncateText'
import { memo, useRef } from 'react'
import { Group, Mesh } from 'three'
import { TextWithBackground } from './TextWithBackgound'

type Props = {
  node: NodeExtended
  hide?: boolean
  scale: number
}

export const TextNode = memo(
  (props: Props) => {
    const { node, hide, scale } = props
    const nodeRef = useRef<Mesh | null>(null)
    const backgroundRef = useRef<Group | null>(null)

    const { normalizedSchemasByType: _normalizedSchemasByType, getNodeKeysByType } = useSchemaStore((s) => s)
    const keyProperty = getNodeKeysByType(node.node_type) || ''

    const sanitizedNodeName =
      keyProperty && node?.properties
        ? removeLeadingMentions(removeEmojis(String(node?.properties[keyProperty] || '')))
        : removeLeadingMentions(node.name || '')

    return (
      <Billboard follow lockX={false} lockY={false} lockZ={false} name="billboard" userData={node}>
        <mesh ref={nodeRef} name={node.ref_id} position={[0, 0, 1]} scale={scale} userData={node} visible={!hide}>

          {/* <mesh
            ref={iconRef}
            position={[-nodeSize / 4, nodeSize / 4, 1]}
          >
            <planeGeometry args={[nodeSize / 2, nodeSize / 2]} />
            <meshBasicMaterial
              map={iconTexture}
              transparent
              opacity={0.8}
            />
          </mesh> */}

          {sanitizedNodeName && (
            <TextWithBackground ref={backgroundRef} id={node.ref_id} text={truncateText(sanitizedNodeName, 150)} />
          )}
        </mesh>
      </Billboard>
    )
  },
  (prevProps, nextProps) =>
    prevProps.hide === nextProps.hide &&
    prevProps.scale === nextProps.scale &&
    prevProps.node.ref_id === nextProps.node.ref_id &&
    prevProps.scale === nextProps.scale,
)

TextNode.displayName = 'TextNode'
