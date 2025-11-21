"use client";

import * as d3 from "d3";
import { useEffect, useRef } from "react";
import {
  type GraphNode,
  type GraphEdge,
  type D3Node,
  type D3Link,
  filterValidLinks,
  setupZoom,
  createNodeElements,
  createLinkElements,
  addArrowMarker,
  updatePositions,
  setupNodeHoverHighlight,
} from "./graphUtils";

interface GraphVisualizationLayeredProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width?: number;
  height?: number;
  colorMap?: Record<string, string>;
  onNodeClick?: (node: GraphNode) => void;
  className?: string;
}

// Define layer order: top to bottom
const LAYER_ORDER: Record<string, number> = {
  Episode: 0,
  Call: 0,
  Hint: 0,
  Prompt: 0,
  Video: 1,
  File: 1,
  Datamodel: 2,
  Function: 2,
  Endpoint: 2,
  Request: 2,
  Topic: 3,
};

const getNodeLayer = (type: string): number => {
  return LAYER_ORDER[type] ?? 3; // Default layer for unknown types
};

export function GraphVisualizationLayered({
  nodes,
  edges,
  width = 800,
  height = 600,
  colorMap,
  onNodeClick,
  className = "",
}: GraphVisualizationLayeredProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    // Save previous transform to preserve zoom/pan state
    const previousTransform = svg.node() ? d3.zoomTransform(svg.node() as Element) : d3.zoomIdentity;

    svg.selectAll("*").remove();

    const container = svg.append("g").attr("class", "graph-container");

    // Setup zoom and restore previous state
    setupZoom(svg, container, previousTransform);

    // Add arrow marker for directed edges
    addArrowMarker(svg);

    // Convert to D3 nodes with layer assignment
    const d3Nodes: D3Node[] = nodes.map((node) => ({
      ...node,
      layer: getNodeLayer(node.type),
    }));

    const d3Links: D3Link[] = edges.map((edge) => ({ ...edge }));
    const nodeIds = new Set(d3Nodes.map((n) => n.id));
    const validLinks = filterValidLinks(d3Links, nodeIds);

    // Group nodes by layer
    const nodesByLayer = d3.group(d3Nodes, (d) => d.layer ?? 0);
    const layers = Array.from(nodesByLayer.keys()).sort((a, b) => (a ?? 0) - (b ?? 0));
    const layerHeight = height / (layers.length + 1);

    // Set initial positions for nodes based on layer
    d3Nodes.forEach((node) => {
      const layer = node.layer ?? 0;
      const nodesInLayer = nodesByLayer.get(layer) || [];
      const indexInLayer = nodesInLayer.indexOf(node);
      const layerWidth = width / (nodesInLayer.length + 1);

      node.x = layerWidth * (indexInLayer + 1);
      node.y = layerHeight * (layer + 1);
    });

    // Create force simulation with layered constraints
    const simulation = d3
      .forceSimulation<D3Node>(d3Nodes)
      .force(
        "link",
        d3
          .forceLink<D3Node, D3Link>(validLinks)
          .id((d) => d.id)
          .distance(100)
          .strength(0.5),
      )
      .force("charge", d3.forceManyBody().strength(-200))
      .force("collision", d3.forceCollide().radius(40))
      .force(
        "y",
        d3
          .forceY<D3Node>((d) => {
            const layer = d.layer ?? 0;
            return layerHeight * (layer + 1);
          })
          .strength(0.8),
      ) // Strong Y force to keep nodes in their layers
      .force("x", d3.forceX<D3Node>(width / 2).strength(0.05)); // Weak X force for centering

    // Create drag behavior (keeps nodes locked to layer)
    const dragBehavior = d3
      .drag<SVGGElement, D3Node>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        // Keep locked to layer Y position
        const layer = d.layer ?? 0;
        const targetY = layerHeight * (layer + 1);
        d.fy = targetY;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    // Create links and nodes
    const link = createLinkElements(container, validLinks, true);
    const node = createNodeElements(container, d3Nodes, colorMap, onNodeClick, dragBehavior);

    // Setup hover highlighting
    setupNodeHoverHighlight(node, link, validLinks);

    // Update positions on simulation tick
    simulation.on("tick", () => {
      updatePositions(link, node);
    });

    return () => {
      simulation.stop();
      svg.on(".zoom", null);
    };
  }, [nodes, edges, width, height, colorMap, onNodeClick]);

  return <svg ref={svgRef} className={`w-full ${className}`} style={{ height: `${height}px` }} />;
}
