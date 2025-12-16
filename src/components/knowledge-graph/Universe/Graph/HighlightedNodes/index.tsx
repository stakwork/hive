import { useTestNodesFetch } from '@/hooks/useTestNodesFetch'
import type { HighlightChunk } from '@/stores/useGraphStore'
import { useGraphStore } from '@/stores/useStores'
import { memo } from 'react'
import { ChunkLayer } from './ChunkLayer'
import { TestConnectionsLayer } from './TestConnectionsLayer'

export const HighlightedNodesLayer = memo(() => {
  const highlightChunks = useGraphStore((s) => s.highlightChunks)
  const { selectedLayer } = useGraphStore((s) => s.testLayerVisibility)

  // Fetch test nodes when a test layer is selected
  useTestNodesFetch({
    unitTests: selectedLayer === 'unitTests',
    integrationTests: selectedLayer === 'integrationTests',
    e2eTests: selectedLayer === 'e2eTests'
  })

  // Map selectedLayer to the correct nodeType format
  const getNodeType = () => {
    switch (selectedLayer) {
      case 'unitTests':
        return 'unittest'
      case 'integrationTests':
        return 'integrationtest'
      case 'e2eTests':
        return 'e2etest'
      default:
        return null
    }
  }

  const nodeType = getNodeType()

  return (
    <group name="highlighted-nodes-layer">
      {nodeType && <TestConnectionsLayer enabled={true} nodeType={nodeType} color="#10b981" />}
      {highlightChunks.map((chunk: HighlightChunk) => {
        // Example camera configurations for different chunk types:

        // Fast direct camera movement
        // const fastConfig = { speed: 0.5, radius: 150 }

        // Dramatic arc trajectory
        // const arcConfig = {
        //   trajectory: { type: 'arc' as const, arcHeight: 0.5 },
        //   radius: 250
        // }

        // Spiral approach (great for dramatic reveals)
        // const spiralConfig = {
        //   trajectory: { type: 'spiral' as const, spiralRotations: 2 },
        //   speed: 1.5,
        //   radius: 180
        // }

        return (
          <ChunkLayer
            key={chunk.chunkId}
            chunk={chunk}
          // cameraConfig={arcConfig}
          />
        )
      })}
    </group>
  )
})

HighlightedNodesLayer.displayName = 'HighlightedNodesLayer'
