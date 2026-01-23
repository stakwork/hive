import type { Node } from "@xyflow/react";

/**
 * Collision Detection Utility
 * 
 * Detects overlapping nodes in a graph layout to ensure proper spacing.
 * Based on the assertNoOverlaps logic from graphFactory.ts.
 */

export interface CollisionResult {
  hasCollisions: boolean;
  collisions: Array<{
    nodeA: string;
    nodeB: string;
    details: string;
  }>;
}

/**
 * Detects collisions between nodes in a graph layout
 * 
 * @param nodes - Array of nodes to check for collisions
 * @param nodeWidth - Default width of nodes
 * @param nodeHeight - Default height of nodes
 * @param minSpacing - Minimum spacing required between nodes (default: 50)
 * @returns CollisionResult with collision details
 */
export function detectCollisions(
  nodes: Node[],
  nodeWidth: number,
  nodeHeight: number,
  minSpacing: number = 50
): CollisionResult {
  const collisions: CollisionResult["collisions"] = [];

  // Handle edge cases
  if (!nodes || nodes.length === 0) {
    return { hasCollisions: false, collisions: [] };
  }

  if (nodeWidth <= 0 || nodeHeight <= 0) {
    throw new Error(
      `Invalid dimensions: nodeWidth (${nodeWidth}) and nodeHeight (${nodeHeight}) must be positive`
    );
  }

  if (minSpacing < 0) {
    throw new Error(`Invalid minSpacing: ${minSpacing} must be non-negative`);
  }

  // Check each pair of nodes for overlap
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const nodeA = nodes[i];
      const nodeB = nodes[j];

      // Skip nodes with invalid positions
      if (
        !isFinite(nodeA.position.x) ||
        !isFinite(nodeA.position.y) ||
        !isFinite(nodeB.position.x) ||
        !isFinite(nodeB.position.y)
      ) {
        continue;
      }

      // Use node-specific dimensions if available, otherwise use defaults
      const widthA = (nodeA.data?.width as number) || nodeWidth;
      const heightA = (nodeA.data?.height as number) || nodeHeight;
      const widthB = (nodeB.data?.width as number) || nodeWidth;
      const heightB = (nodeB.data?.height as number) || nodeHeight;

      // Calculate bounding boxes with spacing buffer
      const aLeft = nodeA.position.x - minSpacing;
      const aRight = nodeA.position.x + widthA + minSpacing;
      const aTop = nodeA.position.y - minSpacing;
      const aBottom = nodeA.position.y + heightA + minSpacing;

      const bLeft = nodeB.position.x - minSpacing;
      const bRight = nodeB.position.x + widthB + minSpacing;
      const bTop = nodeB.position.y - minSpacing;
      const bBottom = nodeB.position.y + heightB + minSpacing;

      // Check for overlap (AABB collision detection)
      const overlapsX = aLeft < bRight && aRight > bLeft;
      const overlapsY = aTop < bBottom && aBottom > bTop;

      if (overlapsX && overlapsY) {
        collisions.push({
          nodeA: nodeA.id,
          nodeB: nodeB.id,
          details:
            `Node A: (${nodeA.position.x}, ${nodeA.position.y}) ${widthA}x${heightA}, ` +
            `Node B: (${nodeB.position.x}, ${nodeB.position.y}) ${widthB}x${heightB}`,
        });
      }
    }
  }

  return {
    hasCollisions: collisions.length > 0,
    collisions,
  };
}
