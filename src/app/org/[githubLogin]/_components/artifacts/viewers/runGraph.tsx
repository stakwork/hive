"use client";

import React from "react";
import { StrutRunGraph } from "@/components/strut-run-graph";
import type { ArtifactContents, ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";

/** Where the run's graph trace is read: the run's own route, under its workspace. */
export const runGraphEndpoint = ({ workspace, run }: ArtifactContents["run_graph"]): string =>
  `/api/workspaces/${encodeURIComponent(workspace)}/strut/runs/${encodeURIComponent(run)}/graph`;

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
