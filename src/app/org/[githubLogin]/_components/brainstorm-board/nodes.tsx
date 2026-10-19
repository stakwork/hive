"use client";

import { memo, useEffect, useRef, type CSSProperties } from "react";
import { Handle, Position, useStore, type Node, type NodeProps } from "@xyflow/react";
import { X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { ChoiceItem } from "../artifacts/viewers/ChoiceTree";
import { hand, mono } from "./fonts";
import { RED } from "./edges";
import { CARD_W } from "./layout";
import { penCircle, tilt } from "./rough";
import { authorName, isPerson, type BoardMember, type Zone } from "./zones";

/** Below this zoom the board is "far": details hide and the handwriting grows. */
export const FAR_ZOOM = 0.5;
const useFar = () => useStore((s) => s.transform[2] < FAR_ZOOM);

/** Grows with zoom-out (1 at 100%, up to 2.2×) so what sits in a corner stays readable. */
const keepReadable: CSSProperties = { transform: "scale(clamp(1, calc(1 / var(--bb-zoom, 1)), 2.2))", transformOrigin: "top right" };

const PAPER = "#f5ebc4";
const LINED: CSSProperties = {
  backgroundColor: PAPER,
  backgroundImage:
    "linear-gradient(90deg, transparent 30px, rgba(200,69,44,.45) 30px 31px, transparent 31px), repeating-linear-gradient(transparent 0 25px, rgba(70,110,170,.35) 25px 26px)",
  backgroundPosition: "0 8px",
};

export interface CardData extends Record<string, unknown> {
  item: ChoiceItem;
  zone: Zone;
  height: number;
  /** A chosen option or decided question that shipped: the built stamp / pill. */
  built: boolean;
  ghost: boolean;
  dim: boolean;
  selected: boolean;
  member: BoardMember | null;
}

function Author({ item, member }: { item: ChoiceItem; member: BoardMember | null }) {
  const name = authorName(item);
  const initial = (member?.name ?? name).trim()[0]?.toUpperCase() ?? "?";
  return (
    <div className="absolute right-2 top-2" style={keepReadable} data-author-avatar>
      <Avatar className="h-7 w-7 border border-black/20 bg-white">
        {member?.image && <AvatarImage src={member.image} alt={member.name ?? name} />}
        <AvatarFallback className="bg-[#e7d9a3] text-[13px] text-[#4b3f1e]">{initial}</AvatarFallback>
      </Avatar>
    </div>
  );
}

function PersonCard({ d, far }: { d: CardData; far: boolean }) {
  const { item, built, selected } = d;
  const chosen = item.state === "chosen";
  return (
    <div className={cn("relative", hand.className)} style={{ width: CARD_W, minHeight: d.height, transform: `rotate(${tilt(item.id)}deg)` }}>
      {/* A strip of tape. */}
      <div className="absolute -top-3 left-1/2 h-5 w-20 -translate-x-1/2 rotate-[-3deg] bg-[rgba(214,201,150,.75)] shadow-sm" aria-hidden />
      <div
        className={cn("relative flex h-full flex-col gap-1 px-4 pb-3 pt-5 text-[#2e2a1c] shadow-[2px_4px_10px_rgba(80,60,20,.25)]", item.isQuestion && "pl-10", selected && "outline outline-2 outline-offset-4 outline-[#2b6cb0]")}
        style={{ minHeight: d.height, ...(item.isQuestion ? LINED : { backgroundColor: PAPER }) }}
        data-person
      >
        <Author item={item} member={d.member} />
        <p className={cn("pr-8 leading-tight", far ? "text-[34px]" : "text-[20px]", chosen && "font-bold", item.isQuestion && "font-semibold")}>{item.letter && <b className="mr-1 text-[#8a6a43]">{item.letter}</b>}{item.name}</p>
        {!far && item.quote && <p className="text-[16px] italic leading-snug text-[#5b5236]">“{item.quote}”</p>}
        <p className={cn("mt-auto self-end pt-1", far ? "text-[26px]" : "text-[17px]")}>— {authorName(item)}</p>
      </div>
      {built && (
        <span className="pointer-events-none absolute -bottom-2 left-3 rotate-[-8deg] rounded-sm border-2 border-[#8a3b2a] px-2 text-[18px] uppercase tracking-widest text-[#8a3b2a] opacity-80" data-built-stamp>
          built
        </span>
      )}
      {chosen && !item.isQuestion && (
        <svg className="pointer-events-none absolute -inset-[14px] overflow-visible" width={CARD_W + 28} height={d.height + 28} viewBox={`0 0 ${CARD_W + 28} ${d.height + 28}`} preserveAspectRatio="none" style={{ width: "calc(100% + 28px)", height: "calc(100% + 28px)" }} data-pen-circle>
          <path d={penCircle(item.id, CARD_W + 28, d.height + 28)} fill="none" stroke={RED} strokeWidth={3.2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
    </div>
  );
}

function AgentCard({ d, far }: { d: CardData; far: boolean }) {
  const { item, built, selected } = d;
  const simulated = item.state === "simulated";
  const chosen = item.state === "chosen";
  const rows: Array<[string, string]> = [];
  if (item.reversibility) rows.push(["reversible", item.reversibility === "two_way" ? "yes" : "no"]);
  if (item.criteria) rows.push(["criteria", item.criteria]);
  rows.push(["state", item.state]);
  return (
    <div className={cn("relative", mono.className)} style={{ width: CARD_W, minHeight: d.height }}>
      {simulated && <div className="absolute inset-0 translate-x-2 translate-y-2 rounded-sm border border-dashed border-sky-500/60 bg-sky-100/60" aria-hidden />}
      <div
        className={cn(
          "relative flex flex-col gap-1.5 rounded-sm bg-white px-3 pb-3 pt-2 text-[#1e2530] shadow-sm",
          simulated ? "border-2 border-dashed border-sky-500" : "border border-[#cfc8b8]",
          item.isQuestion && !simulated && "border-l-[5px] border-l-[#1e2530]",
          chosen && "ring-2 ring-[#c8452c] ring-offset-2 ring-offset-transparent",
          selected && "outline outline-2 outline-offset-4 outline-[#2b6cb0]",
        )}
        style={{ minHeight: d.height }}
        data-agent
      >
        {far && <div className={cn("-mx-3 -mt-2 mb-1 h-4 rounded-t-sm", simulated ? "bg-sky-500" : "bg-[#1e2530]")} data-far-bar />}
        {!far && (
          <div className="flex flex-wrap items-center gap-1 text-[15px] leading-none">
            <span className="rounded-sm bg-[#ebe7dc] px-1.5 py-0.5">{item.isQuestion ? "Question" : "Option"} · agent</span>
            {built && <span className="rounded-sm bg-emerald-100 px-1.5 py-0.5 text-emerald-800">built</span>}
            {simulated && <span className="rounded-sm bg-sky-100 px-1.5 py-0.5 text-sky-800">simulated</span>}
          </div>
        )}
        <p className={cn("leading-tight", far ? "text-[34px]" : "text-[21px]")}>{item.letter && <b className="mr-1.5 text-[#6b7280]">{item.letter}</b>}{item.name}</p>
        {!far && (
          <table className="mt-1 w-full border-t border-[#e4dfd2] text-[16px] leading-tight">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k} className="align-top">
                  <td className="w-[74px] pr-2 pt-0.5 text-[#6b7280]">{k}</td>
                  <td className="pt-0.5">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export const CardNode = memo(function CardNode({ data }: NodeProps<Node<CardData>>) {
  const far = useFar();
  const person = isPerson(data.item.madeBy);
  return (
    <div
      className={cn("cursor-pointer", data.ghost && "opacity-35 saturate-50", data.dim && !data.ghost && "opacity-55")}
      data-state={data.item.state}
      data-zone={data.zone}
      data-ghost={data.ghost || undefined}
      data-ref={data.item.id}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      {person ? <PersonCard d={data} far={far} /> : <AgentCard d={data} far={far} />}
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
});

export interface NoteData extends Record<string, unknown> {
  text: string;
  autoFocus: boolean;
  onText: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  noteId: string;
}

/** A private sticky note: this browser's localStorage only, never the graph. */
export const NoteNode = memo(function NoteNode({ data }: NodeProps<Node<NoteData>>) {
  const far = useFar();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (data.autoFocus) ref.current?.focus();
  }, [data.autoFocus]);
  return (
    <div className={cn("group relative w-[200px]", hand.className)} style={{ transform: `rotate(${tilt(data.noteId, 2.4)}deg)` }} data-note>
      <div className="absolute -top-3 left-1/2 h-5 w-16 -translate-x-1/2 bg-[rgba(190,215,235,.75)] shadow-sm" aria-hidden />
      <div className="bg-[#ffe9a6] p-3 shadow-[2px_4px_10px_rgba(80,60,20,.25)]">
        <div className="mb-1 flex items-center justify-between text-[13px] uppercase tracking-wide text-[#8a6a43]">
          <span>private note</span>
          <button type="button" aria-label="Delete note" className="nodrag rounded p-0.5 opacity-0 hover:bg-black/10 group-hover:opacity-100" onClick={() => data.onDelete(data.noteId)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <textarea
          ref={ref}
          value={data.text}
          rows={3}
          placeholder="Jot something…"
          onChange={(e) => data.onText(data.noteId, e.target.value)}
          className={cn("nodrag nowheel nopan w-full resize-none bg-transparent leading-snug outline-none placeholder:text-[#8a6a43]/60", far ? "text-[30px]" : "text-[19px]")}
        />
      </div>
    </div>
  );
});

export interface ZoneData extends Record<string, unknown> {
  zone: Zone;
  title: string;
  subtitle: string;
  width: number;
  height: number;
  grid: boolean;
  empty: boolean;
}

const ISO = "rgba(70,130,210,.20)";
const ISO_GRID: CSSProperties = {
  backgroundImage: [30, 150, 90].map((a) => `repeating-linear-gradient(${a}deg, ${ISO} 0 1px, transparent 1px 38px)`).join(", "),
  WebkitMaskImage: "radial-gradient(closest-side, #000 45%, transparent 100%)",
  maskImage: "radial-gradient(closest-side, #000 45%, transparent 100%)",
};

/** A zone's heading, and for the future zone the faint blue isometric grid, fading at the edges. */
export const ZoneNode = memo(function ZoneNode({ data }: NodeProps<Node<ZoneData>>) {
  const far = useFar();
  return (
    <div className={cn("pointer-events-none relative", hand.className)} style={{ width: data.width, height: data.height }} data-zone-heading={data.zone}>
      {data.grid && <div className="absolute inset-0" style={ISO_GRID} data-iso-grid />}
      <div className="absolute left-[80px] top-[24px] text-[#3d3626]">
        <h2 className={cn("leading-none", far ? "text-[104px]" : "text-[58px]")}>{data.title}</h2>
        <p className={cn("mt-1 text-[#6b6248]", far ? "text-[40px]" : "text-[24px]")}>{data.subtitle}</p>
        {data.empty && !far && <p className="mt-6 text-[20px] text-[#8a8062]">nothing here yet</p>}
      </div>
    </div>
  );
});

export const nodeTypes = { card: CardNode, note: NoteNode, zone: ZoneNode };
