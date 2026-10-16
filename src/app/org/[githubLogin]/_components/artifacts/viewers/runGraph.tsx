"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { StrutRunGraph } from "@/components/strut-run-graph";
import { isProvenanceType } from "@/components/strut-run-graph/colors";
import type { RunGraphTrace } from "@/lib/strut-run-graph/types";
import type { ArtifactContents, ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { MiniGraph } from "./miniGraph";

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

/**
 * The run's graph small, for the chat's strip: the nodes it read and wrote,
 * with the edges among them — lineage and strut's own bookkeeping left out,
 * as the panel leaves them out. Read once; a finished run's trace does not
 * change. Not read when the ref says the run touched one node or none.
 */
export function RunGraphThumb({ content }: ArtifactViewerProps<"run_graph">) {
  const endpoint = runGraphEndpoint(content);
  const { data } = useQuery({
    queryKey: ["run-graph-thumb", endpoint],
    queryFn: async (): Promise<RunGraphTrace> => {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    },
    enabled: content.nodes === undefined || content.nodes > 1,
    staleTime: Infinity,
  });
  const nodes = data?.nodes.filter((node) => !node.ancestor && !isProvenanceType(node.node_type)) ?? [];
  if (nodes.length < 2) return null;
  return <MiniGraph nodes={nodes.map((node) => ({ id: node.ref_id, type: node.node_type }))} edges={data!.edges} />;
}
