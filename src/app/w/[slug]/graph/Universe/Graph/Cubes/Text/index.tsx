import { Icons } from '@/components/Icons'
import { useSchemaStore } from '@/stores/useSchemaStore'
import { Billboard } from '@react-three/drei'
import { removeEmojis } from '@Universe/utils/removeEmojisFromText'
import { removeLeadingMentions } from '@Universe/utils/removeLeadingMentions'
import { truncateText } from '@Universe/utils/truncateText'
import { memo, useEffect, useRef, useState } from 'react'
import { CircleGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Texture, TextureLoader } from 'three'
import { NodeExtended } from '~/types'
import { NodeCircleGeometry, nodeSize } from '../constants'
import { TextWithBackground } from './TextWithBackgound'

type Props = {
  node: NodeExtended
  hide?: boolean
  scale: number
}

export const TextNode = memo(
  (props: Props) => {
    const { node, hide, scale } = props
    const iconRef = useRef<Mesh | null>(null)
    const nodeRef = useRef<Mesh | null>(null)
    const [texture, setTexture] = useState<Texture | null>(null)
    const [iconTexture, setIconTexture] = useState<Texture | null>(null)
    const backgroundRef = useRef<Group | null>(null)

    const { normalizedSchemasByType, getNodeKeysByType } = useSchemaStore((s) => s)
    const keyProperty = getNodeKeysByType(node.node_type) || ''

    const sanitizedNodeName =
      keyProperty && node?.properties
        ? removeLeadingMentions(removeEmojis(String(node?.properties[keyProperty] || '')))
        : removeLeadingMentions(node.name || '')

    const primaryIcon = normalizedSchemasByType[node.node_type]?.icon
    const Icon = primaryIcon ? Icons[primaryIcon] : null
    const iconName = Icon ? primaryIcon : 'NodesIcon'

    useEffect(() => {
      if (!node?.properties?.image_url) {
        return
      }

      const loader = new TextureLoader()

      loader.load(node.properties.image_url, setTexture, undefined, () =>
        console.error(`Failed to load texture: ${node?.properties?.image_url}`),
      )
    }, [node?.properties?.image_url])

    // Load SVG icon as texture
    useEffect(() => {
      const loader = new TextureLoader()

      loader.load(`/svg-icons/${iconName}.svg`, setIconTexture, undefined, (error) => {
        console.error(`Failed to load icon texture: ${iconName}.svg`, error)
        // Fallback: try to load a default icon
        loader.load('/svg-icons/NodesIcon.svg', setIconTexture, undefined, () => {
          console.error('Failed to load fallback icon')
        })
      })
    }, [iconName])

    return (
      <Billboard follow lockX={false} lockY={false} lockZ={false} name="billboard" userData={node}>
        <mesh ref={nodeRef} name={node.ref_id} position={[0, 0, 1]} scale={scale} userData={node} visible={!hide}>
          {node?.properties?.image_url && texture ? (
            <mesh geometry={NodeCircleGeometry}>
              <meshBasicMaterial map={texture} />
            </mesh>
          ) : iconTexture ? (
            <mesh
              ref={iconRef}
              position={[-nodeSize / 4, nodeSize / 4, 1]}
            >
              <planeGeometry args={[nodeSize / 2, nodeSize / 2]} />
              <meshBasicMaterial
                map={iconTexture}
                transparent
                opacity={0.8}
              />
            </mesh>) : (
            // Fallback: simple circle
            <mesh position={[-nodeSize / 4, nodeSize / 4, 1]}>
              <circleGeometry args={[nodeSize / 8, 8]} />
              <meshBasicMaterial color={0xffffff} transparent opacity={0.6} />
            </mesh>
          )}

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
