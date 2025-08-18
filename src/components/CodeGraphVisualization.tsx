"use client";

import { useLayoutEffect, useRef, useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, Search, RotateCcw, GitBranch } from "lucide-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { CodeGraphService, NodeType, CodeGraphNode } from "@/services/CodeGraphService";

// Re-export types from service for compatibility
export type CodeNode = CodeGraphNode;

export type CodeEdge = {
  from: string;
  to: string;
  type: string;
};

type LayoutNode = CodeNode & {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

interface CodeGraphVisualizationProps {
  workspaceId: string;
  initialNodes?: CodeNode[];
  initialEdges?: CodeEdge[];
  width?: number;
  height?: number;
  className?: string;
}

const BASE_W = 1200;
const BASE_H = 800;
const NODE_RADIUS = 8;
const FORCE_STRENGTH = 0.15; // Reduced to make edges less "sticky"
const CENTER_STRENGTH = 0.05; // Reduced center pull
const COLLISION_RADIUS = 35; // Increased to spread nodes apart
const REPULSION_STRENGTH = 50; // New: repulsion force between nodes

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setSize({ width: cr.width, height: cr.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, size };
}

function getNodeColor(nodeType: string, tokenCount: number): string {
  const intensity = Math.min(tokenCount / 100, 1);
  const saturation = 70 + intensity * 30;
  const lightness = 50 - intensity * 10;
  
  switch (nodeType) {
    case "Function":
      return `hsl(217, ${saturation}%, ${lightness}%)`; // Blue
    case "Class":
      return `hsl(142, ${saturation}%, ${lightness}%)`; // Green
    case "Datamodel":
      return `hsl(45, ${saturation}%, ${lightness}%)`; // Yellow
    case "Endpoint":
      return `hsl(280, ${saturation}%, ${lightness}%)`; // Purple
    case "Page":
      return `hsl(25, ${saturation}%, ${lightness}%)`; // Orange
    case "Test":
      return `hsl(120, ${saturation}%, ${lightness}%)`; // Light Green
    default:
      return `hsl(0, ${saturation}%, ${lightness}%)`;
  }
}

function forceSimulation(
  nodes: LayoutNode[],
  edges: CodeEdge[],
  width: number,
  height: number
): LayoutNode[] {
  const centerX = width / 2;
  const centerY = height / 2;

  // Initialize positions with better distribution
  nodes.forEach((node, i) => {
    if (node.x === undefined) {
      // Spread nodes in a circle initially to avoid clustering
      const angle = (i / nodes.length) * 2 * Math.PI;
      const radius = Math.min(width, height) * 0.25;
      node.x = centerX + Math.cos(angle) * radius;
      node.y = centerY + Math.sin(angle) * radius;
    }
    if (node.vx === undefined) node.vx = 0;
    if (node.vy === undefined) node.vy = 0;
  });

  // Run simulation iterations
  for (let i = 0; i < 100; i++) {
    const alpha = Math.max(0.01, (100 - i) / 100);

    // Center force
    nodes.forEach(node => {
      const dx = centerX - node.x;
      const dy = centerY - node.y;
      node.vx += dx * CENTER_STRENGTH * alpha;
      node.vy += dy * CENTER_STRENGTH * alpha;
    });

    // Edge forces
    edges.forEach(edge => {
      const source = nodes.find(n => n.ref_id === edge.from);
      const target = nodes.find(n => n.ref_id === edge.to);
      if (!source || !target) return;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (distance - 100) * FORCE_STRENGTH * alpha;

      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;

      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    });

    // Repulsion forces between all nodes
    for (let j = 0; j < nodes.length; j++) {
      for (let k = j + 1; k < nodes.length; k++) {
        const nodeA = nodes[j];
        const nodeB = nodes[k];
        const dx = nodeB.x - nodeA.x;
        const dy = nodeB.y - nodeA.y;
        const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 0.1);
        
        // Repulsion force (stronger when closer)
        const repulsionForce = REPULSION_STRENGTH / (distance * distance) * alpha;
        const fx = (dx / distance) * repulsionForce;
        const fy = (dy / distance) * repulsionForce;
        
        nodeA.vx -= fx;
        nodeA.vy -= fy;
        nodeB.vx += fx;
        nodeB.vy += fy;
        
        // Collision detection for minimum distance
        if (distance < COLLISION_RADIUS) {
          const overlap = COLLISION_RADIUS - distance;
          const moveX = (dx / distance) * overlap * 0.5;
          const moveY = (dy / distance) * overlap * 0.5;
          
          nodeA.x -= moveX;
          nodeA.y -= moveY;
          nodeB.x += moveX;
          nodeB.y += moveY;
        }
      }
    }

    // Apply velocity
    nodes.forEach(node => {
      node.x += node.vx * alpha;
      node.y += node.vy * alpha;
      node.vx *= 0.9; // Damping
      node.vy *= 0.9;

      // Keep within bounds
      node.x = Math.max(NODE_RADIUS, Math.min(width - NODE_RADIUS, node.x));
      node.y = Math.max(NODE_RADIUS, Math.min(height - NODE_RADIUS, node.y));
    });
  }

  return nodes;
}

export function CodeGraphVisualization({ 
  workspaceId,
  initialNodes = [],
  initialEdges = [],
  className = "" 
}: CodeGraphVisualizationProps) {
  const { ref: containerRef, size } = useElementSize<HTMLDivElement>();
  const [service] = useState(() => new CodeGraphService(workspaceId));
  
  // Data state
  const [nodes, setNodes] = useState<CodeNode[]>(initialNodes);
  const [edges, setEdges] = useState<CodeEdge[]>(initialEdges);
  const [layoutNodes, setLayoutNodes] = useState<LayoutNode[]>([]);
  
  // UI state
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNodeTypes, setSelectedNodeTypes] = useState<NodeType[]>([]);

  // Zoom and pan state
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [draggedNode, setDraggedNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const width = size.width || BASE_W;
  const height = size.height || BASE_H;

  // Load initial data
  useEffect(() => {
    if (initialNodes.length === 0) {
      loadAllFunctions();
    }
  }, []);

  // Update layout when nodes change
  useEffect(() => {
    if (nodes.length === 0) return;

    const initialNodes: LayoutNode[] = nodes.map(node => ({
      ...node,
      x: Math.random() * width,
      y: Math.random() * height,
      vx: 0,
      vy: 0,
    }));

    const simulatedNodes = forceSimulation(initialNodes, edges, width, height);
    setLayoutNodes(simulatedNodes);
  }, [nodes, edges, width, height]);

  const loadAllFunctions = useCallback(async () => {
    console.log('Load all functions clicked');
    setLoading(true);
    setError(null);
    try {
      const functions = await service.getFunctions();
      setNodes(functions);
      setEdges([]); // No edges for basic function view
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load functions');
    } finally {
      setLoading(false);
    }
  }, [service]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const results = await service.search({
        query: searchQuery,
        method: 'fulltext',
        node_types: selectedNodeTypes.length > 0 ? selectedNodeTypes : undefined,
        limit: 50
      });
      setNodes(results);
      setEdges([]); // Clear edges for search results
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [service, searchQuery, selectedNodeTypes]);

  const handleNodeTypeToggle = useCallback((nodeType: NodeType) => {
    setSelectedNodeTypes(prev => 
      prev.includes(nodeType) 
        ? prev.filter(t => t !== nodeType)
        : [...prev, nodeType]
    );
  }, []);

  // Zoom and pan handlers
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.2, Math.min(3, transform.scale * delta));
    
    // Zoom towards mouse position
    const newX = mouseX - (mouseX - transform.x) * (newScale / transform.scale);
    const newY = mouseY - (mouseY - transform.y) * (newScale / transform.scale);
    
    setTransform({ x: newX, y: newY, scale: newScale });
  }, [transform]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as Element;
    // Only start panning if clicking on the SVG background, not on nodes
    if (target.tagName === 'svg' || target.tagName === 'rect' || (target.tagName === 'g' && !target.closest('g[data-node]'))) {
      e.preventDefault();
      console.log('Starting pan');
      setIsPanning(true);
      setPanStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
    }
  }, [transform]);

  // Global mouse handlers for better drag/pan experience
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isPanning) {
        setTransform(prev => ({
          ...prev,
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y
        }));
      }
      
      if (draggedNode) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        
        const mouseX = (e.clientX - rect.left - transform.x) / transform.scale;
        const mouseY = (e.clientY - rect.top - transform.y) / transform.scale;
        
        setLayoutNodes(prev => 
          prev.map(node => 
            node.ref_id === draggedNode
              ? { ...node, x: mouseX - dragOffset.x, y: mouseY - dragOffset.y }
              : node
          )
        );
      }
    };

    const handleGlobalMouseUp = () => {
      setIsPanning(false);
      setDraggedNode(null);
    };

    if (isPanning || draggedNode) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleGlobalMouseMove);
        document.removeEventListener('mouseup', handleGlobalMouseUp);
      };
    }
  }, [isPanning, panStart, draggedNode, dragOffset, transform]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Local mouse move for hover effects only
  }, []);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    setDraggedNode(null);
  }, []);

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    const node = layoutNodes.find(n => n.ref_id === nodeId);
    if (!node) return;
    
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const mouseX = (e.clientX - rect.left - transform.x) / transform.scale;
    const mouseY = (e.clientY - rect.top - transform.y) / transform.scale;
    
    setDraggedNode(nodeId);
    setDragOffset({ x: mouseX - node.x, y: mouseY - node.y });
  }, [layoutNodes, transform]);

  const resetZoom = useCallback(() => {
    console.log('Reset zoom clicked');
    setTransform({ x: 0, y: 0, scale: 1 });
  }, []);


  const getEdgePath = (edge: CodeEdge): string => {
    const source = layoutNodes.find(n => n.ref_id === edge.from);
    const target = layoutNodes.find(n => n.ref_id === edge.to);
    if (!source || !target) return "";

    return `M ${source.x} ${source.y} L ${target.x} ${target.y}`;
  };

  const isEdgeHighlighted = (edge: CodeEdge): boolean => {
    return selectedNode === edge.from || selectedNode === edge.to;
  };

  const isNodeConnected = (nodeId: string): boolean => {
    if (!selectedNode) return false;
    return edges.some(e => 
      (e.from === selectedNode && e.to === nodeId) || 
      (e.to === selectedNode && e.from === nodeId)
    );
  };

  const selectedNodeData = selectedNode ? 
    layoutNodes.find(n => n.ref_id === selectedNode) : null;

  const computedHeight = width > 0 ? (width * BASE_H) / BASE_W : BASE_H;

  const nodeTypeOptions: NodeType[] = [
    "Function", "Class", "Datamodel", "Endpoint", "Page", "Test"
  ];

  return (
    <TooltipProvider>
      <div className={className}>
        {/* Graph Visualization */}
        <div className="relative">
          <div
            ref={containerRef}
            className="relative rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden"
            style={{ height: Math.min(computedHeight, 600) }}
          >
            {/* Search Controls Overlay */}
            <div className="absolute top-4 left-4 z-10 flex gap-2">
              <Input
                placeholder="Search codebase..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="w-64 bg-background/80 backdrop-blur-sm"
              />
              <Button onClick={handleSearch} disabled={loading || !searchQuery.trim()} size="sm">
                <Search className="w-4 h-4" />
              </Button>
            </div>

            {/* Node Type Filter Overlay */}
            <div className="absolute top-4 left-4 mt-12 z-10">
              <div className="flex gap-1 flex-wrap">
                {nodeTypeOptions.map(nodeType => (
                  <Button
                    key={nodeType}
                    variant={selectedNodeTypes.includes(nodeType) ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleNodeTypeToggle(nodeType)}
                    className={`text-xs h-6 px-2 backdrop-blur-sm transition-all ${
                      selectedNodeTypes.includes(nodeType) 
                        ? "bg-primary text-primary-foreground border-primary shadow-md" 
                        : "bg-background/80 hover:bg-background border-border"
                    }`}
                  >
                    {nodeType}
                  </Button>
                ))}
              </div>
            </div>

            {/* Status Overlay */}
            <div className="absolute bottom-4 left-4 z-10 flex gap-2 text-xs">
              <Badge variant="outline" className="bg-background/80 backdrop-blur-sm">
                {nodes.length} nodes
              </Badge>
              <Badge variant="outline" className="bg-background/80 backdrop-blur-sm">
                {Math.round(transform.scale * 100)}%
              </Badge>
              {loading && (
                <Badge variant="outline" className="bg-background/80 backdrop-blur-sm">
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  Loading...
                </Badge>
              )}
              {error && (
                <Badge variant="destructive" className="bg-background/80 backdrop-blur-sm">
                  Error
                </Badge>
              )}
            </div>

            {/* Zoom Controls */}
            <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setTransform(prev => ({ ...prev, scale: Math.min(3, prev.scale * 1.2) }))}
                    className="bg-background/80 backdrop-blur-sm hover:bg-background h-8 w-8 p-0"
                  >
                    +
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Zoom In</p>
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setTransform(prev => ({ ...prev, scale: Math.max(0.2, prev.scale * 0.8) }))}
                    className="bg-background/80 backdrop-blur-sm hover:bg-background h-8 w-8 p-0"
                  >
                    −
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Zoom Out</p>
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={resetZoom}
                    className="bg-background/80 backdrop-blur-sm hover:bg-background h-8 w-8 p-0"
                  >
                    ⌂
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Reset View</p>
                </TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={loadAllFunctions}
                    disabled={loading}
                    className="bg-background/80 backdrop-blur-sm hover:bg-background h-8 w-8 p-0"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Reset Data</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <svg 
              className="absolute inset-0 w-full h-full cursor-grab"
              viewBox={`0 0 ${width} ${height}`}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{ cursor: isPanning ? 'grabbing' : draggedNode ? 'grabbing' : 'grab' }}
            >
              <defs>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Background rect for capturing pan events */}
              <rect 
                width={width} 
                height={height} 
                fill="transparent" 
                className="cursor-grab"
                style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
              />

              <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>

              {/* Edges */}
              {edges.map((edge, i) => (
                <path
                  key={`edge-${i}`}
                  d={getEdgePath(edge)}
                  stroke={isEdgeHighlighted(edge) ? "#3b82f6" : "#64748b"}
                  strokeWidth={isEdgeHighlighted(edge) ? 2 : 1}
                  strokeOpacity={selectedNode ? (isEdgeHighlighted(edge) ? 1 : 0.3) : 0.6}
                  fill="none"
                  className="transition-all duration-300"
                  filter={isEdgeHighlighted(edge) ? "url(#glow)" : "none"}
                />
              ))}

              {/* Nodes */}
              {layoutNodes.map((node) => (
                <g key={node.ref_id} data-node={node.ref_id}>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={NODE_RADIUS}
                    fill={getNodeColor(node.node_type, node.properties.token_count)}
                    stroke={selectedNode === node.ref_id ? "#3b82f6" : "#ffffff"}
                    strokeWidth={selectedNode === node.ref_id ? 3 : 1}
                    opacity={
                      selectedNode 
                        ? (selectedNode === node.ref_id || isNodeConnected(node.ref_id) ? 1 : 0.3)
                        : (hoveredNode === node.ref_id ? 1 : 0.8)
                    }
                    className="cursor-pointer transition-all duration-300 hover:r-10"
                    onClick={() => setSelectedNode(
                      selectedNode === node.ref_id ? null : node.ref_id
                    )}
                    onMouseDown={(e) => handleNodeMouseDown(e, node.ref_id)}
                    onMouseEnter={() => setHoveredNode(node.ref_id)}
                    onMouseLeave={() => setHoveredNode(null)}
                    filter={selectedNode === node.ref_id ? "url(#glow)" : "none"}
                    style={{ cursor: draggedNode === node.ref_id ? 'grabbing' : 'grab' }}
                  />
                  
                  {/* Node label */}
                  <text
                    x={node.x}
                    y={node.y - NODE_RADIUS - 4}
                    textAnchor="middle"
                    className="text-xs fill-current pointer-events-none"
                    opacity={hoveredNode === node.ref_id || selectedNode === node.ref_id ? 1 : 0}
                  >
                    {node.properties.name}
                  </text>
                </g>
              ))}
              </g>
            </svg>

            {/* Legend */}
            <div className="absolute top-4 right-4 bg-background/80 backdrop-blur-sm rounded-lg p-3 text-sm">
              <div className="space-y-1">
                {nodeTypeOptions.map(nodeType => (
                  <div key={nodeType} className="flex items-center gap-2">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: getNodeColor(nodeType, 50) }}
                    ></div>
                    <span>{nodeType}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Node Details Panel - Overlay */}
            {selectedNodeData && (
              <div className="absolute top-4 right-4 z-20 w-80 max-h-96 overflow-hidden">
                <Card className="bg-background/95 backdrop-blur-sm border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center justify-between">
                      {selectedNodeData.properties.name}
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setSelectedNode(null)}
                        className="h-6 w-6 p-0"
                      >
                        ×
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-6 pb-4 pt-0 max-h-80 overflow-y-auto">
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">{selectedNodeData.node_type}</p>
                      
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="font-medium">File:</span>
                          <p className="text-muted-foreground break-all text-xs">
                            {selectedNodeData.properties.file}
                          </p>
                        </div>
                        
                        <div>
                          <span className="font-medium">Lines:</span>
                          <span className="ml-2 text-muted-foreground">
                            {selectedNodeData.properties.start}-{selectedNodeData.properties.end}
                          </span>
                        </div>
                      </div>
                      
                      <div>
                        <span className="font-medium text-sm">Code:</span>
                        <div className="mt-1 max-h-32 overflow-y-auto">
                          <MarkdownRenderer className="text-xs">
                            {`\`\`\`${selectedNodeData.properties.language || 'javascript'}\n${selectedNodeData.properties.body}\n\`\`\``}
                          </MarkdownRenderer>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}