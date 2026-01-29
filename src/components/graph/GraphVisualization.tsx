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
  updatePositions,
  setupNodeHoverHighlight,
} from "./graphUtils";

interface GraphVisualizationProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width?: number;
  height?: number;
  colorMap?: Record<string, string>;
  onNodeClick?: (node: GraphNode) => void;
  className?: string;
}

export function GraphVisualization({
  nodes,
  edges,
  width = 800,
  height = 600,
  colorMap,
  onNodeClick,
  className = "",
}: GraphVisualizationProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simulationRef = useRef<d3.Simulation<D3Node, D3Link> | null>(null);

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

    // Convert to D3 nodes and filter valid links
    const d3Nodes: D3Node[] = nodes.map(node => ({ ...node }));
    const d3Links: D3Link[] = edges.map(edge => ({ ...edge }));
    const nodeIds = new Set(d3Nodes.map(n => n.id));
    const validLinks = filterValidLinks(d3Links, nodeIds);

    // Create force simulation
    const simulation = d3.forceSimulation<D3Node>(d3Nodes)
      .force("link", d3.forceLink<D3Node, D3Link>(validLinks).id(d => d.id).distance(120))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(30));

    simulationRef.current = simulation;

    // Create drag behavior
    const dragBehavior = d3.drag<SVGGElement, D3Node>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    // Create links and nodes
    const link = createLinkElements(container, validLinks);
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

  return (
    <svg
      ref={svgRef}
      className={`w-full ${className}`}
      style={{ height: `${height}px` }}
    />
  );
}
