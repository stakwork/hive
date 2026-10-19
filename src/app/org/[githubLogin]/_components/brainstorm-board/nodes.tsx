"use client";

import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { Handle, NodeToolbar, Position, type Node, type NodeProps } from "@xyflow/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { ChoiceItem } from "../artifacts/viewers/ChoiceTree";
import { cardActions, type DeskAction } from "./actions";
import { hand, typed } from "./fonts";
import { RED } from "./edges";
import { CARD_W } from "./layout";
import { LINEN } from "./linen";
import { isPerson, memberLabel, type BoardMember } from "./model";
import { penCircle, seeded, tilt } from "./rough";

/**
 * The desk's cards. The paper says what a card is: handwritten on taped paper
 * when a person wrote it, typed on an index card when Jamie did, pencil on
 * tracing paper for a "could be". Settled cards are tea-tinted, a decided
 * question has its corner folded over, a dropped option is crumpled, a chosen
 * one circled in red pen, and the open question on the path is highlighted.
 */

const PAPER = "#f5ebc4";
const AGED = "#ecdba4";
const LINED: CSSProperties = {
  backgroundImage:
    "linear-gradient(90deg, transparent 30px, rgba(200,69,44,.45) 30px 31px, transparent 31px), repeating-linear-gradient(transparent 0 25px, rgba(70,110,170,.35) 25px 26px)",
  backgroundPosition: "0 8px",
};
const INDEX: CSSProperties = {
  backgroundImage:
    "linear-gradient(transparent 25px, rgba(200,69,44,.35) 25px 26px, transparent 26px), repeating-linear-gradient(transparent 0 21px, rgba(70,110,170,.13) 21px 22px)",
  backgroundPosition: "0 0, 0 26px",
};
const SHADOW = "0 1px 2px rgba(80,60,20,.12), 2px 4px 10px rgba(80,60,20,.18)";
const GRAIN_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .4  0 0 0 0 .3  0 0 0 0 .15  0 0 0 .16 0'/></filter><rect width='100%' height='100%' filter='url(#g)'/></svg>";
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(GRAIN_SVG)}")`;

export interface CardData extends Record<string, unknown> {
  item: ChoiceItem;
  ghost: boolean;
  dim: boolean;
  selected: boolean;
  /** The open question at the end of the chosen path: where the brainstorm stands. */
  frontier: boolean;
  /** Written on the desk, not saved yet. */
  pencil: boolean;
  /** The org member who wrote it, if made_by / speaker names one. */
  member: BoardMember | null;
  onSize: (id: string, height: number) => void;
  onAct: (action: DeskAction, item: ChoiceItem) => void;
}

/** Settled: a decided question or a chosen option. */
const settled = (item: ChoiceItem) => item.state === "decided" || item.state === "chosen";

/** Paper fibre, and on settled paper a faint tea blotch. */
function Grain({ aged, seed }: { aged: boolean; seed: string }) {
  const r = seeded(`${seed}tea`);
  const blotch = aged
    ? `radial-gradient(ellipse at ${20 + r() * 60}% ${55 + r() * 35}%, rgba(150,95,30,.16), rgba(150,95,30,.05) 30%, transparent 45%), `
    : "";
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 mix-blend-multiply"
      style={{ backgroundImage: `${blotch}${GRAIN}` }}
    />
  );
}

function Fold() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute right-0 top-0 h-[26px] w-[26px]"
      style={{
        background: `linear-gradient(225deg, ${LINEN} 0 50%, #d9c387 50% 100%)`,
        boxShadow: "-2px 2px 3px rgba(80,60,20,.16)",
      }}
      data-fold
    />
  );
}

/** Filters the cards share, mounted once on the desk: the crumple of a dropped card. */
export function PaperDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <filter id="desk-crumple" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed="7" result="n" />
        <feDiffuseLighting in="n" lightingColor="#fff" surfaceScale="2.4" result="light">
          <feDistantLight azimuth="235" elevation="58" />
        </feDiffuseLighting>
        <feComponentTransfer in="light" result="soft">
          <feFuncR type="linear" slope="0.32" intercept="0.7" />
          <feFuncG type="linear" slope="0.32" intercept="0.7" />
          <feFuncB type="linear" slope="0.32" intercept="0.7" />
        </feComponentTransfer>
        <feComposite in="soft" in2="SourceGraphic" operator="in" result="lit" />
        <feBlend in="SourceGraphic" in2="lit" mode="multiply" />
      </filter>
    </svg>
  );
}
const CRUMPLE: CSSProperties = { filter: "url(#desk-crumple)" };

/** A highlighter swipe behind the open question on the path. */
function Marker({ on, children }: { on: boolean; children: React.ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <span
      className="[box-decoration-break:clone]"
      style={{
        backgroundImage:
          "linear-gradient(transparent 55%, rgba(255,206,70,.6) 55%, rgba(255,206,70,.6) 92%, transparent 92%)",
      }}
    >
      {children}
    </span>
  );
}

/** Signature and avatar: only for a real member. */
function Author({ member }: { member: BoardMember }) {
  const name = memberLabel(member);
  return (
    <div className="absolute right-2 top-2" data-author-avatar>
      <Avatar className="h-7 w-7 border border-black/20 bg-white">
        {member.image && <AvatarImage src={member.image} alt={name} />}
        <AvatarFallback className="bg-[#e7d9a3] text-[13px] text-[#4b3f1e]">{name[0]?.toUpperCase()}</AvatarFallback>
      </Avatar>
    </div>
  );
}

/** State, and for a question its criteria and reversibility. */
function Details({ item }: { item: ChoiceItem }) {
  const rows: Array<[string, string]> = [["state", item.state]];
  if (item.criteria) rows.push(["criteria", item.criteria]);
  if (item.reversibility) rows.push(["reversible", item.reversibility === "two_way" ? "yes" : "no"]);
  return (
    <dl
      className="relative mt-1 grid grid-cols-[72px_1fr] gap-x-2 border-t border-black/15 pt-1 text-[15px] leading-tight [overflow-wrap:anywhere]"
      data-details
    >
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="opacity-70">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Pencilled() {
  return <span className="text-[14px] italic text-[#7b7b7b]">in pencil · not saved</span>;
}

function PersonCard({ d }: { d: CardData }) {
  const { item, selected, member } = d;
  const chosen = item.state === "chosen";
  const simulated = item.state === "simulated";
  return (
    <div className={cn("relative", hand.className)} style={{ width: CARD_W, transform: `rotate(${tilt(item.id)}deg)` }}>
      <div
        className="absolute -top-3 left-1/2 z-[1] h-5 w-20 -translate-x-1/2 rotate-[-3deg] bg-[rgba(214,201,150,.7)] shadow-sm"
        aria-hidden
      />
      <div
        className={cn(
          "relative flex flex-col gap-1 px-4 pb-3 pt-5 text-[#2b261a]",
          item.isQuestion && "pl-10",
          simulated && "border-2 border-dashed border-[rgba(90,90,90,.55)]",
          selected && "outline outline-2 outline-offset-4 outline-[#2b6cb0]",
        )}
        style={{
          ...(item.isQuestion ? LINED : {}),
          backgroundColor: simulated ? "rgba(255,255,255,.45)" : settled(item) ? AGED : PAPER,
          boxShadow: simulated ? undefined : SHADOW,
          ...(item.state === "rejected" ? CRUMPLE : {}),
        }}
        data-person
      >
        {!simulated && <Grain aged={settled(item)} seed={item.id} />}
        {item.isQuestion && item.state === "decided" && <Fold />}
        {member && <Author member={member} />}
        <p
          data-node-text
          className={cn(
            "relative min-w-0 text-[20px] leading-tight [overflow-wrap:anywhere]",
            member && "pr-8",
            (chosen || item.isQuestion) && "font-bold",
            item.state === "rejected" && "line-through",
          )}
        >
          {item.letter && <b className="mr-1 text-[#8a6a43]">{item.letter}</b>}
          <Marker on={d.frontier}>{item.name}</Marker>
        </p>
        {selected && item.quote && (
          <p className="relative text-[16px] italic leading-snug text-[#5b5236] [overflow-wrap:anywhere]">
            “{item.quote}”
          </p>
        )}
        {selected && !d.pencil && <Details item={item} />}
        {(d.pencil || member) && (
          <p className="relative mt-auto flex items-baseline justify-between gap-2 pt-1 text-[17px]" data-signature>
            {d.pencil ? <Pencilled /> : <span />}
            {member && <span>— {memberLabel(member)}</span>}
          </p>
        )}
      </div>
      {chosen && !item.isQuestion && <PenCircle id={item.id} />}
    </div>
  );
}

function AgentCard({ d }: { d: CardData }) {
  const { item, selected } = d;
  const simulated = item.state === "simulated";
  return (
    <div
      className={cn("relative", typed.className)}
      style={{ width: CARD_W, transform: `rotate(${tilt(item.id, 0.5)}deg)` }}
    >
      <div
        className={cn(
          "relative flex flex-col gap-1.5 rounded-[2px] px-3.5 pb-3 pt-2",
          simulated
            ? "border-[1.5px] border-dashed border-[rgba(90,90,90,.55)] text-[#5d5d5d] backdrop-blur-[1.5px]"
            : "border border-[#e1d8c2] text-[#1f1d18]",
          selected && "outline outline-2 outline-offset-4 outline-[#2b6cb0]",
        )}
        style={{
          ...(simulated ? {} : INDEX),
          backgroundColor: simulated ? "rgba(255,255,255,.42)" : settled(item) ? "#f3ead2" : "#fdfbf4",
          boxShadow: simulated ? undefined : SHADOW,
          ...(item.state === "rejected" ? CRUMPLE : {}),
        }}
        data-agent
      >
        {!simulated && <Grain aged={settled(item)} seed={item.id} />}
        {item.isQuestion && item.state === "decided" && <Fold />}
        <div className="relative text-[11.5px] uppercase leading-[14px] tracking-[.1em] text-[#8b8473]">
          {simulated ? "pencilled in · could be" : "typed by jamie"}
        </div>
        <p
          data-node-text
          className={cn(
            "relative mt-1 min-w-0 text-[17px] leading-[1.3] [overflow-wrap:anywhere]",
            item.isQuestion && "font-bold",
            item.state === "rejected" && "line-through",
          )}
        >
          {item.letter && <span className="mr-1.5 text-[#8b8473]">{item.letter}</span>}
          <Marker on={d.frontier}>{item.name}</Marker>
        </p>
        {selected && item.quote && (
          <p className="relative text-[14px] italic leading-snug [overflow-wrap:anywhere]">“{item.quote}”</p>
        )}
        {selected && <Details item={item} />}
      </div>
      {item.state === "chosen" && !item.isQuestion && <PenCircle id={item.id} />}
    </div>
  );
}

/** The red pen circle round a chosen option, sized to the card by CSS. */
function PenCircle({ id }: { id: string }) {
  const W = CARD_W + 28;
  const H = 120;
  return (
    <svg
      className="pointer-events-none absolute -inset-[14px] overflow-visible"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: "calc(100% + 28px)", height: "calc(100% + 28px)" }}
      data-pen-circle
    >
      <path
        d={penCircle(id, W, H)}
        fill="none"
        stroke={RED}
        strokeWidth={3.2}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** The selected card's actions, floating above it at a readable size whatever the zoom. */
function Toolbar({ d }: { d: CardData }) {
  const actions = cardActions(d.item, { pencil: d.pencil, person: isPerson(d.item.madeBy) });
  return (
    <div
      className={cn(
        "nodrag nopan flex items-center gap-0.5 rounded-full border border-[#cdbf9c] bg-[#fbf6e6] p-1 shadow-[0_1px_2px_rgba(80,60,20,.1),0_6px_18px_rgba(80,60,20,.14)] animate-in fade-in-0 zoom-in-95",
        hand.className,
      )}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      data-actions
    >
      {actions.map((a, i) => (
        <button
          key={a.action}
          type="button"
          className={cn(
            "whitespace-nowrap rounded-full px-3 py-0.5 text-[18px] transition-colors active:scale-[.97]",
            i === 0 ? "bg-[#2f2b26] text-[#fbf6e6] hover:bg-black" : "text-[#2f2b26] hover:bg-[rgba(138,106,67,.13)]",
          )}
          onClick={() => d.onAct(a.action, d.item)}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

/** Reports a node's rendered height, so the layout can use it over its estimate. */
function useReportSize(id: string, onSize: (id: string, height: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    onSize(id, el.offsetHeight);
    const ro = new ResizeObserver(() => onSize(id, el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, onSize]);
  return ref;
}

export const CardNode = memo(function CardNode({ data }: NodeProps<Node<CardData>>) {
  const id = data.item.id;
  const ref = useReportSize(id, data.onSize);
  return (
    <div
      ref={ref}
      className={cn(
        "cursor-pointer",
        data.ghost && "opacity-[0.55] saturate-50",
        data.dim && !data.ghost && "opacity-[0.7]",
      )}
      style={{ width: CARD_W }}
      data-board-node
      data-state={data.item.state}
      data-pencil={data.pencil || undefined}
      data-ref={id}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      {isPerson(data.item.madeBy) ? <PersonCard d={data} /> : <AgentCard d={data} />}
      <Handle type="source" position={Position.Right} className="!opacity-0" />
      {data.selected && (
        <NodeToolbar isVisible position={Position.Top} offset={16}>
          <Toolbar d={data} />
        </NodeToolbar>
      )}
    </div>
  );
});

export interface SlotData extends Record<string, unknown> {
  question: string;
  onAdd: (question: string) => void;
  onSize: (id: string, height: number) => void;
}

/** "+ another option" under an open question: there is always another one. */
export const SlotNode = memo(function SlotNode({ id, data }: NodeProps<Node<SlotData>>) {
  const ref = useReportSize(id, data.onSize);
  return (
    <div ref={ref} style={{ width: CARD_W }}>
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <button
        type="button"
        className={cn(
          "nodrag flex h-[46px] w-full items-center justify-center rounded-md border-[1.5px] border-dashed border-[rgba(138,106,67,.55)] bg-[rgba(251,246,230,.35)] text-[19px] text-[#8a6a43] transition-colors hover:border-[#8a6a43] hover:bg-[rgba(251,246,230,.95)] hover:text-[#2f2b26] active:scale-[.97]",
          hand.className,
        )}
        onClick={(e) => {
          e.stopPropagation();
          data.onAdd(data.question);
        }}
        data-slot={data.question}
      >
        + another option
      </button>
    </div>
  );
});

export interface DraftData extends Record<string, unknown> {
  kind: "question" | "option";
  /** A new brainstorm's first question: bigger, with a workspace picker when there is a choice. */
  root: boolean;
  initial: string;
  workspaces: string[];
  ws: string;
  onWorkspace: (ws: string) => void;
  onCommit: (text: string) => void;
  onCancel: () => void;
  onSize: (id: string, height: number) => void;
}

/** A card being written: Enter keeps it (in pencil), Esc or an empty blur throws it away. */
export const DraftNode = memo(function DraftNode({ id, data }: NodeProps<Node<DraftData>>) {
  const ref = useReportSize(id, data.onSize);
  const input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(data.initial);
  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);
  const placeholder = data.root
    ? "What are we deciding?"
    : data.kind === "option"
      ? "Another option…"
      : "A follow-up question…";
  return (
    <div
      ref={ref}
      className={cn("relative animate-in fade-in-0 zoom-in-95", hand.className)}
      style={{
        width: data.root ? 420 : CARD_W,
        padding: data.root ? "22px 22px 12px 48px" : data.kind === "question" ? "18px 16px 8px 40px" : "18px 16px 8px",
        backgroundColor: PAPER,
        boxShadow: SHADOW,
        transform: "rotate(-.6deg)",
        ...(data.kind === "question" ? LINED : {}),
      }}
      data-draft
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <textarea
        ref={input}
        value={text}
        rows={2}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(
          "nodrag nowheel nopan w-full resize-none bg-transparent leading-[1.15] text-[#2b261a] outline-none placeholder:text-[#8a6a43]/60",
          data.root ? "text-[30px]" : "text-[20px]",
          data.kind === "question" && "font-bold",
        )}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (text.trim()) data.onCommit(text.trim());
            else data.onCancel();
          }
          if (e.key === "Escape") data.onCancel();
        }}
        onBlur={(e) => {
          // Moving to the workspace picker is not leaving the card.
          if (e.relatedTarget instanceof HTMLElement && e.currentTarget.parentElement?.contains(e.relatedTarget))
            return;
          if (!text.trim()) data.onCancel();
        }}
      />
      <div className="flex items-center justify-between gap-2 text-[14px] text-[#8a6a43]">
        <span>Enter to add · Esc to cancel</span>
        {data.root && data.workspaces.length > 1 && (
          <select
            aria-label="Workspace"
            className="nodrag rounded border border-[#cdbf9c] bg-transparent px-1 text-[14px]"
            value={data.ws}
            onChange={(e) => data.onWorkspace(e.target.value)}
          >
            {data.workspaces.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
});

export interface HeadingData extends Record<string, unknown> {
  title: string;
  subtitle: string;
}

/** A workspace's handwritten heading on the desk: no frame, just ink. */
export const HeadingNode = memo(function HeadingNode({ data }: NodeProps<Node<HeadingData>>) {
  return (
    <div className={cn("pointer-events-none whitespace-nowrap text-[#3d3626]", hand.className)} data-heading>
      <div className="text-[110px] leading-none">{data.title}</div>
      <div className="mt-2 text-[44px] text-[#8a6a43]">{data.subtitle}</div>
      <svg width="420" height="22" viewBox="0 0 420 22" className="mt-1 block" aria-hidden>
        <path
          d="M4 14 C 100 5, 210 20, 416 9"
          fill="none"
          stroke="rgba(61,54,38,.55)"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
});

export const nodeTypes = { card: CardNode, slot: SlotNode, draft: DraftNode, heading: HeadingNode };
