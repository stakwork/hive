import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createGraphStore } from '@/stores/createGraphStore'
import type { HighlightChunk } from '@/stores/graphStore.types'

/**
 * Unit tests for graph store highlight chunk timeout functionality
 * Tests the configurable timeout duration feature added to addHighlightChunk/removeHighlightChunk
 */

describe('Graph Store - Highlight Chunk Timeouts', () => {
  let store: ReturnType<typeof createGraphStore>

  beforeEach(() => {
    vi.useFakeTimers()
    store = createGraphStore('test-store-id')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('addHighlightChunk', () => {
    test('should accept optional maxDuration parameter', () => {
      const chunkId = store.getState().addHighlightChunk(
        'Test Chunk',
        ['node-1', 'node-2'],
        undefined,
        5000
      )

      expect(chunkId).toBeDefined()
      expect(typeof chunkId).toBe('string')

      const chunks = store.getState().highlightChunks
      expect(chunks).toHaveLength(1)
      expect(chunks[0].chunkId).toBe(chunkId)
    })

    test('should create chunk without maxDuration (backward compatibility)', () => {
      const chunkId = store.getState().addHighlightChunk('Test Chunk', ['node-1', 'node-2'])

      const chunks = store.getState().highlightChunks
      expect(chunks).toHaveLength(1)
      expect(chunks[0].timeoutId).toBeUndefined()
    })

    test('should store timeoutId when maxDuration is provided', () => {
      const chunkId = store.getState().addHighlightChunk(
        'Test Chunk',
        ['node-1', 'node-2'],
        undefined,
        5000
      )

      const chunks = store.getState().highlightChunks
      const chunk = chunks.find((c) => c.chunkId === chunkId)

      expect(chunk).toBeDefined()
      expect(chunk!.timeoutId).toBeDefined()
      expect(typeof chunk!.timeoutId).toBe('object') // NodeJS.Timeout is an object
    })

    test('should not store timeoutId when maxDuration is not provided', () => {
      const chunkId = store.getState().addHighlightChunk('Test Chunk', ['node-1', 'node-2'])

      const chunks = store.getState().highlightChunks
      const chunk = chunks.find((c) => c.chunkId === chunkId)

      expect(chunk).toBeDefined()
      expect(chunk!.timeoutId).toBeUndefined()
    })

    test('should auto-remove chunk after maxDuration', () => {
      const chunkId = store.getState().addHighlightChunk(
        'Test Chunk',
        ['node-1', 'node-2'],
        undefined,
        1000
      )

      // Chunk should exist initially
      expect(store.getState().highlightChunks).toHaveLength(1)

      // Fast-forward time by 1000ms
      vi.advanceTimersByTime(1000)

      // Chunk should be auto-removed
      expect(store.getState().highlightChunks).toHaveLength(0)
    })

    test('should not auto-remove chunk without maxDuration', () => {
      store.getState().addHighlightChunk('Test Chunk', ['node-1', 'node-2'])

      expect(store.getState().highlightChunks).toHaveLength(1)

      // Fast-forward time significantly
      vi.advanceTimersByTime(10000)

      // Chunk should still exist
      expect(store.getState().highlightChunks).toHaveLength(1)
    })

    test('should create multiple chunks with different durations', () => {
      const chunk1Id = store.getState().addHighlightChunk('Chunk 1', ['node-1'], undefined, 1000)
      const chunk2Id = store.getState().addHighlightChunk('Chunk 2', ['node-2'], undefined, 2000)
      const chunk3Id = store.getState().addHighlightChunk('Chunk 3', ['node-3']) // no duration

      expect(store.getState().highlightChunks).toHaveLength(3)

      // After 1000ms, chunk1 should be removed
      vi.advanceTimersByTime(1000)
      expect(store.getState().highlightChunks).toHaveLength(2)
      expect(store.getState().highlightChunks.find((c) => c.chunkId === chunk1Id)).toBeUndefined()

      // After another 1000ms (2000ms total), chunk2 should be removed
      vi.advanceTimersByTime(1000)
      expect(store.getState().highlightChunks).toHaveLength(1)
      expect(store.getState().highlightChunks.find((c) => c.chunkId === chunk2Id)).toBeUndefined()

      // chunk3 should still exist
      expect(store.getState().highlightChunks.find((c) => c.chunkId === chunk3Id)).toBeDefined()
    })

    test('should return unique chunkId for each call', () => {
      const chunkId1 = store.getState().addHighlightChunk('Chunk 1', ['node-1'])
      const chunkId2 = store.getState().addHighlightChunk('Chunk 2', ['node-2'])
      const chunkId3 = store.getState().addHighlightChunk('Chunk 3', ['node-3'])

      expect(chunkId1).not.toBe(chunkId2)
      expect(chunkId1).not.toBe(chunkId3)
      expect(chunkId2).not.toBe(chunkId3)
    })

    test('should update highlightTimestamp when adding chunk', () => {
      const initialTimestamp = store.getState().highlightTimestamp

      vi.advanceTimersByTime(100)

      store.getState().addHighlightChunk('Test Chunk', ['node-1'])

      const newTimestamp = store.getState().highlightTimestamp

      expect(newTimestamp).toBeGreaterThan(initialTimestamp || 0)
    })

    test('should store all chunk properties correctly', () => {
      const title = 'Test Chunk Title'
      const ref_ids = ['node-1', 'node-2', 'node-3']
      const sourceNodeRefId = 'source-node'
      const maxDuration = 5000

      const chunkId = store
        .getState()
        .addHighlightChunk(title, ref_ids, sourceNodeRefId, maxDuration)

      const chunks = store.getState().highlightChunks
      const chunk = chunks.find((c) => c.chunkId === chunkId)

      expect(chunk).toBeDefined()
      expect(chunk!.title).toBe(title)
      expect(chunk!.ref_ids).toEqual(ref_ids)
      expect(chunk!.sourceNodeRefId).toBe(sourceNodeRefId)
      expect(chunk!.timestamp).toBeGreaterThan(0)
      expect(chunk!.timeoutId).toBeDefined()
    })
  })

  describe('removeHighlightChunk', () => {
    test('should clear timeout if timeoutId exists', () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

      const chunkId = store.getState().addHighlightChunk(
        'Test Chunk',
        ['node-1', 'node-2'],
        undefined,
        5000
      )

      store.getState().removeHighlightChunk(chunkId)

      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
      expect(store.getState().highlightChunks).toHaveLength(0)
    })

    test('should not error when clearing chunk without timeout', () => {
      const chunkId = store.getState().addHighlightChunk('Test Chunk', ['node-1', 'node-2'])

      expect(() => {
        store.getState().removeHighlightChunk(chunkId)
      }).not.toThrow()

      expect(store.getState().highlightChunks).toHaveLength(0)
    })

    test('should remove chunk from state', () => {
      const chunkId = store.getState().addHighlightChunk('Test Chunk', ['node-1', 'node-2'])

      expect(store.getState().highlightChunks).toHaveLength(1)

      store.getState().removeHighlightChunk(chunkId)

      expect(store.getState().highlightChunks).toHaveLength(0)
    })

    test('should only remove the specified chunk', () => {
      const chunk1Id = store.getState().addHighlightChunk('Chunk 1', ['node-1'])
      const chunk2Id = store.getState().addHighlightChunk('Chunk 2', ['node-2'])
      const chunk3Id = store.getState().addHighlightChunk('Chunk 3', ['node-3'])

      expect(store.getState().highlightChunks).toHaveLength(3)

      store.getState().removeHighlightChunk(chunk2Id)

      const remainingChunks = store.getState().highlightChunks
      expect(remainingChunks).toHaveLength(2)
      expect(remainingChunks.find((c) => c.chunkId === chunk1Id)).toBeDefined()
      expect(remainingChunks.find((c) => c.chunkId === chunk2Id)).toBeUndefined()
      expect(remainingChunks.find((c) => c.chunkId === chunk3Id)).toBeDefined()
    })

    test('should update highlightTimestamp to null when removing last chunk', () => {
      const chunkId = store.getState().addHighlightChunk('Test Chunk', ['node-1'])

      expect(store.getState().highlightTimestamp).toBeGreaterThan(0)

      store.getState().removeHighlightChunk(chunkId)

      expect(store.getState().highlightTimestamp).toBeNull()
    })

    test('should update highlightTimestamp when chunks remain', () => {
      const chunk1Id = store.getState().addHighlightChunk('Chunk 1', ['node-1'])
      store.getState().addHighlightChunk('Chunk 2', ['node-2'])

      const timestampBefore = store.getState().highlightTimestamp

      vi.advanceTimersByTime(100)

      store.getState().removeHighlightChunk(chunk1Id)

      const timestampAfter = store.getState().highlightTimestamp

      expect(timestampAfter).toBeGreaterThan(0)
      expect(store.getState().highlightChunks).toHaveLength(1)
    })

    test('should handle removing non-existent chunk gracefully', () => {
      store.getState().addHighlightChunk('Test Chunk', ['node-1'])

      expect(() => {
        store.getState().removeHighlightChunk('non-existent-id')
      }).not.toThrow()

      expect(store.getState().highlightChunks).toHaveLength(1)
    })

    test('should prevent timeout from firing after manual removal', () => {
      const chunkId = store.getState().addHighlightChunk(
        'Test Chunk',
        ['node-1', 'node-2'],
        undefined,
        1000
      )

      expect(store.getState().highlightChunks).toHaveLength(1)

      // Manually remove before timeout
      store.getState().removeHighlightChunk(chunkId)

      expect(store.getState().highlightChunks).toHaveLength(0)

      // Fast-forward past the original timeout
      vi.advanceTimersByTime(1000)

      // Should still have 0 chunks (timeout was cleared)
      expect(store.getState().highlightChunks).toHaveLength(0)
    })

    test('should clear timeout for correct chunk when multiple exist', () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

      const chunk1Id = store.getState().addHighlightChunk('Chunk 1', ['node-1'], undefined, 5000)
      const chunk2Id = store.getState().addHighlightChunk('Chunk 2', ['node-2'], undefined, 5000)

      expect(store.getState().highlightChunks).toHaveLength(2)

      store.getState().removeHighlightChunk(chunk1Id)

      // clearTimeout should be called once for chunk1's timeout
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)

      // Only chunk2 should remain
      const remainingChunks = store.getState().highlightChunks
      expect(remainingChunks).toHaveLength(1)
      expect(remainingChunks[0].chunkId).toBe(chunk2Id)
    })
  })

  describe('timeout callback integration', () => {
    test('timeout callback should call removeHighlightChunk', () => {
      const chunkId = store.getState().addHighlightChunk(
        'Test Chunk',
        ['node-1', 'node-2'],
        undefined,
        1000
      )

      const initialChunks = store.getState().highlightChunks
      expect(initialChunks).toHaveLength(1)
      expect(initialChunks[0].chunkId).toBe(chunkId)

      // Advance time to trigger timeout
      vi.advanceTimersByTime(1000)

      // Verify chunk was removed by timeout callback
      expect(store.getState().highlightChunks).toHaveLength(0)
    })

    test('timeout callback should not affect other chunks', () => {
      const chunk1Id = store.getState().addHighlightChunk('Chunk 1', ['node-1'], undefined, 500)
      const chunk2Id = store.getState().addHighlightChunk('Chunk 2', ['node-2'], undefined, 1500)
      const chunk3Id = store.getState().addHighlightChunk('Chunk 3', ['node-3']) // no timeout

      expect(store.getState().highlightChunks).toHaveLength(3)

      // Trigger chunk1's timeout
      vi.advanceTimersByTime(500)

      const afterFirstTimeout = store.getState().highlightChunks
      expect(afterFirstTimeout).toHaveLength(2)
      expect(afterFirstTimeout.find((c) => c.chunkId === chunk2Id)).toBeDefined()
      expect(afterFirstTimeout.find((c) => c.chunkId === chunk3Id)).toBeDefined()

      // Trigger chunk2's timeout
      vi.advanceTimersByTime(1000)

      const afterSecondTimeout = store.getState().highlightChunks
      expect(afterSecondTimeout).toHaveLength(1)
      expect(afterSecondTimeout.find((c) => c.chunkId === chunk3Id)).toBeDefined()
    })

    test('timeout should use correct duration', () => {
      const durations = [100, 500, 1000, 2000, 5000]

      durations.forEach((duration) => {
        const testStore = createGraphStore(`test-${duration}`)
        testStore.getState().addHighlightChunk('Test', ['node-1'], undefined, duration)

        expect(testStore.getState().highlightChunks).toHaveLength(1)

        // Just before timeout
        vi.advanceTimersByTime(duration - 1)
        expect(testStore.getState().highlightChunks).toHaveLength(1)

        // At timeout
        vi.advanceTimersByTime(1)
        expect(testStore.getState().highlightChunks).toHaveLength(0)
      })
    })
  })

  describe('edge cases and error scenarios', () => {
    test('should handle minimal maxDuration (1ms)', () => {
      const chunkId = store.getState().addHighlightChunk('Test Chunk', ['node-1'], undefined, 1)

      expect(store.getState().highlightChunks).toHaveLength(1)

      // Advance time by 1ms
      vi.advanceTimersByTime(1)

      // Chunk should be removed after timer executes
      expect(store.getState().highlightChunks).toHaveLength(0)
    })

    test('should handle very large maxDuration', () => {
      const largeTimeout = 1000 * 60 * 60 * 24 // 24 hours
      const chunkId = store
        .getState()
        .addHighlightChunk('Test Chunk', ['node-1'], undefined, largeTimeout)

      expect(store.getState().highlightChunks).toHaveLength(1)

      // Advance time significantly but not enough to trigger
      vi.advanceTimersByTime(1000 * 60 * 60) // 1 hour
      expect(store.getState().highlightChunks).toHaveLength(1)

      // Advance to full duration
      vi.advanceTimersByTime(1000 * 60 * 60 * 23) // 23 more hours
      expect(store.getState().highlightChunks).toHaveLength(0)
    })

    test('should handle empty ref_ids array', () => {
      const chunkId = store.getState().addHighlightChunk('Test Chunk', [], undefined, 1000)

      const chunk = store.getState().highlightChunks.find((c) => c.chunkId === chunkId)
      expect(chunk).toBeDefined()
      expect(chunk!.ref_ids).toEqual([])
    })

    test('should handle undefined sourceNodeRefId', () => {
      const chunkId = store
        .getState()
        .addHighlightChunk('Test Chunk', ['node-1'], undefined, 1000)

      const chunk = store.getState().highlightChunks.find((c) => c.chunkId === chunkId)
      expect(chunk).toBeDefined()
      expect(chunk!.sourceNodeRefId).toBeUndefined()
    })

    test('should handle rapid add/remove operations', () => {
      const chunkIds: string[] = []

      // Add 10 chunks rapidly
      for (let i = 0; i < 10; i++) {
        chunkIds.push(
          store.getState().addHighlightChunk(`Chunk ${i}`, [`node-${i}`], undefined, 1000)
        )
      }

      expect(store.getState().highlightChunks).toHaveLength(10)

      // Remove odd-indexed chunks
      chunkIds.forEach((id, index) => {
        if (index % 2 === 1) {
          store.getState().removeHighlightChunk(id)
        }
      })

      expect(store.getState().highlightChunks).toHaveLength(5)

      // Let timeouts fire for remaining chunks
      vi.advanceTimersByTime(1000)

      expect(store.getState().highlightChunks).toHaveLength(0)
    })
  })

  describe('backward compatibility', () => {
    test('existing webhook highlights should work without duration', () => {
      // Simulate existing usage pattern without maxDuration parameter
      const chunkId = store.getState().addHighlightChunk('Webhook Highlight', [
        'node-1',
        'node-2',
        'node-3',
      ])

      const chunk = store.getState().highlightChunks.find((c) => c.chunkId === chunkId)

      expect(chunk).toBeDefined()
      expect(chunk!.title).toBe('Webhook Highlight')
      expect(chunk!.ref_ids).toHaveLength(3)
      expect(chunk!.timeoutId).toBeUndefined()

      // Should persist indefinitely
      vi.advanceTimersByTime(100000)
      expect(store.getState().highlightChunks).toHaveLength(1)
    })

    test('should support both old and new usage patterns simultaneously', () => {
      // Old pattern: no timeout
      const oldChunkId = store.getState().addHighlightChunk('Old Pattern', ['node-1'])

      // New pattern: with timeout
      const newChunkId = store
        .getState()
        .addHighlightChunk('New Pattern', ['node-2'], undefined, 1000)

      expect(store.getState().highlightChunks).toHaveLength(2)

      // After timeout, only old pattern chunk should remain
      vi.advanceTimersByTime(1000)

      const remainingChunks = store.getState().highlightChunks
      expect(remainingChunks).toHaveLength(1)
      expect(remainingChunks[0].chunkId).toBe(oldChunkId)
    })
  })
})
