"use client";

/**
 * The System view: a semantic-zoom map of the system with the plan's
 * features standing on it (`CANVAS.md`, "System view"). It draws the model
 * (`model.ts`) at the places `layout.ts` gives, under a camera of its own
 * built from the Plan view's camera maths (`scene.ts`: `fit`, `between`,
 * `zoomAbout`). Four levels: 1 World (zone plates, districts with a rollup,
 * the Unmapped box), 2 District, 3 Feature (a stack), 4 Tier (jobs, pull
 * requests, decisions). The whole system stays drawn behind the focused
 * part, dimmed; wires only at levels 1–2.
 *
 * The camera is not state: it moves the world layer directly. `at` (a
 * district, tier, `zone:<key>` or `unmapped`) and `deep` (level 4) belong
 * to the URL, kept by `InfiniteCanvas`.
 */

import { type MutableRefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type FocusResult, resolveFocus } from "@/lib/canvas/focus-target";
import type { Board } from "../board";
import { TYPE, label, pill } from "../nodes";
import { type Camera, type Rect, type Viewport, between, fit, zoomAbout } from "../scene";
import { a, v } from "../theme";
import { type DistrictBox, HEADER_H, type SystemLayout, UNMAPPED_ROWS, layoutSystem, rectFor } from "./layout";
import { type District, type SystemModel, type Tier, UNASSIGNED, buildSystemModel } from "./model";
import { DetailPanel, JobRows, SystemList, STATE_LABEL, rollupLine, tierLook } from "./SystemPanels";
import { useOrgCanvasJobs, useSystemEdges, useSystemNodes } from "./useSystemData";

export const UNMAPPED = "unmapped";
export const ZONE_PREFIX = "zone:";
/** The part of the view the chrome leaves free. */
const INSETS = { top: 70, bottom: 150 };
const PANEL_W = 400;
const FLIGHT_MS = 650;
const SETTLE_MS = 160;
/** Camera scale (screen px per world unit) below which tier names, and below which claimed nodes, are left out. */
const FAR_Z = 0.3;
const MID_Z = 0.55;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const LOD = (z: number) => (z < FAR_Z ? "far" : z < MID_Z ? "mid" : "near");

export const SYSTEM_CSS = `
.sys-root[data-lod="far"] .sys-mid, .sys-root[data-lod="far"] .sys-near, .sys-root[data-lod="mid"] .sys-near { display: none }
.sys-root[data-lod="near"] .sys-far-only, .sys-root[data-lod="mid"] .sys-far-only { display: none }
.sys-item { transition: opacity .35s }
.sys-hit { cursor: pointer }
@keyframes sys-flash { 0%, 70% { box-shadow: 0 0 0 7px var(--ic-flash), 0 0 28px 10px var(--ic-flash) } 100% { box-shadow: 0 0 0 0 transparent } }
.sys-flash { animation: sys-flash 2.4s ease-out both }
@media (prefers-reduced-motion: reduce) { .sys-flash { animation: none } }
`;

export type SysLevel = 1 | 2 | 3 | 4;

/** What `at` names, against the current model. */
export function levelOf(model: SystemModel, at: string | null, deep: boolean): SysLevel {
  if (!at) return 1;
  if (at === UNMAPPED) return 2;
  if (at.startsWith(ZONE_PREFIX)) return 1;
  if (model.districts.has(at)) return 2;
  if (model.tiers.has(at)) return deep ? 4 : 3;
  return 1;
}

/** Everything a name can be pulled up by in the System view: districts, zones, tiers. */
export function systemCandidates(model: SystemModel) {
  return [
    ...model.zones.filter((z) => z.key !== UNASSIGNED).map((z) => ({ kind: "zone" as const, ref: `${ZONE_PREFIX}${z.key}`, name: z.key, view: "system" as const })),
    ...[...model.districts.values()].map((d) => ({ kind: "component" as const, ref: d.id, name: d.name, view: "system" as const })),
    ...[...model.tiers.values()].map((t) => ({ kind: "feature" as const, ref: t.id, name: t.name, view: "system" as const })),
  ];
}

/** The rect a stack takes (all its drawn tiers), for the level-3 frame. */
function stackRect(layout: SystemLayout, model: SystemModel, tier: Tier): Rect | undefined {
  const d = model.districts.get(tier.district);
  const stack = d?.stacks.find((s) => s.some((t) => t.id === tier.id));
  const rects = (stack ?? [tier]).flatMap((t) => (layout.tiers.get(t.id) ? [layout.tiers.get(t.id)!.rect] : []));
  if (!rects.length) return undefined;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export interface SystemViewProps {
  githubLogin: string;
  workspaceSlugs: string[];
  /** The plan, with every initiative read. */
  board: Board;
  /** The level in the URL. */
  at: string | null;
  deep: boolean;
  setAt: (at: string | null, deep?: boolean) => void;
  mode: "map" | "list";
  setMode: (m: "map" | "list") => void;
  /** An id to highlight for a moment (a "pull up"). */
  flash: string | null;
  /** The "pull up X" resolver for the Jamie bar, set while this view is up. */
  resolver: MutableRefObject<((name: string) => FocusResult | undefined) | null>;
  /** Whether the plan's reads are still coming in. */
  planLoading: boolean;
}

export function SystemView(p: SystemViewProps) {
  const { githubLogin, workspaceSlugs, board, at, deep, setAt, mode, setMode, flash, resolver, planLoading } = p;
  const { nodes, edges, wsOf, loading: mapLoading } = useSystemNodes(workspaceSlugs);
  const { jobsByRef, artifactsByRef } = useOrgCanvasJobs(githubLogin, true);
  const edgeApi = useSystemEdges(githubLogin, true);
  const model = useMemo(
    () => buildSystemModel({ nodes, edges, wsOf, board, jobsByRef, artifactsByRef, edgeMaps: edgeApi.maps }),
    [nodes, edges, wsOf, board, jobsByRef, artifactsByRef, edgeApi.maps],
  );
  const layout = useMemo(() => layoutSystem(model), [model]);
  const level = levelOf(model, at, deep);
  const focusTier = at ? model.tiers.get(at) : undefined;
  const focusDistrict = focusTier ? focusTier.district : at && model.districts.has(at) ? at : null;
  const focusZone = at?.startsWith(ZONE_PREFIX) ? at.slice(ZONE_PREFIX.length) : null;

  useEffect(() => {
    const c = systemCandidates(model);
    resolver.current = (name) => resolveFocus(c, name, "system");
    return () => {
      resolver.current = null;
    };
  }, [model, resolver]);

  // ── The camera ────────────────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const camRef = useRef<Camera | null>(null);
  const vpRef = useRef<Viewport | null>(null);
  const anim = useRef<number | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(0);
  const settle = useRef<number | null>(null);
  const [vp, setVp] = useState<Viewport | null>(null);
  vpRef.current = vp;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const modelRef = useRef(model);
  modelRef.current = model;
  const minZ = vp ? fit(layout.bounds, vp, 0.9, INSETS).z * 0.5 : 0;
  const minZRef = useRef(minZ);
  minZRef.current = minZ;

  useEffect(() => {
    const el = rootRef.current!;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) setVp({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setCamera = useCallback((c: Camera) => {
    const v_ = vpRef.current;
    const world = worldRef.current;
    const root = rootRef.current;
    if (!v_ || !world || !root || !(c.z > 0) || !Number.isFinite(c.z + c.cx + c.cy)) return;
    camRef.current = c;
    world.style.transform = `translate(${v_.w / 2 - c.cx * c.z}px, ${v_.h / 2 - c.cy * c.z}px) scale(${c.z})`;
    root.style.setProperty("--sz", String(Math.max(c.z, 0.04)));
    const lod = LOD(c.z);
    if (root.dataset.lod !== lod) root.dataset.lod = lod;
  }, []);
  const stop = () => {
    if (anim.current) cancelAnimationFrame(anim.current);
    anim.current = null;
  };
  const flyTo = useCallback(
    (to: Camera, instant = false) => {
      stop();
      const from = camRef.current;
      if (!from || instant) return setCamera(to);
      const t0 = performance.now();
      const step = (now: number) => {
        const u = Math.min(1, (now - t0) / FLIGHT_MS);
        setCamera(between(from, to, ease(u)));
        anim.current = u < 1 ? requestAnimationFrame(step) : null;
      };
      anim.current = requestAnimationFrame(step);
    },
    [setCamera],
  );
  useEffect(() => stop, []);

  /** The camera for a level: the thing framed, shifted left of the panel when one is up. */
  const cameraFor = useCallback(
    (ref: string | null, isDeep: boolean, v_: Viewport): Camera => {
      const L = layoutRef.current;
      const M = modelRef.current;
      const framed = (r: Rect, margin = 0.92, panel = false): Camera => {
        const free: Viewport = panel ? { w: Math.max(200, v_.w - PANEL_W - 40), h: v_.h } : v_;
        const c = fit(r, free, margin, INSETS);
        return panel ? { ...c, cx: c.cx + PANEL_W / 2 / c.z } : c;
      };
      if (!ref) return fit(L.bounds, v_, 0.92, INSETS);
      if (ref === UNMAPPED) return framed(L.unmapped);
      if (ref.startsWith(ZONE_PREFIX)) {
        const plate = L.plates.find((pl) => pl.key === ref.slice(ZONE_PREFIX.length));
        return plate ? framed(plate.rect) : fit(L.bounds, v_, 0.92, INSETS);
      }
      const tier = M.tiers.get(ref);
      if (tier) {
        const box = L.tiers.get(tier.id)?.rect;
        if (isDeep && box) return framed({ x: box.x - 160, y: box.y - 170, w: box.w + 320, h: box.h + 340 }, 0.75, true);
        const r = stackRect(L, M, tier);
        if (r) return framed({ x: r.x - 120, y: r.y - 110, w: r.w + 240, h: r.h + 220 }, 0.8, true);
      }
      const r = rectFor(L, M, ref);
      return r ? framed(r) : fit(L.bounds, v_, 0.92, INSETS);
    },
    [],
  );

  // Fly when the level changes (not when the data does): once the thing is in the layout, or at once for the world.
  const wanted = useRef<{ at: string | null; deep: boolean } | null>({ at, deep });
  const lastFlown = useRef<string>("");
  const key = `${at ?? ""}|${deep}`;
  useLayoutEffect(() => {
    if (lastFlown.current !== key) wanted.current = { at, deep };
    const w = wanted.current;
    if (!w || !vp) return;
    const exists =
      !w.at || w.at === UNMAPPED || w.at.startsWith(ZONE_PREFIX) || !!rectFor(layout, model, w.at);
    // Data still coming in: wait, but not forever on the world.
    if (!exists) return;
    wanted.current = null;
    const first = lastFlown.current === "";
    lastFlown.current = key;
    flyTo(cameraFor(w.at, w.deep, vp), first);
  }, [vp, layout, model, key, at, deep, flyTo, cameraFor]);
  // The view resized (an artifact panel opened, the window): frame the level again, unless the person moved the camera.
  const userMoved = useRef(false);
  useEffect(() => {
    userMoved.current = false;
  }, [key]);
  const vpKey = vp ? `${vp.w}x${vp.h}` : "";
  // Also when what's framed grows or moves (the map and the plan arrive one after the other): the same frame, no flight.
  const frame = vp ? cameraFor(at, deep, vp) : null;
  const frameKey = frame ? `${vpKey}|${frame.cx.toFixed(1)}|${frame.cy.toFixed(1)}|${frame.z.toFixed(3)}` : "";
  useEffect(() => {
    if (!vp || userMoved.current || lastFlown.current === "" || anim.current) return;
    setCamera(cameraFor(at, deep, vp));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the frame itself changes
  }, [frameKey]);

  const setAtRef = useRef(setAt);
  setAtRef.current = setAt;
  const atRef = useRef(at);
  atRef.current = at;
  /** Changing the level to what the camera already shows: no flight. */
  const setAtQuiet = useCallback((next: string | null) => {
    const cur = atRef.current;
    // Deeper levels keep their own frame; only world and district follow the scale.
    if (cur === next || (cur && modelRef.current.tiers.has(cur))) return;
    lastFlown.current = `${next ?? ""}|false`;
    wanted.current = null;
    setAtRef.current(next, false);
  }, []);


  // Zooming out or in far enough settles on the level it shows: the world, or the district in the middle.
  const onSettled = useCallback(() => {
    const c = camRef.current;
    const v_ = vpRef.current;
    if (!c || !v_) return;
    const L = layoutRef.current;
    const worldZ = fit(L.bounds, v_, 0.92, INSETS).z;
    const centre = { x: c.cx, y: c.cy };
    const inside = (r: Rect) => centre.x >= r.x && centre.x <= r.x + r.w && centre.y >= r.y && centre.y <= r.y + r.h;
    if (c.z <= worldZ * 1.25) return setAtQuiet(null);
    for (const [id, box] of L.districts) if (c.z >= 0.45 && inside(box.rect)) return setAtQuiet(id);
  }, [setAtQuiet]);
  useEffect(() => {
    const el = rootRef.current!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest?.("[data-sys-panel],[data-canvas-chrome],[data-jamie-bar]")) return;
      e.preventDefault();
      const v_ = vpRef.current;
      if (!v_ || !camRef.current) return;
      stop();
      userMoved.current = true;
      const r = el.getBoundingClientRect();
      const k = e.ctrlKey ? 0.012 : 0.0018;
      setCamera(zoomAbout(camRef.current, Math.exp(-e.deltaY * k), e.clientX - r.left, e.clientY - r.top, v_, minZRef.current));
      if (settle.current) clearTimeout(settle.current);
      settle.current = window.setTimeout(onSettled, SETTLE_MS);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (settle.current) clearTimeout(settle.current);
    };
  }, [setCamera, onSettled]);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button,input,select,textarea,a,[data-canvas-chrome],[data-sys-panel]")) return;
    drag.current = { x: e.clientX, y: e.clientY };
    moved.current = 0;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !camRef.current) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    moved.current += Math.abs(dx) + Math.abs(dy);
    if (moved.current > 4) {
      stop();
      userMoved.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      const c = camRef.current;
      setCamera({ ...c, cx: c.cx - dx / c.z, cy: c.cy - dy / c.z });
    }
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const zoomBy = useCallback(
    (f: number) => {
      const v_ = vpRef.current;
      if (!v_ || !camRef.current) return;
      userMoved.current = true;
      flyTo(zoomAbout(camRef.current, f, v_.w / 2, v_.h / 2, v_, minZRef.current));
      if (settle.current) clearTimeout(settle.current);
      settle.current = window.setTimeout(onSettled, FLIGHT_MS + SETTLE_MS);
    },
    [flyTo, onSettled],
  );

  /** One level out: tier detail → stack → its district → the world. */
  const up = useCallback(() => {
    const cur = atRef.current;
    const M = modelRef.current;
    if (!cur) return;
    const t = M.tiers.get(cur);
    if (t && deepRef.current) return setAtRef.current(cur, false);
    if (t) return setAtRef.current(t.district, false);
    setAtRef.current(null, false);
  }, []);
  const deepRef = useRef(deep);
  deepRef.current = deep;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" || e.key === "ArrowLeft") {
        // An open artifact closes first (its panel takes the key and prevents it).
        if (e.defaultPrevented || document.querySelector("[data-artifact-panel-open]")) return;
        up();
      } else if (e.key === "+" || e.key === "=") zoomBy(1.8);
      else if (e.key === "-") zoomBy(1 / 1.8);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [up, zoomBy]);

  const onClick = (e: React.MouseEvent) => {
    if (moved.current > 4) return;
    const hit = (e.target as HTMLElement).closest<HTMLElement>("[data-hit]")?.dataset.hit;
    if (!hit) return;
    userMoved.current = false;
    if (hit.startsWith("tier:")) {
      const id = hit.slice(5);
      setAt(id, at === id && !deep);
    } else if (hit.startsWith("district:")) setAt(hit.slice(9), false);
    else setAt(hit, false);
  };

  // ── Draw ──────────────────────────────────────────────────────────────────
  const dimmed = (district: string | null, tier?: Tier) => {
    if (level === 1 && !focusZone) return false;
    if (focusZone) return district ? model.districts.get(district)?.zone !== focusZone : true;
    if (at === UNMAPPED) return district !== null;
    if (district !== focusDistrict) return true;
    // In a stack's level, the other stacks stand back.
    if (level >= 3 && tier && focusTier) {
      const mine = model.districts.get(district!)?.stacks.find((s) => s.some((t) => t.id === focusTier.id));
      return !mine?.some((t) => t.id === tier.id);
    }
    return false;
  };
  const wiresShown = level <= 2;
  const toBlank = !mapLoading && !planLoading && !model.mapped && !model.tiers.size;
  const crumbs = useMemo(() => {
    const out: Array<{ label: string; to: () => void }> = [{ label: "World", to: () => setAt(null, false) }];
    if (focusZone) out.push({ label: focusZone, to: () => setAt(at, false) });
    if (at === UNMAPPED) out.push({ label: "Unmapped", to: () => setAt(UNMAPPED, false) });
    const d = focusDistrict ? model.districts.get(focusDistrict) : undefined;
    if (d) out.push({ label: d.name, to: () => setAt(d.id, false) });
    if (focusTier) {
      out.push({ label: focusTier.name, to: () => setAt(focusTier.id, false) });
      if (deep) out.push({ label: "Tier", to: () => setAt(focusTier.id, true) });
    }
    return out;
  }, [at, deep, focusDistrict, focusTier, focusZone, model, setAt]);

  const edits = {
    saving: edgeApi.saving,
    placeIn: (t: Tier, district: string) => {
      if (district === UNASSIGNED) return void edgeApi.unplace(t.ws, t.id);
      const d = model.districts.get(district);
      if (d) void edgeApi.placeIn(t.ws, t.id, { ws: d.ws || t.ws, type: "SysComponent", id: d.id });
    },
    extend: (t: Tier, parent: string) => {
      if (!parent) return void edgeApi.unextend(t.ws, t.id);
      const pt = model.tiers.get(parent);
      if (pt) void edgeApi.extend(t.ws, t.id, { ws: pt.ws, id: pt.id });
    },
  };

  return (
    <div
      ref={rootRef}
      data-system-view
      data-sys-level-now={level}
      className="sys-root"
      data-lod="far"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={onClick}
      style={{ position: "absolute", inset: 0, overflow: "hidden", touchAction: "none", userSelect: "none", zIndex: 5, color: v("ink") }}
    >
      <style>{SYSTEM_CSS}</style>
      <div ref={worldRef} data-sys-world style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, transformOrigin: "0 0" }}>
        {layout.plates.map((pl) => (
          <div
            key={pl.key}
            data-sys-plate={pl.key}
            data-hit={pl.key === UNASSIGNED ? undefined : `${ZONE_PREFIX}${pl.key}`}
            className="sys-item sys-hit"
            style={{
              position: "absolute",
              ...px(pl.rect),
              boxSizing: "border-box",
              borderRadius: 26,
              background: v("sysPlate"),
              border: `2px solid ${v("sysPlateBorder")}`,
              opacity: dimmed(null) && !focusZone ? 0.4 : focusZone && focusZone !== pl.key ? 0.4 : 1,
            }}
          >
            <div style={{ ...label, position: "absolute", left: 30, top: 16, fontSize: "max(15px, calc(12px / var(--sz)))", color: v("muted") }}>
              {pl.label === "Unassigned" ? "Unassigned" : `Trust zone · ${pl.label}`}
            </div>
          </div>
        ))}

        {wiresShown ? (
          <svg data-sys-wires style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, overflow: "visible", pointerEvents: "none" }}>
            {model.wires.map((w) => {
              const f = layout.districts.get(w.from);
              const t = layout.districts.get(w.to);
              if (!f || !t) return null;
              const x1 = f.rect.x + f.rect.w / 2;
              const y1 = f.rect.y + 70;
              const x2 = t.rect.x + t.rect.w / 2;
              const y2 = t.rect.y + 70;
              return (
                <path
                  key={`${w.from}>${w.to}`}
                  d={`M${x1},${y1} C${x1},${y1 - 80} ${x2},${y2 - 80} ${x2},${y2}`}
                  fill="none"
                  stroke={v("road")}
                  strokeWidth={2.5}
                  strokeOpacity={0.55}
                  strokeDasharray="10 7"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
        ) : null}

        {[...model.districts.values()].map((d) => {
          const box = layout.districts.get(d.id);
          return box ? (
            <DistrictView
              key={d.id}
              d={d}
              box={box}
              layout={layout}
              dim={dimmed(d.id)}
              flash={flash}
              focus={focusDistrict === d.id}
              tierDim={(t) => dimmed(d.id, t)}
              selected={at}
              chips={level >= 2}
            />
          ) : null;
        })}

        <div
          data-sys-unmapped
          data-hit={UNMAPPED}
          className="sys-item sys-hit"
          style={{
            position: "absolute",
            ...px(layout.unmapped),
            boxSizing: "border-box",
            borderRadius: 16,
            border: `2px dashed ${v("sysUnmapped")}`,
            background: v("sysUnmappedBg"),
            padding: 18,
            opacity: level === 1 && !focusZone ? 1 : at === UNMAPPED ? 1 : 0.35,
            overflow: "hidden",
          }}
        >
          <div style={{ ...label, fontSize: "max(15px, calc(12px / var(--sz)))", color: v("sysUnmapped") }}>Unmapped</div>
          <div className="sys-mid" style={{ fontFamily: TYPE, fontSize: 13, color: v("muted"), marginBottom: 6 }}>
            Jobs and pull requests that build no feature of the plan
          </div>
          <div className="sys-mid" style={{ maxHeight: UNMAPPED_ROWS * 30, overflow: "hidden" }}>
            <JobRows jobs={model.unmapped.jobs.slice(0, UNMAPPED_ROWS)} />
            {model.unmapped.prs.slice(0, Math.max(0, UNMAPPED_ROWS - model.unmapped.jobs.length)).map((pr) => (
              <div key={pr.artifact.id} style={{ fontFamily: TYPE, fontSize: 13, padding: "5px 0", borderTop: `1px solid ${a("road", 12)}` }}>
                ⎇ {pr.artifact.title} {pr.state ? <span style={{ color: v("muted") }}>· {pr.state}</span> : null}
              </div>
            ))}
          </div>
          <div style={{ fontFamily: TYPE, fontSize: "max(13px, calc(8px / var(--sz)))", color: v("muted"), whiteSpace: "nowrap" }}>
            {model.unmapped.jobs.length} jobs · {model.unmapped.prs.length} pull requests
          </div>
        </div>
      </div>

      {toBlank ? (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", fontFamily: TYPE, fontSize: 18, color: v("muted"), fontStyle: "italic", textAlign: "center", padding: 24 }}>
          No System Map and no features yet. Materialize the System Map, or tell Jamie what you want to build.
        </div>
      ) : null}

      {/* Chrome: where you are, Map | List, zoom. */}
      <div data-canvas-chrome onPointerDown={(e) => e.stopPropagation()} style={{ position: "absolute", left: 16, top: 16, display: "flex", gap: 10, alignItems: "center", zIndex: 20, flexWrap: "wrap" }}>
        <div data-sys-crumbs style={{ ...chrome, display: "flex", gap: 6, padding: "0 14px", alignItems: "center" }}>
          {crumbs.map((c, i) => (
            <span key={`${i}-${c.label}`} style={{ display: "inline-flex", gap: 6 }}>
              {i ? <span style={{ color: v("faint") }}>›</span> : null}
              <button type="button" onClick={c.to} style={{ all: "unset", cursor: i === crumbs.length - 1 ? "default" : "pointer", color: i === crumbs.length - 1 ? v("ink") : v("muted") }}>
                {c.label.length > 34 ? `${c.label.slice(0, 32)}…` : c.label}
              </button>
            </span>
          ))}
        </div>
        <div role="group" aria-label="Map or list" style={{ ...chrome, display: "flex", padding: 3, gap: 2 }}>
          {(["map", "list"] as const).map((m) => (
            <button
              key={m}
              type="button"
              data-sys-mode={m}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              style={{ ...pill(12.5, { border: "none", background: mode === m ? v("ink") : "transparent", color: mode === m ? v("onInk") : v("muted") }) }}
            >
              {m === "map" ? "Map" : "List"}
            </button>
          ))}
        </div>
        {mapLoading || planLoading ? <span className="icb-spin" aria-label="Reading" /> : null}
      </div>

      {mode === "map" ? (
        <div data-canvas-chrome onPointerDown={(e) => e.stopPropagation()} style={{ position: "absolute", right: level >= 3 ? PANEL_W + 32 : 16, bottom: 24, display: "flex", flexDirection: "column", gap: 6, zIndex: 20 }}>
          {[
            { l: "+", t: "Zoom in", go: () => zoomBy(1.8) },
            { l: "−", t: "Zoom out", go: () => zoomBy(1 / 1.8) },
            { l: "⤢", t: "Frame this level", go: () => { userMoved.current = false; if (vp) flyTo(cameraFor(at, deep, vp)); } },
          ].map((b) => (
            <button key={b.l} type="button" title={b.t} aria-label={b.t} onClick={b.go} style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${v("chromeBorder")}`, background: v("chrome"), color: v("ink"), fontSize: 17, cursor: "pointer", boxShadow: v("shadow") }}>
              {b.l}
            </button>
          ))}
        </div>
      ) : null}

      {mode === "list" ? (
        <SystemList model={model} onPick={(id) => { setMode("map"); setAt(id, false); }} />
      ) : focusTier && level >= 3 ? (
        <DetailPanel
          tier={focusTier}
          deep={level === 4}
          model={model}
          edits={edits}
          onDeeper={() => setAt(focusTier.id, true)}
          onPick={(id) => setAt(id, false)}
        />
      ) : null}
    </div>
  );
}

const chrome = {
  height: 34,
  borderRadius: 99,
  background: v("chrome"),
  border: `1px solid ${v("chromeBorder")}`,
  boxShadow: v("shadow"),
  fontFamily: TYPE,
  fontSize: 13.5,
  color: v("ink"),
} as const;

const px = (r: Rect) => ({ left: r.x, top: r.y, width: r.w, height: r.h });

function DistrictView({
  d,
  box,
  layout,
  dim,
  flash,
  focus,
  tierDim,
  selected,
  chips,
}: {
  d: District;
  box: DistrictBox;
  layout: SystemLayout;
  dim: boolean;
  flash: string | null;
  focus: boolean;
  tierDim: (t: Tier) => boolean;
  selected: string | null;
  /** The claimed nodes show from the District level in, not at the World. */
  chips: boolean;
}) {
  const tiers = d.stacks.flat();
  return (
    <>
      <div
        data-sys-district={d.id}
        data-hit={`district:${d.id}`}
        className={`sys-item sys-hit${flash === d.id ? " sys-flash" : ""}`}
        style={{
          position: "absolute",
          ...px(box.rect),
          boxSizing: "border-box",
          borderRadius: 16,
          background: v("sysCell"),
          border: `${focus ? 2 : 1}px solid ${focus ? v("here") : v("sysCellBorder")}`,
          opacity: dim ? 0.38 : 1,
        }}
      >
        <div style={{ position: "absolute", ...px({ x: 20, y: 14, w: box.rect.w - 40, h: 60 }) }}>
          <div style={{ fontFamily: TYPE, fontWeight: 600, fontSize: "max(24px, calc(12px / var(--sz)))", lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {d.name}
            {d.rollup.attention ? (
              <span data-sys-attention title="Something here needs attention" style={{ color: v("blocked"), marginLeft: 8 }}>
                !
              </span>
            ) : null}
          </div>
          <div data-sys-rollup style={{ fontFamily: TYPE, color: v("muted"), fontSize: "max(14px, calc(8px / var(--sz)))", marginTop: 3, whiteSpace: "nowrap" }}>
            {rollupLine(d.rollup)}
          </div>
        </div>
        {/* The component and what it claims, in their slots. */}
        <div className="sys-near" data-sys-chips style={{ position: "absolute", ...px({ x: 20, y: 76, w: box.rect.w - 40, h: HEADER_H - 84 }), display: chips ? "flex" : "none", gap: 6, flexWrap: "wrap", alignContent: "flex-start", overflow: "hidden" }}>
          {d.unassigned ? (
            <span style={{ fontFamily: TYPE, fontSize: 12.5, color: v("muted") }}>Features no repo or edge has placed yet</span>
          ) : (
            d.claimed.slice(0, 9).map((c) => (
              <span
                key={c.id}
                data-sys-claimed={c.id}
                data-slot={c.slot}
                title={`${c.type} · ${c.slot}`}
                style={{ fontFamily: TYPE, fontSize: 11.5, padding: "1px 7px", borderRadius: 5, border: `1px solid ${v("sysCellBorder")}`, background: v("field"), color: v("inkSoft"), whiteSpace: "nowrap" }}
              >
                {SLOT_MARK[c.slot]} {c.name}
              </span>
            ))
          )}
          {d.claimed.length > 9 ? <span style={{ fontFamily: TYPE, fontSize: 11.5, color: v("muted") }}>+{d.claimed.length - 9}</span> : null}
        </div>
      </div>
      {tiers.map((t) => {
        const tb = layout.tiers.get(t.id);
        return tb ? <TierView key={t.id} t={t} rect={tb.rect} dim={dim || tierDim(t)} flash={flash === t.id} selected={selected === t.id} /> : null;
      })}
      {box.overflow ? (
        <div style={{ position: "absolute", left: box.rect.x + 20, top: box.rect.y + box.rect.h - 34, fontFamily: TYPE, fontSize: "clamp(15px, calc(11px / var(--sz)), 26px)", color: v("inkSoft"), pointerEvents: "none", whiteSpace: "nowrap" }}>
          +{box.overflow} more not drawn (see the List)
        </div>
      ) : null}
    </>
  );
}

const SLOT_MARK = { front: "▸", back: "▪", left: "◂", right: "▹" } as const;

function TierView({ t, rect, dim, flash, selected }: { t: Tier; rect: Rect; dim: boolean; flash: boolean; selected: boolean }) {
  const look = tierLook(t.state);
  return (
    <div
      data-sys-tier={t.id}
      data-tier-state={t.state}
      data-hit={`tier:${t.id}`}
      title={`${t.name} — ${STATE_LABEL[t.state]}: ${t.line}`}
      className={`sys-item sys-hit${t.running ? " icb-glow" : ""}${flash ? " sys-flash" : ""}`}
      style={{
        position: "absolute",
        ...px(rect),
        boxSizing: "border-box",
        borderRadius: 8,
        padding: "0 12px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontFamily: TYPE,
        ...look,
        ...(dim ? { opacity: 0.38 } : {}),
        ...(selected ? { outline: `2px solid ${v("here")}`, outlineOffset: 2 } : {}),
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 17, fontWeight: 600 }}>
        {t.blocked ? <span style={{ color: v("blocked") }}>! </span> : null}
        {t.name}
      </span>
      <span className="sys-mid" style={{ display: "flex", gap: 3, alignItems: "center", flexShrink: 0 }}>
        {t.running ? <span className="icb-spin" title={`${t.running} running`} /> : null}
        {t.state === "building"
          ? t.people.slice(0, 2).map((p) => (
              <span
                key={p.id}
                title={p.name}
                data-sys-person={p.id}
                style={{ width: 24, height: 24, borderRadius: 12, display: "grid", placeItems: "center", fontSize: 12, background: v("sysBuilding"), color: v("onInk") }}
              >
                {p.name.slice(0, 1).toUpperCase()}
              </span>
            ))
          : null}
      </span>
    </div>
  );
}
