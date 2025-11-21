import dagre from "@dagrejs/dagre";
import { Node, Edge, Position } from "@xyflow/react";
import type { LayoutConfig, LayoutResult } from "../types";

export function getLayoutedElements(nodes: Node[], edges: Edge[], config: LayoutConfig): LayoutResult {
  const { nodeWidth, nodeHeight, direction = "TB", ranksep = 100, nodesep = 50 } = config;

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, ranksep, nodesep });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
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

  return { nodes: layoutedNodes, edges };
}
