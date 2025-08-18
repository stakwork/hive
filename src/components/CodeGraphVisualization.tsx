"use client";

import { useLayoutEffect, useRef, useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";

export type CodeNode = {
  node_type: string;
  ref_id: string;
  properties: {
    token_count: number;
    file: string;
    node_key: string;
    name: string;
    start: number;
    end: number;
    body: string;
  };
};

export type CodeEdge = {
  from: string;
  to: string;
  type: "calls" | "imports" | "references";
};

type LayoutNode = CodeNode & {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

interface CodeGraphVisualizationProps {
  nodes: CodeNode[];
  edges?: CodeEdge[];
  width?: number;
  height?: number;
  className?: string;
}

const BASE_W = 1200;
const BASE_H = 800;
const NODE_RADIUS = 8;
const FORCE_STRENGTH = 0.3;
const CENTER_STRENGTH = 0.1;
const COLLISION_RADIUS = 20;

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
    case "Variable":
      return `hsl(45, ${saturation}%, ${lightness}%)`; // Yellow
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

  // Initialize positions randomly
  nodes.forEach(node => {
    if (node.x === undefined) node.x = Math.random() * width;
    if (node.y === undefined) node.y = Math.random() * height;
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

    // Collision detection
    for (let j = 0; j < nodes.length; j++) {
      for (let k = j + 1; k < nodes.length; k++) {
        const nodeA = nodes[j];
        const nodeB = nodes[k];
        const dx = nodeB.x - nodeA.x;
        const dy = nodeB.y - nodeA.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
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
  nodes, 
  edges = [], 
  className = "" 
}: CodeGraphVisualizationProps) {
  const { ref: containerRef, size } = useElementSize<HTMLDivElement>();
  const [layoutNodes, setLayoutNodes] = useState<LayoutNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const width = size.width || BASE_W;
  const height = size.height || BASE_H;

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

  return (
    <div className={`flex gap-4 ${className}`}>
      {/* Graph Visualization */}
      <div className="flex-1">
        <div
          ref={containerRef}
          className="relative rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden"
          style={{ height: Math.min(computedHeight, 600) }}
        >
          <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${width} ${height}`}>
            <defs>
              <filter id="glow">
                <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

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
              <g key={node.ref_id}>
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
                  onMouseEnter={() => setHoveredNode(node.ref_id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  filter={selectedNode === node.ref_id ? "url(#glow)" : "none"}
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
          </svg>

          {/* Legend */}
          <div className="absolute top-4 right-4 bg-background/80 backdrop-blur-sm rounded-lg p-3 text-sm">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: getNodeColor("Function", 50) }}
                ></div>
                <span>Functions</span>
              </div>
              <div className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: getNodeColor("Class", 50) }}
                ></div>
                <span>Classes</span>
              </div>
              <div className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: getNodeColor("Variable", 50) }}
                ></div>
                <span>Variables</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Node Details Panel */}
      {selectedNodeData && (
        <Card className="w-80">
          <CardContent className="p-4">
            <div className="space-y-3">
              <div>
                <h3 className="font-semibold text-lg">{selectedNodeData.properties.name}</h3>
                <p className="text-sm text-muted-foreground">{selectedNodeData.node_type}</p>
              </div>
              
              <div className="space-y-2 text-sm">
                <div>
                  <span className="font-medium">File:</span>
                  <p className="text-muted-foreground break-all">
                    {selectedNodeData.properties.file}
                  </p>
                </div>
                
                <div>
                  <span className="font-medium">Lines:</span>
                  <span className="ml-2 text-muted-foreground">
                    {selectedNodeData.properties.start}-{selectedNodeData.properties.end}
                  </span>
                </div>
                
                <div>
                  <span className="font-medium">Token Count:</span>
                  <span className="ml-2 text-muted-foreground">
                    {selectedNodeData.properties.token_count}
                  </span>
                </div>
              </div>
              
              <div>
                <span className="font-medium text-sm">Code:</span>
                <div className="mt-1 max-h-48 overflow-y-auto">
                  <MarkdownRenderer className="text-xs">
                    {`\`\`\`javascript\n${selectedNodeData.properties.body}\n\`\`\``}
                  </MarkdownRenderer>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}