"use client";

import { useTheme } from "@/hooks/use-theme";
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

// --- COLOR PALETTE ---
const COLOR_PALETTE = [
  "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", 
  "#06b6d4", "#6366f1", "#ec4899", "#f97316", "#84cc16",
  "#64748b", "#0ea5e9", "#22c55e", "#a855f7", "#eab308"
];

// --- HELPER FUNCTIONS ---
const getNodeColor = (type: string, nodeTypes: string[]): string => {
  const index = nodeTypes.indexOf(type);
  if (index !== -1) {
    return COLOR_PALETTE[index % COLOR_PALETTE.length];
  }
  return "#6b7280"; // Default gray
};

const getConnectedNodeIds = (nodeId: string, links: D3Link[]): Set<string> => {
  const connectedIds = new Set<string>();
  links.forEach(link => {
    const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
    const targetId = typeof link.target === 'string' ? link.target : link.target.id;

    if (sourceId === nodeId) {
      connectedIds.add(targetId);
    } else if (targetId === nodeId) {
      connectedIds.add(sourceId);
    }
  });
  return connectedIds;
};

// --- POPUP COMPONENT ---
interface NodePopupProps {
  node: D3Node;
  onClose: () => void;
  connectedNodes: D3Node[];
  isDarkMode?: boolean;
  nodeTypes: string[];
}

const NodePopup = ({ node, onClose, connectedNodes, isDarkMode = false, nodeTypes }: NodePopupProps) => {
  return (
    <div
      className={`absolute top-4 right-4 z-50 border rounded-lg shadow-lg p-4 w-80 ${isDarkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-300'}`}
      style={{
        maxHeight: '400px',
        overflowY: 'auto'
      }}
    >
      <div className="flex justify-between items-start mb-3">
        <h4 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{node.name}</h4>
        <button
          onClick={onClose}
          className={`text-xl leading-none ${isDarkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-400 hover:text-gray-600'}`}
        >
          ×
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div
            className="w-4 h-4 rounded-full"
            style={{ backgroundColor: getNodeColor(node.type, nodeTypes) }}
          />
          <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Type: {node.type}</span>
        </div>

        <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          <strong>ID:</strong> {node.id}
        </div>

        {Object.entries(node).map(([key, value]) => {
          if (['id', 'name', 'type', 'x', 'y', 'fx', 'fy', 'index', 'vx', 'vy'].includes(key)) {
            return null;
          }
          return (
            <div key={key} className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              <strong>{key}:</strong> {typeof value === 'object' ? JSON.stringify(value) : String(value)}
            </div>
          );
        })}

        {connectedNodes.length > 0 && (
          <div className="mt-3 pt-3 border-t">
            <h5 className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Connected Nodes ({connectedNodes.length})
            </h5>
            <div className="space-y-1">
              {connectedNodes.slice(0, 5).map(connectedNode => (
                <div key={connectedNode.id} className="flex items-center gap-2 text-sm">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: getNodeColor(connectedNode.type, nodeTypes) }}
                  />
                  <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>{connectedNode.name}</span>
                </div>
              ))}
              {connectedNodes.length > 5 && (
                <div className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                  ... and {connectedNodes.length - 5} more
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const GraphComponent = () => {
  const { id: workspaceId } = useWorkspace();
  const { theme, toggleTheme, mounted } = useTheme();
  const [nodes, setNodes] = useState<D3Node[]>([]);
  const [links, setLinks] = useState<D3Link[]>([]);
  const [schemas, setSchemas] = useState<SchemaNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<D3Node, D3Link> | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [selectedNode, setSelectedNode] = useState<D3Node | null>(null);

  // Determine if dark mode is active
  const isDarkMode = mounted && (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches));

  // Calculate node types for color mapping
  const nodeTypes = Array.from(new Set(nodes.map(node => node.type)));

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

      setNodesLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/swarm/stakgraph/nodes?id=${workspaceId}`);
        const data: ApiResponse = await response.json();

        console.log(data)

        if (!data.success) {
          throw new Error("Failed to fetch nodes data");
        }

        if (data.data?.nodes && data.data.nodes.length > 0) {
          setNodes(data.data.nodes.map(node => ({
            ...node,
            id: (node as any).ref_id || '',
            type: (node as any).node_type as string || '',
            name: (node as any)?.properties?.name as string || ''
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
  }, [workspaceId]);

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

    // Add click handler to clear selection when clicking on empty space
    svg.on("click", () => {
      setSelectedNode(null);
    });

    // Filter links to only include those where both source and target nodes exist
    const nodeIds = new Set(nodes.map(node => node.id));
    const validLinks = links.filter(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      return nodeIds.has(sourceId) && nodeIds.has(targetId);
    });

    const simulation = d3.forceSimulation<D3Node>(nodes)
      .force("link", d3.forceLink<D3Node, D3Link>(validLinks).id(d => d.id).distance(100).strength(0.5))
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
      .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", isDarkMode ? "#6b7280" : "#999");

    // Add links to container
    const link = container.append("g").attr("class", "links")
      .selectAll("line").data(validLinks).enter().append("line")
      .attr("stroke", isDarkMode ? "#6b7280" : "#999").attr("stroke-opacity", 0.6)
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
        }))
      .on("click", (event, d) => {
        event.stopPropagation();
        setSelectedNode(d);
      });

    const circles = nodeGroup.append("circle").attr("r", 20)
      .attr("fill", d => getNodeColor(d.type, nodeTypes))
      .attr("stroke", isDarkMode ? "#374151" : "#fff").attr("stroke-width", 2)
      .style("filter", isDarkMode ? "drop-shadow(2px 2px 4px rgba(0,0,0,0.3))" : "drop-shadow(2px 2px 4px rgba(0,0,0,0.1))");

    nodeGroup.append("text")
      .text(d => d.name.length > 10 ? `${d.name.slice(0, 10)}...` : d.name)
      .attr("x", 0).attr("y", -25).attr("text-anchor", "middle")
      .attr("font-size", "12px").attr("font-weight", "500")
      .attr("fill", isDarkMode ? "#f9fafb" : "#333").style("pointer-events", "none");

    nodeGroup.append("text").text(d => d.type)
      .attr("x", 0).attr("y", 35).attr("text-anchor", "middle")
      .attr("font-size", "10px").attr("fill", isDarkMode ? "#d1d5db" : "#666")
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
  }, [nodes, links, nodesLoading, isClient, isDarkMode, nodeTypes]);

  // Separate useEffect for handling highlighting when selectedNode changes
  useEffect(() => {
    if (!svgRef.current || !nodes.length) return;

    const svg = d3.select(svgRef.current);
    const circles = svg.selectAll("circle");
    const links = svg.selectAll("line");

    if (selectedNode) {
      const validLinks = links.data().filter((link: any) => {
        const nodeIds = new Set(nodes.map(node => node.id));
        const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
        const targetId = typeof link.target === 'string' ? link.target : link.target.id;
        return nodeIds.has(sourceId) && nodeIds.has(targetId);
      });

      const connectedIds = getConnectedNodeIds(selectedNode.id, validLinks);

      // Update node highlighting
      circles
        .attr("stroke-width", (d: any) => d.id === selectedNode.id ? 4 : 2)
        .attr("stroke", (d: any) => {
          if (d.id === selectedNode.id) return "#3b82f6";
          if (connectedIds.has(d.id)) return "#10b981";
          return isDarkMode ? "#374151" : "#fff";
        })
        .style("opacity", (d: any) => {
          if (d.id === selectedNode.id) return 1;
          if (connectedIds.has(d.id)) return 1;
          return 0.5;
        });

      // Update link highlighting
      links
        .attr("stroke", (d: any) => {
          const sourceId = typeof d.source === 'string' ? d.source : d.source.id;
          const targetId = typeof d.target === 'string' ? d.target : d.target.id;
          if ((sourceId === selectedNode.id) || (targetId === selectedNode.id)) {
            return "#3b82f6";
          }
          return isDarkMode ? "#6b7280" : "#999";
        })
        .attr("stroke-width", (d: any) => {
          const sourceId = typeof d.source === 'string' ? d.source : d.source.id;
          const targetId = typeof d.target === 'string' ? d.target : d.target.id;
          if ((sourceId === selectedNode.id) || (targetId === selectedNode.id)) {
            return 3;
          }
          return 2;
        })
        .style("opacity", (d: any) => {
          const sourceId = typeof d.source === 'string' ? d.source : d.source.id;
          const targetId = typeof d.target === 'string' ? d.target : d.target.id;
          if ((sourceId === selectedNode.id) || (targetId === selectedNode.id)) {
            return 1;
          }
          return 0.3;
        });
    } else {
      // Reset highlighting
      circles
        .attr("stroke-width", 2)
        .attr("stroke", isDarkMode ? "#374151" : "#fff")
        .style("opacity", 1);

      links
        .attr("stroke", isDarkMode ? "#6b7280" : "#999")
        .attr("stroke-width", 2)
        .style("opacity", 0.6);
    }
  }, [selectedNode, isDarkMode, nodes]);

  if (loading || !isClient) {
    return (
      <div className={`flex h-96 items-center justify-center border rounded-lg ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50'}`}>
        <div className={`text-lg ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Loading schemas...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex h-96 items-center justify-center border rounded-lg ${isDarkMode ? 'bg-red-900 border-red-800' : 'bg-red-50'}`}>
        <div className={`text-lg ${isDarkMode ? 'text-red-300' : 'text-red-600'}`}>Error: {error}</div>
      </div>
    );
  }

  // Get connected nodes for popup
  const connectedNodes = selectedNode
    ? Array.from(getConnectedNodeIds(selectedNode.id, links))
      .map(id => nodes.find(node => node.id === id))
      .filter(Boolean) as D3Node[]
    : [];

  return (
    <div className={`h-auto w-full border rounded-lg p-4 relative bg-card`}>
      <div className="flex justify-between items-center mb-4">
        <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Graph Visualization</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className={`px-3 py-1 text-sm rounded transition-colors ${isDarkMode
              ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            title="Toggle theme"
          >
            {isDarkMode ? '☀️' : '🌙'}
          </button>
          {nodes.length > 0 && (
            <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {nodes.length} nodes • {links.length} connections
            </div>
          )}
        </div>
      </div>

      {/* Schema Selection */}
      {/* <div className="mb-4">
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-gray-700">Select Schema:</label>
          <select
            value={selectedSchema || ""}
            onChange={(e) => setSelectedSchema(e.target.value || null)}
            className="px-3 py-1 border rounded-md text-sm bg-white max-w-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
      </div> */}

      {nodeTypes.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-4 text-sm">
          <span className={`font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Types:</span>
          {nodeTypes.map(type => (
            <div key={type} className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: getNodeColor(type, nodeTypes) }} />
              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>{type}</span>
            </div>
          ))}
        </div>
      )}

      <div className={`border rounded overflow-hidden bg-card`}>
        {nodesLoading ? (
          <div className="flex h-96 items-center justify-center">
            <div className={`text-lg ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Loading nodes...</div>
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex h-96 items-center justify-center">
            <div className={`text-lg ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>No nodes found for selected schema</div>
          </div>
        ) : (
          <svg ref={svgRef} className="w-full h-auto" />
        )}
      </div>

      {nodes.length > 0 && (
        <div className={`mt-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          <p><strong>Instructions:</strong> Drag nodes to reposition them. Use mouse wheel to zoom, drag canvas to pan, or use the zoom controls above. Click on a node to see details.</p>
        </div>
      )}

      {selectedNode && (
        <NodePopup
          node={selectedNode}
          onClose={() => {
            setSelectedNode(null);
          }}
          connectedNodes={connectedNodes}
          isDarkMode={isDarkMode}
          nodeTypes={nodeTypes}
        />
      )}
    </div>
  );
};
