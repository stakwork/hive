import { useTestNodesFetch } from '@/hooks/useTestNodesFetch'
import type { HighlightChunk } from '@/stores/useGraphStore'
import { useGraphStore } from '@/stores/useStores'
import { memo } from 'react'
import { ChunkLayer } from './ChunkLayer'
import { TestConnectionsLayer } from './TestConnectionsLayer'

export const HighlightedNodesLayer = memo(() => {
  const highlightChunks = useGraphStore((s) => s.highlightChunks)
  const { unitTests, integrationTests, e2eTests } = useGraphStore((s) => s.testLayerVisibility)

  // Fetch test nodes when any test layer is enabled
  useTestNodesFetch({ unitTests, integrationTests, e2eTests })

  return (
    <group name="highlighted-nodes-layer">
      {unitTests && <TestConnectionsLayer enabled={unitTests} nodeType="unittest" color="#8b5cf6" />}
      {integrationTests && <TestConnectionsLayer enabled={integrationTests} nodeType="integrationtest" color="#10b981" />}
      {e2eTests && <TestConnectionsLayer enabled={e2eTests} nodeType="e2etest" color="#f59e0b" />}
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
