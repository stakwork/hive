import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useWebhookHighlights } from '@/hooks/useWebhookHighlights'

// Mock pusher-js
vi.mock('pusher-js', () => ({
  default: vi.fn(() => ({
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    disconnect: vi.fn(),
  })),
}))

// Mock @/lib/pusher
vi.mock('@/lib/pusher', () => ({
  getPusherClient: vi.fn(),
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    HIGHLIGHT_NODES: 'highlight-nodes',
  },
}))

// Mock workspace hook
vi.mock('@/hooks/useWorkspace', () => ({
  useWorkspace: vi.fn(),
}))

// Mock stores
vi.mock('@/stores/useStores', () => ({
  useGraphStore: vi.fn(),
  useDataStore: vi.fn(),
}))

import { getPusherClient, getWorkspaceChannelName, PUSHER_EVENTS } from '@/lib/pusher'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useGraphStore, useDataStore } from '@/stores/useStores'

const mockChannel = {
  bind: vi.fn(),
  unbind: vi.fn(),
}

const mockPusherClient = {
  subscribe: vi.fn(() => mockChannel),
  unsubscribe: vi.fn(),
}

const mockAddHighlightChunk = vi.fn()
const mockAddCallout = vi.fn()
const mockAddNewNode = vi.fn()

describe('useWebhookHighlights', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useWorkspace).mockReturnValue({
      workspace: { slug: 'test-workspace', id: 'ws-1' },
    } as any)

    vi.mocked(useGraphStore).mockReturnValue({
      addHighlightChunk: mockAddHighlightChunk,
      addCallout: mockAddCallout,
    } as any)

    vi.mocked(useDataStore).mockReturnValue({
      addNewNode: mockAddNewNode,
    } as any)

    vi.mocked(getPusherClient).mockReturnValue(mockPusherClient as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Error handling when Pusher env vars are missing', () => {
    test('should not throw when getPusherClient throws (missing env vars)', () => {
      vi.mocked(getPusherClient).mockImplementation(() => {
        throw new Error('Pusher environment variables are not configured')
      })

      expect(() => {
        renderHook(() => useWebhookHighlights())
      }).not.toThrow()
    })

    test('should not log a console error when Pusher env vars are missing', () => {
      const consoleSpy = vi.spyOn(console, 'error')

      vi.mocked(getPusherClient).mockImplementation(() => {
        throw new Error('Pusher environment variables are not configured')
      })

      renderHook(() => useWebhookHighlights())

      expect(consoleSpy).not.toHaveBeenCalled()
    })

    test('should not throw when workspace slug is absent', () => {
      vi.mocked(useWorkspace).mockReturnValue({ workspace: null } as any)

      expect(() => {
        renderHook(() => useWebhookHighlights())
      }).not.toThrow()

      // Should not even attempt to get Pusher client without a workspace slug
      expect(getPusherClient).not.toHaveBeenCalled()
    })
  })

  describe('Successful subscription when Pusher env vars are present', () => {
    test('should subscribe to the correct workspace channel', () => {
      renderHook(() => useWebhookHighlights())

      expect(getWorkspaceChannelName).toHaveBeenCalledWith('test-workspace')
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith('workspace-test-workspace')
    })

    test('should bind to HIGHLIGHT_NODES event on the channel', () => {
      renderHook(() => useWebhookHighlights())

      expect(mockChannel.bind).toHaveBeenCalledWith(
        PUSHER_EVENTS.HIGHLIGHT_NODES,
        expect.any(Function)
      )
    })

    test('should unsubscribe from the channel on unmount', () => {
      const { unmount } = renderHook(() => useWebhookHighlights())

      unmount()

      expect(mockChannel.unbind).toHaveBeenCalledWith(
        PUSHER_EVENTS.HIGHLIGHT_NODES,
        expect.any(Function)
      )
      expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith('workspace-test-workspace')
    })

    test('should re-subscribe when workspace slug changes', () => {
      const { rerender } = renderHook(() => useWebhookHighlights())

      expect(mockPusherClient.subscribe).toHaveBeenCalledWith('workspace-test-workspace')

      vi.mocked(useWorkspace).mockReturnValue({
        workspace: { slug: 'new-workspace', id: 'ws-2' },
      } as any)

      vi.mocked(getWorkspaceChannelName).mockReturnValue('workspace-new-workspace')

      rerender()

      expect(mockPusherClient.subscribe).toHaveBeenCalledWith('workspace-new-workspace')
    })
  })
})
