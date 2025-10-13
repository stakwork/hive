"use client";

import * as d3 from "d3";
import { useEffect, useRef } from "react";

interface GraphNode {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

interface GraphEdge {
  source: string;
  target: string;
  [key: string]: unknown;
}

interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  source: string | D3Node;
  target: string | D3Node;
  [key: string]: unknown;
}

interface GraphVisualizationProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width?: number;
  height?: number;
  colorMap?: Record<string, string>;
  onNodeClick?: (node: GraphNode) => void;
  className?: string;
}

const DEFAULT_COLORS: Record<string, string> = {
  Hint: "#3b82f6",
  Prompt: "#10b981",
  File: "#f59e0b",
  Function: "#8b5cf6",
  Endpoint: "#ef4444",
  Datamodel: "#06b6d4",
  Learning: "#ec4899",
  Task: "#84cc16",
  UserStory: "#f97316",
};

const getNodeColor = (type: string, colorMap?: Record<string, string>): string => {
  const colors = colorMap || DEFAULT_COLORS;
  return colors[type] || "#6b7280";
};

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

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        container.attr("transform", event.transform);
      });

    svg.call(zoom as any);

    // Restore previous zoom/pan state
    try {
      (svg as any).call(zoom.transform, previousTransform);
    } catch (e) {
      // Ignore if transform can't be reapplied
    }

    // Convert to D3 nodes
    const d3Nodes: D3Node[] = nodes.map(node => ({ ...node }));
    const d3Links: D3Link[] = edges.map(edge => ({ ...edge }));

    // Filter valid links
    const nodeIds = new Set(d3Nodes.map(n => n.id));
    const validLinks = d3Links.filter(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      return nodeIds.has(sourceId) && nodeIds.has(targetId);
    });

    // Create force simulation
    const simulation = d3.forceSimulation<D3Node>(d3Nodes)
      .force("link", d3.forceLink<D3Node, D3Link>(validLinks).id(d => d.id).distance(120))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(30));

    simulationRef.current = simulation;

    // Create links
    const link = container.append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(validLinks)
      .enter()
      .append("line")
      .attr("stroke", "#999")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", 1.5);

    // Create node groups
    const node = container.append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(d3Nodes)
      .enter()
      .append("g")
      .style("cursor", onNodeClick ? "pointer" : "grab")
      .call(d3.drag<SVGGElement, D3Node>()
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
        }));

    // Add click handler if provided
    if (onNodeClick) {
      node.on("click", (event, d) => {
        event.stopPropagation();
        onNodeClick(d as GraphNode);
      });
    }

    // Add circles
    node.append("circle")
      .attr("r", 12)
      .attr("fill", d => getNodeColor(d.type, colorMap))
      .attr("stroke", "#fff")
      .attr("stroke-width", 2)
      .style("filter", "drop-shadow(1px 1px 2px rgba(0,0,0,0.2))");

    // Add node labels
    node.append("text")
      .text(d => d.name.length > 20 ? `${d.name.slice(0, 20)}...` : d.name)
      .attr("x", 0)
      .attr("y", -18)
      .attr("text-anchor", "middle")
      .attr("font-size", "11px")
      .attr("font-weight", "500")
      .attr("fill", "currentColor")
      .style("pointer-events", "none");

    // Add type labels
    node.append("text")
      .text(d => d.type)
      .attr("x", 0)
      .attr("y", 25)
      .attr("text-anchor", "middle")
      .attr("font-size", "9px")
      .attr("fill", "#666")
      .style("pointer-events", "none");

    // Update positions on simulation tick
    simulation.on("tick", () => {
      link
        .attr("x1", d => (d.source as D3Node).x!)
        .attr("y1", d => (d.source as D3Node).y!)
        .attr("x2", d => (d.target as D3Node).x!)
        .attr("y2", d => (d.target as D3Node).y!);

      node.attr("transform", d => `translate(${d.x},${d.y})`);
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
