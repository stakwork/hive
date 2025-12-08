import { NodeExtended } from "@Universe/types";

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
    const visited = new Set<string>()

    // Initialize with source nodes at level 0
    nodesByLevel.set(0, new Set(initialNodes))
    initialNodes.forEach(nodeId => {
        allConnectedNodes.add(nodeId)
        visited.add(nodeId)
    })

    if (!useRandomDepth) {
        // Original systematic traversal
        for (let currentLevel = 0; currentLevel < maxDepth; currentLevel++) {
            const currentLevelNodes = nodesByLevel.get(currentLevel) || new Set()
            const nextLevelNodes = new Set<string>()

            currentLevelNodes.forEach(nodeId => {
                const node = nodesNormalized.get(nodeId)
                if (!node) return

                const connectedNodes = [...(node.sources || []), ...(node.targets || [])].filter(nodeId => nodeId !== sourceRefId)

                connectedNodes.forEach(connectedNodeId => {
                    if (visited.has(connectedNodeId) || !nodesNormalized.has(connectedNodeId)) {
                        return
                    }

                    nextLevelNodes.add(connectedNodeId)
                    allConnectedNodes.add(connectedNodeId)
                    visited.add(connectedNodeId)

                    connections.push({
                        from: nodeId,
                        to: connectedNodeId,
                        level: currentLevel + 1
                    })
                })
            })

            if (nextLevelNodes.size > 0) {
                nodesByLevel.set(currentLevel + 1, nextLevelNodes)
            } else {
                break
            }
        }
    } else {
        // Random depth assignment - collect all connected nodes first, then randomly assign depths
        const allConnectedNodesList: string[] = []
        const nodeConnections: Array<{ from: string; to: string }> = []

        // First pass: collect all reachable nodes up to maxDepth
        const queue: Array<{ nodeId: string; level: number }> = initialNodes.map(nodeId => ({ nodeId, level: 0 }))

        while (queue.length > 0) {
            const { nodeId, level } = queue.shift()!

            if (level >= maxDepth) continue

            const node = nodesNormalized.get(nodeId)
            if (!node) continue

            const connectedNodes = [...(node.sources || []), ...(node.targets || [])].filter(nodeId => nodeId !== sourceRefId)

            connectedNodes.forEach(connectedNodeId => {
                if (visited.has(connectedNodeId) || !nodesNormalized.has(connectedNodeId)) {
                    return
                }

                visited.add(connectedNodeId)
                allConnectedNodes.add(connectedNodeId)
                allConnectedNodesList.push(connectedNodeId)

                nodeConnections.push({
                    from: nodeId,
                    to: connectedNodeId
                })

                // Add to queue for further exploration
                queue.push({ nodeId: connectedNodeId, level: level + 1 })
            })
        }

        // Second pass: randomly assign depths and create connections
        allConnectedNodesList.forEach((connectedNodeId) => {
            // Randomly assign depth between 1 and maxDepth
            const randomLevel = Math.floor(Math.random() * maxDepth) + 1

            // Add to the appropriate level
            if (!nodesByLevel.has(randomLevel)) {
                nodesByLevel.set(randomLevel, new Set())
            }
            nodesByLevel.get(randomLevel)!.add(connectedNodeId)
        })

        // Create connections with random levels
        nodeConnections.forEach(({ from, to }) => {
            // Find which level the 'to' node was assigned to
            let assignedLevel = 1
            for (const [level, nodes] of nodesByLevel.entries()) {
                if (nodes.has(to)) {
                    assignedLevel = level
                    break
                }
            }

            connections.push({
                from,
                to,
                level: assignedLevel
            })
        })
    }

    return {
        nodesByLevel,
        allConnectedNodes,
        connections
    }
}