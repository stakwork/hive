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

  // Handle comma-separated ref_ids - take only the first one for now
  const refId = content.ref_id.split(",")[0].trim();

  return (
    <div className="h-full w-full">
      <Graph
        endpoint="/api/subgraph"
        params={{
          ref_id: refId,
          workspace: workspaceSlug || "",
          ...(content.depth && { depth: content.depth.toString() }),
        }}
        title={content.cluster_title || "Knowledge Graph"}
        showStats={true}
        emptyMessage="No graph data available for this reference"
        className="h-full"
      />
    </div>
  );
}
