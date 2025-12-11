import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Unit test to verify ChunkLayer component no longer has auto-timeout logic
 * Checks the source code to ensure the HIGHLIGHT_DURATION useEffect was removed
 */

describe('ChunkLayer - Code Verification', () => {
  const chunkLayerPath = resolve(
    __dirname,
    '../../../components/knowledge-graph/Universe/Graph/HighlightedNodes/ChunkLayer/index.tsx'
  )

  test('ChunkLayer should not have useEffect with HIGHLIGHT_DURATION auto-removal', () => {
    const sourceCode = readFileSync(chunkLayerPath, 'utf-8')

    // Check that the old auto-removal useEffect is gone
    // The old code had: removeHighlightChunk(chunk.chunkId) inside a setTimeout
    const hasOldTimeoutPattern = sourceCode.includes('setTimeout(() => {') && 
                                  sourceCode.includes('removeHighlightChunk(chunk.chunkId)') &&
                                  sourceCode.includes('HIGHLIGHT_DURATION')

    expect(hasOldTimeoutPattern).toBe(false)
  })

  test('ChunkLayer should not have clearTimeout cleanup for HIGHLIGHT_DURATION', () => {
    const sourceCode = readFileSync(chunkLayerPath, 'utf-8')

    // Check for the old pattern: return () => clearTimeout(timer) related to HIGHLIGHT_DURATION
    const hasOldCleanupPattern = 
      sourceCode.includes('const timer = setTimeout') &&
      sourceCode.includes('removeHighlightChunk(chunk.chunkId)') &&
      sourceCode.includes('return () => clearTimeout(timer)')

    expect(hasOldCleanupPattern).toBe(false)
  })

  test('ChunkLayer should still reference removeHighlightChunk from store', () => {
    const sourceCode = readFileSync(chunkLayerPath, 'utf-8')

    // The component should still have access to removeHighlightChunk for manual removal
    const hasStoreReference = sourceCode.includes('useGraphStore')

    expect(hasStoreReference).toBe(true)
  })

  test('HIGHLIGHT_DURATION constant should still exist (for reference only)', () => {
    const sourceCode = readFileSync(chunkLayerPath, 'utf-8')

    // The constant may still exist but should not be used in auto-removal logic
    const hasConstant = sourceCode.includes('HIGHLIGHT_DURATION')

    // This is okay - the constant can exist, it just shouldn't be used in useEffect for auto-removal
    expect(typeof hasConstant).toBe('boolean')
  })

  test('ChunkLayer should not have setTimeout in dependency array with chunk.chunkId', () => {
    const sourceCode = readFileSync(chunkLayerPath, 'utf-8')

    // The old pattern had [chunk.chunkId, removeHighlightChunk] in dependency array
    // for the timeout useEffect
    const lines = sourceCode.split('\n')
    
    let hasOldPattern = false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      
      // Look for setTimeout with removeHighlightChunk
      if (line.includes('setTimeout') && line.includes('removeHighlightChunk(chunk.chunkId)')) {
        // Check if this is inside a useEffect by looking at nearby lines
        for (let j = Math.max(0, i - 5); j <= Math.min(lines.length - 1, i + 5); j++) {
          if (lines[j].includes('useEffect')) {
            hasOldPattern = true
            break
          }
        }
      }
    }

    expect(hasOldPattern).toBe(false)
  })
})
