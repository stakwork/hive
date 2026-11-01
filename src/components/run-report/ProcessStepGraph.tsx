"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { GraphVisualization } from "@/components/graph/GraphVisualization";
import type { EdgeStyle, GraphEdge, GraphNode } from "@/components/graph/graphUtils";
import type { ProcessStep } from "@/lib/run-report/types";

const HEIGHT = 220;
const MAX_NODES = 60;
/** Created (blue) and read (grey) — the report's accent and a neutral. */
export const CREATED_COLOR = "#0071e3";
export const READ_COLOR = "#9ca3af";
const COLORS: Record<string, string> = { created: CREATED_COLOR, read: READ_COLOR };

const edgeStyle = (label: string): EdgeStyle | undefined =>
  label === "created" ? { stroke: CREATED_COLOR, strokeWidth: 2 } : undefined;

/** Nodes and edges of one step: concepts read (grey), nodes and edges the step created (blue). */
export function stepGraphElements(step: ProcessStep): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>();
  for (const c of step.concepts) {
    if (c.access === "read") nodes.set(c.ref_id, { id: c.ref_id, name: c.name, type: "read" });
  }
  for (const n of step.created.nodes) nodes.set(n.ref_id, { id: n.ref_id, name: n.name, type: "created" });
  for (const c of step.concepts) {
    if (c.access === "write" && !nodes.has(c.ref_id)) nodes.set(c.ref_id, { id: c.ref_id, name: c.name, type: "created" });
  }
  const shown = new Set([...nodes.keys()].slice(0, MAX_NODES));
  const edges: GraphEdge[] = [
    ...step.links.map((e) => ({ source: e.source, target: e.target, label: e.edge_type ?? "" })),
    ...step.created.edges.map((e) => ({ source: e.source, target: e.target, label: "created" })),
  ].filter((e) => shown.has(e.source) && shown.has(e.target));
  return { nodes: [...nodes.values()].filter((n) => shown.has(n.id)), edges };
}

/** A small force graph for one step. Concept names are the labels; nothing opens on click. */
export function ProcessStepGraph({ step }: { step: ProcessStep }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const { nodes, edges } = useMemo(() => stepGraphElements(step), [step]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w < 1) return;
      setWidth((prev) => (prev !== null && Math.abs(prev - w) < 1 ? prev : w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="relative w-full overflow-hidden rounded-lg border bg-muted/20"
      style={{ height: HEIGHT }}
      data-testid={`process-graph-${step.step}`}
    >
      {width !== null && nodes.length > 0 ? (
        <GraphVisualization
          nodes={nodes}
          edges={edges}
          width={width}
          height={HEIGHT}
          colorMap={COLORS}
          edgeStyleFn={edgeStyle}
        />
      ) : (
        <p className="p-4 text-sm text-muted-foreground italic">{nodes.length === 0 ? "Nothing to draw." : "Measuring…"}</p>
      )}
    </div>
  );
}
