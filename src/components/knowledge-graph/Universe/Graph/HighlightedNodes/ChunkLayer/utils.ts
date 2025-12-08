import { NodeExtended } from '@Universe/types'

export const findConnectedNodesAtDepth = (
  initialNodes: string[],
  nodesNormalized: Map<string, NodeExtended>,
  maxDepth: number = 1,
  sourceRefId?: string,
  useRandomDepth: boolean = true
): {
  nodesByLevel: Map<number, Set<string>>
  allConnectedNodes: Set<string>
  connections: Array<{ from: string; to: string; level: number }>
} => {
  const nodesByLevel = new Map<number, Set<string>>()
  const allConnectedNodes = new Set<string>()
  const connections: Array<{ from: string; to: string; level: number }> = []
  const connectionKeys = new Set<string>()

  // Seed level 0 with the starting nodes (ref_ids)
  nodesByLevel.set(0, new Set(initialNodes))
  initialNodes.forEach(nodeId => {
    allConnectedNodes.add(nodeId)
  })

  const seeds = Array.from(new Set(initialNodes))

  seeds.forEach(seedId => {
    const depthLimit = useRandomDepth ? Math.max(1, Math.floor(Math.random() * maxDepth) + 1) : maxDepth
    const queue: Array<{ nodeId: string; level: number }> = [{ nodeId: seedId, level: 0 }]
    const visitedLocal = new Set<string>([seedId])

    while (queue.length > 0) {
      const { nodeId, level } = queue.shift()!
      if (level >= depthLimit) continue

      const node = nodesNormalized.get(nodeId)
      if (!node) continue

      const connectedNodes = [...(node.sources || []), ...(node.targets || [])].filter(connectedId => connectedId !== sourceRefId)

      connectedNodes.forEach(connectedNodeId => {
        if (visitedLocal.has(connectedNodeId) || !nodesNormalized.has(connectedNodeId)) {
          return
        }

        visitedLocal.add(connectedNodeId)
        allConnectedNodes.add(connectedNodeId)

        const nextLevel = level + 1
        if (!nodesByLevel.has(nextLevel)) {
          nodesByLevel.set(nextLevel, new Set())
        }
        nodesByLevel.get(nextLevel)!.add(connectedNodeId)

        const connectionKey = `${nodeId}-${connectedNodeId}`
        if (!connectionKeys.has(connectionKey)) {
          connections.push({
            from: nodeId,
            to: connectedNodeId,
            level: nextLevel
          })
          connectionKeys.add(connectionKey)
        }

        queue.push({ nodeId: connectedNodeId, level: nextLevel })
      })
    }
  })

  return {
    nodesByLevel,
    allConnectedNodes,
    connections
  }
}
