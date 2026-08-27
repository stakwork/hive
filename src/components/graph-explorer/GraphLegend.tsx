"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getNodeColor, type GraphNode } from "@/components/graph/graphUtils";

/**
 * Small overlay explaining what the 2D graph's node colors mean.
 *
 * Renders nothing when there are no nodes to summarize, so it never occupies
 * layout space (or shows an empty card) before the graph has data.
 */
export function GraphLegend({
  nodes,
  colorMap,
}: {
  nodes: Pick<GraphNode, "type">[];
  colorMap?: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(true);

  const counts = new Map<string, number>();
  for (const node of nodes) {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  }

  const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return null;
  }

  return (
    <Card className="absolute bottom-4 right-4 max-w-[220px] max-h-[60%] overflow-y-auto p-2 gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={expanded}
        data-testid="graph-legend-toggle"
        className="flex w-full items-center justify-between px-2"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="text-xs font-medium">Legend</span>
        {expanded ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronUp className="size-3.5" />
        )}
      </Button>
      {expanded && (
        <ul className="flex flex-col gap-1 px-2 pb-1">
          {entries.map(([type, count]) => (
            <li
              key={type}
              data-testid={`graph-legend-entry-${type}`}
              className="flex items-center gap-2 text-xs"
            >
              <span
                className="inline-block size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: getNodeColor(type, colorMap) }}
              />
              <span className="flex-1 truncate">{type}</span>
              <Badge variant="secondary">{count}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
