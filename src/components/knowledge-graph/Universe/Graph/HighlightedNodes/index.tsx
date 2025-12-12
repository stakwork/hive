import type { HighlightChunk } from '@/stores/useGraphStore'
import { useGraphStore } from '@/stores/useStores'
import { memo } from 'react'
import { ChunkLayer } from './ChunkLayer'
import { TestConnectionsLayer } from './TestConnectionsLayer'

export const HighlightedNodesLayer = memo(() => {
  const { highlightChunks } = useGraphStore((s) => s)

  return (
    <group name="highlighted-nodes-layer">
      <TestConnectionsLayer visibilityKey="unitTests" nodeType="unittest" color="#8b5cf6" />
      <TestConnectionsLayer visibilityKey="integrationTests" nodeType="integrationtest" color="#f59e0b" />
      <TestConnectionsLayer visibilityKey="e2eTests" nodeType="e2etest" color="#10b981" />
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
