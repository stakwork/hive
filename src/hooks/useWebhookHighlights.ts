import { useWorkspace } from '@/hooks/useWorkspace'
import { getPusherClient, getWorkspaceChannelName, PUSHER_EVENTS } from '@/lib/pusher'
import { useDataStore, useGraphStore } from '@/stores/useStores'
import { useEffect, useCallback } from 'react'

interface HighlightEvent {
  nodeIds: string[]
  workspaceId: string
  depth: number
  title: string
  timestamp: number
}

export const useWebhookHighlights = () => {
  const { workspace } = useWorkspace()
  const { addHighlightChunk } = useGraphStore((s) => s)
  const { addNewNode } = useDataStore((s) => s)

  const fetchNodes = useCallback(async (nodeIds: string[]) => {
    if (!workspace?.slug || nodeIds.length === 0) return []

    try {
      const response = await fetch(
        `/api/workspaces/${workspace.slug}/graph/nodes?ref_ids=${nodeIds.join(',')}`
      )
      if (!response.ok) return []

      const data = await response.json()
      return data?.data?.nodes || []
    } catch (error) {
      console.error('Failed to fetch nodes:', error)
      return []
    }
  }, [workspace?.slug])

  const fetchSubgraph = useCallback(async (nodeIds: string[], depth: number) => {
    if (!workspace?.slug || nodeIds.length === 0) return []

    try {
      const allNodes: any[] = []
      const allEdges: any[] = []
      const allNodeIds = new Set<string>()

      for (const nodeId of nodeIds) {
        const subgraphEndpoint = `/graph/subgraph?include_properties=true&start_node=${nodeId}&depth=${depth}&min_depth=0&limit=100&sort_by=date_added_to_graph`
        const encodedEndpoint = encodeURIComponent(subgraphEndpoint)

        const response = await fetch(
          `/api/swarm/jarvis/nodes?id=${workspace.id}&endpoint=${encodedEndpoint}`
        )

        if (!response.ok) continue

        const data = await response.json()
        const nodes = data?.data?.nodes || []
        const edges = data?.data?.edges || []

        // Collect unique nodes and edges
        nodes.forEach((node: any) => {
          if (!allNodeIds.has(node.ref_id)) {
            allNodeIds.add(node.ref_id)
            allNodes.push(node)
          }
        })

        edges.forEach((edge: any) => {
          const edgeExists = allEdges.some(existingEdge =>
            existingEdge.ref_id === edge.ref_id ||
            (existingEdge.source === edge.source && existingEdge.target === edge.target)
          )
          if (!edgeExists) {
            allEdges.push(edge)
          }
        })
      }

      if (allNodes.length > 0 || allEdges.length > 0) {
        addNewNode({ nodes: allNodes, edges: allEdges })
      }

      return Array.from(allNodeIds)
    } catch (error) {
      console.error('Failed to fetch subgraph:', error)
      return []
    }
  }, [workspace?.slug, workspace?.id, addNewNode])

  useEffect(() => {
    try {
      if (!workspace?.slug) return

      const pusher = getPusherClient()
      const channelName = getWorkspaceChannelName(workspace.slug)
      const channel = pusher.subscribe(channelName)

      const handleHighlightEvent = async (data: HighlightEvent) => {
        console.log('Received highlight event:', data)

        if (data.workspaceId !== workspace.slug) return

        let finalNodeIds: string[] = []

        if (data.depth === 0) {
          // Depth 0: Just fetch the specific nodes
          const nodes = await fetchNodes(data.nodeIds)
          if (nodes.length > 0) {
            addNewNode({ nodes, edges: [] })
          }
          finalNodeIds = data.nodeIds
        } else {
          // Depth > 0: Fetch subgraph
          finalNodeIds = await fetchSubgraph(data.nodeIds, data.depth)
        }

        // Create highlight chunk
        if (finalNodeIds.length > 0) {
          console.log('Creating highlight chunk with nodes:', finalNodeIds)
          addHighlightChunk(data.title, finalNodeIds)
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
  }, [workspace?.slug, fetchNodes, fetchSubgraph, addHighlightChunk, addNewNode])
}