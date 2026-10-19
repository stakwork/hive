"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { GraphWorkbench } from "@/components/graph-workbench";
import { connectionsQuery } from "@/components/graph-workbench/queries";
import { getProposalStatus } from "@/lib/proposals/types";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { ChoiceTree, isTreeArtifact } from "./ChoiceTree";
import { selectActiveMessages, useCanvasChatStore } from "../../../_state/canvasChatStore";
import { MiniGraph, type MiniGraphEdge, type MiniGraphNode } from "./miniGraph";

const NOTICE = {
  approved: "Approved — this is the graph with the change made.",
  rejected: "Rejected — nothing was changed.",
} as const;

const NoRoot = () => <p className="px-3 py-2.5 text-xs text-muted-foreground">This brainstorm card has no root to open.</p>;

/** "approved" or "rejected" once the artifact's proposal is decided, else null. */
function useProposalDecision(content: ArtifactViewerProps<"graph">["content"]) {
  const status = useCanvasChatStore((s) => {
    const messages = selectActiveMessages(s);
    return content.proposal && messages ? getProposalStatus(messages, content.proposal).status : null;
  });
  return status === "approved" || status === "rejected" ? status : null;
}

/** The org page's Brainstorm tab on this tree. A plain link: the page reads `?view=` once, on mount. */
export const brainstormBoardHref = (githubLogin: string, workspace: string, root: string) =>
  `/org/${encodeURIComponent(githubLogin)}?${new URLSearchParams({ view: "canvas", tab: "brainstorm", ws: workspace, root })}`;

function TreeWithBoardLink({ workspace, focus, label }: { workspace: string; focus: string; label?: string }) {
  const login = useParams<{ githubLogin?: string }>()?.githubLogin;
  return (
    <div className="relative h-full">
      <ChoiceTree workspace={workspace} focus={focus} label={label} />
      {login && (
        <a
          href={brainstormBoardHref(login, workspace, focus)}
          className="absolute right-2 top-2 z-10 rounded border bg-background/90 px-2 py-0.5 text-xs font-medium hover:bg-accent"
        >
          Open board
        </a>
      )}
    </div>
  );
}

/**
 * A brainstorm tree (see `isTreeArtifact`), else the graph workbench itself, centred on the artifact's node. A proposal's
 * change is drawn on it until the proposal is decided; after that it shows
 * the graph as it is — centred on what an approval created.
 */
export function GraphPanel({ artifact, content }: ArtifactViewerProps<"graph">) {
  const tree = isTreeArtifact(artifact, content);
  const decided = useProposalDecision(content);
  const created = content.changes?.find((c) => c.kind === "node")?.name;
  // An approval lands on what it created, else where the proposal was centred.
  const approvedFocus = [created, content.focus].filter((ref): ref is string => !!ref);
  if (tree) return content.focus ? <TreeWithBoardLink workspace={content.workspace} focus={content.focus} label={content.label} /> : <NoRoot />;
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

/**
 * The graph small, for the chat's strip. An undecided proposal draws its change —
 * the nodes it would create, dashed, hung off their parent or the focus —
 * from the artifact itself. Otherwise the focus and its neighbours, read
 * through the workbench's own query. Nothing for a brainstorm tree (the
 * panel draws it from another read), without a focus, or with no neighbours.
 */
export function GraphThumb({ artifact, content }: ArtifactViewerProps<"graph">) {
  const decided = useProposalDecision(content);
  const tree = isTreeArtifact(artifact, content);
  const proposed = decided ? [] : (content.changes?.filter((change) => change.kind === "node") ?? []);
  const { data } = useQuery({
    ...connectionsQuery(content.workspace, content.focus ?? ""),
    enabled: !!content.focus && !tree && proposed.length === 0,
  });
  if (tree) return null;
  if (proposed.length > 0) {
    const hub = content.focus ?? "proposal";
    const nodes: MiniGraphNode[] = [
      { id: hub, type: "Concept", focus: true },
      ...proposed.map((change) => ({ id: change.name, type: change.type ?? "Concept", proposed: true })),
    ];
    const edges: MiniGraphEdge[] = proposed.map((change) => ({
      source: change.parent && proposed.some((p) => p.name === change.parent) ? change.parent : hub,
      target: change.name,
    }));
    return <MiniGraph nodes={nodes} edges={edges} />;
  }
  const neighbours = data?.groups.flatMap((group) => group.items) ?? [];
  // A lone node says nothing the kind's icon doesn't.
  if (!data || neighbours.length === 0) return null;
  return (
    <MiniGraph
      nodes={[
        { id: data.node.id, type: data.node.type, focus: true },
        ...neighbours.map((item) => ({ id: item.id, type: item.type })),
      ]}
      edges={neighbours.map((item) => ({ source: data.node.id, target: item.id }))}
    />
  );
}
