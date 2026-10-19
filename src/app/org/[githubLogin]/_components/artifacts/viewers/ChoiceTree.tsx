"use client";

import React, { memo, useCallback, useMemo, useState } from "react";
import dagre from "@dagrejs/dagre";
import { Background, Handle, Position, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery } from "@tanstack/react-query";
import { Bot, HelpCircle, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasChatStore } from "../../../_state/canvasChatStore";
import type { ChoiceEffect } from "@/services/graph/workbench";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";

/**
 * A brainstorm tree (IBIS-style): `Question` nodes (key `question_id`) and
 * `Option` nodes (key `option_id`; old trees use `Choice`, key `choice_id`,
 * which render as options) linked by `PARENT_OF`: Question->Question (a
 * sub-question), Question->Option, Option->Question (a follow-up question),
 * drawn left to right from the artifact's `focus`. All labels are read unless
 * `label` restricts it. A legacy `Choice` with `kind: "question"` is a
 * question. Siblings are ordered by `option_id`, `choice_id` or `question_id`.
 * Labels join along the path: a sub-question (a question under a question)
 * gets a number among its question siblings, an option a letter among its
 * option siblings, appended to the nearest labelled ancestor's label (`1`,
 * `1A`, `1B`, `2`; follow-up questions and the root have none and pass the
 * label through, so `A` -> `AA`, `AB`). Two adjacent numbers are joined with a
 * dot (`1.1`, `1.1A`) — an assumption matching strut's `choice/tree`.
 * Sub-questions are heading-style with only Expand. Clicking a node's button
 * only drafts a message in the chat input; the user sends it.
 */

const NODE_W = 260;
const CHARS_PER_LINE = 34;
const LINE_H = 16;
const PAD_H = 28;
const CLAMP_LINES = 3;
// Selected node's extra rows: state/made_by line and the action buttons.
const DETAILS_H = 20;
const ACTIONS_H = 30;
// Row gap (gap-1) and the chars per line of the narrower text-[13px] question title / text-[11px] detail lines.
const GAP_H = 4;
const QUESTION_CHARS_PER_LINE = 28;
const DETAIL_CHARS_PER_LINE = 40;
// Selected option's effects: a "Pros" / "Cons" heading, then per effect a name line plus its description lines.
const EFFECT_HEAD_H = 14;
const EFFECT_ROW_GAP = 2;
const EFFECT_CHARS_PER_LINE = 40;
const REFETCH_MS = 15_000;

/**
 * The rule for opening the tree instead of the graph workbench, whatever else
 * the content carries (a stray proposal or changes are ignored): `layout:
 * "tree"`, a brainstorm artifact id (`brainstorm-tree`, `job-x:brainstorm-tree`),
 * or a `label` of `Choice` / `Option` / `Question`. A tree needs a `focus` to open at.
 */
export function isTreeArtifact(artifact: { id: string }, content: ArtifactViewerProps<"graph">["content"]): boolean {
  return content.layout === "tree" || /brainstorm/i.test(artifact.id) || content.label === "Choice" || content.label === "Option" || content.label === "Question";
}

/**
 * A `json` card that is really a brainstorm tree (an agent copied the card
 * as JSON before hive mapped it to `graph`): its `value` is an object with a
 * string `focus` and `workspace`, and `layout: "tree"` or the id
 * `brainstorm-tree`. The graph content to open it with, else null.
 */
export function treeContentOfJson(
  artifact: { id: string },
  content: { value: unknown },
): ArtifactViewerProps<"graph">["content"] | null {
  const v = content.value;
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const { workspace, focus, layout, label } = v as Record<string, unknown>;
  if (typeof workspace !== "string" || typeof focus !== "string") return null;
  if (layout !== "tree" && artifact.id !== "brainstorm-tree") return null;
  return { workspace, focus, layout: "tree", ...(typeof label === "string" ? { label } : {}) };
}

export type ChoiceState = "open" | "chosen" | "rejected" | "simulated" | "decided";
export interface ChoiceItem {
  id: string;
  /** The node's `text`, else `name`, else its ref_id. */
  name: string;
  madeBy?: string;
  state: ChoiceState;
  /** Path label: the nearest labelled ancestor's label + own part (a number for a sub-question, a letter for an option): 1, 1A, 2, A, AA… */
  letter?: string;
  quote?: string;
  kind?: string;
  /** A `Question` node (sub-question or follow-up), or a legacy `Choice` with `kind: "question"`. */
  isQuestion: boolean;
  /** Who said it, shown in place of `madeBy`. */
  speaker?: string;
  criteria?: string;
  reversibility?: string;
  /** An option's pros and cons (`HAS_EFFECT`), highest impact first; absent when it has none. */
  effects?: ChoiceEffect[];
}
interface RawNode {
  ref_id: string;
  properties?: Record<string, unknown>;
  /** `Question`, `Option` or `Choice`, from the node's labels. */
  type?: string;
  effects?: unknown;
}
interface RawEdge {
  source: string;
  target: string;
}

/** `option_id` / `choice_id` / `question_id` order: numeric when both are numbers, else string with numeric collation. */
export function compareChoiceIds(a: unknown, b: unknown): number {
  const x = String(a ?? "");
  const y = String(b ?? "");
  const nx = Number(x);
  const ny = Number(y);
  if (x.trim() !== "" && y.trim() !== "" && !Number.isNaN(nx) && !Number.isNaN(ny)) return nx - ny;
  return x.localeCompare(y, undefined, { numeric: true });
}

const optionLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));
/** Joins an own part onto the inherited label; two adjacent numbers get a dot (1.1). */
const joinLabel = (prefix: string, part: string) => (/\d$/.test(prefix) && /^\d/.test(part) ? `${prefix}.${part}` : prefix + part);
const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);

const isQuestionNode = (n: RawNode) => n.type === "Question" || n.properties?.kind === "question";
const orderKey = (n: RawNode) => n.properties?.option_id ?? n.properties?.choice_id ?? n.properties?.question_id;

/** Defensive client-side copy of the server's sanitising: valid direction and name, impact clamped to 0–1 or null, highest impact first. */
export function toChoiceEffects(raw: unknown): ChoiceEffect[] {
  if (!Array.isArray(raw)) return [];
  const out: ChoiceEffect[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name || (r.direction !== "pro" && r.direction !== "con")) continue;
    const impact = typeof r.impact === "number" && Number.isFinite(r.impact) ? Math.min(1, Math.max(0, r.impact)) : null;
    out.push({ ref_id: typeof r.ref_id === "string" ? r.ref_id : name, name, description: typeof r.description === "string" ? r.description : "", direction: r.direction, impact });
  }
  return out.sort((a, b) => (b.impact ?? -1) - (a.impact ?? -1));
}

/** Pros and cons counts, for the compact summary. */
export const effectCounts = (effects: ChoiceEffect[]) => ({
  pros: effects.filter((e) => e.direction === "pro").length,
  cons: effects.filter((e) => e.direction === "con").length,
});
/** "80%" for an impact of 0.8; null impact has no label. */
export const impactPercent = (impact: number | null) => (impact === null ? null : `${Math.round(impact * 100)}%`);

/** Height of the selected-state effects block (headings, name lines, description lines); 0 with no effects. */
export function effectsHeight(effects: ChoiceEffect[] | undefined, charsPerLine = EFFECT_CHARS_PER_LINE, lineH = LINE_H): number {
  if (!effects?.length) return 0;
  const group = (list: ChoiceEffect[]) =>
    list.length === 0
      ? 0
      : EFFECT_HEAD_H +
        list.reduce((a, e) => a + lineH + (e.description ? Math.max(1, Math.ceil(e.description.length / charsPerLine)) * lineH : 0), 0) +
        list.length * EFFECT_ROW_GAP;
  const pros = group(effects.filter((e) => e.direction === "pro"));
  const cons = group(effects.filter((e) => e.direction === "con"));
  return pros + cons + (pros && cons ? GAP_H : 0);
}

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
  // `letter` is the node's own label; `inherited` is what its children join onto.
  const walk = (id: string, letter: string | undefined, inherited: string) => {
    seen.add(id);
    const p = props(id);
    const state = typeof p.state === "string" && STATES.includes(p.state) ? (p.state as ChoiceState) : "open";
    const self = byId.get(id)!;
    items.push({
      id,
      name: text(p.text) ?? text(p.name) ?? id,
      madeBy: text(p.made_by),
      state,
      letter,
      quote: text(p.quote),
      kind: text(p.kind),
      isQuestion: isQuestionNode(self),
      speaker: text(p.speaker),
      criteria: text(p.criteria),
      reversibility: text(p.reversibility),
      ...(!isQuestionNode(self) && toChoiceEffects(self.effects).length ? { effects: toChoiceEffects(self.effects) } : {}),
    });
    const childPrefix = letter ?? inherited;
    const ordered = (kids.get(id) ?? []).filter((c) => !seen.has(c)).sort((a, b) => compareChoiceIds(orderKey(byId.get(a)!), orderKey(byId.get(b)!)));
    let options = 0;
    let subQuestions = 0;
    for (const child of ordered) {
      if (seen.has(child)) continue;
      links.push({ source: id, target: child });
      const childIsQuestion = isQuestionNode(byId.get(child)!);
      // A question under an option is a follow-up: no own part. Under a question, a numbered sub-question.
      const part = !childIsQuestion ? optionLetter(options++) : self && isQuestionNode(self) ? String(++subQuestions) : undefined;
      walk(child, part === undefined ? undefined : joinLabel(childPrefix, part), childPrefix);
    }
  };
  if (byId.has(focus)) walk(focus, undefined, "");
  return { items, links };
}

/** Rendered height of a node, from its text length (see the constants above). */
export function estimateNodeHeight(
  c: Pick<ChoiceItem, "name" | "quote"> & Partial<Pick<ChoiceItem, "criteria" | "reversibility" | "isQuestion" | "state" | "madeBy" | "speaker" | "effects">>,
  selected: boolean,
): number {
  const lines = (t: string, per = CHARS_PER_LINE) => Math.max(1, Math.ceil(t.length / per));
  const nameLines = lines(c.name, c.isQuestion ? QUESTION_CHARS_PER_LINE : CHARS_PER_LINE);
  if (!selected) return Math.min(CLAMP_LINES, nameLines) * LINE_H + PAD_H;
  // Each rendered row: its height; rows are separated by GAP_H.
  const rows = [nameLines * LINE_H];
  if (c.quote) rows.push(lines(c.quote, DETAIL_CHARS_PER_LINE) * LINE_H);
  if ((c.state && c.state !== "open") || c.speaker || c.madeBy) rows.push(DETAILS_H);
  if (c.isQuestion && c.criteria) rows.push(lines(`Criteria: ${c.criteria}`, DETAIL_CHARS_PER_LINE) * LINE_H);
  if (c.isQuestion && c.reversibility) rows.push(lines(`Reversibility: ${c.reversibility}`, DETAIL_CHARS_PER_LINE) * LINE_H);
  if (!c.isQuestion && c.effects?.length) rows.push(effectsHeight(c.effects));
  rows.push(ACTIONS_H);
  return rows.reduce((a, b) => a + b, 0) + (rows.length - 1) * GAP_H + PAD_H;
}

/** Left-to-right positions, as the graph workbench's tree lays out; `heights` per node id (default 64). */
export function layoutTree(
  ids: string[],
  links: Array<{ source: string; target: string }>,
  heights: Record<string, number> = {},
  spacing: { ranksep?: number; nodesep?: number } = {},
): Record<string, { x: number; y: number }> {
  const h = (id: string) => heights[id] ?? 64;
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", ranksep: spacing.ranksep ?? 64, nodesep: spacing.nodesep ?? 12 });
  ids.forEach((id) => g.setNode(id, { width: NODE_W, height: h(id) }));
  links.forEach((l) => g.setEdge(l.source, l.target));
  dagre.layout(g);
  return Object.fromEntries(ids.map((id) => [id, { x: g.node(id).x - NODE_W / 2, y: g.node(id).y - h(id) / 2 }]));
}

/** The drafts a node's two buttons leave in the chat input: `Verb B: "<text>" (<ref_id>)`, no label for the root or a follow-up question. */
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

/** Compact "+2 −1" pros/cons counts for an unselected option. */
function EffectsSummary({ effects }: { effects: ChoiceEffect[] }) {
  const { pros, cons } = effectCounts(effects);
  return (
    <span className="mt-0.5 flex shrink-0 gap-1 text-[10px] font-medium leading-4" data-effects-summary title={`${pros} pro${pros === 1 ? "" : "s"}, ${cons} con${cons === 1 ? "" : "s"}`}>
      {pros > 0 && <span className="text-green-700 dark:text-green-400">+{pros}</span>}
      {cons > 0 && <span className="text-destructive">−{cons}</span>}
    </span>
  );
}

/** Read-only pros and cons of the selected option; a list with no rows is omitted. */
function EffectsList({ effects }: { effects: ChoiceEffect[] }) {
  return (
    <div className="flex flex-col gap-1" data-effects>
      {(["pro", "con"] as const).map((dir) => {
        const list = effects.filter((e) => e.direction === dir);
        if (!list.length) return null;
        const pro = dir === "pro";
        return (
          <div key={dir} className="flex flex-col gap-0.5">
            <div className={cn("text-[10px] font-semibold uppercase leading-[14px]", pro ? "text-green-700 dark:text-green-400" : "text-destructive")}>{pro ? "Pros" : "Cons"}</div>
            {list.map((e) => (
              <div key={e.ref_id || e.name} data-effect data-direction={dir} title={e.description || e.name}>
                <div className="flex items-center gap-1 text-[11px] leading-4">
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  {e.impact !== null && (
                    <>
                      <span className="h-1 w-8 shrink-0 overflow-hidden rounded bg-muted">
                        <span className={cn("block h-full", pro ? "bg-green-500" : "bg-red-500")} style={{ width: `${Math.round(e.impact * 100)}%` }} />
                      </span>
                      <span className="w-7 shrink-0 text-right text-[10px] text-muted-foreground">{impactPercent(e.impact)}</span>
                    </>
                  )}
                </div>
                {e.description && <p className="text-[11px] leading-4 text-muted-foreground">{e.description}</p>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

interface ChoiceNodeData extends Record<string, unknown> {
  choice: ChoiceItem;
  selected: boolean;
  onSelect: (id: string) => void;
}

const ChoiceNode = memo(function ChoiceNode({ data }: NodeProps<Node<ChoiceNodeData>>) {
  const { choice: c, selected, onSelect } = data;
  const setDraft = useCanvasChatStore((s) => s.setPendingInputDraft);
  const appendDraft = useCanvasChatStore((s) => s.appendPendingInputDraft);
  const isQuestion = c.isQuestion;
  const by = c.speaker ?? c.madeBy;
  const button = "nodrag rounded border px-1.5 py-0.5 text-[10px] hover:bg-accent";
  const act = (e: React.MouseEvent, message: string, append = false) => {
    e.stopPropagation();
    (append ? appendDraft : setDraft)(message);
  };
  const MadeBy = c.madeBy === "user" ? User : Bot;
  const effects = c.effects ?? [];
  return (
    <div
      className={cn(
        "group flex min-h-full w-full cursor-pointer flex-col gap-1 rounded-md border px-2 py-1.5 text-xs hover:ring-1 hover:ring-ring/40",
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
          {c.letter && (
            <span className={cn("mr-1 rounded px-1 text-[10px] font-semibold", isQuestion ? "border border-primary/50" : "bg-muted")} data-label-chip={isQuestion ? "question" : "option"}>
              {c.letter}
            </span>
          )}
          {c.name}
        </span>
        {isQuestion && c.state === "decided" && (
          <span className="mt-0.5 shrink-0 rounded bg-green-500/20 px-1 text-[10px] font-normal text-green-700 dark:text-green-400">decided</span>
        )}
        {!selected && !isQuestion && effects.length > 0 && <EffectsSummary effects={effects} />}
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
          {!isQuestion && effects.length > 0 && <EffectsList effects={effects} />}
          <div className="mt-auto flex gap-1">
            <button type="button" className={button} title={isQuestion ? "More options" : undefined} onClick={(e) => act(e, expandDraft(c))}>
              {!isQuestion && c.state === "rejected" ? "Revisit" : "Expand"}
            </button>
            {!isQuestion && (
              <button type="button" className={button} onClick={(e) => act(e, goWithDraft(c), true)}>
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
