"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import * as d3 from "d3";
import { useEffect, useRef, useState } from "react";

// --- TYPE DEFINITIONS ---
interface GraphNode {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

interface ApiResponse {
  success: boolean;
  data?: {
    nodes?: GraphNode[];
    edges?: { source: string; target: string;[key: string]: unknown }[];
  };
}

interface SchemaResponse {
  success: boolean;
  data?: SchemaNode[];
}

interface SchemaNode {
  node_type: string;
  description: string;
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

// --- HELPER FUNCTION ---
const getNodeColor = (type: string): string => {
  const colorMap: Record<string, string> = {
    Service: "#3b82f6", Gateway: "#10b981", Storage: "#f59e0b",
    Cache: "#8b5cf6", Queue: "#ef4444", Engine: "#06b6d4",
    Function: "#6366f1",
  };
  return colorMap[type] || "#6b7280";
};

export const GraphComponent = () => {
  const { id: workspaceId } = useWorkspace();
  const [nodes, setNodes] = useState<D3Node[]>([]);
  const [links, setLinks] = useState<D3Link[]>([]);
  const [schemas, setSchemas] = useState<SchemaNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<D3Node, D3Link> | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [selectedSchema, setSelectedSchema] = useState<string | null>(null);

  console.log('workspaceId', workspaceId)

  // Ensure component only renders on the client to avoid hydration errors
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Load schemas initially
  useEffect(() => {
    const fetchSchemas = async () => {
      setLoading(true);
      setError(null);
      try {
        console.log(workspaceId)
        const response = await fetch(`/api/swarm/stakgraph/schema?id=${workspaceId}`);
        const data: SchemaResponse = await response.json();

        if (!data.success) {
          throw new Error("Failed to fetch schema data");
        }

        if (data.data && data.data.length > 0) {
          setSchemas(data.data);
        }
      } catch (err) {
        console.log(err)
        setError("Failed to load schemas");
      } finally {
        setLoading(false);
      }
    };

    if (workspaceId) {
      fetchSchemas();
    }
  }, [workspaceId]);

  // Load nodes based on selected schema
  useEffect(() => {
    const fetchNodes = async () => {
      if (!selectedSchema) return;

      setNodesLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/swarm/stakgraph/nodes?id=${workspaceId}&node_type=${selectedSchema}`);
        const data: ApiResponse = await response.json();

        if (!data.success) {
          throw new Error("Failed to fetch nodes data");
        }

        if (data.data?.nodes && data.data.nodes.length > 0) {
          setNodes(data.data.nodes.map(node => ({
            ...node,
            id: (node as any).ref_id,
            type: (node as any).node_type as string,
            name: (node as any)?.properties?.name as string
          })) as D3Node[]);
          setLinks(data.data.edges as D3Link[] || []);
        } else {
          setNodes([]);
          setLinks([]);
        }
      } catch (err) {
        console.log(err)
        setError("Failed to load nodes");
        setNodes([]);
        setLinks([]);
      } finally {
        setNodesLoading(false);
      }
    };

    fetchNodes();
  }, [workspaceId, selectedSchema]);

  // Initialize D3 force simulation with zoom and pan
  useEffect(() => {
    // Wait until we're on the client, the svg ref is ready, and we have data
    if (!isClient || !svgRef.current || nodes.length === 0 || nodesLoading) return;

    const svg = d3.select(svgRef.current);
    const width = 800;
    const height = 500;
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    svg.selectAll("*").remove(); // Clear previous render

    // Create a container group for all graph elements (this will be transformed on zoom/pan)
    const container = svg.append("g").attr("class", "graph-container");

    // Set up zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 10])
      .on("zoom", (event) => {
        container.attr("transform", event.transform);
      });

    // Apply zoom behavior to svg
    svg.call(zoom);

    const simulation = d3.forceSimulation<D3Node>(nodes)
      .force("link", d3.forceLink<D3Node, D3Link>(links).id(d => d.id).distance(100).strength(0.5))
      .force("charge", d3.forceManyBody().strength(-300).distanceMax(300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(40).strength(0.7));

    simulationRef.current = simulation;

    // Add arrow markers to container (or defs)
    svg.append("defs").selectAll("marker")
      .data(["arrow"]).enter().append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 25).attr("refY", 0)
      .attr("markerWidth", 6).attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#999");

    // Add links to container
    const link = container.append("g").attr("class", "links")
      .selectAll("line").data(links).enter().append("line")
      .attr("stroke", "#999").attr("stroke-opacity", 0.6)
      .attr("stroke-width", 2).attr("marker-end", "url(#arrow)");

    // Add nodes to container
    const nodeGroup = container.append("g").attr("class", "nodes")
      .selectAll("g").data(nodes).enter().append("g")
      .attr("class", "node").style("cursor", "pointer")
      .call(d3.drag<SVGGElement, D3Node>()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x; d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null; d.fy = null;
        }));

    nodeGroup.append("circle").attr("r", 20)
      .attr("fill", d => getNodeColor(d.type))
      .attr("stroke", "#fff").attr("stroke-width", 2)
      .style("filter", "drop-shadow(2px 2px 4px rgba(0,0,0,0.1))");

    nodeGroup.append("text")
      .text(d => d.name.length > 10 ? `${d.name.slice(0, 10)}...` : d.name)
      .attr("x", 0).attr("y", -25).attr("text-anchor", "middle")
      .attr("font-size", "12px").attr("font-weight", "500")
      .attr("fill", "#333").style("pointer-events", "none");

    nodeGroup.append("text").text(d => d.type)
      .attr("x", 0).attr("y", 35).attr("text-anchor", "middle")
      .attr("font-size", "10px").attr("fill", "#666")
      .style("pointer-events", "none");

    simulation.on("tick", () => {
      link
        .attr("x1", d => (d.source as D3Node).x!).attr("y1", d => (d.source as D3Node).y!)
        .attr("x2", d => (d.target as D3Node).x!).attr("y2", d => (d.target as D3Node).y!);
      nodeGroup.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    // Store zoom behavior for reset function
    const svgNode = svg.node() as SVGSVGElement & { zoom?: d3.ZoomBehavior<SVGSVGElement, unknown> };
    if (svgNode) {
      svgNode.zoom = zoom;
    }

    return () => {
      simulation.stop();
    };
  }, [nodes, links, nodesLoading, isClient]);

  if (loading || !isClient) {
    return (
      <div className="flex h-96 items-center justify-center border rounded-lg bg-gray-50">
        <div className="text-lg text-gray-600">Loading schemas...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-96 items-center justify-center border rounded-lg bg-red-50">
        <div className="text-lg text-red-600">Error: {error}</div>
      </div>
    );
  }

  if (schemas.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center border rounded-lg bg-gray-50">
        <div className="text-lg text-gray-600">No schemas available</div>
      </div>
    );
  }

  const nodeTypes = Array.from(new Set(nodes.map(node => node.type)));

  const resetSimulation = () => {
    if (simulationRef.current) {
      simulationRef.current.alpha(1).restart();
    }
  };

  const resetZoom = () => {
    if (svgRef.current) {
      const svg = d3.select(svgRef.current);
      const svgNode = svg.node() as SVGSVGElement & { zoom?: d3.ZoomBehavior<SVGSVGElement, unknown> };
      const zoom = svgNode?.zoom;
      if (zoom) {
        svg.transition().duration(750).call(
          zoom.transform,
          d3.zoomIdentity
        );
      }
    }
  };

  const zoomIn = () => {
    if (svgRef.current) {
      const svg = d3.select(svgRef.current);
      const svgNode = svg.node() as SVGSVGElement & { zoom?: d3.ZoomBehavior<SVGSVGElement, unknown> };
      const zoom = svgNode?.zoom;
      if (zoom) {
        svg.transition().duration(300).call(
          zoom.scaleBy,
          1.5
        );
      }
    }
  };

  const zoomOut = () => {
    if (svgRef.current) {
      const svg = d3.select(svgRef.current);
      const svgNode = svg.node() as SVGSVGElement & { zoom?: d3.ZoomBehavior<SVGSVGElement, unknown> };
      const zoom = svgNode?.zoom;
      if (zoom) {
        svg.transition().duration(300).call(
          zoom.scaleBy,
          1 / 1.5
        );
      }
    }
  };

  return (
    <div className="h-auto w-full border rounded-lg bg-white p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Stakgraph Visualization</h3>
        <div className="flex items-center gap-2">
          {selectedSchema && (
            <>
              <div className="flex items-center gap-1 border rounded-md">
                <button onClick={zoomIn} className="px-2 py-1 text-sm hover:bg-gray-100 transition-colors" title="Zoom In">
                  +
                </button>
                <button onClick={zoomOut} className="px-2 py-1 text-sm hover:bg-gray-100 transition-colors border-x" title="Zoom Out">
                  −
                </button>
                <button onClick={resetZoom} className="px-2 py-1 text-sm hover:bg-gray-100 transition-colors" title="Reset Zoom">
                  ⌂
                </button>
              </div>
              <button onClick={resetSimulation} className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors">
                Reset Layout
              </button>
              <div className="text-sm text-gray-500">
                {nodes.length} nodes • {links.length} connections
              </div>
            </>
          )}
        </div>
      </div>

      {/* Schema Selection */}
      <div className="mb-4">
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-gray-700">Select Schema:</label>
          <select
            value={selectedSchema || ""}
            onChange={(e) => setSelectedSchema(e.target.value || null)}
            className="px-3 py-1 border rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">-- Select a schema --</option>
            {schemas.map((schema) => (
              <option key={schema.node_type} value={schema.node_type}>
                {schema.node_type} - {schema.description}
              </option>
            ))}
          </select>
          {nodesLoading && (
            <div className="text-sm text-gray-500">Loading nodes...</div>
          )}
        </div>
      </div>

      {nodeTypes.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-4 text-sm">
          <span className="font-medium text-gray-700">Types:</span>
          {nodeTypes.map(type => (
            <div key={type} className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: getNodeColor(type) }} />
              <span className="text-gray-600">{type}</span>
            </div>
          ))}
        </div>
      )}

      <div className="border rounded bg-gray-50 overflow-hidden">
        {!selectedSchema ? (
          <div className="flex h-96 items-center justify-center">
            <div className="text-lg text-gray-600">Please select a schema to view the graph</div>
          </div>
        ) : nodesLoading ? (
          <div className="flex h-96 items-center justify-center">
            <div className="text-lg text-gray-600">Loading nodes...</div>
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex h-96 items-center justify-center">
            <div className="text-lg text-gray-600">No nodes found for selected schema</div>
          </div>
        ) : (
          <svg ref={svgRef} className="w-full h-auto" />
        )}
      </div>

      {selectedSchema && nodes.length > 0 && (
        <div className="mt-4 text-sm text-gray-600">
          <p><strong>Instructions:</strong> Drag nodes to reposition them. Use mouse wheel to zoom, drag canvas to pan, or use the zoom controls above.</p>
        </div>
      )}
    </div>
  );
};
