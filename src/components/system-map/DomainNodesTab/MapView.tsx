"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Maximize, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  ancestors,
  descendants,
  neighbourhood,
  type GlyphKind,
  type MapChip,
  type MapModel,
  type MapNode,
  type MapRegion,
  type MapWire,
  type WireKind,
} from "./map-layout";
import type { PackageCveReport } from "./package-cves";
import { severityRank } from "./package-cves";

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 40;
/** Room above the map for the floating toolbar, and beside it for the panel. */
const TOP = 56;
const DRAG_THRESHOLD = 4;
/** Ink line width, map units. */
const OL = 0.28;

const TYPE_COLOR: Record<string, string> = {
  SysComponent: "#3b5fa0",
  SysResource: "#3f9a6e",
  SysInterface: "#3b7fd1",
  SysDataAsset: "#8da35a",
  SysOperation: "#8f7fd6",
  SysPrincipal: "#d77ea1",
  Actor: "#d9452b",
  SysActor: "#d9452b",
  SysArtifact: "#b8923f",
  SysCapability: "#3aa6a0",
  SysTechnology: "#8a93a2",
  SysProtocol: "#8a93a2",
};
const GOLD = "#d4a72c";
const ZONE_COLOR: Record<string, string> = {
  actors: "#d9452b",
  identities: "#d77ea1",
  ci: "#b58f2a",
  device: "#3b5fa0",
  tailnet: "#2f8f88",
  internal: "#3f9a6e",
  loopback: "#8a94a6",
  internet: "#d9452b",
  catalog: "#8a93a2",
};
const WIRE_COLOR: Record<WireKind, string> = {
  flow: "#e0962f",
  cross: "#d9452b",
  reach: "#5b6472",
  guard: GOLD,
  struct: "#a8adb8",
};
const WIRE_WIDTH: Record<WireKind, number> = { flow: 0.84, cross: 1.0, reach: 0.72, guard: 0.64, struct: 0.22 };
const BOARD_COLOR = "#3b5fa0";
const CHAIN_COLOR = "#3b5fa0";
const VULN_COLOR = "#d9452b";
const HUB_COLOR = "#2f8f88";
const DIRECT_COLOR = "#3b5fa0";
const CHIP_COLOR = "#aab2bf";
const DEP_COLOR = "#b9b4a8";

type Box = { x0: number; y0: number; x1: number; y1: number };
interface View {
  x: number;
  y: number;
  k: number;
}
type Tier = "map" | "board";

const zoneColor = (key: string) => ZONE_COLOR[key] ?? "#7a8594";
const regionTitle = (r: MapRegion) => r.label.split("·")[0].trim();

function rr(w: number, h: number, r: number): string {
  const x = -w / 2;
  const y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  return `M${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x + r}Q${x},${y + h} ${x},${y + h - r}V${y + r}Q${x},${y} ${x + r},${y}Z`;
}
function polygon(points: [number, number][]): string {
  return "M" + points.map((p) => p.join(",")).join("L") + "Z";
}
function hexagon(r: number): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const t = Math.PI / 6 + (i * Math.PI) / 3;
    pts.push([r * Math.cos(t), r * Math.sin(t)]);
  }
  return polygon(pts);
}
const diamond = (r: number) =>
  polygon([
    [0, -r],
    [r, 0],
    [0, r],
    [-r, 0],
  ]);
const drum = (rx: number, ry: number, h: number) =>
  `M${-rx},${-h / 2}A${rx},${ry} 0 0 1 ${rx},${-h / 2}V${h / 2}A${rx},${ry} 0 0 1 ${-rx},${h / 2}Z`;
const person = (r: number) =>
  `M${-r * 1.9},${r * 1.55}A${r * 1.9},${r * 1.9} 0 0 1 ${r * 1.9},${r * 1.55}Z M${r},${-r * 0.55}A${r},${r} 0 1 0 ${-r},${-r * 0.55}A${r},${r} 0 1 0 ${r},${-r * 0.55}Z`;

/** The silhouette of a glyph, as a path centred on the node. */
function silhouette(glyph: GlyphKind): string {
  switch (glyph) {
    case "component":
      return rr(11, 7.5, 1.1);
    case "database":
      return drum(2.7, 1, 3.8);
    case "volume":
      return rr(6.2, 4.2, 0.5);
    case "resource":
      return rr(6.2, 5.2, 0.7);
    case "interface":
      return hexagon(2.2);
    case "operation":
      return rr(4.2, 2.6, 0.5);
    case "artifact":
      return rr(4.6, 3, 0.3);
    case "capability":
      return diamond(1.7);
    case "secret":
      return diamond(2);
    case "asset":
      return rr(3.2, 3.8, 0.3);
    case "principal":
      return person(1.05);
    case "actor":
      return person(1.35);
    default:
      return rr(4.4, 2.4, 0.4);
  }
}

/** The small marks that make a glyph readable at a glance; drawn in the ink colour. */
function GlyphDetail({ glyph, color }: { glyph: GlyphKind; color: string }) {
  const ink = { stroke: "currentColor", strokeWidth: OL * 0.6, fill: "none" } as const;
  switch (glyph) {
    case "component":
      return (
        <>
          <path
            d={rr(9.4, 2.1, 0.6)}
            transform="translate(0 -2.2)"
            fill={color}
            fillOpacity={0.35}
            stroke="currentColor"
            strokeWidth={OL * 0.6}
          />
          <rect x="-4.5" y="0.4" width="3.2" height="0.45" rx="0.2" fill="currentColor" />
          <rect x="-1" y="0.4" width="1.4" height="0.45" rx="0.2" fill="currentColor" />
          <rect
            x="3"
            y="1"
            width="1.2"
            height="1.2"
            rx="0.3"
            fill={color}
            fillOpacity={0.5}
            stroke="currentColor"
            strokeWidth={OL * 0.5}
          />
        </>
      );
    case "database":
      return (
        <>
          <ellipse
            cx="0"
            cy="-1.9"
            rx="2.7"
            ry="1"
            fill={color}
            fillOpacity={0.5}
            stroke="currentColor"
            strokeWidth={OL * 0.8}
          />
          <path d="M-2.7,0.1A2.7,1 0 0 0 2.7,0.1" {...ink} opacity={0.6} />
          <path d="M-2.7,1.1A2.7,1 0 0 0 2.7,1.1" {...ink} opacity={0.6} />
        </>
      );
    case "volume":
      return <rect x="-1.8" y="0.9" width="3.6" height="0.4" rx="0.2" fill="currentColor" />;
    case "resource":
      return (
        <>
          <rect x="-2.3" y="-1.5" width="4.6" height="0.45" rx="0.2" fill="currentColor" />
          <rect x="-2.3" y="-0.2" width="4.6" height="0.45" rx="0.2" fill="currentColor" opacity={0.6} />
        </>
      );
    case "interface":
      return (
        <>
          <circle r="0.85" fill={color} fillOpacity={0.6} stroke="currentColor" strokeWidth={OL * 0.7} />
          <circle r="0.25" fill="currentColor" />
        </>
      );
    case "operation":
      return <path d="M-1.3,-0.3L-0.3,0.7L1.4,-0.9" {...ink} strokeWidth={OL * 0.9} strokeLinecap="round" />;
    case "artifact":
      return (
        <>
          <path
            d={rr(4.2, 2.7, 0.3)}
            transform="translate(0.3 -0.3)"
            fill={color}
            fillOpacity={0.45}
            stroke="currentColor"
            strokeWidth={OL * 0.7}
          />
          <path d="M-1.1,-1.1H1.5M-1.1,-0.5H1.5M-1.1,0.1H1.5" {...ink} opacity={0.7} />
        </>
      );
    case "capability":
      return <path d="M0,-1.7V1.7M-1.7,0H1.7" {...ink} opacity={0.6} />;
    case "secret":
      return <path d="M-2,0H2M0,-2L-0.9,0L0,2L0.9,0Z" {...ink} opacity={0.7} />;
    default:
      return null;
  }
}

/** A wire as a quadratic curve bowed to one side, from the edge of `a` to the edge of `b`. */
function wirePath(a: MapNode, b: MapNode, bow?: number): { d: string; arrow: [number, number][]; length: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const ra = Math.min(Math.max(a.w, a.h) / 2 + 0.8, dist * 0.3);
  const rb = Math.min(Math.max(b.w, b.h) / 2 + 1.4, dist * 0.3);
  const sx = a.x + ux * ra;
  const sy = a.y + uy * ra;
  const ex = b.x - ux * rb;
  const ey = b.y - uy * rb;
  const k = bow ?? Math.min(14, Math.max(1.5, dist * 0.16));
  const mx = (sx + ex) / 2 - uy * k;
  const my = (sy + ey) / 2 + ux * k;
  const tx = ex - mx;
  const ty = ey - my;
  const tl = Math.hypot(tx, ty) || 1;
  const ax = tx / tl;
  const ay = ty / tl;
  const tipx = ex + ax * 0.6;
  const tipy = ey + ay * 0.6;
  const L = 2.6;
  const W = 1.1;
  const bx = tipx - ax * L;
  const by = tipy - ay * L;
  // Length of the quadratic by sampling, for the pulse animation.
  let length = 0;
  let px = sx;
  let py = sy;
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    const qx = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * mx + t * t * ex;
    const qy = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * my + t * t * ey;
    length += Math.hypot(qx - px, qy - py);
    px = qx;
    py = qy;
  }
  return {
    d: `M${sx.toFixed(2)},${sy.toFixed(2)}Q${mx.toFixed(2)},${my.toFixed(2)} ${ex.toFixed(2)},${ey.toFixed(2)}`,
    arrow: [
      [tipx, tipy],
      [bx - ay * W, by + ax * W],
      [bx + ay * W, by - ax * W],
    ],
    length,
  };
}

function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}
function union(boxes: Box[]): Box {
  return boxes.reduce(
    (u, b) => ({
      x0: Math.min(u.x0, b.x0),
      y0: Math.min(u.y0, b.y0),
      x1: Math.max(u.x1, b.x1),
      y1: Math.max(u.y1, b.y1),
    }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  );
}

interface Label {
  id: string;
  text: string;
  sub?: string;
  /** Anchor in map units: above-centre for nodes, top-left for plates. */
  x: number;
  y: number;
  prio: number;
  /** 0 = plate title, 1 = always, 2 = when zoomed in or asked for. */
  tier: 0 | 1 | 2;
  tierWorld: Tier;
  kind: "plate" | "hub" | "node" | "secret" | "chip";
  color?: string;
  ghost?: boolean;
}

/**
 * The Map view: the System Map drawn as a plan (plates per trust zone,
 * components as buildings with their interfaces in front and storage
 * behind, wires for flows, reach and secret access) with the package
 * dependency board to the right. Drag to pan, ⌘/Ctrl + scroll (or pinch)
 * to zoom, scroll to move. `selectedId` may be any node or package.
 */
export interface MapHighlight {
  /** Map nodes and package chips to light; everything else dims. The camera fits them when this changes. */
  ids: Set<string>;
  color: string;
  /** Changes when the highlight is a new one (another finding), so the camera fits once per highlight. */
  key: string;
}

export interface MapBadge {
  count: number;
  color: string;
  title: string;
}

export function MapView({
  model,
  cves,
  selectedId,
  onSelect,
  panel,
  sidePanel,
  highlight = null,
  onClearHighlight,
  badges,
  onBadge,
  peekId = null,
}: {
  model: MapModel;
  /** The package CVE check, when one has run: colours the chips. */
  cves: PackageCveReport | null;
  selectedId: string | null;
  onSelect: (refId: string | null) => void;
  /** The detail panel, floated over the canvas. */
  panel?: React.ReactNode;
  /** A second floating panel on the left (the findings list). */
  sidePanel?: React.ReactNode;
  /** Nodes lit from outside the map (a finding's related nodes); a hover or selection still wins. */
  highlight?: MapHighlight | null;
  /** Escape clears the highlight too. */
  onClearHighlight?: () => void;
  /** A count badge on a node (findings in a component). */
  badges?: Map<string, MapBadge>;
  onBadge?: (refId: string) => void;
  /** A node hovered outside the map (a step of a finding's path): lit as if hovered here. */
  peekId?: string | null;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sidePanelRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: TOP, k: 4 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [tier, setTier] = useState<Tier>("map");
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusZone, setFocusZone] = useState<string | null>(null);
  /** The component whose packages the board is lit for (opened from that component). */
  const [boardOwner, setBoardOwner] = useState<string | null>(null);
  const [show, setShow] = useState({ flow: true, reach: true, guard: true, struct: false, labels: false });
  const [widths, setWidths] = useState<Map<string, [number, number]>>(() => new Map());
  const labelEls = useRef(new Map<string, HTMLElement>());
  const fitted = useRef(false);

  const mapBox = useMemo<Box>(() => {
    const boxes: Box[] = model.regions.map((r) => r);
    if (model.regions.length) boxes.push(signBox(model));
    return boxes.length ? union(boxes) : { x0: -50, y0: -50, x1: 50, y1: 50 };
  }, [model]);
  const boardBox = useMemo<Box>(() => (model.boards.length ? union(model.boards) : mapBox), [model, mapBox]);

  // ---- camera ----
  const insets = useCallback(() => {
    const vp = viewportRef.current;
    const wide = !!vp && vp.clientWidth > 900;
    const right = panel && wide ? (panelRef.current?.offsetWidth ?? 320) + 24 : 0;
    const left = sidePanel && wide ? (sidePanelRef.current?.offsetWidth ?? 288) + 24 : 16;
    return { top: TOP, right, bottom: 16, left };
  }, [panel, sidePanel]);
  const fitBox = useCallback(
    (box: Box, pad = 1.06) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const ins = insets();
      const availW = Math.max(100, vp.clientWidth - ins.left - ins.right);
      const availH = Math.max(100, vp.clientHeight - ins.top - ins.bottom);
      const k = clampZoom(Math.min(availW / ((box.x1 - box.x0) * pad), availH / ((box.y1 - box.y0) * pad)));
      setView({
        k,
        x: ins.left + availW / 2 - ((box.x0 + box.x1) / 2) * k,
        y: ins.top + availH / 2 - ((box.y0 + box.y1) / 2) * k,
      });
    },
    [insets],
  );
  const fit = useCallback(() => {
    setFocusZone(null);
    fitBox(tier === "board" ? boardBox : mapBox);
  }, [fitBox, tier, boardBox, mapBox]);
  useLayoutEffect(() => {
    if (fitted.current) return;
    fitted.current = true;
    fitBox(mapBox);
  }, [fitBox, mapBox]);
  useEffect(() => {
    fitted.current = false;
  }, [model]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    setView((v) => {
      const k = clampZoom(v.k * factor);
      const px = cx ?? vp.clientWidth / 2;
      const py = cy ?? vp.clientHeight / 2;
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  }, []);
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (event: WheelEvent) => {
      if (panelRef.current?.contains(event.target as Node) || sidePanelRef.current?.contains(event.target as Node)) {
        return;
      }
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

  const drag = useRef<{ id: number; x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (event: React.PointerEvent) => {
    const target = event.target as HTMLElement;
    if (
      event.button !== 0 ||
      target.closest("[data-interactive]") ||
      panelRef.current?.contains(target) ||
      sidePanelRef.current?.contains(target)
    ) {
      return;
    }
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

  // ---- tiers ----
  const enterBoard = useCallback(
    (owner: string | null = null) => {
      setBoardOwner(owner);
      setTier("board");
      setFocusZone(null);
      onSelect(null);
      fitBox(boardBox, 1.04);
    },
    [fitBox, boardBox, onSelect],
  );
  const leaveBoard = useCallback(() => {
    setBoardOwner(null);
    setTier("map");
    onSelect(null);
    fitBox(mapBox);
  }, [fitBox, mapBox, onSelect]);
  const pick = useCallback(
    (id: string) => {
      if (model.chips.has(id) && tier !== "board") setTier("board");
      if (model.nodes.has(id) && tier !== "map") setTier("map");
      setFocusZone(null);
      onSelect(id);
    },
    [model, tier, onSelect],
  );
  const toggleZone = useCallback(
    (key: string) => {
      if (tier === "board") setTier("map");
      if (focusZone === key) {
        setFocusZone(null);
        fitBox(mapBox);
        return;
      }
      setFocusZone(key);
      onSelect(null);
      const r = model.regions.find((x) => x.key === key);
      if (r) fitBox(r, 1.25);
    },
    [tier, focusZone, fitBox, mapBox, model, onSelect],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onSelect(null);
      setFocusZone(null);
      setBoardOwner(null);
      onClearHighlight?.();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onSelect, onClearHighlight]);

  // Fit a new highlight's map nodes. Packages stay on the board unless it is opened.
  const highlightKey = highlight ? `${highlight.key}:${highlight.ids.size}` : null;
  const prevHighlight = useRef<string | null>(null);
  useEffect(() => {
    if (highlightKey === prevHighlight.current) return;
    prevHighlight.current = highlightKey;
    if (!highlight || highlight.ids.size === 0) return;
    const pts = [...highlight.ids].map((id) => model.nodes.get(id)).filter((n): n is MapNode => !!n);
    if (!pts.length) return;
    setFocusZone(null);
    setTier("map");
    const box = union(pts.map((q) => ({ x0: q.x - q.w / 2, y0: q.y - q.h / 2, x1: q.x + q.w / 2, y1: q.y + q.h / 2 })));
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const hw = Math.max((box.x1 - box.x0) / 2 + 8, 30);
    const hh = Math.max((box.y1 - box.y0) / 2 + 8, 18);
    fitBox({ x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh }, 1.05);
  }, [highlightKey, highlight, model, fitBox]);

  // Bring a selection made elsewhere (a link in the panel) on screen.
  const prevSelected = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId === prevSelected.current) return;
    prevSelected.current = selectedId;
    if (!selectedId) return;
    const n = model.nodes.get(selectedId);
    const c = model.chips.get(selectedId);
    const p = n ?? c;
    if (!p) return;
    if (c && tier !== "board") setTier("board");
    if (n && tier !== "map") setTier("map");
    const vp = viewportRef.current;
    if (!vp) return;
    const { x, y, k } = viewRef.current;
    const ins = insets();
    const sx = x + p.x * k;
    const sy = y + p.y * k;
    const clear =
      sx > ins.left + 20 && sx < vp.clientWidth - ins.right - 20 && sy > ins.top + 20 && sy < vp.clientHeight - 40;
    if (!clear) {
      if (c) {
        const ids = [selectedId, ...ancestors(model, selectedId)];
        const pts = ids.map((id) => model.chips.get(id)!);
        fitBox(union(pts.map((q) => ({ x0: q.x - 8, y0: q.y - 8, x1: q.x + 8, y1: q.y + 8 }))), 1.1);
      } else {
        fitBox({ x0: p.x - 34, y0: p.y - 20, x1: p.x + 34, y1: p.y + 20 }, 1);
      }
    }
  }, [selectedId, model, tier, fitBox, insets]);

  // ---- emphasis ----
  const focusId = hoverId ?? peekId ?? selectedId;
  const emphasis = useMemo(() => {
    const focusNode = focusId && model.nodes.has(focusId) ? focusId : null;
    const focusChip = focusId && model.chips.has(focusId) ? focusId : null;
    let litNodes: Set<string> | null = null;
    let litWires: ((w: MapWire) => boolean) | null = null;
    if (focusNode) {
      litNodes = neighbourhood(model, focusNode);
      litWires = (w) => w.source === focusNode || w.target === focusNode;
    } else if (focusZone) {
      const r = model.regions.find((x) => x.key === focusZone);
      const ids = new Set(r?.ids ?? []);
      litNodes = ids;
      litWires = (w) => ids.has(w.source) || ids.has(w.target);
    } else if (highlight && !focusChip) {
      const ids = highlight.ids;
      litNodes = ids;
      litWires = (w) => ids.has(w.source) && ids.has(w.target);
    }
    let chain: Set<string> | null = null;
    let down: Set<string> | null = null;
    if (focusChip) {
      chain = new Set([focusChip, ...ancestors(model, focusChip)]);
      down = descendants(model, focusChip);
    }
    const ownerChips = boardOwner ? new Set(model.packagesOf.get(boardOwner) ?? []) : null;
    const litChips = focusChip || focusNode ? null : ((highlight ?? null)?.ids ?? ownerChips);
    return { focusNode, focusChip, litNodes, litWires, chain, down, litChips };
  }, [focusId, focusZone, model, highlight, boardOwner]);

  // ---- wires (geometry is per model; styling per emphasis) ----
  const wires = useMemo(
    () =>
      model.wires
        .map((w) => {
          const a = model.nodes.get(w.source);
          const b = model.nodes.get(w.target);
          if (!a || !b) return null;
          return { w, ...wirePath(a, b, w.bow) };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    [model],
  );
  const depPaths = useMemo(
    () =>
      model.depEdges.map(([s, t]) => {
        const a = model.chips.get(s)!;
        const b = model.chips.get(t)!;
        const ay = a.y - a.h / 2;
        const by = b.y + b.h / 2;
        const my = (ay + by) / 2;
        return {
          s,
          t,
          d: `M${a.x.toFixed(2)},${ay.toFixed(2)}C${a.x.toFixed(2)},${my.toFixed(2)} ${b.x.toFixed(2)},${my.toFixed(2)} ${b.x.toFixed(2)},${by.toFixed(2)}`,
          tip: [b.x, by] as [number, number],
        };
      }),
    [model],
  );

  // ---- labels ----
  const labels = useMemo<Label[]>(() => {
    const out: Label[] = [];
    for (const r of model.regions) {
      out.push({
        id: `plate:${r.key}`,
        text: r.label,
        sub: `${r.ids.length} node${r.ids.length === 1 ? "" : "s"}`,
        x: r.x0 + 3,
        y: r.y0 + 2.6,
        prio: 0,
        tier: 0,
        tierWorld: "map",
        kind: "plate",
        color: zoneColor(r.key),
      });
    }
    for (const n of model.nodes.values()) {
      out.push({
        id: n.node.refId,
        text: n.label,
        sub: n.hub
          ? `${(n.node.properties.kind as string) || "component"}${n.region ? ` · ${n.region}` : ""}`
          : undefined,
        x: n.x,
        y: n.y - n.h / 2 - 0.3,
        prio: n.hub ? 1 : n.labelTier === 1 ? 2 : 3,
        tier: n.labelTier,
        tierWorld: "map",
        kind: n.hub ? "hub" : n.secret ? "secret" : "node",
        color: n.hub ? TYPE_COLOR[n.node.type] : undefined,
        ghost: n.ghost,
      });
    }
    if (model.regions.length) {
      const s = signBox(model);
      out.push({
        id: "sign",
        text: `${model.stats.packages} PACKAGES →`,
        sub: "click to open",
        x: s.x0,
        y: s.y1 - 1,
        prio: 0,
        tier: 0,
        tierWorld: "map",
        kind: "plate",
        color: "currentColor",
      });
    }
    for (const b of model.boards) {
      out.push({
        id: `board:${b.key}`,
        text: b.label,
        sub: `${b.ids.length} · ${b.sub}`,
        x: b.x0 + 3,
        y: b.y0 + 2.6,
        prio: 0,
        tier: 0,
        tierWorld: "board",
        kind: "plate",
        color: BOARD_COLOR,
      });
    }
    for (const c of model.chips.values()) {
      const flagged = !!cves?.byPackage.has(c.node.refId);
      out.push({
        id: c.node.refId,
        text: c.name,
        x: c.x,
        y: c.y - c.h / 2 - 0.25,
        prio: flagged ? 1 : c.hub || c.direct ? 2 : 3,
        tier: flagged || c.hub || c.direct ? 1 : 2,
        tierWorld: "board",
        kind: "chip",
        color: flagged ? VULN_COLOR : c.hub ? HUB_COLOR : c.direct ? DIRECT_COLOR : undefined,
      });
    }
    return out;
  }, [model, cves]);
  useLayoutEffect(() => {
    const next = new Map<string, [number, number]>();
    for (const [id, el] of labelEls.current) next.set(id, [el.offsetWidth, el.offsetHeight]);
    setWidths(next);
  }, [labels]);
  const registerLabel = useCallback((id: string, el: HTMLElement | null) => {
    if (el) labelEls.current.set(id, el);
    else labelEls.current.delete(id);
  }, []);

  const placedLabels = useMemo(() => {
    const vp = viewportRef.current;
    const W = vp?.clientWidth ?? 1200;
    const H = vp?.clientHeight ?? 700;
    const { x: tx, y: ty, k } = view;
    const worldTier: Tier = model.boards.length && (W / 2 - tx) / k > mapBox.x1 + 40 ? "board" : "map";
    const forced = new Set<string>();
    if (emphasis.litNodes && emphasis.focusNode) for (const id of emphasis.litNodes) forced.add(id);
    if (emphasis.chain) for (const id of emphasis.chain) forced.add(id);
    if (highlight && !emphasis.focusNode && !emphasis.chain) for (const id of highlight.ids) forced.add(id);
    const near = k > 9;
    const placed: Box[] = [];
    const out = new Map<string, { x: number; y: number }>();
    const order = labels.slice().sort((a, b) => (forced.has(a.id) ? -1 : a.prio) - (forced.has(b.id) ? -1 : b.prio));
    for (const L of order) {
      if (L.tierWorld !== worldTier) continue;
      if (!(L.tier < 2 || show.labels || near || forced.has(L.id))) continue;
      const x = L.x * k + tx;
      const y = L.y * k + ty;
      if (x < -200 || x > W + 200 || y < -100 || y > H + 100) continue;
      const [w, h] = widths.get(L.id) ?? [L.text.length * 6.5, 14];
      const P = 7;
      const plate = L.tier === 0;
      const box: Box = plate
        ? { x0: x - P, y0: y - P, x1: x + w + P, y1: y + h + P }
        : { x0: x - w / 2 - P, y0: y - h - 4 - P, x1: x + w / 2 + P, y1: y - 4 + P };
      if (placed.some((p) => box.x0 < p.x1 && p.x0 < box.x1 && box.y0 < p.y1 && p.y0 < box.y1)) continue;
      placed.push(box);
      out.set(L.id, plate ? { x, y } : { x: x - w / 2, y: y - 4 - h });
    }
    return out;
  }, [labels, widths, view, show.labels, emphasis, model, mapBox, highlight]);

  const dimNode = (id: string) => {
    if (emphasis.chain || emphasis.down) return false;
    return !!emphasis.litNodes && !emphasis.litNodes.has(id);
  };
  const dimChip = (id: string) => {
    if (!emphasis.chain) return !!emphasis.litChips && !emphasis.litChips.has(id);
    return !emphasis.chain.has(id) && !emphasis.down!.has(id);
  };
  const dimWire = (w: MapWire) => !!emphasis.litWires && !emphasis.litWires(w);
  const chipColor = (c: MapChip) => {
    const f = cves?.byPackage.get(c.node.refId);
    if (f) return severityRank(f.severity) <= severityRank("HIGH") ? VULN_COLOR : "#e0962f";
    return c.hub ? HUB_COLOR : c.direct ? DIRECT_COLOR : CHIP_COLOR;
  };
  const depStyle = (s: string, t: string) => {
    const { chain, down, focusChip } = emphasis;
    if (!chain) return { stroke: DEP_COLOR, width: 0.14, opacity: 0.9 };
    if (chain.has(s) && chain.has(t)) {
      const red = focusChip && cves?.byPackage.has(focusChip);
      return { stroke: red ? VULN_COLOR : CHAIN_COLOR, width: 0.32, opacity: 1, lit: true };
    }
    if ((down!.has(s) || s === focusChip) && down!.has(t)) return { stroke: "#6b7686", width: 0.2, opacity: 1 };
    return { stroke: DEP_COLOR, width: 0.14, opacity: 0.15 };
  };

  const regionCards = useMemo(() => {
    const ORDER = ["actors", "identities", "ci", "device", "tailnet", "internal", "loopback", "internet", "catalog"];
    return model.regions
      .slice()
      .sort((a, b) => (ORDER.indexOf(a.key) + 1 || 99) - (ORDER.indexOf(b.key) + 1 || 99))
      .map((r) => {
        const ids = new Set(r.ids);
        const cross = model.wires.filter((w) => w.kind === "cross" && (ids.has(w.source) || ids.has(w.target))).length;
        const reach = model.wires.filter((w) => w.kind === "reach" && ids.has(w.target)).length;
        const secrets = r.ids.filter((id) => model.nodes.get(id)?.secret).length;
        return {
          r,
          cross,
          sub: [`${r.ids.length} nodes`, reach ? `${reach} reach` : "", secrets ? `${secrets} secrets` : ""]
            .filter(Boolean)
            .join(" · "),
        };
      });
  }, [model]);
  const vulnerableCount = useMemo(
    () => [...model.chips.keys()].filter((id) => cves?.byPackage.has(id)).length,
    [model, cves],
  );

  const sign = model.regions.length ? signBox(model) : null;
  // A selected component with packages: the board button opens the board lit for them.
  const ownerForBoard = selectedId && model.packagesOf.get(selectedId)?.length ? selectedId : null;
  const showGroup = (kind: WireKind) => (kind === "cross" ? show.flow : show[kind]);

  return (
    <div className="space-y-3" data-testid="system-map-map">
      <style>{`@keyframes map-pulse{to{stroke-dashoffset:-12}}`}</style>
      <div
        ref={viewportRef}
        className={cn(
          "relative h-[calc(100vh-15rem)] min-h-[520px] touch-none select-none overflow-hidden rounded-lg border bg-muted/20 text-foreground",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-testid="map-canvas"
      >
        <svg className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <pattern
              id="map-grid"
              patternUnits="userSpaceOnUse"
              width={25 * view.k}
              height={25 * view.k}
              patternTransform={`translate(${view.x} ${view.y})`}
            >
              {[5, 10, 15, 20].map((i) => (
                <path
                  key={i}
                  d={`M${i * view.k},0V${25 * view.k}M0,${i * view.k}H${25 * view.k}`}
                  className="stroke-border"
                  strokeWidth={0.5}
                  strokeOpacity={0.35}
                  fill="none"
                />
              ))}
              <path
                d={`M0,0H${25 * view.k}M0,0V${25 * view.k}`}
                className="stroke-border"
                strokeWidth={0.8}
                strokeOpacity={0.7}
                fill="none"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#map-grid)" />
          <g transform={`matrix(${view.k} 0 0 ${view.k} ${view.x} ${view.y})`}>
            {/* plates */}
            {model.regions.map((r) => (
              <g
                key={r.key}
                data-testid="map-plate"
                className="transition-opacity"
                opacity={focusZone && focusZone !== r.key ? 0.35 : 1}
              >
                <rect
                  x={r.x0 + 1}
                  y={r.y0 + 1.2}
                  width={r.x1 - r.x0}
                  height={r.y1 - r.y0}
                  rx={3.2}
                  className="fill-foreground"
                  fillOpacity={0.12}
                />
                <rect
                  x={r.x0}
                  y={r.y0}
                  width={r.x1 - r.x0}
                  height={r.y1 - r.y0}
                  rx={3.2}
                  className="fill-card stroke-foreground"
                  strokeWidth={OL}
                  strokeOpacity={0.8}
                  strokeDasharray={r.dim ? "2 1.6" : undefined}
                />
                <rect
                  x={r.x0}
                  y={r.y0}
                  width={r.x1 - r.x0}
                  height={r.y1 - r.y0}
                  rx={3.2}
                  fill={zoneColor(r.key)}
                  fillOpacity={r.dim ? 0.04 : 0.08}
                />
                <rect
                  x={r.x0 + 3}
                  y={r.y0 + 1.1}
                  width={r.x1 - r.x0 - 6}
                  height={0.9}
                  rx={0.3}
                  fill={zoneColor(r.key)}
                />
              </g>
            ))}
            {/* wires: structure under, flows on top */}
            {(["struct", "guard", "reach", "flow", "cross"] as WireKind[]).map((kind) => (
              <g key={kind} style={{ display: showGroup(kind) ? undefined : "none" }}>
                {wires
                  .filter((x) => x.w.kind === kind)
                  .map(({ w, d, arrow, length }) => {
                    const width = WIRE_WIDTH[kind];
                    const color = WIRE_COLOR[kind];
                    return (
                      <g
                        key={w.id}
                        data-testid="map-wire"
                        className="transition-opacity"
                        opacity={dimWire(w) ? 0.06 : 1}
                      >
                        {kind !== "struct" && (
                          <path
                            d={d}
                            fill="none"
                            className="stroke-foreground"
                            strokeWidth={width + OL * 1.2}
                            strokeLinecap="round"
                          />
                        )}
                        <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" />
                        {kind !== "struct" && (
                          <path
                            d={d}
                            fill="none"
                            stroke="#fff"
                            strokeOpacity={0.75}
                            strokeWidth={width * 0.5}
                            strokeLinecap="round"
                            strokeDasharray="1.2 10.8"
                            style={{ animation: `map-pulse ${Math.max(1.2, length / 28)}s linear infinite` }}
                          />
                        )}
                        {w.arrow && (
                          <path
                            d={polygon(arrow)}
                            fill={color}
                            className="stroke-foreground"
                            strokeWidth={OL * 0.8}
                            strokeLinejoin="round"
                          />
                        )}
                        <path
                          d={d}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={Math.max(2, width * 3)}
                          className="pointer-events-auto cursor-help"
                        >
                          <title>{`${model.nodes.get(w.source)?.node.name} → ${model.nodes.get(w.target)?.node.name}: ${w.label}`}</title>
                        </path>
                      </g>
                    );
                  })}
              </g>
            ))}
            {/* nodes */}
            {[...model.nodes.values()].map((n) => {
              const color = n.secret ? GOLD : (TYPE_COLOR[n.node.type] ?? "#8a93a2");
              const id = n.node.refId;
              const selected = selectedId === id;
              const scale = selected || hoverId === id || peekId === id ? 1.1 : 1;
              const d = silhouette(n.glyph);
              return (
                <g
                  key={id}
                  data-interactive
                  data-testid="map-node"
                  data-ref-id={id}
                  role="button"
                  tabIndex={0}
                  transform={`translate(${n.x} ${n.y}) scale(${scale})`}
                  className="cursor-pointer outline-none transition-opacity"
                  opacity={dimNode(id) ? 0.16 : n.ghost ? 0.5 : 1}
                  onClick={() => pick(id)}
                  onKeyDown={(e) => e.key === "Enter" && pick(id)}
                  onPointerEnter={() => setHoverId(id)}
                  onPointerLeave={() => setHoverId((h) => (h === id ? null : h))}
                >
                  <title>{`${n.node.type.replace(/^Sys/, "")}${n.node.properties.kind ? ` · ${n.node.properties.kind}` : ""}: ${n.node.name}`}</title>
                  <path d={d} transform="translate(0.55 0.75)" className="fill-foreground" fillOpacity={0.14} />
                  <path d={d} className="fill-card" />
                  <path
                    d={d}
                    fill={color}
                    fillOpacity={n.secret ? 0.85 : 0.28}
                    stroke={color}
                    strokeWidth={OL}
                    strokeLinejoin="round"
                  />
                  <GlyphDetail glyph={n.glyph} color={color} />
                  {highlight?.ids.has(id) && !selected && (
                    <path
                      d={d}
                      fill="none"
                      stroke={highlight.color}
                      strokeWidth={OL * 1.6}
                      strokeDasharray="1 0.6"
                      transform="scale(1.18)"
                      data-testid="map-node-highlight"
                    />
                  )}
                  {selected && (
                    <path d={d} fill="none" className="stroke-primary" strokeWidth={OL * 1.6} transform="scale(1.12)" />
                  )}
                  {badges?.get(id) && (
                    <g
                      transform={`translate(${n.w / 2 - 0.6} ${-n.h / 2 + 0.4})`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onBadge?.(id);
                      }}
                      data-testid="map-node-badge"
                    >
                      <title>{badges.get(id)!.title}</title>
                      <circle
                        r={1.5}
                        fill={badges.get(id)!.color}
                        className="stroke-background"
                        strokeWidth={OL * 1.2}
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={badges.get(id)!.count > 99 ? 1.1 : 1.5}
                        fontWeight={700}
                        fill="#fff"
                      >
                        {badges.get(id)!.count > 999 ? "1k+" : badges.get(id)!.count}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
            {/* signpost to the board */}
            {sign && model.boards.length > 0 && (
              <g
                data-interactive
                data-testid="map-signpost"
                role="button"
                tabIndex={0}
                className="cursor-pointer"
                transform={`translate(${(sign.x0 + sign.x1) / 2} ${(sign.y0 + sign.y1) / 2 - 3})`}
                onClick={() => enterBoard()}
                onKeyDown={(e) => e.key === "Enter" && enterBoard()}
              >
                <title>Open the package board</title>
                <path
                  d={rr(14, 7, 0.6)}
                  transform="translate(0.55 0.75)"
                  className="fill-foreground"
                  fillOpacity={0.14}
                />
                <path d={rr(14, 7, 0.6)} className="fill-foreground" />
                <path
                  d={polygon([
                    [4.2, 0],
                    [1.6, -1.6],
                    [1.6, 1.6],
                  ])}
                  className="fill-background"
                />
                <rect x="-4.7" y="-0.55" width="5" height="1.1" rx="0.3" className="fill-background" />
              </g>
            )}
            {/* board */}
            {model.boards.map((b) => (
              <g key={b.key} data-testid="map-board">
                <rect
                  x={b.x0 + 1}
                  y={b.y0 + 1.2}
                  width={b.x1 - b.x0}
                  height={b.y1 - b.y0}
                  rx={3.2}
                  className="fill-foreground"
                  fillOpacity={0.12}
                />
                <rect
                  x={b.x0}
                  y={b.y0}
                  width={b.x1 - b.x0}
                  height={b.y1 - b.y0}
                  rx={3.2}
                  className="fill-card stroke-foreground"
                  strokeWidth={OL}
                  strokeOpacity={0.8}
                />
                <rect
                  x={b.x0}
                  y={b.y0}
                  width={b.x1 - b.x0}
                  height={b.y1 - b.y0}
                  rx={3.2}
                  fill={BOARD_COLOR}
                  fillOpacity={0.06}
                />
                <rect x={b.x0 + 3} y={b.y0 + 1.1} width={b.x1 - b.x0 - 6} height={0.9} rx={0.3} fill={BOARD_COLOR} />
              </g>
            ))}
            <g>
              {depPaths.map(({ s, t, d, tip }) => {
                const st = depStyle(s, t);
                return (
                  <g key={`${s}>${t}`}>
                    {st.lit && (
                      <path
                        d={d}
                        fill="none"
                        className="stroke-foreground"
                        strokeWidth={st.width + OL * 0.8}
                        strokeLinecap="round"
                      />
                    )}
                    <path
                      d={d}
                      fill="none"
                      stroke={st.stroke}
                      strokeWidth={st.width}
                      opacity={st.opacity}
                      strokeLinecap="round"
                    />
                    {st.lit && (
                      <path
                        d={polygon([
                          [tip[0], tip[1] - 0.1],
                          [tip[0] - 0.6, tip[1] + 1.3],
                          [tip[0] + 0.6, tip[1] + 1.3],
                        ])}
                        fill={st.stroke}
                        className="stroke-foreground"
                        strokeWidth={OL * 0.6}
                        strokeLinejoin="round"
                      />
                    )}
                  </g>
                );
              })}
            </g>
            {[...model.chips.values()].map((c) => {
              const id = c.node.refId;
              const color = chipColor(c);
              const selected = selectedId === id;
              const scale = selected || hoverId === id || peekId === id ? 1.18 : 1;
              return (
                <g
                  key={id}
                  data-interactive
                  data-testid="map-chip"
                  data-ref-id={id}
                  role="button"
                  tabIndex={0}
                  transform={`translate(${c.x} ${c.y}) scale(${scale})`}
                  className="cursor-pointer outline-none"
                  opacity={dimChip(id) ? 0.16 : 1}
                  onClick={() => pick(id)}
                  onKeyDown={(e) => e.key === "Enter" && pick(id)}
                  onPointerEnter={() => setHoverId(id)}
                  onPointerLeave={() => setHoverId((h) => (h === id ? null : h))}
                >
                  <title>{`${c.name}${c.version ? `@${c.version}` : ""} · ${c.direct ? "direct" : `depth ${c.depth}`} · ${c.dependents.length} dependents`}</title>
                  <path
                    d={rr(c.w, c.h, 0.3)}
                    transform="translate(0.33 0.45)"
                    className="fill-foreground"
                    fillOpacity={0.14}
                  />
                  <path
                    d={rr(c.w, c.h, 0.3)}
                    fill={color}
                    className="stroke-foreground"
                    strokeWidth={OL * 0.6}
                    strokeOpacity={0.8}
                    strokeLinejoin="round"
                  />
                  <rect
                    x={-c.w / 4}
                    y={-c.h / 2 + 0.4}
                    width={c.w / 2}
                    height={0.3}
                    rx={0.1}
                    className="fill-foreground"
                    fillOpacity={0.7}
                  />
                  {highlight?.ids.has(id) && !selected && (
                    <path
                      d={rr(c.w, c.h, 0.3)}
                      fill="none"
                      stroke={highlight.color}
                      strokeWidth={OL * 1.4}
                      transform="scale(1.25)"
                    />
                  )}
                  {selected && (
                    <path
                      d={rr(c.w, c.h, 0.3)}
                      fill="none"
                      className="stroke-primary"
                      strokeWidth={OL * 1.4}
                      transform="scale(1.15)"
                    />
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* labels: HTML, projected and decluttered per view */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" data-testid="map-labels">
          {labels.map((L) => {
            const p = placedLabels.get(L.id);
            const dim =
              (L.kind === "chip"
                ? dimChip(L.id)
                : L.kind === "plate"
                  ? focusZone && L.id !== `plate:${focusZone}` && L.id.startsWith("plate:")
                  : dimNode(L.id)) && !emphasis.chain?.has(L.id);
            return (
              <div
                key={L.id}
                ref={(el) => registerLabel(L.id, el)}
                className={cn(
                  "absolute left-0 top-0 whitespace-nowrap leading-tight transition-opacity",
                  L.kind === "plate" &&
                    "rounded bg-card/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]",
                  L.kind === "hub" && "text-[13px] font-bold uppercase tracking-wide",
                  L.kind === "node" && "text-[11px] font-semibold",
                  L.kind === "secret" && "font-mono text-[11px] font-medium text-amber-700 dark:text-amber-400",
                  L.kind === "chip" && "font-mono text-[10px]",
                  L.ghost && "text-muted-foreground",
                  dim && "opacity-10",
                )}
                style={{
                  transform: p ? `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)` : "translate(-9999px, -9999px)",
                  visibility: p ? "visible" : "hidden",
                  color: L.kind === "plate" || L.kind === "chip" ? L.color : undefined,
                  textShadow:
                    L.kind === "plate"
                      ? undefined
                      : "0 0 3px var(--background), 0 0 6px var(--background), 0 1px 0 var(--background), 0 -1px 0 var(--background)",
                }}
              >
                {L.text}
                {L.sub && (
                  <span
                    className={cn(
                      "ml-2 font-normal normal-case tracking-normal text-muted-foreground",
                      L.kind === "hub" && "block text-[9px] font-semibold uppercase tracking-[0.16em]",
                    )}
                    style={{ color: L.kind === "hub" ? L.color : undefined }}
                  >
                    {L.sub}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* toolbar */}
        <div
          data-interactive
          className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-background/95 px-2 py-1 text-xs shadow-sm backdrop-blur"
          data-testid="map-toolbar"
        >
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => zoomAt(1 / 1.25)}
              aria-label="Zoom out"
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <span className="w-12 text-center tabular-nums text-muted-foreground" data-testid="map-zoom">
              {Math.round(view.k * 25)}%
            </span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => zoomAt(1.25)} aria-label="Zoom in">
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={fit} data-testid="map-fit">
              <Maximize className="mr-1 h-3 w-3" /> Fit
            </Button>
          </div>
          {(
            [
              ["flow", "Flows", WIRE_COLOR.flow],
              ["reach", "Reach", WIRE_COLOR.reach],
              ["guard", "Secrets", WIRE_COLOR.guard],
              ["struct", "Structure", WIRE_COLOR.struct],
            ] as const
          ).map(([key, label, color]) => (
            <label key={key} className="flex items-center gap-1.5 text-muted-foreground">
              <Switch
                checked={show[key]}
                onCheckedChange={(v) => setShow((s) => ({ ...s, [key]: v }))}
                className="scale-75"
                data-testid={`map-toggle-${key}`}
              />
              <span className="inline-block h-1 w-3.5 rounded-sm" style={{ background: color }} />
              {label}
            </label>
          ))}
          <label className="flex items-center gap-1.5 text-muted-foreground">
            <Switch
              checked={show.labels}
              onCheckedChange={(v) => setShow((s) => ({ ...s, labels: v }))}
              className="scale-75"
              data-testid="map-toggle-labels"
            />
            All labels
          </label>
          <span className="hidden items-center gap-2 text-muted-foreground sm:flex">
            <span>{model.stats.drawn} nodes</span>
            <span
              className={cn(
                model.stats.crossZone
                  ? "font-medium text-red-600 dark:text-red-400"
                  : "text-emerald-700 dark:text-emerald-400",
              )}
            >
              {model.stats.crossZone} cross-zone
            </span>
            <span>{model.stats.secrets} secrets</span>
          </span>
          {model.boards.length > 0 && (
            <Button
              variant={tier === "board" ? "secondary" : "default"}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={tier === "board" ? leaveBoard : () => enterBoard(ownerForBoard)}
              data-testid="map-board-toggle"
            >
              {tier === "board" ? (
                <>
                  <ArrowLeft className="mr-1 h-3 w-3" /> Back to map
                </>
              ) : (
                <>
                  {ownerForBoard
                    ? `${model.packagesOf.get(ownerForBoard)!.length} packages of ${model.nodes.get(ownerForBoard)?.label ?? "it"}`
                    : `${model.stats.packages} packages`}
                  {vulnerableCount > 0 && (
                    <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white">
                      {vulnerableCount}
                    </span>
                  )}
                  <ArrowRight className="ml-1 h-3 w-3" />
                </>
              )}
            </Button>
          )}
        </div>

        {sidePanel && (
          <div
            ref={sidePanelRef}
            data-interactive
            className="absolute left-3 top-14 z-10 w-72 max-w-[calc(100%-1.5rem)] cursor-auto overflow-y-auto overscroll-contain rounded-lg border bg-background/95 p-3 shadow-md backdrop-blur"
            style={{ maxHeight: "calc(100% - 4.5rem)" }}
            data-testid="map-side-panel"
          >
            {sidePanel}
          </div>
        )}

        {panel && (
          <div
            ref={panelRef}
            data-interactive
            className="absolute right-3 top-3 z-10 w-80 max-w-[calc(100%-1.5rem)] cursor-auto overflow-y-auto overscroll-contain rounded-lg border bg-background/95 p-3 shadow-md backdrop-blur"
            style={{ maxHeight: "calc(100% - 1.5rem)" }}
            data-testid="map-panel"
          >
            {panel}
          </div>
        )}

        <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-muted-foreground">
          {tier === "board" && boardOwner
            ? `Lit: the ${model.packagesOf.get(boardOwner)?.length ?? 0} packages ${model.nodes.get(boardOwner)?.label ?? "the component"} depends on. Click a chip for its chain, Esc to clear.`
            : tier === "board"
              ? "Bottom row: what the repo declares directly; each row up is one dependency hop deeper. Click a chip for the chain that pulls it in."
              : "Plates are trust zones; a red wire is a flow that crosses one. Hover to light a node's links, click for details. Drag to move, ⌘/Ctrl + scroll to zoom."}
        </p>
      </div>

      {/* zone cards */}
      <div className="flex gap-2 overflow-x-auto pb-1" data-testid="map-zones">
        {model.boards.length > 0 && (
          <button
            type="button"
            onClick={() => enterBoard()}
            className={cn(
              "relative flex w-52 shrink-0 items-center gap-2.5 rounded-lg border bg-background px-3 py-2 text-left hover:bg-muted/50",
              tier === "board" && "ring-2 ring-primary",
            )}
            data-testid="map-zone-card"
            data-zone="packages"
          >
            <span className="h-9 w-1.5 shrink-0 rounded-sm bg-foreground" />
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold uppercase tracking-wide">Packages</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {model.stats.packages} packages · {model.stats.direct} direct
                {cves ? ` · ${vulnerableCount} vulnerable` : ""}
              </span>
            </span>
            {vulnerableCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">
                {vulnerableCount}
              </span>
            )}
          </button>
        )}
        {regionCards.map(({ r, cross, sub }) => (
          <button
            key={r.key}
            type="button"
            onClick={() => toggleZone(r.key)}
            title={r.description || undefined}
            className={cn(
              "relative flex w-52 shrink-0 items-center gap-2.5 rounded-lg border bg-background px-3 py-2 text-left hover:bg-muted/50",
              focusZone === r.key && "ring-2 ring-primary",
            )}
            data-testid="map-zone-card"
            data-zone={r.key}
          >
            <span className="h-9 w-1.5 shrink-0 rounded-sm" style={{ background: zoneColor(r.key) }} />
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold uppercase tracking-wide">{regionTitle(r)}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>
            </span>
            {cross > 0 && (
              <span
                className="absolute -right-1.5 -top-1.5 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white"
                title="cross-zone flows"
              >
                {cross}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Where the signpost to the board sits: just right of the right-most plate. */
function signBox(model: MapModel): Box {
  const right = model.regions.reduce((a, r) => (!a || r.x1 > a.x1 ? r : a), null as MapRegion | null)!;
  const cx = right.x1 + 16;
  const cy = (right.y0 + right.y1) / 2;
  return { x0: cx - 7, y0: cy - 7, x1: cx + 7 + 26, y1: cy + 9 };
}
