"use client";

import React from "react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { hierarchyQuery } from "@/components/graph-workbench/queries";
import {
  DEFAULT_TREE,
  buildGraph,
  childrenOf,
  parentsOf,
  pathToRoot,
  rootsOf,
  type WorkbenchGraph,
  type WorkbenchNode,
} from "@/components/graph-workbench/model";
import { cn } from "@/lib/utils";
import { useCanvasChatStore, type GraphFocus } from "../../_state/canvasChatStore";
import { startNewOrgConversation } from "../../_state/openOrgConversation";
import type { GraphWorkspace } from "../GraphView";
import { MobileArtifactLayer } from "./MobileArtifacts";
import { MobileTopBar } from "./MobileTopBar";

const MAX_DEPTH = 24;

interface MobileGraphViewProps {
  githubLogin: string;
  workspaces: GraphWorkspace[];
  loading: boolean;
  /** Reports the node in view, so Jamie knows what "this" is. Keep it stable. */
  onFocusChange: (focus: GraphFocus | null) => void;
  /** The chat, shown over the graph on "Ask Jamie"; `onBack` returns to the graph. */
  renderChat: (onBack: () => void) => ReactNode;
}

/**
 * The graph view on a phone, read only: the workspace's concept tree to expand
 * and collapse, a node's details in a bottom sheet, and "Ask Jamie" — the chat
 * over the graph, about that node. Same data as the desktop workbench
 * (`hierarchyQuery` / `buildGraph`); none of its editing.
 */
export function MobileGraphView({ githubLogin, workspaces, loading, onFocusChange, renderChat }: MobileGraphViewProps) {
  const searchParams = useSearchParams();
  const ordered = useMemo(
    () => [...workspaces].sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0)),
    [workspaces],
  );
  const [requested, setRequested] = useState(() => searchParams.get("workspace"));
  const current = ordered.find((ws) => ws.slug === requested) ?? ordered[0];

  const [chatOpen, setChatOpen] = useState(false);

  const pickWorkspace = (slug: string) => {
    setRequested(slug);
    const params = new URLSearchParams(window.location.search);
    params.set("workspace", slug);
    params.delete("gnode");
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="mobile-graph-view">
      <MobileTopBar title="Graph" />
      {ordered.length > 1 && current && (
        <div className="shrink-0 border-b px-4 py-2">
          <select
            aria-label="Workspace"
            data-testid="mobile-graph-workspace"
            value={current.slug}
            onChange={(e) => pickWorkspace(e.target.value)}
            className="h-11 w-full rounded-lg border bg-background px-3 text-base"
          >
            {ordered.map((ws) => (
              <option key={ws.slug} value={ws.slug}>
                {ws.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {loading ? (
          <div className="m-4 h-24 animate-pulse rounded-xl bg-muted" />
        ) : !current ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No workspaces with a graph to explore.</p>
        ) : (
          <ConceptTree
            // A new workspace is a new graph: start its tree afresh.
            key={current.slug}
            githubLogin={githubLogin}
            workspaceSlug={current.slug}
            onFocusChange={onFocusChange}
            onAsk={() => setChatOpen(true)}
          />
        )}
      </div>

      {chatOpen && (
        <div data-testid="mobile-graph-chat" className="fixed inset-0 z-40 bg-background pb-0">
          {renderChat(() => setChatOpen(false))}
          <MobileArtifactLayer />
        </div>
      )}
    </div>
  );
}

function ConceptTree({
  githubLogin,
  workspaceSlug,
  onFocusChange,
  onAsk,
}: {
  githubLogin: string;
  workspaceSlug: string;
  onFocusChange: (focus: GraphFocus | null) => void;
  onAsk: () => void;
}) {
  const searchParams = useSearchParams();
  const { data, isPending, error } = useQuery(hierarchyQuery(workspaceSlug, DEFAULT_TREE.type));
  const graph = useMemo(() => (data ? buildGraph(data, DEFAULT_TREE) : null), [data]);
  const roots = useMemo(() => (graph ? rootsOf(graph).map((r) => r.node) : []), [graph]);
  const loose = useMemo(
    () =>
      graph
        ? Object.values(graph.nodes)
            .filter((n) => !parentsOf(graph, n.id).length && !childrenOf(graph, n.id).length)
            .sort((a, b) => a.name.localeCompare(b.name))
        : [],
    [graph],
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = graph && selectedId ? (graph.nodes[selectedId] ?? null) : null;

  const select = useCallback(
    (node: WorkbenchNode | null) => {
      setSelectedId(node?.id ?? null);
      onFocusChange(node ? { workspaceSlug, refId: node.id, name: node.name, type: node.type } : null);
      const params = new URLSearchParams(window.location.search);
      if (node) params.set("gnode", node.id);
      else params.delete("gnode");
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    },
    [onFocusChange, workspaceSlug],
  );

  // A `?gnode=` deep link opens its node, the tree unfolded down to it — once, when the graph arrives.
  const deepLink = searchParams.get("gnode");
  const [deepLinked, setDeepLinked] = useState(false);
  useEffect(() => {
    if (!graph || deepLinked || !deepLink) return;
    setDeepLinked(true);
    const node = Object.values(graph.nodes).find((n) => n.id === deepLink || n.key === deepLink || n.name === deepLink);
    if (!node) return;
    setExpanded((prev) => new Set([...prev, ...(pathToRoot(graph, node.id) ?? []).slice(0, -1)]));
    select(node);
  }, [graph, deepLink, deepLinked, select]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  if (isPending) return <div className="m-4 h-24 animate-pulse rounded-xl bg-muted" />;
  if (error || !graph)
    return <p className="p-6 text-center text-sm text-muted-foreground">Failed to load the graph.</p>;
  if (roots.length === 0 && loose.length === 0)
    return <p className="p-6 text-center text-sm text-muted-foreground">No concepts in this graph yet.</p>;

  const ask = (node: WorkbenchNode) => {
    // A fresh chat about the node: the chat's context already names it (`onFocusChange`).
    startNewOrgConversation(githubLogin);
    useCanvasChatStore.getState().setPendingInputDraft(`Tell me about "${node.name}"`);
    select(node);
    onAsk();
  };

  return (
    <>
      <ul role="tree" data-testid="mobile-graph-tree" className="p-2">
        {roots.map((node) => (
          <TreeRow
            key={node.id}
            graph={graph}
            node={node}
            depth={0}
            expanded={expanded}
            selectedId={selectedId}
            onToggle={toggle}
            onSelect={select}
          />
        ))}
      </ul>
      {loose.length > 0 && (
        <section className="px-2 pb-4">
          <h2 className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">Not in any tree</h2>
          <ul>
            {loose.map((node) => (
              <TreeRow
                key={node.id}
                graph={graph}
                node={node}
                depth={0}
                expanded={expanded}
                selectedId={selectedId}
                onToggle={toggle}
                onSelect={select}
              />
            ))}
          </ul>
        </section>
      )}
      <NodeSheet graph={graph} node={selected} onClose={() => select(null)} onSelect={select} onAsk={ask} />
    </>
  );
}

function TreeRow({
  graph,
  node,
  depth,
  expanded,
  selectedId,
  onToggle,
  onSelect,
}: {
  graph: WorkbenchGraph;
  node: WorkbenchNode;
  depth: number;
  expanded: ReadonlySet<string>;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onSelect: (node: WorkbenchNode) => void;
}) {
  const kids = depth < MAX_DEPTH ? childrenOf(graph, node.id) : [];
  const open = expanded.has(node.id);
  return (
    <li role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={node.id === selectedId}>
      <div
        className={cn("flex items-center rounded-lg", node.id === selectedId && "bg-muted")}
        style={{ paddingLeft: depth * 16 }}
      >
        {kids.length > 0 ? (
          <button
            type="button"
            aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
            onClick={() => onToggle(node.id)}
            className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground"
          >
            {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
          </button>
        ) : (
          <span className="w-11 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 pr-3 text-left text-[15px]"
        >
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {kids.length > 0 && <span className="text-xs tabular-nums text-muted-foreground">{kids.length}</span>}
        </button>
      </div>
      {open && kids.length > 0 && (
        <ul role="group">
          {kids.map((id) => (
            <TreeRow
              key={id}
              graph={graph}
              node={graph.nodes[id]}
              depth={depth + 1}
              expanded={expanded}
              selectedId={selectedId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** A tapped concept's details, read only, with the way to ask Jamie about it. */
function NodeSheet({
  graph,
  node,
  onClose,
  onSelect,
  onAsk,
}: {
  graph: WorkbenchGraph;
  node: WorkbenchNode | null;
  onClose: () => void;
  onSelect: (node: WorkbenchNode) => void;
  onAsk: (node: WorkbenchNode) => void;
}) {
  // Keep the last node up while the sheet eases out.
  const [shown, setShown] = useState<WorkbenchNode | null>(node);
  useEffect(() => {
    if (node) setShown(node);
  }, [node]);
  const n = node ?? shown;
  const parents = n ? parentsOf(graph, n.id) : [];
  const kids = n ? childrenOf(graph, n.id) : [];
  return (
    <Sheet open={!!node} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        data-testid="mobile-graph-node-sheet"
        className="max-h-[80dvh] gap-0 rounded-t-2xl"
      >
        {n && (
          <>
            <SheetHeader className="pr-12">
              <SheetTitle className="text-lg">{n.name}</SheetTitle>
              <SheetDescription>
                {n.type}
                {n.repo && ` · ${n.repo}`}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-2 text-sm">
              {n.description && <p className="text-muted-foreground">{n.description}</p>}
              {n.docs && <MarkdownRenderer size="compact">{n.docs}</MarkdownRenderer>}
              {parents.length > 0 && (
                <NodeLinks label="Parent" ids={parents} graph={graph} onSelect={onSelect} />
              )}
              {kids.length > 0 && <NodeLinks label="Children" ids={kids} graph={graph} onSelect={onSelect} />}
            </div>
            <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
              <Button
                data-testid="mobile-graph-ask-jamie"
                className="h-12 w-full gap-2 text-base"
                onClick={() => onAsk(n)}
              >
                <MessageSquare className="h-4 w-4" />
                Ask Jamie
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function NodeLinks({
  label,
  ids,
  graph,
  onSelect,
}: {
  label: string;
  ids: string[];
  graph: WorkbenchGraph;
  onSelect: (node: WorkbenchNode) => void;
}) {
  return (
    <div>
      <h3 className="pb-1 text-xs font-medium text-muted-foreground">{label}</h3>
      <div className="flex flex-wrap gap-2">
        {ids.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(graph.nodes[id])}
            className="min-h-9 rounded-full border px-3 text-sm active:bg-muted"
          >
            {graph.nodes[id].name}
          </button>
        ))}
      </div>
    </div>
  );
}
