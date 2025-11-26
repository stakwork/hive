import type { HighlightChunk } from '@/stores/useGraphStore'
import { useGraphStore } from '@/stores/useStores'
import { memo } from 'react'
import { ChunkLayer } from './ChunkLayer'

export const HighlightedNodesLayer = memo(() => {
  const { highlightChunks } = useGraphStore((s) => s)

  if (highlightChunks.length === 0) return null

  return (
    <group name="highlighted-nodes-layer">
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