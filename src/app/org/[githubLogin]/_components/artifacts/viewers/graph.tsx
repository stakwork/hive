"use client";

import React from "react";
import { GraphWorkbench } from "@/components/graph-workbench";
import { getProposalStatus } from "@/lib/proposals/types";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { selectActiveMessages, useCanvasChatStore } from "../../../_state/canvasChatStore";

const NOTICE = {
  approved: "Approved — this is the graph with the change made.",
  rejected: "Rejected — nothing was changed.",
} as const;

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

/**
 * The graph workbench itself, centred on the artifact's node. A proposal's
 * change is drawn on it until the proposal is decided; after that it shows
 * the graph as it is — centred on what an approval created.
 */
export function GraphPanel({ artifact, content }: ArtifactViewerProps<"graph">) {
  const status = useCanvasChatStore((s) => {
    const messages = selectActiveMessages(s);
    return content.proposal && messages ? getProposalStatus(messages, content.proposal).status : null;
  });
  const decided = status === "approved" || status === "rejected" ? status : null;
  const created = content.changes?.find((c) => c.kind === "node")?.name;
  // An approval lands on what it created, else where the proposal was centred —
  // unless the proposal set an explicit override (a node delete must never
  // re-focus the now-deleted ref_id).
  const approvedFocus = content.approvedFocus
    ? [content.approvedFocus]
    : [created, content.focus].filter((ref): ref is string => !!ref);
  return (
    <div className="h-full">
      <GraphWorkbench
        // A decision remounts it: from the proposal drawn on the graph to the graph as it is.
        key={`${artifact.id}:${decided ?? "open"}`}
        workspaceSlug={content.workspace}
        initialFocusId={decided === "approved" ? approvedFocus : content.focus}
        changes={decided ? undefined : content.changes}
        notice={decided ? NOTICE[decided] : undefined}
      />
    </div>
  );
}
