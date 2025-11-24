import type { HighlightChunk } from '@/stores/useGraphStore'
import { useGraphStore } from '@/stores/useStores'
import { memo } from 'react'
import { ChunkLayer } from './ChunkLayer'

export const HighlightedNodesLayer = memo(() => {
  const { highlightChunks } = useGraphStore((s) => s)

  if (highlightChunks.length === 0) return null

  return (
    <group name="highlighted-nodes-layer">
      {highlightChunks.map((chunk: HighlightChunk) => (
        <ChunkLayer key={chunk.chunkId} chunk={chunk} />
      ))}
    </group>
  )
})

HighlightedNodesLayer.displayName = 'HighlightedNodesLayer'