import ELK from 'elkjs/lib/elk.bundled.js';
import { Node, Edge } from '@xyflow/react';

// Create ELK instance
const elk = new ELK();

interface ElkNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layoutOptions?: Record<string, string>;
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  layoutOptions?: Record<string, string>;
}

interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkNode[];
  edges: ElkEdge[];
}

interface NodeBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface NodeWithBounds extends Node {
  bounds: NodeBounds;
}

/**
 * Clamps node coordinates to ensure they remain within visible viewport bounds.
 * Prevents nodes from being positioned off-screen due to negative coordinates.
 *
 * @param node - The node to clamp
 * @param minX - Minimum X coordinate (default: 0)
 * @param minY - Minimum Y coordinate (default: 0)
 * @returns The node with clamped position
 */
function clampNodePosition(
  node: Node,
  minX: number = 0,
  minY: number = 0
): Node {
  return {
    ...node,
    position: {
      x: Math.max(minX, node.position.x),
      y: Math.max(minY, node.position.y),
    },
  };
}

interface EdgePath {
  source: string;
  target: string;
  sourceCenterX: number;
  sourceCenterY: number;
  targetCenterX: number;
  targetCenterY: number;
}

export const smartLayout = async (nodes: Node[], edges: Edge[]): Promise<Node[]> => {
  console.log('Applying smart layout with edge-node clash prevention...');

  // Clone nodes to avoid modifying originals
  const nodesCopy: Node[] = JSON.parse(JSON.stringify(nodes));

  try {
    // Step 1: Apply basic ELK layout with generous spacing
    const layoutedNodes = await applyBasicLayout(nodesCopy, edges);

    // Step 2: Fix any remaining overlaps
    const noOverlapNodes = fixNodeOverlaps(layoutedNodes);

    // Step 3: Ensure edges don't cross through nodes
    return optimizeEdgePaths(noOverlapNodes, edges);
  } catch (error) {
    console.error('Smart layout error:', error);
    return nodesCopy;
  }
};

async function applyBasicLayout(nodes: Node[], edges: Edge[]): Promise<Node[]> {
  // Identify special nodes
  const diamondNodes = nodes.filter(node =>
    node.data?.stepType === 'IfCondition' ||
    node.data?.stepType === 'IfElseCondition' ||
    (typeof node.data?.className === 'string' && node.data.className.includes('diamond')) ||
    (node.data?.bgColor === '#f5e8d5')
  );

  const startNodes = nodes.filter(node =>
    node.id === 'start'
  );

  const endNodes = nodes.filter(node =>
    node.id === 'system.succeed' ||
    node.id === 'system.fail'
  );

  // Create ELK graph with generous spacing
  const elkGraph: ElkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '350',
      'elk.layered.spacing.nodeNodeBetweenLayers': '300',
      'elk.spacing.edgeEdge': '180',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.aspectRatio': '2.0',
      'elk.padding': '[top=80, left=80, bottom=80, right=80]',
      'elk.edgeLabels.inline': 'true',
      'elk.layered.spacing.edgeNodeBetweenLayers': '150',
      'elk.layered.spacing.edgeNode': '100',
      'elk.layered.mergeEdges': 'true',
      'elk.layered.thoroughness': '10',
    },
    children: nodes.map(node => {
      // Determine if this is a special node type
      const isDiamond = diamondNodes.some(n => n.id === node.id);
      const isStart = startNodes.some(n => n.id === node.id);
      const isEnd = endNodes.some(n => n.id === node.id);

      // Set width and height based on node type
      const width: number = (node?.data?.width as number | undefined) || (isDiamond ? 170 : 200);
      const height: number = (node?.data?.height as number | undefined) || (isDiamond ? 170 : 120);

      // Node-specific layout options
      const nodeOptions: Record<string, string> = {};

      if (isStart) {
        nodeOptions['elk.layered.layering.layerConstraint'] = 'FIRST';
      }

      if (isEnd) {
        nodeOptions['elk.layered.layering.layerConstraint'] = 'LAST';
      }

      if (isDiamond) {
        nodeOptions['elk.padding'] = '[top=80, left=80, bottom=80, right=80]';
        nodeOptions['elk.portConstraints'] = 'FREE';
      }

      return {
        id: node.id,
        x: 0,
        y: 0,
        width,
        height,
        layoutOptions: nodeOptions,
      };
    }),
    edges: edges.map(edge => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
      layoutOptions: {
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.feedbackEdges': 'true',
      }
    })),
  };

  // Run ELK layout
  const layoutedGraph = await elk.layout(elkGraph) as { children?: ElkNode[] };

  // Apply positions to nodes
  return nodes.map(node => {
    const layoutedNode = layoutedGraph.children?.find(n => n.id === node.id);

    if (layoutedNode) {
      return {
        ...node,
        position: {
          x: layoutedNode.x,
          y: layoutedNode.y,
        },
      };
    }

    return node;
  });
}

function fixNodeOverlaps(nodes: Node[]): Node[] {
  // Make a copy of nodes
  const fixedNodes = [...nodes];
  // Use generous node size with safety margin
  const nodeSize = { width: 250, height: 150 };

  // Iteratively fix overlaps until no more are found or max iterations reached
  let overlapsExist = true;
  let iterations = 0;
  const maxIterations = 10;

  while (overlapsExist && iterations < maxIterations) {
    let foundOverlap = false;
    iterations++;

    // Check each pair of nodes for overlaps
    for (let i = 0; i < fixedNodes.length; i++) {
      for (let j = i + 1; j < fixedNodes.length; j++) {
        const nodeA = fixedNodes[i];
        const nodeB = fixedNodes[j];

        // Calculate overlap with additional safety margin
        const safetyMargin = 30;
        const xOverlap = Math.abs(nodeA.position.x - nodeB.position.x) < (nodeSize.width + safetyMargin);
        const yOverlap = Math.abs(nodeA.position.y - nodeB.position.y) < (nodeSize.height + safetyMargin);

        if (xOverlap && yOverlap) {
          foundOverlap = true;

          // Determine which direction to move based on relative positions
          if (Math.abs(nodeA.position.x - nodeB.position.x) < Math.abs(nodeA.position.y - nodeB.position.y)) {
            // Nodes are more vertically aligned, so move horizontally
            const xShift = (nodeSize.width + safetyMargin) / 2;
            if (nodeA.position.x <= nodeB.position.x) {
              nodeA.position.x -= xShift;
              nodeB.position.x += xShift;
            } else {
              nodeA.position.x += xShift;
              nodeB.position.x -= xShift;
            }

            // Clamp coordinates to prevent off-screen positioning
            fixedNodes[i] = clampNodePosition(fixedNodes[i]);
            fixedNodes[j] = clampNodePosition(fixedNodes[j]);
          } else {
            // Nodes are more horizontally aligned, so move vertically
            const yShift = (nodeSize.height + safetyMargin) / 2;
            if (nodeA.position.y <= nodeB.position.y) {
              nodeA.position.y -= yShift;
              nodeB.position.y += yShift;
            } else {
              nodeA.position.y += yShift;
              nodeB.position.y -= yShift;
            }

            // Clamp coordinates to prevent off-screen positioning
            fixedNodes[i] = clampNodePosition(fixedNodes[i]);
            fixedNodes[j] = clampNodePosition(fixedNodes[j]);
          }
        }
      }
    }

    overlapsExist = foundOverlap;
  }

  return fixedNodes;
}

function optimizeEdgePaths(nodes: Node[], edges: Edge[]): Node[] {
  const fixedNodes = [...nodes];

  // Create a node map for quick lookup
  const nodeMap: Record<string, NodeWithBounds> = {};
  fixedNodes.forEach(node => {
    nodeMap[node.id] = {
      ...node,
      // Add boundary information
      bounds: {
        left: node.position.x,
        top: node.position.y,
        right: node.position.x + ((node.data?.width as number | undefined) || 200),
        bottom: node.position.y + ((node.data?.height as number | undefined) || 120)
      }
    };
  });

  // First pass: Identify problem edges that might cross nodes
  const edgePathMap: Record<string, EdgePath> = {};
  edges.forEach(edge => {
    const source = nodeMap[edge.source];
    const target = nodeMap[edge.target];

    if (!source || !target) return;

    // Calculate potential straight line path between centers
    const sourceCenterX = source.bounds.left + (source.bounds.right - source.bounds.left) / 2;
    const sourceCenterY = source.bounds.top + (source.bounds.bottom - source.bounds.top) / 2;
    const targetCenterX = target.bounds.left + (target.bounds.right - target.bounds.left) / 2;
    const targetCenterY = target.bounds.top + (target.bounds.bottom - target.bounds.top) / 2;

    edgePathMap[edge.id] = {
      source: edge.source,
      target: edge.target,
      sourceCenterX,
      sourceCenterY,
      targetCenterX,
      targetCenterY
    };
  });

  // Second pass: Adjust node positions to prevent edge clashes
  const checkObstacles = (edge: Edge, nodeId: string): boolean => {
    const edgePath = edgePathMap[edge.id];
    if (!edgePath) return false;

    // Skip source and target nodes of this edge
    if (nodeId === edge.source || nodeId === edge.target) return false;

    const node = nodeMap[nodeId];
    if (!node) return false;

    // Check if line intersects node rectangle
    const lineStartX = edgePath.sourceCenterX;
    const lineStartY = edgePath.sourceCenterY;
    const lineEndX = edgePath.targetCenterX;
    const lineEndY = edgePath.targetCenterY;

    // Expand node bounds with safety margin
    const safetyMargin = 40;
    const nodeBounds = {
      left: node.bounds.left - safetyMargin,
      top: node.bounds.top - safetyMargin,
      right: node.bounds.right + safetyMargin,
      bottom: node.bounds.bottom + safetyMargin
    };

    // Simple bounding box check first
    if (Math.max(lineStartX, lineEndX) < nodeBounds.left ||
      Math.min(lineStartX, lineEndX) > nodeBounds.right ||
      Math.max(lineStartY, lineEndY) < nodeBounds.top ||
      Math.min(lineStartY, lineEndY) > nodeBounds.bottom) {
      return false;
    }

    // Helper function to check line segment intersection
    const lineIntersects = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): boolean => {
      const den = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
      if (den === 0) return false;

      const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / den;
      const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / den;

      return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
    };

    // Check against each edge of the rectangle
    if (lineIntersects(lineStartX, lineStartY, lineEndX, lineEndY,
        nodeBounds.left, nodeBounds.top, nodeBounds.right, nodeBounds.top) ||
      lineIntersects(lineStartX, lineStartY, lineEndX, lineEndY,
        nodeBounds.right, nodeBounds.top, nodeBounds.right, nodeBounds.bottom) ||
      lineIntersects(lineStartX, lineStartY, lineEndX, lineEndY,
        nodeBounds.right, nodeBounds.bottom, nodeBounds.left, nodeBounds.bottom) ||
      lineIntersects(lineStartX, lineStartY, lineEndX, lineEndY,
        nodeBounds.left, nodeBounds.bottom, nodeBounds.left, nodeBounds.top)) {
      return true;
    }

    // Special case: line is completely inside node
    if (lineStartX >= nodeBounds.left && lineStartX <= nodeBounds.right &&
      lineStartY >= nodeBounds.top && lineStartY <= nodeBounds.bottom &&
      lineEndX >= nodeBounds.left && lineEndX <= nodeBounds.right &&
      lineEndY >= nodeBounds.top && lineEndY <= nodeBounds.bottom) {
      return true;
    }

    return false;
  };

  // Find and fix edge-node clashes
  let madeChanges = true;
  let iterationCount = 0;
  const maxIterations = 5;

  while (madeChanges && iterationCount < maxIterations) {
    madeChanges = false;
    iterationCount++;

    // For each edge
    edges.forEach(edge => {
      // For each node (that is not part of this edge)
      Object.keys(nodeMap).forEach(nodeId => {
        if (checkObstacles(edge, nodeId)) {
          const node = nodeMap[nodeId];
          const sourceCenterX = edgePathMap[edge.id].sourceCenterX;
          const sourceCenterY = edgePathMap[edge.id].sourceCenterY;
          const targetCenterX = edgePathMap[edge.id].targetCenterX;
          const targetCenterY = edgePathMap[edge.id].targetCenterY;

          // Determine displacement direction - perpendicular to the edge
          const edgeVectorX = targetCenterX - sourceCenterX;
          const edgeVectorY = targetCenterY - sourceCenterY;
          const edgeLength = Math.sqrt(edgeVectorX * edgeVectorX + edgeVectorY * edgeVectorY);

          // Perpendicular vector
          let perpVectorX = -edgeVectorY / edgeLength;
          let perpVectorY = edgeVectorX / edgeLength;

          // Calculate closest point on edge to node center
          const nodeCenterX = node.bounds.left + (node.bounds.right - node.bounds.left) / 2;
          const nodeCenterY = node.bounds.top + (node.bounds.bottom - node.bounds.top) / 2;

          // Make perpendicular vector point away from the edge
          const dotProduct = perpVectorX * (nodeCenterX - sourceCenterX) +
            perpVectorY * (nodeCenterY - sourceCenterY);
          if (dotProduct < 0) {
            perpVectorX = -perpVectorX;
            perpVectorY = -perpVectorY;
          }

          // Move node perpendicular to the edge
          const displacementAmount = 120;

          // Find the node in fixedNodes and update its position
          const nodeIndex = fixedNodes.findIndex(n => n.id === nodeId);
          if (nodeIndex >= 0) {
            fixedNodes[nodeIndex].position.x += perpVectorX * displacementAmount;
            fixedNodes[nodeIndex].position.y += perpVectorY * displacementAmount;

            // Update nodeMap for next iteration
            nodeMap[nodeId].position = fixedNodes[nodeIndex].position;
            nodeMap[nodeId].bounds = {
              left: fixedNodes[nodeIndex].position.x,
              top: fixedNodes[nodeIndex].position.y,
              right: fixedNodes[nodeIndex].position.x + (node.bounds.right - node.bounds.left),
              bottom: fixedNodes[nodeIndex].position.y + (node.bounds.bottom - node.bounds.top)
            };

            madeChanges = true;
          }
        }
      });
    });
  }

  // Final step: Make sure diamond nodes have proper space for branches
  const diamondNodes = fixedNodes.filter(node =>
    node.data?.stepType === 'IfCondition' ||
    node.data?.stepType === 'IfElseCondition' ||
    (typeof node.data?.className === 'string' && node.data.className.includes('diamond')) ||
    (node.data?.bgColor === '#f5e8d5')
  );

  diamondNodes.forEach(diamond => {
    // Find outgoing edges
    const outEdges = edges.filter(edge => edge.source === diamond.id);

    // If this diamond has multiple outgoing edges
    if (outEdges.length > 1) {
      // Get target nodes
      const targetNodes = outEdges
        .map(edge => fixedNodes.find(node => node.id === edge.target))
        .filter((node): node is Node => node !== undefined);

      // If we have multiple targets, ensure they have vertical separation
      if (targetNodes.length > 1) {
        // Sort targets by vertical position
        targetNodes.sort((a, b) => a.position.y - b.position.y);

        // Ensure minimum vertical spacing of 300px between targets of a diamond
        const minSpace = 300;
        for (let i = 1; i < targetNodes.length; i++) {
          const prevNode = targetNodes[i-1];
          const currNode = targetNodes[i];

          if (currNode.position.y - prevNode.position.y < minSpace) {
            // Move current node down to maintain minimum spacing
            currNode.position.y = prevNode.position.y + minSpace;
          }
        }
      }
    }
  });

  return fixedNodes;
}
