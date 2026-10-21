"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Lock, Maximize, Minus, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { SystemMapDomainNode } from "@/types/system-map";
import {
  COLUMNS,
  UNPLACED_LANE,
  visibleArrows,
  type ArchCard,
  type ArchGroup,
  type ArchitectureModel,
} from "./architecture";
import { shortType } from "./DomainGraph";
import { NodeLink } from "./NodeDetails";

/** The map is laid out at a fixed width and zoomed, like a canvas. */
const MAP_WIDTH = 1240;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const PAD = 16;
/** Room above the map for the floating toolbar. */
const TOP = 52;
/** Pointer travel under this is a click, not a drag. */
const DRAG_THRESHOLD = 4;

const TYPE_BORDER: Record<string, string> = {
  Actor: "border-l-purple-500",
  SysPrincipal: "border-l-violet-500",
  SysInterface: "border-l-sky-500",
  SysComponent: "border-l-blue-600",
  SysResource: "border-l-emerald-600",
  SysDataAsset: "border-l-amber-600",
};
const LINK = "text-blue-600 hover:underline dark:text-blue-400";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface View {
  x: number;
  y: number;
  k: number;
}
interface ArrowPath {
  id: string;
  d: string;
  labelX: number;
  labelY: number;
}

/** A curve from the side of `s` facing `t` to the side of `t` facing `s`; one column → loops out right. */
function arrowPath(s: Box, t: Box): Omit<ArrowPath, "id"> {
  const cy = (b: Box) => b.y + b.h / 2;
  const sameColumn = Math.abs(s.x + s.w / 2 - (t.x + t.w / 2)) < 40;
  if (sameColumn) {
    const x = s.x + s.w;
    const bend = 48;
    return {
      d: `M${x},${cy(s)} C${x + bend},${cy(s)} ${x + bend},${cy(t)} ${x},${cy(t)}`,
      labelX: x + bend * 0.75,
      labelY: (cy(s) + cy(t)) / 2,
    };
  }
  const forward = t.x > s.x;
  const x1 = forward ? s.x + s.w : s.x;
  const x2 = forward ? t.x : t.x + t.w;
  const dx = Math.max(40, Math.abs(x2 - x1) / 2) * (forward ? 1 : -1);
  return {
    d: `M${x1},${cy(s)} C${x1 + dx},${cy(s)} ${x2 - dx},${cy(t)} ${x2},${cy(t)}`,
    labelX: (x1 + x2) / 2,
    labelY: (cy(s) + cy(t)) / 2 - 4,
  };
}

function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

function Card({
  card,
  selected,
  dimmed,
  onSelect,
  onOpen,
  onOpenPackages,
  register,
}: {
  card: ArchCard;
  selected: boolean;
  dimmed: boolean;
  onSelect: (refId: string) => void;
  onOpen: (refId: string) => void;
  onOpenPackages: () => void;
  register: (id: string, el: HTMLElement | null) => void;
}) {
  const { node } = card;
  const kind = typeof node.properties.kind === "string" ? node.properties.kind : null;
  return (
    <div
      ref={(el) => register(node.refId, el)}
      role="button"
      tabIndex={0}
      data-interactive
      onClick={() => onSelect(node.refId)}
      onKeyDown={(event) => event.key === "Enter" && onSelect(node.refId)}
      className={cn(
        "relative z-[2] cursor-pointer rounded-md border border-l-[3px] bg-background px-2.5 py-1.5 transition-opacity hover:shadow-sm",
        TYPE_BORDER[node.type] ?? "border-l-slate-400",
        card.secret && "border-red-500/40 border-l-red-600",
        selected && "ring-2 ring-primary",
        dimmed && "opacity-30",
      )}
      data-testid="arch-card"
      data-ref-id={node.refId}
    >
      <p className="flex flex-wrap gap-x-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span title={node.type}>{shortType(node.type)}</span>
        {kind && <span>· {kind}</span>}
        {card.secret && (
          <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400">
            · <Lock className="h-2.5 w-2.5" /> secret
          </span>
        )}
      </p>
      <p className="break-words text-sm font-medium leading-snug">{node.name}</p>
      {card.duplicates.length > 0 && (
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
          <TriangleAlert className="h-3 w-3" /> possible duplicate
        </p>
      )}
      {card.chips.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {card.chips.map((chip) => {
            const action = chip.packages ? onOpenPackages : chip.refId ? () => onOpen(chip.refId!) : null;
            return action ? (
              <button
                key={chip.label}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  action();
                }}
                className={cn("max-w-full truncate rounded-full bg-muted px-1.5 py-px text-[11px]", LINK)}
                title={chip.label}
                data-testid={chip.packages ? "arch-chip-packages" : "arch-chip"}
              >
                {chip.label}
                {chip.packages && " ▸"}
              </button>
            ) : (
              <span
                key={chip.label}
                className="max-w-full truncate rounded-full bg-muted px-1.5 py-px text-[11px] text-muted-foreground"
                title={chip.label}
              >
                {chip.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A group of cards one source fans into: one box until opened, then the cards inside a dashed frame. */
function Group({
  group,
  cards,
  open,
  dimmed,
  onToggle,
  onPick,
  register,
  children,
}: {
  group: ArchGroup;
  cards: ArchCard[];
  open: boolean;
  dimmed: boolean;
  onToggle: () => void;
  onPick: (refId: string) => void;
  register: (id: string, el: HTMLElement | null) => void;
  children: React.ReactNode;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;
  const header = (
    <button
      type="button"
      data-interactive
      onClick={onToggle}
      className="flex w-full items-center gap-1 text-left text-xs font-medium"
      data-testid="arch-group-toggle"
    >
      <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      {group.label}
      {group.secretCount > 0 && (
        <span className="ml-1 flex items-center gap-0.5 text-[11px] font-normal text-red-600 dark:text-red-400">
          <Lock className="h-2.5 w-2.5" /> {group.secretCount} secret
        </span>
      )}
    </button>
  );
  if (open) {
    return (
      <div
        ref={(el) => register(group.id, el)}
        className="relative z-[2] space-y-2 rounded-lg border border-dashed border-muted-foreground/40 p-2"
        data-testid="arch-group"
        data-open="true"
      >
        {header}
        {children}
      </div>
    );
  }
  const shown = cards.slice(0, 4);
  return (
    <div
      ref={(el) => register(group.id, el)}
      className={cn(
        "relative z-[2] rounded-md border border-dashed border-muted-foreground/50 bg-background px-2.5 py-1.5 transition-opacity",
        group.secretCount > 0 && "border-red-500/50",
        dimmed && "opacity-30",
      )}
      data-testid="arch-group"
      data-open="false"
    >
      {header}
      <ul className="mt-1 space-y-0.5 pl-4 text-[11px]">
        {shown.map((c) => (
          <li key={c.node.refId} className="truncate">
            <button type="button" data-interactive className={LINK} onClick={() => onPick(c.node.refId)}>
              {c.node.name}
            </button>
          </li>
        ))}
        {cards.length > shown.length && (
          <li>
            <button type="button" data-interactive className="text-muted-foreground hover:underline" onClick={onToggle}>
              +{cards.length - shown.length} more
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

/**
 * The Architecture view, as a canvas: drag to pan, ⌘/Ctrl + scroll (or
 * pinch) to zoom, scroll to move. Trust-zone lanes × who / entry points /
 * components / data columns; arrows are drawn over the cards from their
 * measured positions. Selecting a card dims everything it does not touch
 * and labels its arrows; `panel` floats top-right.
 */
export function ArchitectureView({
  model,
  byRef,
  selectedId,
  onSelect,
  onOpen,
  onOpenPackages,
  panel,
}: {
  model: ArchitectureModel;
  byRef: Map<string, SystemMapDomainNode>;
  selectedId: string | null;
  onSelect: (refId: string | null) => void;
  onOpen: (refId: string) => void;
  onOpenPackages: () => void;
  /** The detail panel, floated over the canvas. */
  panel?: React.ReactNode;
}) {
  const [showCredentials, setShowCredentials] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<View>({ x: PAD, y: TOP, k: 1 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const [boxes, setBoxes] = useState<Map<string, Box>>(() => new Map());
  const [mapSize, setMapSize] = useState({ w: MAP_WIDTH, h: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const fitted = useRef(false);

  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  }, []);

  // A member picked from the panel or a chip opens its group.
  useEffect(() => {
    const groupId = selectedId ? model.groupOf.get(selectedId) : undefined;
    if (groupId && !expanded.has(groupId)) setExpanded((prev) => new Set(prev).add(groupId));
  }, [selectedId, model.groupOf, expanded]);

  const toggleGroup = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const arrows = useMemo(() => visibleArrows(model, expanded, showCredentials), [model, expanded, showCredentials]);

  // Layout positions, in map pixels (unzoomed).
  const measure = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const origin = map.getBoundingClientRect();
    const k = viewRef.current.k;
    const next = new Map<string, Box>();
    for (const [id, el] of els.current) {
      const r = el.getBoundingClientRect();
      next.set(id, { x: (r.left - origin.left) / k, y: (r.top - origin.top) / k, w: r.width / k, h: r.height / k });
    }
    setBoxes(next);
    setMapSize({ w: map.offsetWidth, h: map.offsetHeight });
  }, []);

  useLayoutEffect(() => {
    measure();
    const map = mapRef.current;
    if (!map || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(map);
    return () => observer.disconnect();
  }, [measure, model, expanded]);

  const fit = useCallback(() => {
    const vp = viewportRef.current;
    const map = mapRef.current;
    if (!vp || !map) return;
    const k = clampZoom(Math.min(1, (vp.clientWidth - 2 * PAD) / map.offsetWidth));
    setView({ x: Math.max(PAD, (vp.clientWidth - map.offsetWidth * k) / 2), y: TOP, k });
  }, []);

  // Open fitted to the width once the map has a size.
  useLayoutEffect(() => {
    if (!fitted.current && mapSize.h > 0) {
      fitted.current = true;
      fit();
    }
  }, [mapSize.h, fit]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    setView((v) => {
      const k = clampZoom(v.k * factor);
      const px = cx ?? vp.clientWidth / 2;
      const py = cy ?? vp.clientHeight / 2;
      // Keep the map point under (px, py) where it is.
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  }, []);

  // Wheel: ⌘/Ctrl (and trackpad pinch) zooms at the cursor, plain scroll pans. Not over the panel.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (event: WheelEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = vp.getBoundingClientRect();
        zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX - rect.left, event.clientY - rect.top);
      } else {
        setView((v) => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }));
      }
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Drag the background to pan; a click without a drag clears the selection.
  const drag = useRef<{ id: number; x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (event: React.PointerEvent) => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest("[data-interactive]") || panelRef.current?.contains(target)) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, vx: view.x, vy: view.y, moved: false };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.moved) setDragging(true);
    d.moved = true;
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (!d.moved) onSelect(null);
  };

  // Keep the selected card on screen and clear of the floating panel, with room for its arrows to the right.
  const hasPanel = !!panel;
  useEffect(() => {
    if (!selectedId) return;
    const box = boxes.get(selectedId);
    const vp = viewportRef.current;
    if (!box || !vp) return;
    const usable = vp.clientWidth - (hasPanel ? (panelRef.current?.offsetWidth ?? 320) + 24 : 0);
    const { x, y, k } = viewRef.current;
    const left = x + box.x * k;
    const top = y + box.y * k;
    const clear = left >= 0 && top >= TOP && left + box.w * k <= usable && top + box.h * k <= vp.clientHeight;
    if (!clear) {
      setView({ k, x: usable / 3 - (box.x + box.w / 2) * k, y: vp.clientHeight / 3 - (box.y + box.h / 2) * k });
    }
  }, [selectedId, boxes, hasPanel]);

  const paths = useMemo(() => {
    const out: ArrowPath[] = [];
    for (const a of arrows) {
      const s = boxes.get(a.source);
      const t = boxes.get(a.target);
      if (s && t) out.push({ id: a.id, ...arrowPath(s, t) });
    }
    return out;
  }, [arrows, boxes]);

  const { related, lit } = useMemo(() => {
    const relatedIds = new Set<string>();
    const litIds = new Set<string>();
    if (selectedId) {
      relatedIds.add(selectedId);
      for (const a of arrows) {
        if (a.source === selectedId || a.target === selectedId) {
          relatedIds.add(a.source);
          relatedIds.add(a.target);
          litIds.add(a.id);
        }
      }
    }
    return { related: relatedIds, lit: litIds };
  }, [arrows, selectedId]);
  const arrowById = useMemo(() => new Map(arrows.map((a) => [a.id, a])), [arrows]);
  const focused = selectedId !== null && model.cards.has(selectedId);

  const renderCard = (card: ArchCard) => (
    <Card
      key={card.node.refId}
      card={card}
      selected={selectedId === card.node.refId}
      dimmed={focused && !related.has(card.node.refId)}
      onSelect={onSelect}
      onOpen={onOpen}
      onOpenPackages={onOpenPackages}
      register={register}
    />
  );

  return (
    <div className="space-y-3" data-testid="system-map-architecture">
      <div
        ref={viewportRef}
        className={cn(
          "relative h-[calc(100vh-15rem)] min-h-[520px] touch-none select-none overflow-hidden rounded-lg border bg-muted/20",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-testid="arch-canvas"
      >
        <div
          ref={mapRef}
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: MAP_WIDTH, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
        >
          <div className="grid grid-cols-[110px_repeat(4,minmax(0,1fr))] gap-x-14 px-3 pb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            <span />
            {COLUMNS.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <div className="space-y-2.5">
            {model.lanes.map((lane) => (
              <div
                key={lane.name}
                className="grid grid-cols-[110px_repeat(4,minmax(0,1fr))] gap-x-14 rounded-lg border border-dashed bg-background/60 p-3 odd:bg-muted/40"
                data-testid="arch-lane"
              >
                <div>
                  <p className="text-xs font-semibold">{lane.name === UNPLACED_LANE ? "No zone" : lane.name}</p>
                  {lane.description && (
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{lane.description}</p>
                  )}
                </div>
                {lane.columns.map((items, column) => (
                  <div key={column} className="flex min-w-0 flex-col gap-2.5">
                    {items.map((item) =>
                      item.kind === "card" ? (
                        renderCard(item.card)
                      ) : (
                        <Group
                          key={item.group.id}
                          group={item.group}
                          cards={item.cards}
                          open={expanded.has(item.group.id)}
                          dimmed={focused && !related.has(item.group.id)}
                          onToggle={() => toggleGroup(item.group.id)}
                          onPick={(refId) => onSelect(refId)}
                          register={register}
                        >
                          {item.cards.map(renderCard)}
                        </Group>
                      ),
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <svg
            className="pointer-events-none absolute left-0 top-0 z-[1] overflow-visible"
            width={mapSize.w}
            height={mapSize.h}
            aria-hidden
          >
            <defs>
              <marker
                id="arch-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" className="fill-slate-400 dark:fill-slate-500" />
              </marker>
              <marker
                id="arch-arrow-lit"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" className="fill-primary" />
              </marker>
            </defs>
            {paths.map((p) => {
              const arrow = arrowById.get(p.id);
              if (!arrow) return null;
              const isLit = lit.has(p.id);
              const dim = focused && !isLit;
              const name = (id: string) => byRef.get(id)?.name ?? model.groups.get(id)?.label ?? id;
              return (
                <g key={p.id} data-testid="arch-arrow" className={cn(dim && "opacity-10")}>
                  <path
                    d={p.d}
                    fill="none"
                    strokeWidth={isLit ? 2.2 : 1.4}
                    strokeDasharray={arrow.credential ? "4 3" : undefined}
                    className={isLit ? "stroke-primary" : "stroke-slate-400 dark:stroke-slate-600"}
                    markerEnd={`url(#${isLit ? "arch-arrow-lit" : "arch-arrow"})`}
                  />
                  <path
                    d={p.d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={12}
                    className="pointer-events-auto cursor-help"
                  >
                    <title>{`${name(arrow.source)} → ${name(arrow.target)}: ${arrow.label}`}</title>
                  </path>
                  {(isLit || (showLabels && !focused)) && (
                    <text
                      x={p.labelX}
                      y={p.labelY}
                      textAnchor="middle"
                      className={cn("text-[10px]", isLit ? "fill-primary font-medium" : "fill-muted-foreground")}
                      style={{ paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3 }}
                    >
                      {arrow.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        <div
          data-interactive
          className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-background/95 px-2 py-1 text-xs shadow-sm backdrop-blur"
          data-testid="arch-toolbar"
        >
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => zoomAt(1 / 1.2)}
              aria-label="Zoom out"
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <span className="w-10 text-center tabular-nums text-muted-foreground" data-testid="arch-zoom">
              {Math.round(view.k * 100)}%
            </span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => zoomAt(1.2)} aria-label="Zoom in">
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={fit} data-testid="arch-fit">
              <Maximize className="mr-1 h-3 w-3" /> Fit
            </Button>
          </div>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            <Switch
              checked={showCredentials}
              onCheckedChange={setShowCredentials}
              className="scale-75"
              data-testid="arch-credentials-toggle"
            />
            Credentials
          </label>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            <Switch
              checked={showLabels}
              onCheckedChange={setShowLabels}
              className="scale-75"
              data-testid="arch-labels-toggle"
            />
            Labels
          </label>
        </div>

        {panel && (
          <div
            ref={panelRef}
            data-interactive
            className="absolute right-3 top-3 z-10 w-80 max-w-[calc(100%-1.5rem)] cursor-auto overflow-y-auto overscroll-contain rounded-lg border bg-background/95 p-3 shadow-md backdrop-blur"
            style={{ maxHeight: "calc(100% - 1.5rem)" }}
            data-testid="arch-panel"
          >
            {panel}
          </div>
        )}

        <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-muted-foreground">
          Lanes are trust zones: an arrow leaving its lane crosses a trust boundary. Drag to move, ⌘/Ctrl + scroll to
          zoom.
        </p>
      </div>

      <div className="grid gap-2.5 md:grid-cols-3">
        <div className="rounded-lg border p-3 text-xs" data-testid="arch-isolated">
          <p className="mb-1 font-medium">Not connected ({model.isolated.length})</p>
          {model.isolated.length === 0 && <p className="text-muted-foreground">None</p>}
          {model.isolated.map((n) => (
            <p key={n.refId}>
              <NodeLink node={n} onOpen={onOpen} /> <span className="text-muted-foreground">{shortType(n.type)}</span>
            </p>
          ))}
        </div>
        <div className="rounded-lg border p-3 text-xs" data-testid="arch-duplicates">
          <p className="mb-1 font-medium">Possible duplicates</p>
          {model.duplicateGroups.length === 0 && <p className="text-muted-foreground">None</p>}
          {model.duplicateGroups.map((group) => (
            <p key={group.join()}>
              {group.map((id, i) => (
                <React.Fragment key={id}>
                  {i > 0 && <span className="text-muted-foreground"> ≈ </span>}
                  {byRef.get(id) && <NodeLink node={byRef.get(id)!} onOpen={onOpen} />}
                </React.Fragment>
              ))}
            </p>
          ))}
        </div>
        <div className="rounded-lg border p-3 text-xs text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">Folded into cards</p>
          {model.folded.map((f) => `${f.count} ${shortType(f.type)}`).join(" · ") || "Nothing"} — shown as chips or
          arrow labels.{" "}
          {model.packageCount > 0 && (
            <button type="button" className={LINK} onClick={onOpenPackages}>
              {model.packageCount} packages
            </button>
          )}
          {model.packageCount > 0 && " are in the Dependencies view."}
        </div>
      </div>
    </div>
  );
}
