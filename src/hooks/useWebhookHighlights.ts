import { useWorkspace } from '@/hooks/useWorkspace'
import { getPusherClient, getWorkspaceChannelName, PUSHER_EVENTS } from '@/lib/pusher'
import { useGraphStore } from '@/stores/useStores'
import { useEffect } from 'react'

interface HighlightEvent {
  nodeIds: string[]
  workspaceId: string
  timestamp: number
}

export const useWebhookHighlights = () => {
  const { workspace } = useWorkspace()
  const { setWebhookHighlightNodes } = useGraphStore((s) => s)

  useEffect(() => {
    // Skip in test environment to prevent E2E test failures
    if (process.env.NODE_ENV === 'test' || typeof window === 'undefined') return

    if (!workspace?.slug) return

    const pusher = getPusherClient()
    const channelName = getWorkspaceChannelName(workspace.slug)
    const channel = pusher.subscribe(channelName)

    const handleHighlightEvent = (data: HighlightEvent) => {
      console.log('Received highlight event:', data)

      console.log("pusher-data:", data);

      // Verify this is for the current workspace
      if (data.workspaceId === workspace.slug) {
        setWebhookHighlightNodes(data.nodeIds)
      }
    }

    channel.bind(PUSHER_EVENTS.HIGHLIGHT_NODES, handleHighlightEvent)

    return () => {
      channel.unbind(PUSHER_EVENTS.HIGHLIGHT_NODES, handleHighlightEvent)
      pusher.unsubscribe(channelName)
    }
  }, [workspace?.slug, setWebhookHighlightNodes])
}