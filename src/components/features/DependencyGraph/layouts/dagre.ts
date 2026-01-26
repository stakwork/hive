import dagre from "@dagrejs/dagre";
import { Node, Edge, Position } from "@xyflow/react";
import type { LayoutConfig, LayoutResult } from "../types";
import { detectCollisions } from "./collisionDetection";

const MAX_LAYOUT_ATTEMPTS = 5;
const RANKSEP_INCREMENT = 100;
const NODESEP_INCREMENT = 75;

export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  config: LayoutConfig
): LayoutResult {
  const {
    nodeWidth,
    nodeHeight,
    direction = "TB",
    ranksep: initialRanksep = 200,
    nodesep: initialNodesep = 100,
  } = config;

  let currentRanksep = initialRanksep;
  let currentNodesep = initialNodesep;
  let layoutedNodes: Node[] = [];
  let attempt = 0;

  // Retry loop with increasing spacing on collision detection
  while (attempt < MAX_LAYOUT_ATTEMPTS) {
    attempt++;

    // Create and configure dagre graph
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({
      rankdir: direction,
      ranksep: currentRanksep,
      nodesep: currentNodesep,
    });

    // Add nodes to graph
    nodes.forEach((node) => {
      dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });

    // Add edges to graph
    edges.forEach((edge) => {
      dagreGraph.setEdge(edge.source, edge.target);
    });

    // Perform layout
    dagre.layout(dagreGraph);

    // Extract layouted node positions
    layoutedNodes = nodes.map((node) => {
      const nodeWithPosition = dagreGraph.node(node.id);
      return {
        ...node,
        targetPosition: direction === "LR" ? Position.Left : Position.Top,
        sourcePosition: direction === "LR" ? Position.Right : Position.Bottom,
        position: {
          x: nodeWithPosition.x - nodeWidth / 2,
          y: nodeWithPosition.y - nodeHeight / 2,
        },
      };
    });

    // Check for collisions
    const collisionResult = detectCollisions(
      layoutedNodes,
      nodeWidth,
      nodeHeight,
      50 // minSpacing for collision detection (buffer on each side)
    );

    // If no collisions, return the result
    if (!collisionResult.hasCollisions) {
      return { nodes: layoutedNodes, edges };
    }

    // If this was the last attempt, log warning and return anyway
    if (attempt >= MAX_LAYOUT_ATTEMPTS) {
      console.warn(
        `[DagreLayout] Max layout attempts (${MAX_LAYOUT_ATTEMPTS}) reached with ${collisionResult.collisions.length} collision(s) still present:`,
        collisionResult.collisions.map(
          (c) => `${c.nodeA} <-> ${c.nodeB}: ${c.details}`
        )
      );
      return { nodes: layoutedNodes, edges };
    }

    // Increase spacing for next attempt
    currentRanksep += RANKSEP_INCREMENT;
    currentNodesep += NODESEP_INCREMENT;
  }

  // This should never be reached, but TypeScript requires it
  return { nodes: layoutedNodes, edges };
}
