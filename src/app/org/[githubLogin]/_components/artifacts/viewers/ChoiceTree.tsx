"use client";

import React, { memo, useCallback, useMemo, useState } from "react";
import dagre from "@dagrejs/dagre";
import { Background, Handle, Position, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery } from "@tanstack/react-query";
import { Bot, HelpCircle, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasChatStore } from "../../../_state/canvasChatStore";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";

/**
 * A brainstorm tree (IBIS-style): `Question` nodes (key `question_id`) and
 * `Choice` options (key `choice_id`) linked by `PARENT_OF` both ways, drawn
 * left to right from the artifact's `focus`. Both labels are read unless
 * `label` restricts it to one. Old trees are `Choice` nodes with
 * `kind: "question"`, which still render as questions. Siblings are ordered
 * by `choice_id` (else `question_id`); options are lettered by path (A, B,
 * AA, AB…, counted through questions, which have no letter). Clicking a
 * node's button only drafts a message in the chat input; the user sends it.
 */

const NODE_W = 260;
const CHARS_PER_LINE = 34;
const LINE_H = 16;
const PAD_H = 28;
const CLAMP_LINES = 3;
// Selected node's extra rows: state/made_by line and the action buttons.
const DETAILS_H = 20;
const ACTIONS_H = 30;
const REFETCH_MS = 15_000;

/**
 * The rule for opening the tree instead of the graph workbench, whatever else
 * the content carries (a stray proposal or changes are ignored): `layout:
 * "tree"`, a brainstorm artifact id (`brainstorm-tree`, `job-x:brainstorm-tree`),
 * or a `label` of `Choice` / `Question`. A tree needs a `focus` to open at.
 */
export function isTreeArtifact(artifact: { id: string }, content: ArtifactViewerProps<"graph">["content"]): boolean {
  return content.layout === "tree" || /brainstorm/i.test(artifact.id) || content.label === "Choice" || content.label === "Question";
}

export type ChoiceState = "open" | "chosen" | "rejected" | "simulated" | "decided";
export interface ChoiceItem {
  id: string;
  /** The node's `text`, else `name`, else its ref_id. */
  name: string;
  madeBy?: string;
  state: ChoiceState;
  /** Path label: the nearest lettered ancestor's label + its letter among its parent's `option` children (A, B, AA, AB…). */
  letter?: string;
  quote?: string;
  kind?: string;
  /** A `Question` node, or a legacy `Choice` with `kind: "question"`. */
  isQuestion: boolean;
  /** Who said it, shown in place of `madeBy`. */
  speaker?: string;
  criteria?: string;
  reversibility?: string;
}
interface RawNode {
  ref_id: string;
  properties?: Record<string, unknown>;
  /** `Question` or `Choice`, from the node's labels. */
  type?: string;
}
interface RawEdge {
  source: string;
  target: string;
}

/** `choice_id` (else `question_id`) order: numeric when both are numbers, else string with numeric collation. */
export function compareChoiceIds(a: unknown, b: unknown): number {
  const x = String(a ?? "");
  const y = String(b ?? "");
  const nx = Number(x);
  const ny = Number(y);
  if (x.trim() !== "" && y.trim() !== "" && !Number.isNaN(nx) && !Number.isNaN(ny)) return nx - ny;
  return x.localeCompare(y, undefined, { numeric: true });
}

const optionLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));
const prefix_ = (prefix: string, letter: string) => prefix + letter;
const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);

const isQuestionNode = (n: RawNode) => n.type === "Question" || n.properties?.kind === "question";
const orderKey = (n: RawNode) => n.properties?.choice_id ?? n.properties?.question_id;

const STATES: readonly string[] = ["open", "chosen", "rejected", "simulated", "decided"];

/** The root and its descendants along `PARENT_OF` (cycle-safe), with the edges among them. */
export function buildChoiceTree(nodes: RawNode[], edges: RawEdge[], focus: string) {
  // Every node is of the label already: the read selects by label.
  const byId = new Map(nodes.map((n) => [n.ref_id, n]));
  const kids = new Map<string, string[]>();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    kids.set(e.source, [...(kids.get(e.source) ?? []), e.target]);
  }
  const items: ChoiceItem[] = [];
  const links: Array<{ source: string; target: string }> = [];
  const seen = new Set<string>();
  const props = (id: string) => byId.get(id)!.properties ?? {};
  const walk = (id: string, letter: string | undefined, prefix: string) => {
    seen.add(id);
    const p = props(id);
    const state = typeof p.state === "string" && STATES.includes(p.state) ? (p.state as ChoiceState) : "open";
    items.push({
      id,
      name: text(p.text) ?? text(p.name) ?? id,
      madeBy: text(p.made_by),
      state,
      letter,
      quote: text(p.quote),
      kind: text(p.kind),
      isQuestion: isQuestionNode(byId.get(id)!),
      speaker: text(p.speaker),
      criteria: text(p.criteria),
      reversibility: text(p.reversibility),
    });
    const childPrefix = letter ?? prefix;
    const ordered = (kids.get(id) ?? []).filter((c) => !seen.has(c)).sort((a, b) => compareChoiceIds(orderKey(byId.get(a)!), orderKey(byId.get(b)!)));
    let options = 0;
    for (const child of ordered) {
      if (seen.has(child)) continue;
      links.push({ source: id, target: child });
      const isOption = !isQuestionNode(byId.get(child)!);
      walk(child, isOption ? prefix_(childPrefix, optionLetter(options++)) : undefined, childPrefix);
    }
  };
  if (byId.has(focus)) walk(focus, undefined, "");
  return { items, links };
}

/** Rendered height of a node, from its text length (see the constants above). */
export function estimateNodeHeight(c: Pick<ChoiceItem, "name" | "quote">, selected: boolean): number {
  const lines = (t: string) => Math.max(1, Math.ceil(t.length / CHARS_PER_LINE));
  if (!selected) return Math.min(CLAMP_LINES, lines(c.name)) * LINE_H + PAD_H;
  return (lines(c.name) + (c.quote ? lines(c.quote) : 0)) * LINE_H + PAD_H + DETAILS_H + ACTIONS_H;
}

/** Left-to-right positions, as the graph workbench's tree lays out; `heights` per node id (default 64). */
export function layoutTree(
  ids: string[],
  links: Array<{ source: string; target: string }>,
  heights: Record<string, number> = {},
): Record<string, { x: number; y: number }> {
  const h = (id: string) => heights[id] ?? 64;
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", ranksep: 64, nodesep: 12 });
  ids.forEach((id) => g.setNode(id, { width: NODE_W, height: h(id) }));
  links.forEach((l) => g.setEdge(l.source, l.target));
  dagre.layout(g);
  return Object.fromEntries(ids.map((id) => [id, { x: g.node(id).x - NODE_W / 2, y: g.node(id).y - h(id) / 2 }]));
}

/** The drafts a node's two buttons leave in the chat input: `Verb B: "<text>" (<ref_id>)`, no letter for a question. */
const draft = (verb: string, c: ChoiceItem) => `${verb} ${c.letter ? `${c.letter}: ` : ""}"${c.name}" (${c.id})`;
export const expandDraft = (c: ChoiceItem) => draft(c.state === "rejected" && !c.isQuestion ? "Revisit" : "Expand", c);
export const goWithDraft = (c: ChoiceItem) => draft("Go with", c);

const STATE_STYLE: Record<ChoiceState, string> = {
  open: "border-border bg-card",
  chosen: "border-green-500 bg-green-500/10",
  rejected: "border-border bg-muted/40 text-muted-foreground",
  simulated: "border-dashed border-sky-500 bg-card",
  decided: "border-border bg-card",
};
const BADGE: Record<ChoiceState, string> = {
  open: "bg-muted text-muted-foreground",
  chosen: "bg-green-500/20 text-green-700 dark:text-green-400",
  rejected: "bg-muted text-muted-foreground line-through",
  simulated: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  decided: "bg-green-500/20 text-green-700 dark:text-green-400",
};

const DOT: Record<ChoiceState, string> = {
  open: "bg-muted-foreground/40",
  chosen: "bg-green-500",
  rejected: "bg-muted-foreground/60",
  simulated: "bg-sky-500",
  decided: "bg-green-500",
};

interface ChoiceNodeData extends Record<string, unknown> {
  choice: ChoiceItem;
  selected: boolean;
  onSelect: (id: string) => void;
}

const ChoiceNode = memo(function ChoiceNode({ data }: NodeProps<Node<ChoiceNodeData>>) {
  const { choice: c, selected, onSelect } = data;
  const setDraft = useCanvasChatStore((s) => s.setPendingInputDraft);
  const isQuestion = c.isQuestion;
  const by = c.speaker ?? c.madeBy;
  const button = "nodrag rounded border px-1.5 py-0.5 text-[10px] hover:bg-accent";
  const act = (e: React.MouseEvent, message: string) => {
    e.stopPropagation();
    setDraft(message);
  };
  const MadeBy = c.madeBy === "user" ? User : Bot;
  return (
    <div
      className={cn(
        "group flex h-full w-full cursor-pointer flex-col gap-1 rounded-md border px-2 py-1.5 text-xs hover:ring-1 hover:ring-ring/40",
        isQuestion ? "border-border border-l-2 border-l-primary/60 bg-card" : STATE_STYLE[c.state],
        selected && "ring-2 ring-ring",
      )}
      data-state={c.state}
      data-selected={selected}
      onClick={() => onSelect(c.id)}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className={cn("flex items-start gap-1 leading-4", isQuestion ? "text-[13px] font-semibold" : "font-medium", !isQuestion && c.state === "rejected" && "line-through")} title={c.quote ? `${c.name}\n\n“${c.quote}”` : c.name}>
        {isQuestion && <HelpCircle className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" data-question-icon />}
        {!isQuestion && !selected && <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", DOT[c.state])} data-state-dot={c.state} />}
        <span className={cn("min-w-0 flex-1 break-words", !selected && "line-clamp-3")}>
          {c.letter && <span className="mr-1 rounded bg-muted px-1 text-[10px] font-semibold">{c.letter}</span>}
          {c.name}
        </span>
        {isQuestion && c.state === "decided" && (
          <span className="mt-0.5 shrink-0 rounded bg-green-500/20 px-1 text-[10px] font-normal text-green-700 dark:text-green-400">decided</span>
        )}
        {!selected && by && (
          <span className="mt-0.5 shrink-0 text-muted-foreground" title={`made by ${by}`}>
            <MadeBy className="h-3 w-3" />
          </span>
        )}
      </div>
      {selected && (
        <>
          {c.quote && <p className="text-[11px] italic leading-4 text-muted-foreground">“{c.quote}”</p>}
          <div className="flex items-center gap-1">
            {c.state !== "open" && <span className={cn("rounded px-1 text-[10px]", BADGE[c.state])}>{c.state}</span>}
            {by && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground" data-made-by={by}>
                <MadeBy className="h-3 w-3" />
                {by}
              </span>
            )}
          </div>
          {isQuestion && c.criteria && <p className="text-[11px] leading-4 text-muted-foreground">Criteria: {c.criteria}</p>}
          {isQuestion && c.reversibility && <p className="text-[11px] leading-4 text-muted-foreground">Reversibility: {c.reversibility}</p>}
          <div className="mt-auto flex gap-1">
            <button type="button" className={button} title={isQuestion ? "More options" : undefined} onClick={(e) => act(e, expandDraft(c))}>
              {!isQuestion && c.state === "rejected" ? "Revisit" : "Expand"}
            </button>
            {!isQuestion && (
              <button type="button" className={button} onClick={(e) => act(e, goWithDraft(c))}>
                Go with
              </button>
            )}
          </div>
        </>
      )}
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
});

const nodeTypes = { choice: ChoiceNode };

interface TreeResponse {
  nodes?: RawNode[];
  edges?: RawEdge[];
}

/** Polled while open and on window focus, so children Jamie adds appear. */
function useChoices(workspace: string, focus: string, label?: string) {
  return useQuery({
    queryKey: ["choice-tree", workspace, focus, label ?? ""],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/graph/choice-tree?focus=${encodeURIComponent(focus)}${label ? `&label=${encodeURIComponent(label)}` : ""}`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return (await res.json()) as TreeResponse;
    },
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
  });
}

function Tree({ items, links }: ReturnType<typeof buildChoiceTree>) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const onSelect = useCallback((id: string) => setSelectedId((cur) => (cur === id ? null : id)), []);
  const { nodes, edges } = useMemo(() => {
    const heights = Object.fromEntries(items.map((i) => [i.id, estimateNodeHeight(i, i.id === selectedId)]));
    const pos = layoutTree(items.map((i) => i.id), links, heights);
    return {
      nodes: items.map<Node>((choice) => ({
        id: choice.id,
        type: "choice",
        position: pos[choice.id],
        data: { choice, selected: choice.id === selectedId, onSelect } satisfies ChoiceNodeData,
        width: NODE_W,
        height: heights[choice.id],
      })),
      edges: links.map<Edge>((l) => ({ id: `${l.source}>${l.target}`, ...l })),
    };
  }, [items, links, selectedId, onSelect]);
  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.15, maxZoom: 1.1 }} nodesDraggable={false} nodesConnectable={false} minZoom={0.3} onPaneClick={() => setSelectedId(null)} proOptions={{ hideAttribution: true }}>
      <Background />
    </ReactFlow>
  );
}

export function ChoiceTree({ workspace, focus, label }: { workspace: string; focus: string; label?: string }) {
  const { data, isLoading, error } = useChoices(workspace, focus, label);
  const tree = useMemo(() => buildChoiceTree(data?.nodes ?? [], data?.edges ?? [], focus), [data, focus]);
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
