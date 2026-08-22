"use client";

import React, { useMemo } from "react";
import { AlertCircle, ExternalLink } from "lucide-react";
import { loopSubgraphHref } from "@/components/legal/RecursionBox";
import { buildTimelineLayout } from "@/lib/harvey-lab/timeline-layout";
import { RecursionTimelineViz } from "@/components/legal/RecursionTimelineViz";
import type { SubgraphNode, SubgraphEdge } from "@/lib/harvey-lab/hill-climb-series";

interface Props {
  nodes: SubgraphNode[];
  edges: SubgraphEdge[];
  partial: boolean;
  evalSetRefId: string;
  workspaceSlug: string;
}

export function RecursionGraphPanel({
  nodes,
  edges,
  partial,
  evalSetRefId,
  workspaceSlug,
}: Props) {
  const layout = useMemo(
    () => buildTimelineLayout(nodes, edges, partial),
    [nodes, edges, partial],
  );

  const explorerHref = loopSubgraphHref(workspaceSlug, evalSetRefId);

  return (
    <div className="border-t bg-muted/10 px-4 py-3">
      {/* Panel header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Recursion subgraph</h3>
          {partial && (
            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-3 w-3" />
              <span>incomplete data</span>
            </span>
          )}
        </div>
        <a
          href={explorerHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Open this task's recursion subgraph in the Graph Explorer (opens in new tab)"
        >
          <ExternalLink className="h-3 w-3" />
          Open in Graph Explorer
        </a>
      </div>

      {/* Timeline visualisation */}
      <RecursionTimelineViz layout={layout} />
    </div>
  );
}
