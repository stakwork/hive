"use client";

import React from "react";
import { StrutRunGraph } from "@/components/strut-run-graph";
import type { ArtifactContents, ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { plural } from "../lines";

/** Where the run's graph trace is read: the run's own route, under its workspace. */
export const runGraphEndpoint = ({ workspace, run }: ArtifactContents["run_graph"]): string =>
  `/api/workspaces/${encodeURIComponent(workspace)}/strut/runs/${encodeURIComponent(run)}/graph`;

/** "14 calls · 37 nodes", from the counts the ref was written with; null without them. */
export function runGraphFact({ calls, nodes }: ArtifactContents["run_graph"]): string | null {
  if (calls === undefined) return null;
  return nodes === undefined ? plural(calls, "call") : `${plural(calls, "call")} · ${plural(nodes, "node")}`;
}

export function RunGraphInline({ content }: ArtifactViewerProps<"run_graph">) {
  return (
    <p className="px-3 py-2.5 text-xs text-muted-foreground">
      What the run read and wrote in <span className="font-mono">{content.workspace}</span>&apos;s graph, call by call
    </p>
  );
}

/**
 * The run graph itself, filling the panel. Each version is another run, so
 * a step between versions starts the view over rather than carrying a
 * selection or a replay position from one run into the next.
 */
export function RunGraphPanel({ content }: ArtifactViewerProps<"run_graph">) {
  return (
    <div className="h-full">
      <StrutRunGraph key={content.run} endpoint={runGraphEndpoint(content)} workspaceSlug={content.workspace} fill />
    </div>
  );
}
