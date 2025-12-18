import { useWorkspace } from '@/hooks/useWorkspace'
import { useDataStore } from '@/stores/useStores'
import { Billboard, Text } from '@react-three/drei'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'

const NODE_SIZE = 45
const NODE_SCALE = 0.8
const NODE_OPACITY = 0.9
const MOCK_COLOR = 'lime' // Purple for mock nodes
const DEFAULT_CIRCLE_RADIUS = 3000

type MockNode = {
  ref_id: string
  name: string
  description?: string
  x: number
  y: number
  z: number
}

type MockNodesLayerProps = {
  radius?: number
}

export const MockNodesLayer = memo<MockNodesLayerProps>(({ radius = DEFAULT_CIRCLE_RADIUS }) => {
  const { id: workspaceId } = useWorkspace()
  const nodeTypes = useDataStore((s) => s.nodeTypes)

  const [mockNodes, setMockNodes] = useState<MockNode[]>([])
  const [isLoadingNodes, setIsLoadingNodes] = useState(false)
  const [hasFetchedMocks, setHasFetchedMocks] = useState(false)

  // Calculate Y position for Mock nodes (put them at the top) - updates when nodeTypes change
  const mockYPosition = useMemo(() => {
    const totalTypes = nodeTypes.length + 1
    const layerSpacing = 500
    const startOffset = ((totalTypes - 1) / 2) * layerSpacing
    return startOffset // Top position (first layer)
  }, [nodeTypes])

  const fetchMockData = useCallback(async () => {
    if (!workspaceId || hasFetchedMocks) {
      return
    }

    try {
      setIsLoadingNodes(true)

      const depth = 1
      const limit = 5000
      const topNodeCount = 5000
      const nodeTypes = ['Mock']

      const endpoint =
        `/graph/search` +
        `?depth=${depth}` +
        `&limit=${limit}` +
        `&top_node_count=${topNodeCount}` +
        `&node_type=${encodeURIComponent(JSON.stringify(nodeTypes))}`

      const url =
        `/api/swarm/jarvis/nodes` +
        `?id=${workspaceId}` +
        `&endpoint=${encodeURIComponent(endpoint)}`

      console.log(`[MockNodesLayer] Fetching Mock nodes from:`, url)

      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(`Failed to fetch Mock data: ${response.statusText}`)
      }

      const result = await response.json()

      if (!result.success || !result.data) {
        throw new Error(`API returned unsuccessful response for Mock data`)
      }

      const fetchedNodes = result.data.nodes || []

      console.log(`[MockNodesLayer] Fetched ${fetchedNodes.length} Mock nodes`)

      // Position nodes in a horizontal circle around origin (Y position will be updated during render)
      const nodesWithPositions = fetchedNodes.map((node: any, index: number) => {
        const angle = (index / fetchedNodes.length) * 2 * Math.PI
        return {
          ref_id: node.ref_id,
          name: node.name || `Mock ${index + 1}`,
          description: node.properties?.description || '',
          x: Math.cos(angle) * radius,
          y: 0, // Will be updated during render
          z: Math.sin(angle) * radius,
        }
      })

      setMockNodes(nodesWithPositions)
      setHasFetchedMocks(true)
    } catch (error) {
      console.error(`[MockNodesLayer] Error fetching Mock data:`, error)
      setMockNodes([])
    } finally {
      setIsLoadingNodes(false)
    }
  }, [workspaceId, hasFetchedMocks, radius])

  useEffect(() => {
    setHasFetchedMocks(false)
    setMockNodes([])
  }, [workspaceId])

  useEffect(() => {
    fetchMockData()
  }, [fetchMockData])

  const nodeGeometry = useMemo(() => {
    if (!mockNodes.length) return null
    return new THREE.SphereGeometry(NODE_SIZE, 16, 16)
  }, [mockNodes.length])

  const mockMaterial = useMemo(() => {
    if (!mockNodes.length) return null
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(MOCK_COLOR),
      transparent: true,
      opacity: NODE_OPACITY,
    })
  }, [mockNodes.length])

  if (mockNodes.length === 0) return null

  return (
    <group name="mock-nodes-layer">
      {mockNodes.map((node) => (
        <Billboard key={`mock-group-${node.ref_id}`} position={new THREE.Vector3(node.x, mockYPosition, node.z)}>
          <mesh
            geometry={nodeGeometry || undefined}
            material={mockMaterial || undefined}
            scale={NODE_SCALE}
          />
          {node.description && (
            <Text
              position={[0, NODE_SIZE + 20, 0]}
              fontSize={12}
              color="white"
              anchorX="center"
              anchorY="bottom"
              maxWidth={200}
            >
              {node.description}
            </Text>
          )}
        </Billboard>
      ))}
    </group>
  )
})

MockNodesLayer.displayName = 'MockNodesLayer'