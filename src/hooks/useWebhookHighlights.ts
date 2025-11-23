import { useWorkspace } from '@/hooks/useWorkspace'
import { getPusherClient, getWorkspaceChannelName, PUSHER_EVENTS } from '@/lib/pusher'
import { useGraphStore } from '@/stores/useStores'
import { useEffect } from 'react'

interface HighlightEvent {
  nodeIds: string[]
  workspaceId: string
  depth: number
  title: string
  timestamp: number
}

export const useWebhookHighlights = () => {
  const { workspace } = useWorkspace()
  const { setWebhookHighlightNodes, addWebhookHighlightChunk } = useGraphStore((s) => s)

  useEffect(() => {
    try {
      if (!workspace?.slug) return

      const pusher = getPusherClient()
      const channelName = getWorkspaceChannelName(workspace.slug)
      const channel = pusher.subscribe(channelName)

      const handleHighlightEvent = (data: HighlightEvent) => {
        console.log('Received highlight event:', data)

        console.log("pusher-data:", data);

        // Verify this is for the current workspace
        if (data.workspaceId === workspace.slug) {
          console.log("setting webhook highlight nodes:", data.nodeIds, data.depth, data.title)

          // Use new chunk-based system if title is provided, fallback to legacy system
          if (data.title) {
            addWebhookHighlightChunk(data.title, data.nodeIds, data.depth)
          } else {
            setWebhookHighlightNodes(data.nodeIds, data.depth)
          }
        }
      }

      channel.bind(PUSHER_EVENTS.HIGHLIGHT_NODES, handleHighlightEvent)

      return () => {
        channel.unbind(PUSHER_EVENTS.HIGHLIGHT_NODES, handleHighlightEvent)
        pusher.unsubscribe(channelName)
      }
    } catch (error) {
      console.error('Error subscribing to webhook highlights:', error)
    }
  }, [workspace?.slug, setWebhookHighlightNodes, addWebhookHighlightChunk])
}