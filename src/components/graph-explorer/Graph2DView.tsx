"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { GraphVisualization } from "@/components/graph/GraphVisualization";
import type { GraphEdge, GraphNode } from "@/components/graph/graphUtils";
import { GRAPH_EXPLORER_COLORS } from "./nodeColors";
import { LEGAL_NODE_ICONS, resolveEdgeStyle } from "./legalGraphStyles";
import type { RawGraph } from "./walkGraph";

/**
 * Flat 2D reading of the same walk the 3D canvas shows.
 *
 * `GraphVisualization` sizes its SVG from explicit `width`/`height` numbers, so
 * this measures the container and feeds it concrete pixels — the alternative,
 * teaching the shared component to size itself, would change every existing
 * caller. Nodes carry their source label (File, Function, Concept…) so the
 * palette in `graphUtils` colors them by type.
 */
export function Graph2DView({
  rawGraph,
  onNodeSelect,
}: {
  rawGraph: RawGraph;
  /** Receives the node's `ref_id` — same drill-down the 3D canvas triggers. */
  onNodeSelect: (refId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      // Ignore the zero-size pass while the tab is still hidden — laying the
      // simulation out into a 0×0 box collapses every node onto the origin.
      if (width < 1 || height < 1) return;
      setSize((prev) =>
        prev && Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
          ? prev
          : { width: Math.round(width), height: Math.round(height) }
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const nodes = useMemo<GraphNode[]>(
    () =>
      rawGraph.nodes.map((n) => ({
        id: n.id,
        name: n.label,
        type: n.nodeType ?? "Node",
      })),
    [rawGraph.nodes]
  );

  const edges = useMemo<GraphEdge[]>(
    () =>
      rawGraph.edges.map((e) => ({
        source: e.source,
        target: e.target,
        label: e.label ?? "",
      })),
    [rawGraph.edges]
  );

  const handleNodeClick = useMemo(
    () => (node: GraphNode) => onNodeSelect(node.id),
    [onNodeSelect]
  );

  return (
    <div ref={containerRef} className="h-full w-full" data-testid="graph-2d-view">
      {size && nodes.length > 0 && (
        <GraphVisualization
          nodes={nodes}
          edges={edges}
          width={size.width}
          height={size.height}
          colorMap={GRAPH_EXPLORER_COLORS}
          onNodeClick={handleNodeClick}
          iconMap={LEGAL_NODE_ICONS}
          edgeStyleFn={resolveEdgeStyle}
        />
      )}
    </div>
  );
}
