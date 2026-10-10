"use client";

import { useCallback, useMemo, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { GraphWorkbench, Picker, type SelectedNode } from "@/components/graph-workbench";
import { Button } from "@/components/ui/button";
import type { GraphFocus } from "../_state/canvasChatStore";

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
 * `?workspace=<slug>` picks the workspace (the default one otherwise) and
 * `?gnode=<ref_id>` centres on a node (`?node=` is the canvas's).
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

  // Until a node has been focused, a null selection is just the graph still loading: leave a deep link's `gnode` be.
  const hasFocused = useRef(false);
  const onSelectionChange = useCallback(
    (node: SelectedNode | null) => {
      onFocusChange(slug && node ? { workspaceSlug: slug, refId: node.id, name: node.name, type: node.type } : null);
      if (node) hasFocused.current = true;
      else if (!hasFocused.current) return;
      // Mirror focus into the URL (replace, not push, so Back isn't flooded).
      const params = new URLSearchParams(window.location.search);
      if (node) params.set("gnode", node.id);
      else params.delete("gnode");
      if (params.get("gnode") === new URLSearchParams(window.location.search).get("gnode")) return;
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [slug, onFocusChange, pathname],
  );

  if (loading) {
    return <div className="h-full bg-muted animate-pulse" />;
  }

  if (!current) {
    return <p className="text-muted-foreground text-center py-12">No workspaces with a graph to explore.</p>;
  }

  // `history.replaceState`, not the router: a router navigation re-runs this
  // protected route's middleware and page query (see OrgCanvasView).
  const pick = (next: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set("workspace", next);
    params.delete("gnode");
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  };

  return (
    <GraphWorkbench
      // A new workspace is a new graph: remount rather than carry state across.
      key={current.slug}
      workspaceSlug={current.slug}
      initialFocusId={searchParams.get("gnode")}
      onSelectionChange={onSelectionChange}
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
