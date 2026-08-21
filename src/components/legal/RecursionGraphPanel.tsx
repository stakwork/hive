"use client";

import React, { useMemo, useState } from "react";
import { AlertCircle, ExternalLink } from "lucide-react";
import { RecursionTimelineViz } from "@/components/legal/RecursionTimelineViz";
import { GraphVisualizationLayered } from "@/components/graph/GraphVisualizationLayered";
import { buildTimelineLayout } from "@/lib/harvey-lab/timeline-layout";
import { loopSubgraphHref } from "@/components/legal/RecursionBox";
import type { SubgraphNode, SubgraphEdge } from "@/lib/harvey-lab/hill-climb-series";
import type { GraphNode, GraphEdge } from "@/components/graph/graphUtils";

// ── Layout mode ───────────────────────────────────────────────────────────────

type LayoutMode = "timeline" | "graph";

// ── Props ─────────────────────────────────────────────────────────────────────

interface RecursionGraphPanelProps {
  nodes: SubgraphNode[];
  edges: SubgraphEdge[];
  partial: boolean;
  evalSetRefId: string;
  workspaceSlug: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Translate SubgraphNodes into the shape GraphVisualizationLayered expects. */
function toGraphNodes(nodes: SubgraphNode[]): GraphNode[] {
  return nodes.map((n) => ({
    id: n.ref_id,
    name:
      (typeof n.properties?.name === "string" && n.properties.name.trim()
        ? n.properties.name.trim()
        : n.node_type ?? n.ref_id),
    type: n.node_type ?? "unknown",
  }));
}

/** Translate SubgraphEdges into the shape GraphVisualizationLayered expects. */
function toGraphEdges(edges: SubgraphEdge[]): GraphEdge[] {
  return edges.map((e) => ({
    source: e.source,
    target: e.target,
    label: e.edge_type,
  }));
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RecursionGraphPanel({
  nodes,
  edges,
  partial,
  evalSetRefId,
  workspaceSlug,
}: RecursionGraphPanelProps) {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("timeline");

  const layout = useMemo(() => buildTimelineLayout(nodes, edges, partial), [nodes, edges, partial]);

  const graphNodes = useMemo(() => toGraphNodes(nodes), [nodes]);
  const graphEdges = useMemo(() => toGraphEdges(edges), [edges]);

  const explorerHref = loopSubgraphHref(workspaceSlug, evalSetRefId);

  return (
    <div
      className="mt-2 rounded-lg border bg-card overflow-hidden"
      data-testid="recursion-graph-panel"
    >
      {/* Panel header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold">Recursion subgraph</h3>

          {/* Partial-data warning */}
          {partial && (
            <span
              className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
              data-testid="panel-partial-warning"
            >
              <AlertCircle className="h-3 w-3" />
              <span>incomplete data</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Layout toggle */}
          <div className="flex rounded-md border overflow-hidden text-xs" role="group" aria-label="Layout mode">
            <button
              type="button"
              onClick={() => setLayoutMode("timeline")}
              className={[
                "px-3 py-1.5 font-medium transition-colors",
                layoutMode === "timeline"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50",
              ].join(" ")}
              aria-pressed={layoutMode === "timeline"}
              data-testid="layout-toggle-timeline"
            >
              Timeline
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode("graph")}
              className={[
                "px-3 py-1.5 font-medium transition-colors border-l",
                layoutMode === "graph"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50",
              ].join(" ")}
              aria-pressed={layoutMode === "graph"}
              data-testid="layout-toggle-graph"
            >
              Graph
            </button>
          </div>

          {/* Graph Explorer deep link */}
          <a
            href={explorerHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Open recursion subgraph in Graph Explorer (opens in new tab)"
            data-testid="panel-graph-explorer-link"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in Graph Explorer
          </a>
        </div>
      </div>

      {/* Panel body */}
      <div className="p-4">
        {layoutMode === "timeline" ? (
          <RecursionTimelineViz layout={layout} />
        ) : (
          <div style={{ height: 400 }}>
            <GraphVisualizationLayered
              nodes={graphNodes}
              edges={graphEdges}
              height={400}
            />
          </div>
        )}
      </div>
    </div>
  );
}
