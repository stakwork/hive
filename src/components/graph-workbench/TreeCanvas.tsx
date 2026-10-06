"use client";

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dagre from "@dagrejs/dagre";
import {
  Handle,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Maximize2, Minus } from "lucide-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { Portal as HoverCardPortal } from "@radix-ui/react-hover-card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { useContextMenu } from "./ContextMenu";
import { CanvasModeToggle } from "./CanvasModeToggle";
import {
  childrenOf,
  hasDocs,
  neighboursOf,
  parentsOf,
  pathsToRoot,
  reach,
  type WorkbenchGraph,
  type WorkbenchNode,
} from "./model";
import { useWorkbench } from "./store";

const NODE_W = 196;
const NODE_H = 38;
const FIT = { padding: 0.15, duration: 250, maxZoom: 1.1, minZoom: 0.6 };

type Side = "up" | "down";

interface TreeNodeData extends Record<string, unknown> {
  node: WorkbenchNode;
  selected: boolean;
  onPath: boolean;
  isFocus: boolean;
  hiddenParents: number;
  hiddenChildren: number;
  hasParents: boolean;
  hasChildren: boolean;
  onToggle: (id: string, side: Side) => void;
}

/** "+3" shows what's hidden on that side; "−" folds it back once shown. */
function SideToggle({ side, hidden, has, onClick }: { side: Side; hidden: number; has: boolean; onClick: () => void }) {
  if (!has) return null;
  const label = side === "up" ? (hidden ? "Show parents" : "Hide parents") : hidden ? "Show children" : "Hide children";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        "nodrag absolute top-1/2 z-10 flex h-4 min-w-4 -translate-y-1/2 items-center justify-center rounded-full border bg-background px-1 text-[10px] leading-none tabular-nums text-muted-foreground hover:text-foreground",
        side === "up" ? "-left-3" : "-right-3",
        !hidden && "opacity-0 group-hover:opacity-100",
      )}
      title={label}
      aria-label={label}
      data-testid={`tree-toggle-${side}`}
    >
      {hidden ? `+${hidden}` : <Minus className="h-2.5 w-2.5" />}
    </button>
  );
}

const TreeNode = memo(function TreeNode({ data }: NodeProps<Node<TreeNodeData>>) {
  const { node, selected, onPath, isFocus, hiddenParents, hiddenChildren, hasParents, hasChildren, onToggle } = data;
  const { proposed } = node;
  return (
    <HoverCard openDelay={400} closeDelay={80}>
      <HoverCardTrigger asChild>
        <div
          className={cn(
            "group relative flex h-[38px] w-[196px] items-center gap-2 rounded-md border bg-card px-2.5 text-xs shadow-sm transition-colors",
            onPath && !selected && "border-foreground/30",
            proposed && proposed !== "removed" && "border-dashed border-emerald-500",
            proposed === "removed" && "border-dashed border-rose-500",
            selected && "border-primary ring-2 ring-primary/30",
          )}
          data-testid={`tree-node-${node.id}`}
        >
          <Handle
            type="target"
            position={Position.Left}
            isConnectable={false}
            className="!h-1.5 !w-1.5 !border-0 !bg-muted-foreground/40"
          />
          <SideToggle side="up" hidden={hiddenParents} has={hasParents} onClick={() => onToggle(node.id, "up")} />
          {/* Hollow dot: nothing here for an agent to read yet. */}
          <span
            className={cn("h-2 w-2 shrink-0 rounded-full", hasDocs(node) ? "bg-amber-500" : "border border-amber-500")}
          />
          <span className={cn("truncate font-medium", proposed === "removed" && "line-through text-rose-600 dark:text-rose-400")}>
            {node.name}
          </span>
          {proposed ? (
            <span
              className={cn(
                "ml-auto shrink-0 text-[10px]",
                proposed === "removed" ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {proposed === "new" ? "proposed" : proposed === "removed" ? "removed" : "changed"}
            </span>
          ) : (
            isFocus && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">focus</span>
          )}
          <SideToggle side="down" hidden={hiddenChildren} has={hasChildren} onClick={() => onToggle(node.id, "down")} />
          <Handle
            type="source"
            position={Position.Right}
            isConnectable={false}
            className="!h-1.5 !w-1.5 !border-0 !bg-muted-foreground/40"
          />
        </div>
      </HoverCardTrigger>
      {/* Out of the canvas: inside it, the nodes drawn after this one would cover the card. */}
      <HoverCardPortal>
        <HoverCardContent side="right" align="start" className="w-80 p-3" data-testid="tree-node-peek">
          <p className="text-sm font-medium">{node.name}</p>
          {node.description ? (
            <p className="mt-1 text-xs text-muted-foreground">{node.description}</p>
          ) : (
            node.docs && (
              <div className="mt-2 max-h-40 overflow-hidden text-xs [mask-image:linear-gradient(black_70%,transparent)]">
                <MarkdownRenderer size="compact">{node.docs.slice(0, 600)}</MarkdownRenderer>
              </div>
            )
          )}
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
});

const nodeTypes = { tree: TreeNode };

function layout(
  ids: string[],
  edges: Array<{ source: string; target: string }>,
): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", ranksep: 64, nodesep: 10 });
  ids.forEach((id) => g.setNode(id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return Object.fromEntries(
    ids.map((id) => {
      const p = g.node(id);
      return [id, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 }];
    }),
  );
}

/** A node, its parents and its children — where a focus starts. */
const neighbourhood = (g: WorkbenchGraph, id: string) => new Set([id, ...neighboursOf(g, id)]);

/** Keep only what still connects to the focus through shown hierarchy edges. */
const prune = (g: WorkbenchGraph, shown: Set<string>, focus: string) =>
  new Set([focus, ...reach(g, focus, (g, id) => neighboursOf(g, id).filter((n) => shown.has(n)))]);

/**
 * Hide everything beyond `id` on one side — except the focus, the path
 * between it and `id`, and the focus's own side of the tree (folding an
 * ancestor's children must not fold the focus's subtree with it).
 */
function fold(g: WorkbenchGraph, shown: Set<string>, focus: string, id: string, side: Side): Set<string> {
  const beyond = reach(g, id, side === "up" ? parentsOf : childrenOf);
  const protect = new Set([focus]);
  if (id !== focus) {
    const above = reach(g, focus, parentsOf);
    const below = reach(g, focus, childrenOf);
    if (side === "up" && below.has(id)) {
      above.forEach((n) => protect.add(n));
      reach(g, id, parentsOf).forEach((n) => below.has(n) && protect.add(n));
    }
    if (side === "down" && above.has(id)) {
      below.forEach((n) => protect.add(n));
      reach(g, id, childrenOf).forEach((n) => above.has(n) && protect.add(n));
    }
  }
  return prune(g, new Set([...shown].filter((n) => !beyond.has(n) || protect.has(n))), focus);
}

function TreeCanvasInner({ graph }: { graph: WorkbenchGraph }) {
  const { selectedId, select, focus, setCanvasMode, pending } = useWorkbench();
  const { fitView, getViewport } = useReactFlow();
  const paneW = useStore((s) => s.width);
  const paneH = useStore((s) => s.height);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const { open: openMenu, menu } = useContextMenu();
  /** Nodes to frame after the next layout: everything (new focus) or what a toggle revealed. */
  const frame = useRef<"all" | string[] | null>("all");

  // What a proposal touches stays on the canvas, however it's folded.
  const pinned = pending.touched;

  const refocus = useCallback(
    (id: string) => {
      if (!graph.nodes[id]) return;
      setFocusId(id);
      setShown(new Set([...neighbourhood(graph, id), ...pinned]));
      frame.current = "all";
    },
    [graph, pinned],
  );

  // An explicit focus re-anchors the canvas — not a rebuilt graph (saved docs, a background re-read).
  useEffect(() => {
    if (focus.id) refocus(focus.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // A plain selection extends what's shown when it's next to it, and re-anchors only when it isn't.
  useEffect(() => {
    if (!selectedId || !graph.nodes[selectedId] || shown.has(selectedId)) return;
    const adjacent = neighboursOf(graph, selectedId).some((n) => shown.has(n));
    if (adjacent) setShown((s) => new Set(s).add(selectedId));
    else refocus(selectedId);
    // Only a new selection should move the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const toggle = useCallback(
    (id: string, side: Side) => {
      const neighbours = side === "up" ? parentsOf(graph, id) : childrenOf(graph, id);
      const hidden = neighbours.filter((n) => !shown.has(n));
      if (hidden.length) {
        frame.current = [id, ...hidden];
        setShown((s) => new Set([...s, ...hidden]));
      } else if (focusId) {
        setShown(new Set([...fold(graph, shown, focusId, id, side), ...pinned]));
      }
    },
    [graph, shown, focusId, pinned],
  );

  /** Open the whole subtree under a node. */
  const showAllBelow = useCallback(
    (id: string) => {
      frame.current = "all";
      setShown((s) => new Set([...s, id, ...reach(graph, id, childrenOf)]));
    },
    [graph],
  );

  const onPath = useMemo(() => {
    const nodes = new Set<string>();
    const edges = new Set<string>();
    if (!selectedId || !graph.nodes[selectedId]) return { nodes, edges };
    for (const p of pathsToRoot(graph, selectedId)) {
      p.forEach((id) => nodes.add(id));
      for (let i = 1; i < p.length; i++) edges.add(`${p[i - 1]}>${p[i]}`);
    }
    return { nodes, edges };
  }, [graph, selectedId]);

  // Positions depend only on what's shown: selecting a node doesn't lay the tree out again.
  const placed = useMemo(() => {
    const ids = [...shown].filter((id) => graph.nodes[id]);
    const structure = ids.flatMap((s) =>
      childrenOf(graph, s)
        .filter((t) => shown.has(t))
        .map((t) => ({ source: s, target: t })),
    );
    return { ids, structure, pos: layout(ids, structure) };
  }, [graph, shown]);

  const { nodes, edges } = useMemo(() => {
    const { ids, structure, pos } = placed;
    const nodes: Node<TreeNodeData>[] = ids.map((id) => {
      const ps = parentsOf(graph, id);
      const cs = childrenOf(graph, id);
      return {
        id,
        type: "tree",
        position: pos[id],
        draggable: false,
        connectable: false,
        deletable: false,
        data: {
          node: graph.nodes[id],
          selected: id === selectedId,
          onPath: onPath.nodes.has(id),
          isFocus: id === focusId,
          hiddenParents: ps.filter((p) => !shown.has(p)).length,
          hiddenChildren: cs.filter((c) => !shown.has(c)).length,
          hasParents: ps.length > 0,
          hasChildren: cs.length > 0,
          onToggle: toggle,
        },
      };
    });
    const muted = "color-mix(in oklch, var(--muted-foreground) 60%, transparent)";
    const strong = "color-mix(in oklch, var(--foreground) 70%, transparent)";
    const added = "rgb(16 185 129)";
    const removed = "rgb(244 63 94)";
    const dashed = (stroke: string) => ({ stroke, strokeWidth: 1.5, strokeDasharray: "5 4" });
    const edges: Edge[] = structure.map((e) => {
      const key = `${e.source}>${e.target}`;
      const lit = onPath.edges.has(key);
      return {
        id: `${graph.lens.edge}:${key}`,
        ...e,
        type: "smoothstep",
        selectable: false,
        style: pending.newEdges.has(key)
          ? dashed(added)
          : pending.removedEdges.has(key)
            ? dashed(removed)
            : { stroke: lit ? strong : muted, strokeWidth: lit ? 2 : 1.25 },
      };
    });
    // Proposed links of other edge types: dashed, labelled, outside the tree's own structure — green to add, red to remove.
    const proposedLink = (l: { edge: string; source: string; target: string }, stroke: string, id: string): Edge => ({
      id: `${id}:${l.edge}:${l.source}>${l.target}`,
      source: l.source,
      target: l.target,
      type: "straight",
      selectable: false,
      label: l.edge,
      labelStyle: { fontSize: 10, fill: stroke },
      labelBgStyle: { fill: "var(--background)" },
      style: dashed(stroke),
    });
    for (const l of pending.links)
      if (shown.has(l.source) && shown.has(l.target)) edges.push(proposedLink(l, added, "proposed"));
    for (const l of pending.unlinks)
      if (shown.has(l.source) && shown.has(l.target)) edges.push(proposedLink(l, removed, "going"));
    return { nodes, edges };
  }, [graph, placed, shown, selectedId, focusId, onPath, toggle, pending]);

  // Re-fit when the pane changes size (a panel opened beside it).
  const lastSize = useRef("");
  useEffect(() => {
    const size = `${paneW}x${paneH}`;
    if (lastSize.current && lastSize.current !== size) frame.current = "all";
    lastSize.current = size;
  }, [paneW, paneH]);

  // After each layout, frame what changed: the whole view for a new focus, or a toggle's reveal.
  useEffect(() => {
    const target = frame.current;
    if (!target || !paneW || !paneH || nodes.length === 0) return;
    frame.current = null;
    const t = setTimeout(() => {
      if (target === "all") fitView(FIT);
      else fitView({ ...FIT, nodes: target.map((id) => ({ id })), padding: 0.25, maxZoom: getViewport().zoom });
    }, 40);
    return () => clearTimeout(t);
  }, [nodes, paneW, paneH, fitView, getViewport]);

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, n) => select(n.id)}
        onNodeDoubleClick={(_, n) => toggle(n.id, "down")}
        onNodeContextMenu={(e, n: Node<TreeNodeData>) => {
          const { hiddenParents: ps, hiddenChildren: cs, hasChildren } = n.data;
          openMenu(
            e,
            [
              { label: "Open", onSelect: () => select(n.id) },
              { label: "Focus here", onSelect: () => refocus(n.id) },
              ...(ps ? [{ label: "Show parents", hint: String(ps), onSelect: () => toggle(n.id, "up") }] : []),
              ...(cs ? [{ label: "Show children", hint: String(cs), onSelect: () => toggle(n.id, "down") }] : []),
              ...(hasChildren ? [{ label: "Show everything below", onSelect: () => showAllBelow(n.id) }] : []),
              {
                label: "Show in graph",
                separatorBefore: true,
                onSelect: () => {
                  select(n.id);
                  setCanvasMode("graph");
                },
              },
            ],
            n.data.node.name,
          );
        }}
        nodesDraggable={false}
        nodesConnectable={false}
        zoomOnDoubleClick={false}
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        className="bg-muted/20"
      >
        <Panel
          position="top-left"
          className="flex items-center gap-1.5 rounded-md border bg-background/95 px-2 py-1 shadow-sm"
        >
          <CanvasModeToggle />
          <button
            type="button"
            onClick={() => fitView(FIT)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Fit to screen"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </Panel>
        <Panel position="bottom-left" className="text-[11px] text-muted-foreground">
          +N shows parents or children · double-click opens children · right-click for more
        </Panel>
      </ReactFlow>
      {menu}
    </>
  );
}

export function TreeCanvas({ graph }: { graph: WorkbenchGraph }) {
  return (
    <ReactFlowProvider>
      <TreeCanvasInner graph={graph} />
    </ReactFlowProvider>
  );
}
