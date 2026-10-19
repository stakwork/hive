"use client";

import { memo, useEffect, useRef, type CSSProperties } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { ChoiceItem } from "../artifacts/viewers/ChoiceTree";
import type { BoardAction } from "./actions";
import { hand, mono } from "./fonts";
import { RED } from "./edges";
import { CARD_W } from "./layout";
import { isPerson, memberLabel, type BoardMember } from "./model";
import { penCircle, tilt } from "./rough";

const PAPER = "#f5ebc4";
const LINED: CSSProperties = {
  backgroundColor: PAPER,
  backgroundImage:
    "linear-gradient(90deg, transparent 30px, rgba(200,69,44,.45) 30px 31px, transparent 31px), repeating-linear-gradient(transparent 0 25px, rgba(70,110,170,.35) 25px 26px)",
  backgroundPosition: "0 8px",
};

export interface CardData extends Record<string, unknown> {
  item: ChoiceItem;
  /** Estimated height; the card's own height is reported through `onSize`. */
  height: number;
  ghost: boolean;
  dim: boolean;
  selected: boolean;
  /** The org member who wrote it, if made_by / speaker names one. */
  member: BoardMember | null;
  /** The board's root: "Start here" would be a no-op. */
  isRoot: boolean;
  onSize: (id: string, height: number) => void;
  onAct: (action: BoardAction | "start-here", item: ChoiceItem) => void;
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

const btn = "nodrag nopan rounded border border-[#d2d2d7] bg-white px-2 py-0.5 text-[13px] font-medium text-[#1d1d1f] shadow-sm hover:bg-[#f2f2f4]";

function Actions({ d }: { d: CardData }) {
  const { item } = d;
  const act = (e: React.MouseEvent, a: BoardAction | "start-here") => {
    e.stopPropagation();
    d.onAct(a, item);
  };
  const sans = "font-sans";
  return (
    <div className={cn("nodrag nopan mt-1 flex flex-wrap gap-1.5", sans)} data-actions>
      {!item.isQuestion && item.state !== "chosen" && (
        <button type="button" className={btn} onClick={(e) => act(e, "go-with")}>
          Go with
        </button>
      )}
      {!item.isQuestion && item.state === "chosen" && (
        <button type="button" className={btn} onClick={(e) => act(e, "deselect")}>
          Deselect
        </button>
      )}
      <button type="button" className={btn} onClick={(e) => act(e, "expand")}>
        Expand
      </button>
      {item.isQuestion && (
        <button type="button" className={btn} onClick={(e) => act(e, "add-idea")}>
          Add idea
        </button>
      )}
      {!d.isRoot && (
        <button type="button" className={btn} title="Open the board with this node as its root" onClick={(e) => act(e, "start-here")}>
          Start here
        </button>
      )}
    </div>
  );
}

const SIM_DASH = "border-2 border-dashed border-sky-500";

function PersonCard({ d }: { d: CardData }) {
  const { item, selected, member } = d;
  const chosen = item.state === "chosen";
  const simulated = item.state === "simulated";
  return (
    <div className={cn("relative", hand.className)} style={{ width: CARD_W, transform: `rotate(${tilt(item.id)}deg)` }}>
      {/* A strip of tape. */}
      <div className="absolute -top-3 left-1/2 h-5 w-20 -translate-x-1/2 rotate-[-3deg] bg-[rgba(214,201,150,.75)] shadow-sm" aria-hidden />
      <div
        className={cn(
          "relative flex flex-col gap-1 px-4 pb-3 pt-5 text-[#2e2a1c] shadow-[2px_4px_10px_rgba(80,60,20,.25)]",
          item.isQuestion && "pl-10",
          simulated && SIM_DASH,
          selected && "outline outline-2 outline-offset-4 outline-[#2b6cb0]",
        )}
        style={item.isQuestion ? LINED : { backgroundColor: PAPER }}
        data-person
      >
        {member && <Author member={member} />}
        <p data-node-text className={cn("min-w-0 text-[20px] leading-tight [overflow-wrap:anywhere]", member && "pr-8", chosen && "font-bold", item.isQuestion && "font-semibold")}>
          {item.letter && <b className="mr-1 text-[#8a6a43]">{item.letter}</b>}
          {item.name}
        </p>
        {selected && item.quote && <p className="text-[16px] italic leading-snug text-[#5b5236] [overflow-wrap:anywhere]">“{item.quote}”</p>}
        {selected && <Details item={item} />}
        {member && <p className="mt-auto self-end pt-1 text-[17px]" data-signature>— {memberLabel(member)}</p>}
        {selected && <Actions d={d} />}
      </div>
      {chosen && !item.isQuestion && <PenCircle id={item.id} />}
    </div>
  );
}

/** The red pen circle round a chosen option, sized to the card by CSS. */
function PenCircle({ id }: { id: string }) {
  const W = CARD_W + 28;
  const H = 120;
  return (
    <svg className="pointer-events-none absolute -inset-[14px] overflow-visible" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "calc(100% + 28px)", height: "calc(100% + 28px)" }} data-pen-circle>
      <path d={penCircle(id, W, H)} fill="none" stroke={RED} strokeWidth={3.2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** State, and for a question its criteria and reversibility. */
function Details({ item }: { item: ChoiceItem }) {
  const rows: Array<[string, string]> = [["state", item.state]];
  if (item.criteria) rows.push(["criteria", item.criteria]);
  if (item.reversibility) rows.push(["reversible", item.reversibility === "two_way" ? "yes" : "no"]);
  return (
    <dl className="mt-1 grid grid-cols-[72px_1fr] gap-x-2 border-t border-black/15 pt-1 text-[15px] leading-tight [overflow-wrap:anywhere]" data-details>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="opacity-70">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function AgentCard({ d }: { d: CardData }) {
  const { item, selected } = d;
  const simulated = item.state === "simulated";
  const chosen = item.state === "chosen";
  return (
    <div className={cn("relative", mono.className)} style={{ width: CARD_W }}>
      {simulated && <div className="absolute inset-0 translate-x-2 translate-y-2 rounded-sm border border-dashed border-sky-500/60 bg-sky-100/60" aria-hidden />}
      <div
        className={cn(
          "relative flex flex-col gap-1.5 rounded-sm bg-white px-3 pb-3 pt-2 text-[#1e2530] shadow-sm",
          simulated ? SIM_DASH : "border border-[#cfc8b8]",
          item.isQuestion && !simulated && "border-l-[5px] border-l-[#1e2530]",
          chosen && "ring-2 ring-[#c8452c] ring-offset-2 ring-offset-transparent",
          selected && "outline outline-2 outline-offset-4 outline-[#2b6cb0]",
        )}
        data-agent
      >
        <div className="flex flex-wrap items-center gap-1 text-[15px] leading-none">
          <span className="rounded-sm bg-[#ebe7dc] px-1.5 py-0.5">{item.isQuestion ? "Question" : "Option"} · agent</span>
          {simulated && <span className="rounded-sm bg-sky-100 px-1.5 py-0.5 text-sky-800">simulated</span>}
        </div>
        <p data-node-text className="min-w-0 text-[21px] leading-tight [overflow-wrap:anywhere]">
          {item.letter && <b className="mr-1.5 text-[#6b7280]">{item.letter}</b>}
          {item.name}
        </p>
        {selected && item.quote && <p className="text-[16px] italic leading-snug [overflow-wrap:anywhere]">“{item.quote}”</p>}
        {selected && <Details item={item} />}
        {selected && <Actions d={d} />}
      </div>
    </div>
  );
}

export const CardNode = memo(function CardNode({ data }: NodeProps<Node<CardData>>) {
  const ref = useRef<HTMLDivElement>(null);
  const { onSize } = data;
  const id = data.item.id;
  // Report the card's real height, so the layout can use it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    onSize(id, el.offsetHeight);
    const ro = new ResizeObserver(() => onSize(id, el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, onSize]);
  return (
    <div
      ref={ref}
      className={cn("cursor-pointer", data.ghost && "opacity-[0.55] saturate-50", data.dim && !data.ghost && "opacity-[0.7]")}
      style={{ width: CARD_W }}
      data-board-node
      data-state={data.item.state}
      data-ghost={data.ghost || undefined}
      data-ref={id}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      {isPerson(data.item.madeBy) ? <PersonCard d={data} /> : <AgentCard d={data} />}
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
});

export const nodeTypes = { card: CardNode };
