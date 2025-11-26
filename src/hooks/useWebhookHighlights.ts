import { Link, NodeExtended } from '@/components/knowledge-graph/Universe/types'
import { useWorkspace } from '@/hooks/useWorkspace'
import { getPusherClient, getWorkspaceChannelName, PUSHER_EVENTS } from '@/lib/pusher'
import { useDataStore, useGraphStore } from '@/stores/useStores'
import { useCallback, useEffect } from 'react'

interface HighlightEvent {
  nodeIds: string[]
  workspaceId: string
  depth: number
  title: string
  timestamp: number
  sourceNodeRefId: string
}

const dedupeIds = (ids: (string | undefined)[]) =>
  Array.from(new Set(ids.filter((id): id is string => !!id)))

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
      const allNodes: NodeExtended[] = []
      const allEdges: Link[] = []
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
        nodes.forEach((node: NodeExtended) => {
          if (!allNodeIds.has(node.ref_id)) {
            allNodeIds.add(node.ref_id)
            allNodes.push(node)
          }
        })

        edges.forEach((edge: Link) => {
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

        // Always include the source node (if present) when fetching/highlighting
        const nodeIdsWithSource = dedupeIds([
          ...(data.nodeIds || []),
          data.sourceNodeRefId,
        ])

        if (data.depth === 0) {
          // Depth 0: Just fetch the specific nodes
          const nodes = await fetchNodes(nodeIdsWithSource)

          console.log('add new nodes:', nodes)
          if (nodes.length > 0) {
            addNewNode({ nodes, edges: [] })
          }
          finalNodeIds = nodeIdsWithSource
        } else {
          // Depth > 0: Fetch subgraph, and ensure source node is fetched explicitly
          const fetchedIds = await fetchSubgraph(nodeIdsWithSource, data.depth)
          const sourceNodes =
            data.sourceNodeRefId && !fetchedIds.includes(data.sourceNodeRefId)
              ? await fetchNodes([data.sourceNodeRefId])
              : []

          if (sourceNodes.length > 0) {
            console.log('add new source nodes:', sourceNodes)
            addNewNode({ nodes: sourceNodes, edges: [] })
          }

          finalNodeIds = dedupeIds([
            ...fetchedIds,
            ...sourceNodes.map((n: NodeExtended) => n.ref_id),
            ...nodeIdsWithSource,
          ])
        }

        // Create highlight chunk
        if (finalNodeIds.length > 0) {
          console.log('Creating highlight chunk with nodes:', finalNodeIds)
          addHighlightChunk(data.title, finalNodeIds, data.sourceNodeRefId)
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
