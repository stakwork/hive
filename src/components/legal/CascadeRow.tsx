"use client";

import React, { useState, type ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  NodePeekBody,
  ViewInGraphLink,
  fetchNodePeek,
  type NodePeek,
} from "@/components/run-report/NodePeek";
import type {
  AgentRow,
  CascadeRowModel,
  CascadeTurn,
  ConceptRow,
  PillRow,
} from "@/lib/legal-cascade/types";

/**
 * Row renderers + geometry for the session-cascade trace. The mockup's
 * absolutely-positioned rows over one SVG translate 1:1: these constants ARE
 * the spec (34px rows, lane x-offsets, right-hand concept rail).
 */

export const ROW_H = 34;
export const TOP_PAD = 10;
export const LANE_X = [96, 176, 248];
/** Concept chips live on the right rail: width 224, inset 8. */
export const RAIL_CHIP_W = 224;
export const RAIL_RIGHT = 8;
export const MIN_W = 980;

/**
 * Workspace slug for the trace being rendered. The concept chips fetch their
 * own node to fill the peek, and threading the slug through sections and rows
 * to reach them would be pure prop drilling. Null outside a workspace (tests,
 * embeds): the chip still opens, and the peek says why it cannot fetch.
 */
const CascadeWorkspaceContext = React.createContext<string | null>(null);

export function CascadeWorkspaceProvider({
  slug,
  children,
}: {
  slug: string | null;
  children: ReactNode;
}) {
  return (
    <CascadeWorkspaceContext.Provider value={slug}>
      {children}
    </CascadeWorkspaceContext.Provider>
  );
}

export function laneIndex(depth: number): number {
  return Math.min(Math.max(depth, 0), LANE_X.length - 1);
}

export const LANE_TEXT = [
  "text-cyan-700 dark:text-cyan-400",
  "text-violet-700 dark:text-violet-400",
  "text-rose-700 dark:text-rose-400",
];
export const LANE_STROKE = [
  "stroke-cyan-600 dark:stroke-cyan-400",
  "stroke-violet-600 dark:stroke-violet-400",
  "stroke-rose-600 dark:stroke-rose-400",
];
export const LANE_FILL = [
  "fill-cyan-600 dark:fill-cyan-400",
  "fill-violet-600 dark:fill-violet-400",
  "fill-rose-600 dark:fill-rose-400",
];

// ── View rows (model rows + expansions) ──────────────────────────────────────

export type ViewRow =
  | { type: "model"; row: CascadeRowModel; key: string }
  | { type: "prompt"; row: AgentRow; key: string }
  | { type: "detail"; pill: PillRow; turn: CascadeTurn; key: string };

export function pillKey(row: PillRow): string {
  return `${row.sessionId}:${row.o0}`;
}

export function agentKey(row: AgentRow, index: number): string {
  return row.childSessionId || `${row.sessionId}:fork:${index}`;
}

function modelKey(row: CascadeRowModel, index: number): string {
  if (row.kind === "pill") return `pill-${pillKey(row)}`;
  if (row.kind === "agent") return `agent-${agentKey(row, index)}`;
  return `${row.kind}-${row.sessionId}-${row.order}-${index}`;
}

/**
 * Expand model rows into what actually renders: an open agent header gains a
 * prompt row; an open pill unrolls the turns it already holds in memory.
 */
export function buildViewRows(
  rows: CascadeRowModel[],
  expandedPills: ReadonlySet<string>,
  openPrompts: ReadonlySet<string>,
): ViewRow[] {
  const out: ViewRow[] = [];
  rows.forEach((row, i) => {
    out.push({ type: "model", row, key: modelKey(row, i) });
    if (row.kind === "agent" && row.prompt && openPrompts.has(agentKey(row, i))) {
      out.push({ type: "prompt", row, key: `prompt-${agentKey(row, i)}` });
    }
    if (row.kind === "pill" && expandedPills.has(pillKey(row))) {
      for (const turn of row.turns) {
        out.push({ type: "detail", pill: row, turn, key: `detail-${row.sessionId}-${turn.order}` });
      }
    }
  });
  return out;
}

export function viewRowLane(vr: ViewRow): number {
  if (vr.type === "detail") return laneIndex(vr.pill.depth);
  return laneIndex(vr.row.depth);
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatRelativeTime(ts: number | null, startMs: number | null): string {
  // Backfilled sessions have no per-turn timestamps — blank gutter, never fake.
  if (ts == null || startMs == null) return "";
  const totalSec = Math.max(0, Math.round((ts - startMs) / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDuration(ms: number | null): string | null {
  if (ms == null) return null;
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function formatTokens(total: number): string {
  if (total >= 1000) return `${Math.round(total / 1000)}k`;
  return String(total);
}

export function shortSessionId(id: string): string {
  return id.length > 22 ? `${id.slice(0, 8)}…${id.slice(-10)}` : id;
}

// ── Markers ──────────────────────────────────────────────────────────────────

function Marker({ x, children }: { x: number; children: ReactNode }) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 18 18"
      className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
      style={{ left: x - 9 }}
      aria-hidden
    >
      {children}
    </svg>
  );
}

function markerFor(vr: ViewRow, lane: number): ReactNode {
  const fill = LANE_FILL[lane];
  const stroke = LANE_STROKE[lane];
  if (vr.type === "prompt") {
    return <rect x={5} y={5} width={8} height={8} rx={2} className="fill-foreground" />;
  }
  if (vr.type === "detail") {
    const t = vr.turn;
    if (t.turn_type === "reasoning") {
      return <circle cx={9} cy={9} r={4} className={`fill-card ${stroke}`} strokeWidth={2} />;
    }
    return (
      <circle
        cx={9}
        cy={9}
        r={t.turn_type === "tool_call" ? 4 : 2.5}
        className={fill}
        opacity={t.turn_type === "tool_call" ? 1 : 0.7}
      />
    );
  }
  const row = vr.row;
  switch (row.kind) {
    case "user":
      return <rect x={4.5} y={4.5} width={9} height={9} rx={2} className="fill-foreground" />;
    case "agent":
      return <circle cx={9} cy={9} r={5.5} className={`fill-card ${stroke}`} strokeWidth={2.5} />;
    case "pill":
      return <circle cx={9} cy={9} r={4.5} className={fill} />;
    case "concept":
      return (
        <rect
          x={4.5}
          y={4.5}
          width={9}
          height={9}
          transform="rotate(45 9 9)"
          strokeWidth={2}
          className={
            row.verb === "READ"
              ? "fill-card stroke-amber-600 dark:stroke-amber-400"
              : "fill-amber-600 stroke-amber-600 dark:fill-amber-400 dark:stroke-amber-400"
          }
        />
      );
    case "response":
      return (
        <>
          <circle cx={9} cy={9} r={6} fill="none" strokeWidth={1.5} className={stroke} />
          <circle cx={9} cy={9} r={2.8} className={fill} />
        </>
      );
  }
}

// ── Row content ──────────────────────────────────────────────────────────────

const LABEL_CLASS =
  "absolute top-1/2 -translate-y-1/2 whitespace-nowrap overflow-hidden text-ellipsis";

function truncate(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

interface CascadeRowItemProps {
  vr: ViewRow;
  index: number;
  /** Epoch ms of the run's first activity — the time gutter's zero. */
  runStartMs: number | null;
  expandedPills: ReadonlySet<string>;
  openPrompts: ReadonlySet<string>;
  onTogglePill: (key: string) => void;
  onToggleAgent: (key: string) => void;
}

/** One absolutely positioned 34px row: gutter, marker, label/pill/chip. */
export function CascadeRowItem({
  vr,
  index,
  runStartMs,
  expandedPills,
  openPrompts,
  onTogglePill,
  onToggleAgent,
}: CascadeRowItemProps) {
  const lane = viewRowLane(vr);
  const x = LANE_X[lane];
  const laneText = LANE_TEXT[lane];

  const timestamp =
    vr.type === "detail" ? vr.turn.timestamp : vr.type === "prompt" ? null : vr.row.timestamp;
  const gutter = formatRelativeTime(timestamp, runStartMs);

  return (
    <div
      className="absolute left-0 right-0 flex items-center rounded-md transition-colors hover:bg-muted/40"
      style={{ top: TOP_PAD + index * ROW_H, height: ROW_H }}
      data-testid={`cascade-row-${vr.key}`}
    >
      {gutter && (
        <div className="absolute left-1 w-[52px] text-right font-mono text-[10px] text-muted-foreground tabular-nums">
          {gutter}
        </div>
      )}
      <Marker x={x}>{markerFor(vr, lane)}</Marker>
      {renderContent(vr, x, laneText, expandedPills, openPrompts, onTogglePill, onToggleAgent)}
    </div>
  );
}

function renderContent(
  vr: ViewRow,
  x: number,
  laneText: string,
  expandedPills: ReadonlySet<string>,
  openPrompts: ReadonlySet<string>,
  onTogglePill: (key: string) => void,
  onToggleAgent: (key: string) => void,
): ReactNode {
  if (vr.type === "prompt") {
    return (
      <div
        className={`${LABEL_CLASS} text-[12.5px] font-semibold`}
        style={{ left: x + 40, right: 250 }}
        title={vr.row.prompt ?? undefined}
      >
        “{vr.row.prompt}”
      </div>
    );
  }

  if (vr.type === "detail") {
    const t = vr.turn;
    const title = `turn ${t.order} · ${t.turn_type}${t.tool ? ` · ${t.tool}` : ""}\n${truncate(t.content, 400)}`;
    if (t.turn_type === "reasoning") {
      return (
        <div
          className={`${LABEL_CLASS} text-xs italic text-muted-foreground`}
          style={{ left: x + 40, right: 250 }}
          title={title}
        >
          {t.content}
        </div>
      );
    }
    return (
      <div
        className={`${LABEL_CLASS} text-[11.5px] text-muted-foreground`}
        style={{ left: x + 40, right: 250 }}
        title={title}
      >
        <span className={`font-semibold ${laneText}`}>{t.tool ?? "unknown"}</span>{" "}
        {t.turn_type === "tool_call" ? "tool_call" : "→ tool_result"}
      </div>
    );
  }

  const row = vr.row;
  switch (row.kind) {
    case "user":
      return (
        <div
          className={`${LABEL_CLASS} text-[12.5px] font-semibold`}
          style={{ left: x + 26, right: 250 }}
          title={row.text}
        >
          “{truncate(row.text, 200)}”
        </div>
      );

    case "response":
      return (
        <div
          className={`${LABEL_CLASS} text-[12.5px] font-semibold ${laneText}`}
          style={{ left: x + 26, right: 250 }}
          title={row.text}
        >
          “{truncate(row.text, 200)}”
        </div>
      );

    case "agent": {
      // The view-row key embeds the same agentKey buildViewRows used, so the
      // toggle key stays consistent for placeholder forks too.
      const key = vr.key.replace(/^agent-/, "");
      const open = openPrompts.has(key);
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onToggleAgent(key)}
              data-testid={`cascade-agent-${row.childSessionId || "pending"}`}
              className={`${LABEL_CLASS} text-left font-mono text-[10.5px] font-bold uppercase tracking-[0.1em] ${laneText}`}
              style={{ left: x + 26, right: 250 }}
            >
              <span className="text-[9px] opacity-80">{open ? "▾" : "▸"}</span> {row.label}{" "}
              {row.childSessionId && (
                <span className="normal-case font-normal tracking-normal text-muted-foreground">
                  · {shortSessionId(row.childSessionId)}
                </span>
              )}
              {!row.hasTrace && (
                <span className="ml-2 rounded border border-border px-1 py-px font-mono text-[9px] normal-case tracking-normal text-muted-foreground">
                  no trace
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-md text-xs">
            AgentSession{row.childSessionId ? ` · ${row.childSessionId}` : ""} — click to see
            the prompt it was given
          </TooltipContent>
        </Tooltip>
      );
    }

    case "pill": {
      const key = pillKey(row);
      const open = expandedPills.has(key);
      const turnCount = row.o1 - row.o0 + 1;
      const dur = formatDuration(row.durationMs);
      return (
        <div className="absolute top-1/2 -translate-y-1/2" style={{ left: x + 26 }}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onTogglePill(key)}
                data-testid={`cascade-pill-${row.sessionId}-${row.o0}`}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/30 px-3 py-0.5 font-mono text-[11.5px] text-muted-foreground transition-colors hover:border-muted-foreground/60 hover:text-foreground"
              >
                <span className="text-[9px] opacity-80">{open ? "▾" : "▸"}</span>
                <b className="font-semibold text-foreground">{turnCount}</b>
                <span>turns</span>
                {dur && <span>· {dur}</span>}
                {row.open && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-md font-mono text-xs">
              turns {row.o0}–{row.o1} · {row.calls} tool calls · {row.texts.length} reasoning
              {row.mix ? ` — ${row.mix}` : ""}
            </TooltipContent>
          </Tooltip>
        </div>
      );
    }

    case "concept":
      return (
        <>
          <div
            className="absolute top-1/2 border-t border-dashed border-amber-600/60 dark:border-amber-400/60"
            style={{ left: x + 12, right: RAIL_RIGHT + RAIL_CHIP_W + 12 }}
            aria-hidden
          />
          <ConceptChip row={row} />
        </>
      );
  }
}

/**
 * A rail chip opens a peek at the Concept it names: the node fetched live from
 * the graph, so the modal carries the current name/id/description/docs rather
 * than the thin identity the trace recorded.
 */
function ConceptChip({ row }: { row: ConceptRow }) {
  const workspaceSlug = React.useContext(CascadeWorkspaceContext);
  const [peek, setPeek] = useState<NodePeek | null>(null);
  const created = row.verb !== "READ";

  const openPeek = async () => {
    setPeek({ state: "loading" });
    setPeek(await fetchNodePeek(workspaceSlug, row.refId));
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={openPeek}
            data-testid={`cascade-concept-${row.refId ?? row.name}`}
            className={`absolute top-1/2 flex h-[26px] -translate-y-1/2 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[11px] transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              created
                ? "border-amber-600 bg-amber-600 text-white hover:bg-amber-500 dark:border-amber-400 dark:bg-amber-400 dark:text-amber-950 dark:hover:bg-amber-300"
                : "border-amber-600/45 bg-amber-500/10 text-amber-700 hover:border-amber-600 hover:bg-amber-500/20 dark:border-amber-400/45 dark:text-amber-400 dark:hover:border-amber-400"
            }`}
            style={{ right: RAIL_RIGHT, width: RAIL_CHIP_W }}
          >
            <svg width={11} height={11} viewBox="0 0 12 12" aria-hidden>
              <rect
                x={2.5}
                y={2.5}
                width={7}
                height={7}
                transform="rotate(45 6 6)"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
              />
            </svg>
            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left font-semibold">
              {row.name}
            </span>
            <span className="shrink-0 text-[9px] tracking-[0.12em] opacity-85">
              {row.verb === "CREATED" ? "+ CREATED" : row.verb}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-md font-mono text-xs">
          turn {row.order} · {row.verb === "READ" ? "READ_CONCEPT edge" : `${row.verb} (display-parsed)`}
          {row.via ? ` · via ${row.via}` : ""}
        </TooltipContent>
      </Tooltip>

      <Dialog open={peek !== null} onOpenChange={(next) => !next && setPeek(null)}>
        <DialogContent className="max-w-2xl" data-testid="cascade-concept-peek">
          <DialogHeader>
            <ViewInGraphLink workspaceSlug={workspaceSlug} refId={row.refId} />
            <DialogTitle className="flex items-baseline gap-2 text-[15px]">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/60">
                concept
              </span>
              {row.name}
            </DialogTitle>
            <DialogDescription className="space-y-0.5 font-mono text-[10px] text-muted-foreground/60">
              {row.refId && <span className="block truncate">ref {row.refId}</span>}
              <span className="block">
                turn {row.order} · {row.verb}
                {row.via ? ` · via ${row.via}` : ""}
              </span>
            </DialogDescription>
          </DialogHeader>
          {peek?.state === "loading" && (
            <p className="text-[12.5px] italic text-muted-foreground">fetching from the graph…</p>
          )}
          {peek?.state === "error" && (
            <p className="text-[12.5px] text-muted-foreground">{peek.note}</p>
          )}
          {peek?.state === "done" && (
            <div className="max-h-[55vh] overflow-y-auto overscroll-contain">
              <NodePeekBody payload={peek.payload} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
