"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { GraphWorkbench, Picker, type SelectedNode } from "@/components/graph-workbench";
import { Button } from "@/components/ui/button";
import type { GraphFocus } from "../_state/canvasChatStore";
import { graphParams } from "./graphHref";

export interface GraphWorkspace {
  slug: string;
  name: string;
  isDefault?: boolean;
}

interface GraphViewProps {
  /** The org's workspaces, as the page already holds them. */
  workspaces: GraphWorkspace[];
  loading: boolean;
  /** Whether the org page's Jamie chat is showing beside the graph. */
  chatOpen: boolean;
  onToggleChat: () => void;
  /** Reports the node in view, so Jamie knows what "this" is. Keep it stable. */
  onFocusChange: (focus: GraphFocus | null) => void;
}

/**
 * The org page's graph view: the graph workbench over one workspace's graph.
 * `?workspace=<slug>` picks the workspace (the default one otherwise),
 * `?ref_id=` centres on a node and `?type=` opens its type's trees. The
 * selected node is written back, so the URL is a link to what's on screen.
 */
export function GraphView({ workspaces, loading, chatOpen, onToggleChat, onFocusChange }: GraphViewProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ordered = useMemo(
    () => [...workspaces].sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0)),
    [workspaces],
  );
  const requested = searchParams.get("workspace");
  const current = ordered.find((ws) => ws.slug === requested) ?? ordered[0];
  const slug = current?.slug;

  // `history.replaceState`, not the router: a router navigation re-runs this
  // protected route's middleware and page query (see OrgCanvasView).
  const replaceParams = useCallback(
    (params: URLSearchParams) => window.history.replaceState(null, "", `${pathname}?${params.toString()}`),
    [pathname],
  );

  const onSelectionChange = useCallback(
    (node: SelectedNode | null) => {
      onFocusChange(slug && node ? { workspaceSlug: slug, refId: node.id, name: node.name, type: node.type } : null);
      if (!slug) return;
      const here = new URLSearchParams(window.location.search);
      if (node) replaceParams(graphParams({ workspace: slug, type: node.type, refId: node.id }, here));
      else if (here.has("ref_id")) {
        here.delete("ref_id");
        replaceParams(here);
      }
    },
    [slug, onFocusChange, replaceParams],
  );

  /** A link to a node on this graph view, to share. */
  const nodeLink = useCallback(
    (node: { id: string; type: string }) =>
      `${window.location.origin}${pathname}?${graphParams({ workspace: slug, type: node.type, refId: node.id })}`,
    [pathname, slug],
  );

  if (loading) {
    return <div className="h-full bg-muted animate-pulse" />;
  }

  if (!current) {
    return <p className="text-muted-foreground text-center py-12">No workspaces with a graph to explore.</p>;
  }

  const pick = (next: string) =>
    replaceParams(graphParams({ workspace: next }, new URLSearchParams(window.location.search)));

  return (
    <GraphWorkbench
      // A new workspace is a new graph: remount rather than carry state across.
      key={current.slug}
      workspaceSlug={current.slug}
      initialFocusId={searchParams.get("ref_id")}
      initialType={searchParams.get("type")}
      onSelectionChange={onSelectionChange}
      nodeLink={nodeLink}
      leading={
        <Picker
          label="Workspace"
          value={current.name}
          selected={current.slug}
          onSelect={pick}
          heading="Each workspace has its own graph"
          items={ordered.map((ws) => ({ key: ws.slug, label: ws.name }))}
          testId="org-graph-workspace"
        />
      }
      trailing={
        <Button
          variant={chatOpen ? "secondary" : "outline"}
          size="sm"
          className="h-8 gap-1.5"
          onClick={onToggleChat}
          data-testid="org-graph-ask-jamie"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {chatOpen ? "Hide Jamie" : "Ask Jamie"}
        </Button>
      }
    />
  );
}
