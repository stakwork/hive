// layoutUtils.js
import ELK from 'elkjs/lib/elk.bundled.js';

// Create ELK instance
const elk = new ELK();

/**
 * Smart layout function that prevents overlaps and edge-node clashes
 * @param {Array} nodes - ReactFlow nodes
 * @param {Array} edges - ReactFlow edges
 * @returns {Promise<Array>} - Positioned nodes without overlaps
 */
export const smartLayout = async (nodes, edges) => {
  console.log('Applying smart layout with edge-node clash prevention...');

  // Clone nodes to avoid modifying originals
  const nodesCopy = JSON.parse(JSON.stringify(nodes));

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

/**
 * Apply basic ELK layout with generous spacing
 */
async function applyBasicLayout(nodes, edges) {
  // Identify special nodes
  const diamondNodes = nodes.filter(node =>
    node.data?.stepType === 'IfCondition' ||
    node.data?.stepType === 'IfElseCondition' ||
    (node.data?.className && node.data.className.includes('diamond')) ||
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
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '350',          // Increase spacing between nodes
      'elk.layered.spacing.nodeNodeBetweenLayers': '300', // Increase spacing between layers
      'elk.spacing.edgeEdge': '180',          // Increase spacing between parallel edges
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.edgeRouting': 'ORTHOGONAL',       // Use orthogonal edge routing
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.aspectRatio': '2.0',              // Wider than tall
      'elk.padding': '[top=80, left=80, bottom=80, right=80]', // Increased padding
      'elk.edgeLabels.inline': 'true',       // Inline edge labels to avoid overlaps
      'elk.layered.spacing.edgeNodeBetweenLayers': '150', // IMPORTANT: Spacing between edges and nodes in different layers
      'elk.layered.spacing.edgeNode': '100',  // IMPORTANT: Spacing between edges and nodes in same layer
      'elk.layered.mergeEdges': 'true',      // Merge edges where possible to reduce congestion
      'elk.layered.thoroughness': '10',      // High thoroughness for better quality layout
    },
    children: nodes.map(node => {
      // Determine if this is a special node type
      const isDiamond = diamondNodes.some(n => n.id === node.id);
      const isStart = startNodes.some(n => n.id === node.id);
      const isEnd = endNodes.some(n => n.id === node.id);

      // Set width and height based on node type (with increased sizes)
      const width = node?.data?.width || (isDiamond ? 170 : 200);
      const height = node?.data?.height || (isDiamond ? 170 : 120);

      // Node-specific layout options
      const nodeOptions = {};

      if (isStart) {
        // Pin start nodes to the left
        nodeOptions['elk.layered.layering.layerConstraint'] = 'FIRST';
      }

      if (isEnd) {
        // Pin end nodes to the right
        nodeOptions['elk.layered.layering.layerConstraint'] = 'LAST';
      }

      if (isDiamond) {
        // Give diamonds extra padding
        nodeOptions['elk.padding'] = '[top=80, left=80, bottom=80, right=80]';
        // Diamonds should have more influence on port placement for better edge routing
        nodeOptions['elk.portConstraints'] = 'FREE';
      }

      return {
        id: node.id,
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
        'elk.edgeRouting': 'ORTHOGONAL', // Ensure orthogonal edge routing
        'elk.layered.feedbackEdges': 'true', // Handle feedback edges
      }
    })),
  };

  // Run ELK layout
  const layoutedGraph = await elk.layout(elkGraph);

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

/**
 * Fix overlapping nodes by adjusting positions
 */
function fixNodeOverlaps(nodes) {
  // Make a copy of nodes
  const fixedNodes = [...nodes];
  // Use generous node size with safety margin
  const nodeSize = { width: 250, height: 150 };

  // Iteratively fix overlaps until no more are found or max iterations reached
  let overlapsExist = true;
  let iterations = 0;
  const maxIterations = 10; // Prevent infinite loops

  while (overlapsExist && iterations < maxIterations) {
    let foundOverlap = false;
    iterations++;

    // Check each pair of nodes for overlaps
    for (let i = 0; i < fixedNodes.length; i++) {
      for (let j = i + 1; j < fixedNodes.length; j++) {
        const nodeA = fixedNodes[i];
        const nodeB = fixedNodes[j];

        // Calculate overlap with additional safety margin
        const safetyMargin = 30; // Extra pixels to ensure no overlap
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
          }
        }
      }
    }

    overlapsExist = foundOverlap;
  }

  return fixedNodes;
}

/**
 * Optimize edge paths to avoid node overlaps - greatly enhanced
 */
function optimizeEdgePaths(nodes, edges) {
  const fixedNodes = [...nodes];

  // Create a node map for quick lookup
  const nodeMap = {};
  fixedNodes.forEach(node => {
    nodeMap[node.id] = {
      ...node,
      // Add boundary information
      bounds: {
        left: node.position.x,
        top: node.position.y,
        right: node.position.x + (node.data?.width || 200),
        bottom: node.position.y + (node.data?.height || 120)
      }
    };
  });

  // First pass: Identify problem edges that might cross nodes
  const edgePathMap = {};
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
  const checkObstacles = (edge, nodeId) => {
    const edgePath = edgePathMap[edge.id];
    if (!edgePath) return false;

    // Skip source and target nodes of this edge
    if (nodeId === edge.source || nodeId === edge.target) return false;

    const node = nodeMap[nodeId];
    if (!node) return false;

    // Check if line intersects node rectangle
    // This is a simplified line-rectangle intersection check
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

    // Simple bounding box check first - is edge completely outside node's extended bounds?
    if (Math.max(lineStartX, lineEndX) < nodeBounds.left ||
      Math.min(lineStartX, lineEndX) > nodeBounds.right ||
      Math.max(lineStartY, lineEndY) < nodeBounds.top ||
      Math.min(lineStartY, lineEndY) > nodeBounds.bottom) {
      return false; // No clash possible
    }

    // Simplified line-rectangle intersection check
    // For each edge of the rectangle, check if the line intersects it

    // Helper function to check line segment intersection
    const lineIntersects = (x1, y1, x2, y2, x3, y3, x4, y4) => {
      // Calculate denominators
      const den = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
      if (den === 0) return false; // Lines are parallel

      // Calculate ua and ub
      const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / den;
      const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / den;

      // Check if intersection is on both line segments
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
      return true; // Edge intersects node
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
          // We found a clash! The edge goes through this node
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
          const displacementAmount = 120; // Large enough to avoid the edge

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
    (node.data?.className && node.data.className.includes('diamond')) ||
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
        .filter(Boolean);

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