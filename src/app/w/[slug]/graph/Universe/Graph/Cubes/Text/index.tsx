import { Icons } from '@/components/Icons'
import { useSchemaStore } from '@/stores/useSchemaStore'
import { Billboard, Svg } from '@react-three/drei'
import { removeEmojis } from '@Universe/utils/removeEmojisFromText'
import { removeLeadingMentions } from '@Universe/utils/removeLeadingMentions'
import { truncateText } from '@Universe/utils/truncateText'
import { memo, useEffect, useRef, useState } from 'react'
import { Group, Mesh, MeshBasicMaterial, Texture, TextureLoader } from 'three'
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
    const svgRef = useRef<Mesh | null>(null)
    const nodeRef = useRef<Mesh | null>(null)
    const [texture, setTexture] = useState<Texture | null>(null)
    const backgroundRef = useRef<Group | null>(null)

    const { normalizedSchemasByType, getNodeKeysByType } = useSchemaStore((s) => s)
    const keyProperty = getNodeKeysByType(node.node_type) || ''

    const sanitizedNodeName =
      keyProperty && node?.properties
        ? removeLeadingMentions(removeEmojis(String(node?.properties[keyProperty] || '')))
        : removeLeadingMentions(node.name || '')

    useEffect(() => {
      if (!node?.properties?.image_url) {
        return
      }

      const loader = new TextureLoader()

      loader.load(node.properties.image_url, setTexture, undefined, () =>
        console.error(`Failed to load texture: ${node?.properties?.image_url}`),
      )
    }, [node?.properties?.image_url])

    const primaryIcon = normalizedSchemasByType[node.node_type]?.icon
    const Icon = primaryIcon ? Icons[primaryIcon] : null
    const iconName = Icon ? primaryIcon : 'NodesIcon'

    return (
      <Billboard follow lockX={false} lockY={false} lockZ={false} name="billboard" userData={node}>
        <mesh ref={nodeRef} name={node.ref_id} position={[0, 0, 1]} scale={scale} userData={node} visible={!hide}>
          {node?.properties?.image_url && texture ? (
            <mesh geometry={NodeCircleGeometry}>
              <meshBasicMaterial map={texture} />
            </mesh>
          ) : (
            <Svg
              ref={svgRef}
              name="svg"
              onUpdate={(svg) => {
                svg.traverse((child) => {
                  if (child instanceof Mesh) {

                    child.material = new MeshBasicMaterial({
                      color: 'rgba(255, 255, 255, 0.5)',
                    })
                  }
                })
              }}
              position={[-nodeSize / 4, nodeSize / 4, 1]}
              scale={nodeSize / 30}
              src={`/svg-icons/${iconName}.svg`}
              userData={node}
            />
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
