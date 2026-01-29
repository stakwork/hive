import * as d3 from "d3";

export interface GraphNode {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

export interface GraphEdge {
  source: string;
  target: string;
  [key: string]: unknown;
}

export interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  type: string;
  layer?: number;
  [key: string]: unknown;
}

export interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  source: string | D3Node;
  target: string | D3Node;
  [key: string]: unknown;
}

export const DEFAULT_COLORS: Record<string, string> = {
  // Original types
  Hint: "#3b82f6",
  Prompt: "#10b981",
  File: "#f59e0b",
  Function: "#8b5cf6",
  Endpoint: "#ef4444",
  Datamodel: "#06b6d4",
  Request: "#ec4899",
  Learning: "#84cc16",
  Task: "#f97316",

  // Repository & Package structure
  Repository: "#1e40af",
  Package: "#0891b2",
  Language: "#0d9488",
  Directory: "#f59e0b",

  // Code organization
  Import: "#7c3aed",
  Library: "#9333ea",
  Class: "#a855f7",
  Trait: "#c084fc",
  Instance: "#d8b4fe",

  // Features & Pages
  Feature: "#059669",
  Page: "#10b981",
  Var: "#34d399",

  // Test types (similar colors - shades of amber/yellow)
  UnitTest: "#fbbf24",
  IntegrationTest: "#f59e0b",
  E2eTest: "#f97316",
};

export const getNodeColor = (type: string, colorMap?: Record<string, string>): string => {
  const colors = colorMap || DEFAULT_COLORS;
  return colors[type] || "#6b7280";
};

export const filterValidLinks = (
  links: D3Link[],
  nodeIds: Set<string>
): D3Link[] => {
  return links.filter(link => {
    const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
    const targetId = typeof link.target === 'string' ? link.target : link.target.id;
    return nodeIds.has(sourceId) && nodeIds.has(targetId);
  });
};

export const setupZoom = (
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  container: d3.Selection<SVGGElement, unknown, null, undefined>,
  previousTransform: d3.ZoomTransform
): void => {
  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 4])
    .on("zoom", (event) => {
      container.attr("transform", event.transform);
    });

   
  svg.call(zoom as any);

  // Restore previous zoom/pan state
  try {
     
    (svg as any).call(zoom.transform, previousTransform);
  } catch {
    // Ignore if transform can't be reapplied
  }
};

export const createNodeElements = (
  container: d3.Selection<SVGGElement, unknown, null, undefined>,
  nodes: D3Node[],
  colorMap: Record<string, string> | undefined,
  onNodeClick: ((node: GraphNode) => void) | undefined,
  dragBehavior: d3.DragBehavior<SVGGElement, D3Node, unknown>
): d3.Selection<SVGGElement, D3Node, SVGGElement, unknown> => {
  const node = container.append("g")
    .attr("class", "nodes")
    .selectAll("g")
    .data(nodes)
    .enter()
    .append("g")
    .style("cursor", onNodeClick ? "pointer" : "grab")
    .call(dragBehavior);

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

  return node;
};

export const createLinkElements = (
  container: d3.Selection<SVGGElement, unknown, null, undefined>,
  links: D3Link[],
  withArrows = false
): d3.Selection<SVGLineElement, D3Link, SVGGElement, unknown> => {
  const link = container.append("g")
    .attr("class", "links")
    .selectAll("line")
    .data(links)
    .enter()
    .append("line")
    .attr("stroke", "#999")
    .attr("stroke-opacity", 0.6)
    .attr("stroke-width", 1.5);

  if (withArrows) {
    link.attr("marker-end", "url(#arrowhead)");
  }

  return link;
};

export const addArrowMarker = (
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>
): void => {
  svg.append("defs").append("marker")
    .attr("id", "arrowhead")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 20)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "#999");
};

export const updatePositions = (
  link: d3.Selection<SVGLineElement, D3Link, SVGGElement, unknown>,
  node: d3.Selection<SVGGElement, D3Node, SVGGElement, unknown>
): void => {
  link
    .attr("x1", d => (d.source as D3Node).x!)
    .attr("y1", d => (d.source as D3Node).y!)
    .attr("x2", d => (d.target as D3Node).x!)
    .attr("y2", d => (d.target as D3Node).y!);

  node.attr("transform", d => `translate(${d.x},${d.y})`);
};

export const getConnectedNodeIds = (
  nodeId: string,
  links: D3Link[]
): Set<string> => {
  const connected = new Set<string>();

  // Find all nodes connected to this node (both as source and target)
  links.forEach(link => {
    const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
    const targetId = typeof link.target === 'string' ? link.target : link.target.id;

    if (sourceId === nodeId) {
      connected.add(targetId);
    }
    if (targetId === nodeId) {
      connected.add(sourceId);
    }
  });

  return connected;
};

export const setupNodeHoverHighlight = (
  node: d3.Selection<SVGGElement, D3Node, SVGGElement, unknown>,
  link: d3.Selection<SVGLineElement, D3Link, SVGGElement, unknown>,
  links: D3Link[]
): void => {
  node
    .on("mouseenter", function(_, d) {
      const hoveredId = d.id;
      const connectedIds = getConnectedNodeIds(hoveredId, links);

      // Dim all nodes except hovered and connected
      node.style("opacity", n => {
        if (n.id === hoveredId || connectedIds.has(n.id)) {
          return 1;
        }
        return 0.3;
      });

      // Dim all links except those connected to hovered node
      link.style("opacity", l => {
        const sourceId = typeof l.source === 'string' ? l.source : l.source.id;
        const targetId = typeof l.target === 'string' ? l.target : l.target.id;

        if (sourceId === hoveredId || targetId === hoveredId) {
          return 1;
        }
        return 0.15;
      });
    })
    .on("mouseleave", function() {
      // Reset all opacities
      node.style("opacity", 1);
      link.style("opacity", 0.6);
    });
};
