"use client";

import React from "react";
import { GraphWorkbench } from "@/components/graph-workbench";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";

export function GraphInline({ artifact, content }: ArtifactViewerProps<"graph">) {
  if (content.changes?.length)
    return (
      <p className="px-3 py-2.5 text-xs text-muted-foreground">
        Shows {artifact.title} on the graph, with the change dashed
      </p>
    );
  return (
    <p className="px-3 py-2.5 text-xs text-muted-foreground">
      {content.focus ? `Opens on ${artifact.title}` : "Opens the graph"} in{" "}
      <span className="font-mono">{content.workspace}</span>
    </p>
  );
}

/** The graph workbench itself, centred on the artifact's node, with any proposed change drawn on it. */
export function GraphPanel({ artifact, content }: ArtifactViewerProps<"graph">) {
  return (
    <div className="h-full">
      <GraphWorkbench
        key={artifact.id}
        workspaceSlug={content.workspace}
        initialFocusId={content.focus}
        changes={content.changes}
      />
    </div>
  );
}
