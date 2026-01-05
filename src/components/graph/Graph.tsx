"use client";

import { GraphVisualization } from "./GraphVisualization";
import { GraphVisualizationLayered } from "./GraphVisualizationLayered";
import { useGraphData } from "./useGraphData";

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

interface GraphProps {
  // Data fetching options
  endpoint?: string;
  params?: Record<string, string>;
  transform?: (data: unknown) => { nodes: GraphNode[]; edges: GraphEdge[] };

  // Visualization options
  width?: number;
  height?: number;
  colorMap?: Record<string, string>;
  onNodeClick?: (node: GraphNode) => void;

  // Display options
  title?: string;
  showStats?: boolean;
  emptyMessage?: string;
  className?: string;
  layout?: "force" | "layered";
}

export function Graph({
  endpoint,
  params,
  transform,
  width,
  height,
  colorMap,
  onNodeClick,
  title,
  showStats = true,
  emptyMessage = "No graph data available",
  className = "",
  layout = "layered",
}: GraphProps) {
  const { nodes, edges, loading, error } = useGraphData({
    endpoint,
    params,
    transform,
  });

  // Determine if we should use flex layout (when no height specified)
  const useFlexLayout = height === undefined;
  const effectiveHeight = height || 600;

  if (loading) {
    return (
      <div className={`border rounded-lg bg-card p-4 ${useFlexLayout ? 'flex flex-col h-full' : ''} ${className}`}>
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading graph...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`border rounded-lg bg-card p-4 ${useFlexLayout ? 'flex flex-col h-full' : ''} ${className}`}>
        <div className="flex items-center justify-center h-64">
          <div className="text-destructive">Error: {error}</div>
        </div>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className={`border rounded-lg bg-card p-4 ${useFlexLayout ? 'flex flex-col h-full' : ''} ${className}`}>
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">{emptyMessage}</div>
        </div>
      </div>
    );
  }

  const VisualizationComponent = layout === "layered" ? GraphVisualizationLayered : GraphVisualization;

  return (
    <div className={`border rounded-lg bg-card p-4 ${useFlexLayout ? 'flex flex-col h-full' : ''} ${className}`}>
      {(title || showStats) && (
        <div className="mb-3 flex justify-between items-center flex-shrink-0">
          {title && <h3 className="text-sm font-medium">{title}</h3>}
          {showStats && (
            <div className="text-xs text-muted-foreground">
              {nodes.length} nodes • {edges.length} connections
            </div>
          )}
        </div>
      )}

      <div className={`border rounded overflow-hidden bg-background ${useFlexLayout ? 'flex-1 min-h-0' : ''}`}>
        <VisualizationComponent
          nodes={nodes}
          edges={edges}
          width={width}
          height={useFlexLayout ? undefined : effectiveHeight}
          colorMap={colorMap}
          onNodeClick={onNodeClick}
        />
      </div>
    </div>
  );
}
