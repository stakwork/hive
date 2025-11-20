import { useSchemaStore } from '@/stores/useSchemaStore'
import { useDataStore, useNodeTypes, useSelectedNode } from '@/stores/useStores'
import { Instance, Instances } from '@react-three/drei'
import { NodeExtended } from '@Universe/types'
import { colors } from '@Universe/utils/colors'
import { memo, useMemo } from 'react'
import { BufferGeometry, SphereGeometry } from 'three'
import { nodeSize } from '../constants'

const COLORS_MAP = [
  '#fff',
  '#9747FF',
  '#00887A',
  '#0098A6',
  '#0288D1',
  '#33691E',
  '#465A65',
  '#512DA7',
  '#5C6BC0',
  '#5D4038',
  '#662C00',
  '#689F39',
  '#6B1B00',
  '#750000',
  '#78909C',
  '#7E57C2',
  '#8C6E63',
  '#AA47BC',
  '#BF360C',
  '#C2175B',
  '#EC407A',
  '#EF6C00',
  '#F5511E',
  '#FF9696',
  '#FFC064',
  '#FFCD29',
  '#FFEA60',
]


const NodePointsComponent = () => {
  const selectedNode = useSelectedNode()
  const dataInitial = useDataStore((s) => s.dataInitial)
  const { normalizedSchemasByType } = useSchemaStore((s) => s)
  const nodeTypes = useNodeTypes()
  const nodesNormalized = useDataStore((s) => s.nodesNormalized)

  console.log('NodePointsComponent re-rendered')

  // Create shared geometry for all instances
  const sharedGeometry = useMemo(
    () => new SphereGeometry(nodeSize / 2, 16, 8), // Sphere with 16 width segments, 8 height segments for performance
    [],
  )

  // Memoize node data to prevent unnecessary re-calculations
  const nodeInstanceData = useMemo(() => {
    if (!dataInitial?.nodes) return []

    return dataInitial.nodes.map((node: NodeExtended) => {
      const normalizedNode = nodesNormalized.get(node.ref_id)
      const weight = normalizedNode?.weight || normalizedNode?.properties?.weight || 1
      const scale = Math.cbrt(weight)

      const secondaryColor = normalizedSchemasByType[node.node_type]?.secondary_color
      const color = secondaryColor ?? (COLORS_MAP[nodeTypes.indexOf(node.node_type)] || colors.white)

      return {
        key: node.ref_id,
        color,
        scale: Math.max(0.5, Math.min(2, scale)), // Clamp scale between 0.5 and 2
        node,
        position: [node.x || 0, node.y || 0, node.z || 0] as [number, number, number]
      }
    })
  }, [dataInitial?.nodes, nodesNormalized, normalizedSchemasByType, nodeTypes])

  const nodeCount = nodeInstanceData.length

  return (
    <Instances
      geometry={sharedGeometry as BufferGeometry}
      limit={Math.max(1000, nodeCount)} // Dynamic limit based on actual node count
      range={Math.max(1000, nodeCount)}
      visible={!selectedNode || true}
    >
      <meshBasicMaterial />
      {nodeInstanceData.map(({ key, color, scale, node, position }) => (
        <Instance
          key={key}
          color={color}
          scale={scale}
          position={position}
          userData={node}
        />
      ))}
    </Instances>
  )
}

export const NodePoints = memo(NodePointsComponent)
