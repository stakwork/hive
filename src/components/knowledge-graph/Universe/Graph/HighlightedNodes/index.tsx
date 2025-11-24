import { useGraphStore } from '@/stores/useStores'
import { memo } from 'react'
import { ChunkLayer } from './ChunkLayer'
import type { HighlightChunk } from '@/stores/useGraphStore'

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
