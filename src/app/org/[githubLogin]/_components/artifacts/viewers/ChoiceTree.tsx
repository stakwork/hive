"use client";

import React, { memo, useMemo } from "react";
import dagre from "@dagrejs/dagre";
import { Background, Handle, Position, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery } from "@tanstack/react-query";
import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasChatStore } from "../../../_state/canvasChatStore";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";

/**
 * A brainstorm tree: nodes of one label (ordered by `choice_id`, options lettered A, B, C…) (default `Choice`) linked by
 * `PARENT_OF`, drawn left to right from the artifact's `focus`. Clicking a
 * node's button only drafts a message in the chat input; the user sends it.
 */

const NODE_W = 220;
const NODE_H = 64;
const EDGE = "PARENT_OF";
const DEFAULT_LABEL = "Choice";
const REFETCH_MS = 15_000;

/**
 * The rule for opening the tree instead of the graph workbench: no proposal
 * or changes (those are the workbench's), a `focus` to root at, and either
 * `layout: "tree"` on the content or the artifact id `brainstorm-tree`.
 */
export function isTreeArtifact(artifact: { id: string }, content: ArtifactViewerProps<"graph">["content"]): boolean {
  return !content.proposal && !content.changes?.length && !!content.focus && (content.layout === "tree" || artifact.id === "brainstorm-tree");
}

export type ChoiceState = "open" | "chosen" | "rejected" | "simulated";
export interface ChoiceItem {
  id: string;
  /** The node's `text`, else `name`, else its ref_id. */
  name: string;
  madeBy?: string;
  state: ChoiceState;
  /** A, B, C… among its parent's `option` children, in `choice_id` order. */
  letter?: string;
  quote?: string;
}
interface RawNode {
  ref_id: string;
  node_type?: string;
  properties?: Record<string, unknown>;
}
interface RawEdge {
  source: string;
  target: string;
  edge_type?: string;
}

/** `choice_id` order: numeric when both are numbers, else string with numeric collation. */
export function compareChoiceIds(a: unknown, b: unknown): number {
  const x = String(a ?? "");
  const y = String(b ?? "");
  const nx = Number(x);
  const ny = Number(y);
  if (x.trim() !== "" && y.trim() !== "" && !Number.isNaN(nx) && !Number.isNaN(ny)) return nx - ny;
  return x.localeCompare(y, undefined, { numeric: true });
}

const optionLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));
const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);

const STATES: readonly string[] = ["open", "chosen", "rejected", "simulated"];

/** The root and its descendants along `PARENT_OF` (cycle-safe), with the edges among them. */
export function buildChoiceTree(nodes: RawNode[], edges: RawEdge[], focus: string, label = DEFAULT_LABEL) {
  const byId = new Map(nodes.filter((n) => n.node_type === label).map((n) => [n.ref_id, n]));
  const kids = new Map<string, string[]>();
  for (const e of edges) {
    if (e.edge_type !== EDGE || !byId.has(e.source) || !byId.has(e.target)) continue;
    kids.set(e.source, [...(kids.get(e.source) ?? []), e.target]);
  }
  const items: ChoiceItem[] = [];
  const links: Array<{ source: string; target: string }> = [];
  const seen = new Set<string>();
  const props = (id: string) => byId.get(id)!.properties ?? {};
  const walk = (id: string, letter?: string) => {
    seen.add(id);
    const p = props(id);
    const state = typeof p.state === "string" && STATES.includes(p.state) ? (p.state as ChoiceState) : "open";
    items.push({ id, name: text(p.text) ?? text(p.name) ?? id, madeBy: text(p.made_by), state, letter, quote: text(p.quote) });
    const ordered = (kids.get(id) ?? []).filter((c) => !seen.has(c)).sort((a, b) => compareChoiceIds(props(a).choice_id, props(b).choice_id));
    let options = 0;
    for (const child of ordered) {
      if (seen.has(child)) continue;
      links.push({ source: id, target: child });
      walk(child, props(child).kind === "option" ? optionLetter(options++) : undefined);
    }
  };
  if (byId.has(focus)) walk(focus);
  return { items, links };
}

/** Left-to-right positions, as the graph workbench's tree lays out. */
export function layoutTree(ids: string[], links: Array<{ source: string; target: string }>): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", ranksep: 64, nodesep: 12 });
  ids.forEach((id) => g.setNode(id, { width: NODE_W, height: NODE_H }));
  links.forEach((l) => g.setEdge(l.source, l.target));
  dagre.layout(g);
  return Object.fromEntries(ids.map((id) => [id, { x: g.node(id).x - NODE_W / 2, y: g.node(id).y - NODE_H / 2 }]));
}

/** The drafts a node's two buttons leave in the chat input: `Verb B: "<text>" (<ref_id>)`, no letter for a question. */
const draft = (verb: string, c: ChoiceItem) => `${verb} ${c.letter ? `${c.letter}: ` : ""}"${c.name}" (${c.id})`;
export const expandDraft = (c: ChoiceItem) => draft(c.state === "rejected" ? "Revisit" : "Expand", c);
export const goWithDraft = (c: ChoiceItem) => draft("Go with", c);

const STATE_STYLE: Record<ChoiceState, string> = {
  open: "border-border bg-card",
  chosen: "border-green-500 bg-green-500/10",
  rejected: "border-border bg-muted/40 text-muted-foreground",
  simulated: "border-dashed border-sky-500 bg-card",
};
const BADGE: Record<ChoiceState, string> = {
  open: "bg-muted text-muted-foreground",
  chosen: "bg-green-500/20 text-green-700 dark:text-green-400",
  rejected: "bg-muted text-muted-foreground line-through",
  simulated: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
};

const ChoiceNode = memo(function ChoiceNode({ data }: NodeProps<Node<{ choice: ChoiceItem }>>) {
  const c = data.choice;
  const setDraft = useCanvasChatStore((s) => s.setPendingInputDraft);
  const button = "nodrag rounded border px-1.5 py-0.5 text-[10px] hover:bg-accent";
  return (
    <div className={cn("flex h-full w-full flex-col justify-between rounded-md border px-2 py-1 text-xs", STATE_STYLE[c.state])} data-state={c.state}>
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className={cn("truncate font-medium", c.state === "rejected" && "line-through")} title={c.quote ?? c.name}>
        {c.letter && <span className="mr-1 rounded bg-muted px-1 text-[10px] font-semibold">{c.letter}</span>}
        {c.name}
      </div>
      <div className="flex items-center gap-1">
        <span className={cn("rounded px-1 text-[10px]", BADGE[c.state])}>{c.state}</span>
        {c.madeBy && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground" data-made-by={c.madeBy}>
            {c.madeBy === "user" ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
            {c.madeBy}
          </span>
        )}
        <span className="ml-auto flex gap-1">
          <button type="button" className={button} onClick={() => setDraft(expandDraft(c))}>
            {c.state === "rejected" ? "Revisit" : "Expand"}
          </button>
          <button type="button" className={button} onClick={() => setDraft(goWithDraft(c))}>
            Go with
          </button>
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
});

const nodeTypes = { choice: ChoiceNode };

interface GraphResponse {
  data?: { nodes?: RawNode[]; edges?: RawEdge[] };
}

/** Polled while open and on window focus, so children Jamie adds appear. */
function useChoices(workspace: string, label: string) {
  return useQuery({
    queryKey: ["choice-tree", workspace, label],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/graph/nodes?node_type=${encodeURIComponent(label)}&limit=1000&limit_mode=total`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return ((await res.json()) as GraphResponse).data ?? {};
    },
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
  });
}

function Tree({ items, links }: ReturnType<typeof buildChoiceTree>) {
  const { nodes, edges } = useMemo(() => {
    const pos = layoutTree(items.map((i) => i.id), links);
    return {
      nodes: items.map<Node>((choice) => ({ id: choice.id, type: "choice", position: pos[choice.id], data: { choice }, width: NODE_W, height: NODE_H })),
      edges: links.map<Edge>((l) => ({ id: `${l.source}>${l.target}`, ...l })),
    };
  }, [items, links]);
  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.15, maxZoom: 1.1 }} nodesDraggable={false} nodesConnectable={false} minZoom={0.3} proOptions={{ hideAttribution: true }}>
      <Background />
    </ReactFlow>
  );
}

export function ChoiceTree({ workspace, focus, label = DEFAULT_LABEL }: { workspace: string; focus: string; label?: string }) {
  const { data, isLoading, error } = useChoices(workspace, label);
  const tree = useMemo(() => buildChoiceTree(data?.nodes ?? [], data?.edges ?? [], focus, label), [data, focus, label]);
  if (isLoading) return <p className="p-4 text-xs text-muted-foreground">Loading tree…</p>;
  if (error) return <p className="p-4 text-xs text-destructive">Could not load the tree.</p>;
  if (!tree.items.length) return <p className="p-4 text-xs text-muted-foreground">Nothing to show for this choice yet.</p>;
  return (
    <div className="h-full w-full">
      <ReactFlowProvider>
        <Tree {...tree} />
      </ReactFlowProvider>
    </div>
  );
}
