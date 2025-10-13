"use client";

import { Graph } from "@/components/graph";
import type { GraphContent } from "@/lib/chat";

interface GraphArtifactProps {
  content: GraphContent;
  workspaceSlug?: string;
}

export function GraphArtifact({ content, workspaceSlug }: GraphArtifactProps) {
  if (!content.ref_id) {
    return (
      <div className="p-4 border rounded-lg bg-muted/50 text-muted-foreground text-sm">
        No reference ID provided for graph
      </div>
    );
  }

  return (
    <Graph
      endpoint="/api/subgraph"
      params={{
        ref_id: content.ref_id,
        workspace: workspaceSlug || "",
        ...(content.depth && { depth: content.depth.toString() }),
      }}
      height={500}
      title="Knowledge Graph"
      showStats={true}
      emptyMessage="No graph data available for this reference"
    />
  );
}
