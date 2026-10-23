"use client";

import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { stageLine } from "@/lib/initiative-plan";
import { useCanvasChatStore, type InitiativeFocus } from "../../_state/canvasChatStore";
import type { ArtifactRef, ArtifactVersion } from "../../_state/canvasChatArtifacts";
import { type CanvasJob, useCanvasJobs } from "../../_state/useCanvasJobs";
import { ArtifactPanel } from "../artifacts/ArtifactPanel";
import { useCollapsibleArtifactPanel } from "../artifacts/useCollapsibleArtifactPanel";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { ChatArtifacts } from "../artifacts/ChatArtifacts";
import { OnPaper } from "../artifacts/onPaper";
import { findBrainstormCard } from "../artifacts/openArtifact";
import {
  type Board,
  type PlanNode,
  DESK_SIZE,
  GRAPH_LABEL,
  IMPLEMENT,
  NAVIGATE,
  bestMatch,
  byId,
  expandDraft,
  initiativeOf,
  initiativesByRecency,
  kids,
  nearestContainer,
  suggestions,
  textField,
} from "./board";
import { AllInitiatives, StackCard } from "./desk";
import { type Work, workOf } from "./build";
import { ArchitectureCard, BuildCard } from "./feature-panels";
import { JamieBar, type JamieMode, useAskJamie } from "./JamieBar";
import {
  AddCard,
  type CardContext,
  Face,
  FrameHeader,
  JobMarker,
  type NodeActions,
  OptionCard,
  QuestionCard,
  StoriesPanel,
  TYPE,
} from "./nodes";
import { Palette } from "./Palette";
import {
  type Blend,
  type Camera,
  CONTAINERS,
  HEADER,
  ORG,
  STACK,
  type Rect,
  type Scene,
  type SceneNode,
  type Viewport,
  between,
  contains,
  diveTo,
  fit,
  inView,
  layoutScene,
  levelBlend,
  levelFor,
  openAt,
  openTree,
  type OpenTrees,
  optionKey,
  orgRect,
  overlaps,
  toScreen,
  union,
  zoomAbout,
} from "./scene";
import { PAPER_CSS } from "./paper";
import { CANVAS_THEME, a, deskStyle, themeVars, v } from "./theme";
import { type Pencil, withProposals } from "./proposals";
import { useCanvasBoard } from "./useCanvasBoard";
import { useCanvasProposals } from "./useCanvasProposals";

/** Design widths: each card is laid out at this width, then scaled to its screen size. */
const FACE_W: Partial<Record<string, number>> = {
  initiative: 540,
  milestone: 310,
  brief: 310,
  feature: 320,
  architecture: 760,
  build: 760,
  stories: 1500,
  stack: 220,
};
const FRAME_W: Partial<Record<string, number>> = { initiative: 1200, milestone: 820, feature: 820 };
const QUESTION_W = 240;
const OPTION_W = 330;
/** Chrome over the canvas: breadcrumb row on top, Jamie's reply and bar below. */
const INSETS = { top: 70, bottom: 190 };
/** The full chat's width when it slides in. */
const CHAT_W = 420;
/** A settled job's tick stays on its card this long. */
const SETTLED_MS = 6_000;

const KEYFRAMES = `
@keyframes icb-glow { 0%,100% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--ic-job) 50%, transparent), 0 0 26px 4px color-mix(in srgb, var(--ic-job) 28%, transparent) } 50% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--ic-job) 85%, transparent), 0 0 46px 12px color-mix(in srgb, var(--ic-job) 40%, transparent) } }
.icb-glow { animation: icb-glow 1.8s ease-in-out infinite }
@keyframes icb-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
.icb-pulse { animation: icb-pulse 1.2s ease-in-out infinite }
@keyframes icb-spin { to { transform: rotate(360deg) } }
.icb-spin { width: 10px; height: 10px; border-radius: 99px; border: 2px solid color-mix(in srgb, var(--ic-job) 25%, transparent); border-top-color: var(--ic-job); animation: icb-spin .8s linear infinite; flex-shrink: 0 }
@keyframes icb-bloom { from { opacity: 0; transform: scale(.9) } to { opacity: 1; transform: none } }
.icb-bloom { animation: icb-bloom .6s cubic-bezier(.2,.8,.2,1) both }
@keyframes icb-listen { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ic-job) 50%, transparent) } 100% { box-shadow: 0 0 0 16px transparent } }
.icb-listen { animation: icb-listen 1.1s ease-out infinite }
@keyframes icb-flash { 0%,60% { background-color: var(--ic-flash) } 100% { background-color: transparent } }
.icb-flash { animation: icb-flash 2.2s ease-out both }
.icb-req .icb-act { opacity: 0; transition: opacity .12s }
.icb-req:hover .icb-act, .icb-req:focus-within .icb-act { opacity: 1 }
.icb-editable:hover { background: color-mix(in srgb, var(--ic-road) 10%, transparent) }
.icb-root :focus-visible { outline: 2px solid var(--ic-focus); outline-offset: 2px }
.icb-root ::placeholder { color: var(--ic-faint) }
@media (prefers-reduced-motion: reduce) { .icb-glow, .icb-pulse, .icb-bloom, .icb-listen { animation: none } }
`;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Cards are mounted this far past the view (a share of it on each side), so panning doesn't pop them in. */
const CULL_MARGIN = 0.5;
/** Wheel or drag quiet this long: the camera has settled. */
const SETTLE_MS = 150;
const FORK_KINDS = ["question", "option"];
const NO_ARTIFACTS: ArtifactRef[] = [];
/** A card's grow-in as it appears. */
const grow = (vis: number) => 0.92 + 0.08 * Math.min(1, vis * 1.5);
/** The largest a blended value gets over the rest of a flight (from `u` to arrival). */
const peak = (f: (u: number) => number, u: number) => (u < 1 ? Math.max(f(u), f((u + 1) / 2), f(1)) : f(1));
/** The camera's zoom, coarsely (quarter steps of a doubling), for the little that is sized on screen. */
const zoomBucket = (z: number) => Math.pow(2, Math.round(Math.log2(z) * 4) / 4);
const SettledZoom = createContext(1);
/** Overlays the wheel scrolls rather than zooming the canvas under them. */
const WHEEL_OWN = "[data-canvas-chrome],[data-palette],[data-jamie-bar]";
const sameRect = (a?: Rect, b?: Rect) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const NO_VERSIONS = new Map<ArtifactRef, ArtifactVersion>();

interface Trans {
  /** Containers open before the move, and the level it left. */
  from: string[];
  fromLevel: string;
  /** 0 → 1 while the camera flies. */
  u: number;
}

type Seek = { at: string } | { name: string; text: string };

/** The level in the URL (`?at=<ref_id>`), so a reload, a shared link or closing an artifact comes back to it. */
function readAt(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("at");
}
function replaceParams(edit: (params: URLSearchParams) => void) {
  const params = new URLSearchParams(window.location.search);
  edit(params);
  window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
}
function writeAt(id: string) {
  replaceParams((p) => (id === ORG ? p.delete("at") : p.set("at", id)));
}

/**
 * The infinite canvas on the org page's Brainstorm tab: the org's
 * initiatives, read from the graph, as places you click into (org →
 * initiative → milestone → feature). The desk holds the latest few (and any
 * pulled in from the stack or ⌘K). Zooming moves the camera and never
 * changes the level; ←, the breadcrumbs and Esc go back out. An initiative
 * shows its brief, milestones and user stories; a milestone its features; a
 * feature its architecture and build. Brainstorms grow to the right of whatever they're
 * about. Jamie sits in a bar at the bottom; the full chat slides in from the
 * left and the canvas narrows.
 */
export function InfiniteCanvas({
  githubLogin,
  workspaceSlugs,
  renderChat,
}: {
  githubLogin: string;
  workspaceSlugs: string[];
  /** The org page's chat, for the full-chat size. */
  renderChat: (onCollapse: () => void) => ReactNode;
}) {
  const [initiative, setInitiative] = useState<string | null>(null);
  // The desk: the latest initiatives by `updated_at`, plus any pulled in from the stack or ⌘K this session.
  const [pulled, setPulled] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [palette, setPalette] = useState(false);
  /** A card being brought onto the desk to go to (`reach`): it goes there once it's laid out. */
  const [pendingGo, setPendingGo] = useState<string | null>(null);
  /** Looking for a card that may be under an initiative off the desk: the level in the URL, or a "pull up …". */
  const [seek, setSeek] = useState<Seek | null>(() => {
    const at = readAt();
    return at ? { at } : null;
  });
  const {
    board: graphBoard,
    entries,
    loading,
    reading,
    failed,
    savePlan,
    choose,
  } = useCanvasBoard(githubLogin, workspaceSlugs, {
    // Plans are read for what's on the desk; all of them while ⌘K or the full list is open, or while seeking.
    read: (ids) => (palette || showAll || seek ? ids : [...new Set([...ids.slice(0, DESK_SIZE), ...pulled])]),
    openInitiative: initiative,
  });
  // Strut's pending proposals, drawn in where they'd go (pencil cards).
  const { pending: pendingProposals, decide: decideProposal } = useCanvasProposals(githubLogin);
  const board = useMemo(() => withProposals(graphBoard, pendingProposals), [graphBoard, pendingProposals]);
  const { jobsByRef, artifactsByRef } = useCanvasJobs(githubLogin, initiative);

  const [vp, setVp] = useState<Viewport | null>(null);
  // The camera is not state: it moves the world layer directly. React hears only when it has settled.
  const [framedOnce, setFramedOnce] = useState(false);
  /** The part of the world whose cards are mounted, recomputed when the camera settles or leaves it. */
  const [cull, setCull] = useState<Rect | null>(null);
  const [settledZoom, setSettledZoom] = useState(1);
  const [level, setLevel] = useState(ORG);
  const [trans, setTrans] = useState<Trans>({ from: [], fromLevel: ORG, u: 1 });
  /** Where the flight is in the level blend, painted frame by frame; `trans.u` only records where it ends. */
  const transU = useRef(1);
  const [ask, setAsk] = useState<{ id: string; x: number; y: number } | null>(null);
  const [mode, setMode] = useState<JamieMode>("input");
  const artifact = useCollapsibleArtifactPanel();
  const artifactOpen = artifact.artifactOpen;
  const artifactOpenRef = useRef(artifactOpen);
  artifactOpenRef.current = artifactOpen;
  const [chatMounted, setChatMounted] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  /** Each mounted card's box, for painting a level blend without rendering. */
  const boxes = useRef(new Map<string, HTMLElement>());
  /** Redraws the links for a camera and blend point (set by `Links`). */
  const drawLinks = useRef<((cam: Camera, vp: Viewport, u: number) => void) | null>(null);
  const cullRef = useRef<Rect | null>(null);
  const settleTimer = useRef<number | null>(null);
  const deskLook = useRef<CSSProperties>({});
  const camRef = useRef<Camera | null>(null);
  const vpRef = useRef<Viewport | null>(null);
  const levelRef = useRef(ORG);
  const anim = useRef<number | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(0);
  /** The person moved the camera since arriving at this level: new cards don't re-frame it. */
  const userMoved = useRef(false);
  const framed = useRef<Rect | undefined>(undefined);
  const flashTimer = useRef<number | null>(null);
  const askJamie = useAskJamie();

  // ── Jobs and artifacts on cards ───────────────────────────────────────────
  /**
   * Artifacts by the container whose strip shows them (a story's go under its initiative). A feature's pull
   * requests show in its build panel instead.
   */
  const artifactsAt = useMemo(() => {
    const out: Record<string, ArtifactRef[]> = {};
    for (const [ref, list] of Object.entries(artifactsByRef)) {
      const at = nearestContainer(board, ref);
      const shown = byId(board, ref)?.type === "feature" ? list.filter((x) => x.kind !== "pull_request") : list;
      if (at && shown.length) out[at] = [...(out[at] ?? []), ...shown];
    }
    return out;
  }, [artifactsByRef, board]);
  /** Where the build is under the initiative you're in, from its jobs and their pull requests. */
  const work = useMemo(
    () => (initiative ? workOf(board, initiative, jobsByRef, artifactsByRef) : new Map<string, Work>()),
    [board, initiative, jobsByRef, artifactsByRef],
  );
  const counts = useCallback((id: string) => artifactsAt[id]?.length ?? 0, [artifactsAt]);
  // A settled job's tick fades after a while: tick the clock while one is showing.
  const freshest = useMemo(
    () =>
      Math.max(
        0,
        ...Object.values(jobsByRef).flatMap((js) => js.filter((j) => j.state !== "running").map((j) => j.updatedAt)),
      ),
    [jobsByRef],
  );
  useEffect(() => {
    const left = freshest + SETTLED_MS - Date.now();
    if (left <= 0) return;
    const t = window.setTimeout(() => setNow(Date.now()), left + 50);
    return () => clearTimeout(t);
  }, [freshest]);

  /** Which brainstorm each card shows unfolded (the newest until someone picks another). */
  const [openTrees, setOpenTrees] = useState<OpenTrees>({});
  /** Go to the card a brainstorm is about with that tree unfolded; the URL keeps the card as `at`. */
  const openBrainstorm = useCallback((card: string, root: string) => {
    setOpenTrees((o) => ({ ...o, [card]: root }));
    setSeek({ at: card });
    replaceParams((p) => {
      for (const k of ["tree", "ws", "root", "node"]) p.delete(k);
      p.set("at", card);
    });
  }, []);
  // A brainstorm link (`?at=<card>&tree=<root>`, a chat card or the panel's link).
  const searchParams = useSearchParams();
  const linkAt = searchParams.get("at");
  const linkTree = searchParams.get("tree");
  useEffect(() => {
    if (linkAt && linkTree) openBrainstorm(linkAt, linkTree);
  }, [linkAt, linkTree, openBrainstorm]);
  // A brainstorm by ref (`?ws=&root=`, links made without reading the tree and the old desk's): find the card it's
  // about and go there; one about no card opens in the panel.
  const qc = useQueryClient();
  const linkWs = searchParams.get("ws");
  const linkRoot = searchParams.get("root");
  const [offCard, setOffCard] = useState<{ workspace: string; focus: string } | null>(null);
  useEffect(() => {
    if (!linkWs || !linkRoot) return;
    let live = true;
    void findBrainstormCard(qc, linkWs, linkRoot).then((at) => {
      if (!live) return;
      if (at) return openBrainstorm(at.card, at.root);
      replaceParams((p) => ["ws", "root", "node"].forEach((k) => p.delete(k)));
      setOffCard({ workspace: linkWs, focus: linkRoot });
    });
    return () => {
      live = false;
    };
  }, [qc, linkWs, linkRoot, openBrainstorm]);
  // Starting the page's chat clears the panel, so a brainstorm about no card opens there once the chat is up.
  const chatUp = useCanvasChatStore((s) => !!s.activeConversationId);
  useEffect(() => {
    if (!offCard || !chatUp) return;
    useCanvasChatStore.getState().openLiveArtifact({
      id: `brainstorm:${offCard.focus}`,
      kind: "graph",
      title: "Brainstorm",
      source: { type: "inline", content: { ...offCard, layout: "tree" } },
    });
    setOffCard(null);
  }, [offCard, chatUp]);
  const desk = useMemo(() => {
    const latest = initiativesByRecency(board)
      .slice(0, DESK_SIZE)
      .map((n) => n.id);
    return [...latest, ...pulled.filter((id) => !latest.includes(id) && board.nodes.some((n) => n.id === id))];
  }, [board, pulled]);
  const scene = useMemo(
    () => layoutScene(board, desk, { artifacts: counts, open: openTrees }),
    [board, desk, counts, openTrees],
  );
  /** Zoom out as far as you like, but not past seeing the whole org small. */
  const minZ = vp ? fit(orgRect(scene), vp, 0.88, INSETS).z * 0.5 : 0;
  const minZRef = useRef(minZ);
  minZRef.current = minZ;
  vpRef.current = vp;
  levelRef.current = level;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const crumbs = openAt(scene, level);
  const blend = useMemo(
    () => levelBlend(scene, { open: trans.from, level: trans.fromLevel }, { open: openAt(scene, level), level }),
    [scene, trans.from, trans.fromLevel, level],
  );
  const blendRef = useRef(blend);
  blendRef.current = blend;
  /** While the list of every initiative is open it sits beside the stack, so it follows the camera. */
  const [, setCamTick] = useState(0);
  const followCam = useRef(false);
  followCam.current = showAll;

  useEffect(() => {
    const el = rootRef.current!;
    // A hidden or squeezed-to-nothing canvas has no view to frame (a zero zoom makes flights NaN).
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) setVp({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stop = () => {
    if (anim.current) cancelAnimationFrame(anim.current);
    anim.current = null;
  };
  useEffect(
    () => () => {
      stop();
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  /**
   * Mount the cards in view (and a margin round it). Mid-move it only acts once the view has left what's
   * mounted; `tight` (the camera settled) fits it to the view again. Renders only if that changes which cards.
   */
  const recull = useCallback((tight: boolean) => {
    const c = camRef.current;
    const v = vpRef.current;
    if (!c || !v) return;
    const cur = cullRef.current;
    if (!tight && cur && contains(cur, inView(c, v))) return;
    const want = inView(c, v, CULL_MARGIN);
    if (cur && [...sceneRef.current.values()].every((n) => overlaps(n.rect, cur) === overlaps(n.rect, want))) return;
    cullRef.current = want;
    setCull(want);
  }, []);
  /** A flight mounts everything along its way up front, so it doesn't render mid-air. */
  const cover = useCallback((a: Camera, b: Camera) => {
    const v = vpRef.current;
    if (!v) return;
    const way = union(inView(a, v), inView(b, v));
    if (cullRef.current && contains(cullRef.current, way)) return;
    const want = union(way, inView(b, v, CULL_MARGIN));
    cullRef.current = want;
    setCull(want);
  }, []);

  /** Move the camera: the world layer, the desk's texture and the links, with no render. */
  const setCamera = useCallback(
    (c: Camera) => {
      const v = vpRef.current;
      const root = rootRef.current;
      const world = worldRef.current;
      if (!v || !root || !world || !(c.z > 0) || !Number.isFinite(c.z + c.cx + c.cy)) return;
      camRef.current = c;
      world.style.transform = `translate(${v.w / 2 - c.cx * c.z}px, ${v.h / 2 - c.cy * c.z}px) scale(${c.z})`;
      // Only what changed: setting the texture's image again every frame repaints it.
      const look = deskStyle(CANVAS_THEME, c, v);
      const was = deskLook.current as Record<string, unknown>;
      Object.assign(root.style, Object.fromEntries(Object.entries(look).filter(([k, val]) => was[k] !== val)));
      deskLook.current = look;
      root.dataset.zoom = c.z.toFixed(3);
      drawLinks.current?.(c, v, transU.current);
      recull(false);
      if (followCam.current) setCamTick((t) => t + 1);
    },
    [recull],
  );
  /** Paint the level blend at `u` straight onto the mounted cards (and links). */
  const paintBlend = useCallback((u: number) => {
    const b = blendRef.current;
    for (const [id, el] of boxes.current) {
      const vis = b.vis(id, u);
      el.style.opacity = String(vis);
      el.style.transform = `scale(${grow(vis)})`;
      el.style.pointerEvents = vis > 0.3 ? "auto" : "none";
      if (el.dataset.open === undefined) continue;
      const o = b.open(id, u);
      el.dataset.open = o.toFixed(2);
      for (const part of el.children) {
        const s = (part as HTMLElement).style;
        if ((part as HTMLElement).dataset.part === "frame") s.opacity = String(o);
        if ((part as HTMLElement).dataset.part === "face") {
          s.opacity = String(1 - o);
          s.pointerEvents = 1 - o > 0.5 ? "auto" : "none";
        }
      }
    }
    if (camRef.current && vpRef.current) drawLinks.current?.(camRef.current, vpRef.current, u);
  }, []);
  /** The camera came to rest: mount what's now in view. */
  const settle = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
    recull(true);
    if (camRef.current) setSettledZoom(zoomBucket(camRef.current.z));
  }, [recull]);
  /**
   * The camera is moving (wheel or drag): settle once it stops. No `will-change`: measured, a composited
   * world layer re-rasters at every new scale and drops more frames than painting it.
   */
  const nudge = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(settle, SETTLE_MS);
  }, [settle]);
  /** A gesture cuts a level flight short: it lands at once. */
  const finishBlend = useCallback(() => {
    if (transU.current >= 1) return;
    transU.current = 1;
    paintBlend(1);
    setTrans((s) => ({ ...s, u: 1 }));
  }, [paintBlend]);
  // A new size (the chat or an artifact sliding in) moves the centre of the view.
  useLayoutEffect(() => {
    if (camRef.current) setCamera(camRef.current);
  }, [vp, setCamera]);
  // An artifact open on the right belongs to the canvas: leaving it (another tab) closes it.
  useEffect(() => () => useCanvasChatStore.getState().closeArtifactPanel(), []);

  /**
   * Fly the camera; `withLevel` also blends the opened containers over the same flight. A flight that
   * replaces one still opening a level (new cards re-framing it) finishes opening it from where it was.
   */
  const flyTo = useCallback(
    (to: Camera, withLevel = false) => {
      stop();
      const from = camRef.current;
      const u0 = withLevel ? 0 : transU.current;
      const blending = u0 < 1;
      transU.current = u0;
      if (!from || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        if (blending) finishBlend();
        setCamera(to);
        settle();
        return;
      }
      cover(from, to);
      const t0 = performance.now();
      const step = (t: number) => {
        const u = Math.min(1, (t - t0) / 750);
        if (blending) {
          transU.current = u0 + (1 - u0) * ease(u);
          paintBlend(transU.current);
        }
        setCamera(between(from, to, ease(u)));
        anim.current = u < 1 ? requestAnimationFrame(step) : null;
        if (u < 1) return;
        if (blending) setTrans((s) => ({ ...s, u: 1 }));
        settle();
      };
      anim.current = requestAnimationFrame(step);
    },
    [cover, finishBlend, paintBlend, setCamera, settle],
  );

  const frameOf = useCallback(
    (id: string, s: Scene = scene) => {
      const n = id === ORG ? null : s.get(id);
      return n ? n.group : orgRect(s);
    },
    [scene],
  );
  const cameraFor = useCallback(
    (id: string, v: Viewport) => {
      const n = id === ORG ? null : scene.get(id);
      return n ? diveTo(n, v, INSETS) : fit(orgRect(scene), v, 0.88, INSETS);
    },
    [scene],
  );

  /**
   * Wherever you go or move the camera, a navigation still waiting on slow reads (a link, ⌘K, "pull up")
   * is dropped: it must not land later and pull you somewhere you've left.
   */
  const pendingNav = useRef(false);
  pendingNav.current = !!seek || !!pendingGo;
  const dropPending = useCallback(() => {
    if (!pendingNav.current) return;
    pendingNav.current = false;
    setSeek(null);
    setPendingGo(null);
  }, []);

  /** Click into a level (or out to one): open it and fly there. Zooming never calls this. */
  const go = useCallback(
    (id: string, instant = false) => {
      if (!vp) return;
      if (id !== ORG && !scene.get(id)) return;
      dropPending();
      const from = openAt(scene, levelRef.current);
      // The flight paints this blend from its first frame, even before the render that records it.
      blendRef.current = levelBlend(
        scene,
        { open: from, level: levelRef.current },
        { open: openAt(scene, id), level: id },
      );
      setTrans({ from, fromLevel: levelRef.current, u: instant ? 1 : 0 });
      transU.current = instant ? 1 : 0;
      setLevel(id);
      levelRef.current = id;
      setInitiative(id === ORG ? null : (initiativeOf(board, id)?.id ?? null));
      userMoved.current = false;
      framed.current = frameOf(id);
      writeAt(id);
      if (instant) {
        stop();
        setCamera(cameraFor(id, vp));
        settle();
      } else flyTo(cameraFor(id, vp), true);
    },
    [scene, vp, board, flyTo, frameOf, cameraFor, dropPending, setCamera, settle],
  );

  // First frame (the org, even while a level from the URL is still being found), and new cards (a job
  // writing, a brainstorm read) re-framing the level — unless the person has moved the camera since.
  useEffect(() => {
    if (!vp) return;
    if (!camRef.current) {
      framed.current = frameOf(ORG);
      setCamera(fit(orgRect(scene), vp, 0.88, INSETS));
      settle();
      setFramedOnce(true);
      return;
    }
    const rect = frameOf(levelRef.current);
    if (userMoved.current || sameRect(rect, framed.current)) return;
    framed.current = rect;
    flyTo(cameraFor(levelRef.current, vp));
  }, [scene, vp, flyTo, frameOf, cameraFor, setCamera, settle]);
  // A level that left the graph (or the latest few) goes back to the org.
  useEffect(() => {
    if (!loading && level !== ORG && !scene.has(level) && !seek) go(ORG);
  }, [loading, level, scene, seek, go]);

  useEffect(() => {
    // The full chat or an artifact narrows the canvas: once it has slid, frame the level again.
    const t = window.setTimeout(() => {
      if (vpRef.current) flyTo(cameraFor(levelRef.current, vpRef.current));
    }, 460);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the chat or an artifact opens or closes
  }, [mode === "full", artifactOpen]);
  useEffect(() => {
    if (mode === "full") setChatMounted(true);
  }, [mode]);
  // Something drafted a message for the chat (a brainstorm card in it, a proposal): show the chat it lands in.
  const pendingDraft = useCanvasChatStore((s) => s.pendingInputDraft !== null || s.pendingInputAppend !== null);
  useEffect(() => {
    if (pendingDraft) setMode("full");
  }, [pendingDraft]);

  const up = useCallback(() => go(crumbs.length > 1 ? crumbs[crumbs.length - 2] : ORG), [crumbs, go]);

  /** Go to any card, even under an initiative not on the desk: pull that onto the desk first, then fly there. */
  const reach = (id: string) => {
    const init = initiativeOf(board, id) ?? (byId(board, id)?.type === "initiative" ? byId(board, id) : undefined);
    if (init && !desk.includes(init.id)) {
      setPulled((p) => [...p, init.id]);
      setPendingGo(id);
    } else go(levelFor(scene, board, id));
    flashOn(id);
  };
  useEffect(() => {
    // An initiative just came onto the desk: once it's laid out, fly to what was asked for.
    if (!pendingGo) return;
    const lvl = levelFor(scene, board, pendingGo);
    if (lvl === ORG && !scene.has(pendingGo)) return;
    go(lvl);
    setPendingGo(null);
  }, [pendingGo, scene, board, go]);
  // Every plan is being read for what's sought: once they're in, open it (pulling its initiative onto the desk),
  // or for a "pull up" with no match, ask Jamie instead.
  useEffect(() => {
    if (!seek || !vp) return;
    if ("at" in seek) {
      if (scene.has(seek.at)) {
        setSeek(null);
        go(seek.at, true);
        return;
      }
      const n = byId(board, seek.at);
      const init = n?.type === "initiative" ? n : initiativeOf(board, seek.at);
      if (init && !desk.includes(init.id)) setPulled((p) => (p.includes(init.id) ? p : [...p, init.id]));
      else if (n || (!loading && !reading)) setSeek(null);
      return;
    }
    if (loading || reading) return;
    setSeek(null);
    const hit = bestMatch(board, seek.name);
    if (hit) reach(hit.id);
    else void askJamie(seek.text, focusRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `reach` reads this render's board and desk
  }, [seek, vp, scene, board, desk, loading, reading, go, askJamie]);

  // ── What Jamie is pointed at ──────────────────────────────────────────────
  const focusFor = useCallback(
    (id: string): InitiativeFocus | null => {
      const init = initiativeOf(board, id);
      const n = byId(board, id);
      if (!init || !n) return null;
      const entry = entries.find((e) => e.summary.ref_id === init.id);
      return {
        workspaceSlug: init.ws,
        initiativeRefId: init.id,
        initiativeName: init.name,
        stage: entry?.tree ? stageLine(entry.tree.stage) : null,
        selectedRefId: n.id === init.id ? null : n.id,
        selectedType: n.id === init.id ? null : GRAPH_LABEL[n.type],
        selectedLabel: n.id === init.id ? null : n.name,
      };
    },
    [board, entries],
  );
  // The level you're in is what Jamie hears about with every message (as text in the hidden context line).
  const levelFocus = level === ORG ? null : focusFor(level);
  const focusKey = levelFocus
    ? `${levelFocus.initiativeRefId}|${levelFocus.selectedRefId}|${levelFocus.stage}|${levelFocus.selectedLabel}`
    : "";
  const focusRef = useRef(levelFocus);
  focusRef.current = levelFocus;
  useEffect(() => {
    useCanvasChatStore.getState().setInitiativeFocus(focusRef.current);
  }, [focusKey]);
  useEffect(() => () => useCanvasChatStore.getState().setInitiativeFocus(null), []);

  function flashOn(id: string) {
    setFlash(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2400);
  }
  useEffect(() => () => void (flashTimer.current && clearTimeout(flashTimer.current)), []);

  /** Ask Jamie about a card: go into its level and send, with that card as the focus. */
  const send = async (id: string, text: string) => {
    setAsk(null);
    const lvl = levelFor(scene, board, id);
    if (lvl !== levelRef.current) go(lvl);
    // Show the turn at once (Jamie working, then the reply) above the bar.
    setMode((m) => (m === "full" ? m : "last"));
    const sent = await askJamie(text, focusFor(id));
    // The card was the focus for that message only: Jamie goes back to hearing about the level.
    useCanvasChatStore.getState().setInitiativeFocus(focusRef.current);
    return sent;
  };

  /** What you say in the bar: "pull up …" goes there; anything else goes to Jamie about the level you're in. */
  const talk = async (text: string) => {
    const nav = text.match(NAVIGATE);
    if (nav) {
      // The best match may be under an initiative whose plan isn't read yet: read them all, then look.
      setSeek({ name: nav[1], text });
      return true;
    }
    return askJamie(text, levelFocus);
  };

  // Stable actions for the cards, reading the latest closures through a ref.
  const latest = useRef({ board, savePlan, choose, send });
  latest.current = { board, savePlan, choose, send };
  const actions: NodeActions = useMemo(() => {
    const node = (id: string) => byId(latest.current.board, id);
    const save = (...args: Parameters<typeof savePlan>) => latest.current.savePlan(...args);
    return {
      ask: (id, anchor) => {
        const r = rootRef.current!.getBoundingClientRect();
        setAsk({ id, x: anchor.left - r.left, y: anchor.bottom - r.top + 8 });
      },
      setStatus: (reqId, status) => {
        const r = node(reqId);
        if (r) void save(r, [{ op: "edit", ref: reqId, fields: { status } }]);
      },
      addRequirement: (storyId, text) => {
        const st = node(storyId);
        if (st)
          void save(st, [
            { op: "add", temp: "r", type: "Requirement", parent: storyId, fields: { text, status: "accepted" } },
          ]);
      },
      addStory: (initiativeId, text) => {
        const n = node(initiativeId);
        if (n)
          void save(n, [
            { op: "add", temp: "s", type: "UserStory", parent: initiativeId, fields: { text, status: "accepted" } },
          ]);
      },
      addFeature: (milestoneId, text) => {
        const m = node(milestoneId);
        if (m)
          void save(m, [
            { op: "add", temp: "f", type: "InitiativeFeature", parent: milestoneId, fields: { name: text } },
          ]);
      },
      choose: (qid, oid) => {
        const q = node(qid);
        if (q) void latest.current.choose(q, oid);
      },
      expand: (qid, oid) => {
        const o = node(qid)?.options?.find((x) => x.id === oid);
        if (o) void latest.current.send(qid, expandDraft({ id: o.id, name: o.title, letter: o.letter }));
      },
      implement: (id) => void latest.current.send(id, IMPLEMENT),
      moreOptions: (qid) => {
        const q = node(qid);
        if (q) void latest.current.send(qid, expandDraft({ id: q.id, name: q.name }));
      },
      rename: (id, text) => {
        const n = node(id);
        if (n) void save(n, [{ op: "edit", ref: id, fields: { [textField(n.type)]: text } }]);
      },
      remove: (id) => {
        const n = node(id);
        if (n) void save(n, [{ op: "remove", ref: id }]);
      },
    };
  }, []);

  const turnRunning = useCanvasChatStore((s) => {
    const c = s.activeConversationId ? s.conversations[s.activeConversationId] : undefined;
    return !!c?.activeTurn;
  });
  const ctx: CardContext = useMemo(
    () => ({
      board,
      jobs: jobsByRef,
      actions,
      flash,
      work: (id: string) => work.get(id),
      decide: (p: Pencil, action: "accept" | "reject") => decideProposal(p.proposalId, p.runId, action),
    }),
    [board, jobsByRef, actions, flash, work, decideProposal],
  );

  // ── Input ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        setPalette((o) => !o);
        return;
      }
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      // Esc closes the nearest thing first: the full list, then the Ask box; then it goes up a level.
      if (e.key === "Escape") {
        // Taken here, the artifact panel leaves it alone (it skips a prevented key).
        if (showAll) (e.preventDefault(), setShowAll(false));
        else if (ask) (e.preventDefault(), setAsk(null));
        // An open artifact closes next (the panel takes the key itself); then it goes up a level.
        else if (!artifactOpenRef.current) up();
      }
      if (!vp || !camRef.current) return;
      if (e.key === "+" || e.key === "=") flyTo(zoomAbout(camRef.current, 1.8, vp.w / 2, vp.h / 2, vp));
      if (e.key === "-") flyTo(zoomAbout(camRef.current, 1 / 1.8, vp.w / 2, vp.h / 2, vp, minZ));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ask, showAll, up, vp, flyTo, minZ]);

  useEffect(() => {
    const el = rootRef.current!;
    const onWheel = (e: WheelEvent) => {
      // A list on a card that can scroll scrolls; everywhere else the wheel zooms.
      const list = (e.target as HTMLElement).closest?.("[data-wheel-scroll]") as HTMLElement | null;
      if (list && list.scrollHeight > list.clientHeight + 1 && !e.ctrlKey) return;
      // Overlays over the canvas (⌘K, the lists, the Ask box, Jamie's reply) scroll themselves; only the canvas zooms.
      if ((e.target as HTMLElement).closest?.(WHEEL_OWN)) return;
      e.preventDefault();
      const vp = vpRef.current;
      if (!vp || !camRef.current) return;
      stop();
      userMoved.current = true;
      dropPending();
      finishBlend();
      nudge();
      const r = el.getBoundingClientRect();
      const k = e.ctrlKey ? 0.012 : 0.0018;
      setCamera(
        zoomAbout(camRef.current, Math.exp(-e.deltaY * k), e.clientX - r.left, e.clientY - r.top, vp, minZRef.current),
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [dropPending, finishBlend, nudge, setCamera]);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button,input,textarea,a,[data-canvas-chrome]")) return;
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
      dropPending();
      finishBlend();
      nudge();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      const c = camRef.current;
      setCamera({ ...c, cx: c.cx - dx / c.z, cy: c.cy - dy / c.z });
    }
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  /** Clicking a container steps into it; clicking anything else never changes the level. */
  const clickNode = (n: SceneNode) => {
    if (moved.current > 4) return;
    if (n.type === "stack") return setShowAll(true);
    // A folded brainstorm opens (the level re-frames around it); an open one frames its whole tree. The level stays.
    if (n.type === "question" && vp) {
      const q = byId(board, n.id);
      // Only a root folds; a follow-up question is part of the open tree and must never change which tree is open.
      if (q?.about && !q.follows && openTree(board, q.about, openTrees) !== q.id) {
        setOpenTrees((o) => ({ ...o, [q.about!]: q.id }));
        return;
      }
      userMoved.current = true;
      dropPending();
      return flyTo(diveTo(n, vp, INSETS));
    }
    // A pencil card is only a proposal: nothing to go into until it's accepted.
    if (CONTAINERS.includes(n.type) && !byId(board, n.id)?.pencil) go(n.id);
  };
  /** One handler for every card: the nearest `data-hit` under the click says which. */
  const onWorldClick = (e: MouseEvent) => {
    const hit = (e.target as HTMLElement).closest<HTMLElement>("[data-hit]")?.dataset.hit;
    const n = hit ? scene.get(hit) : undefined;
    if (n) clickNode(n);
  };

  const nameOf = (id: string) => {
    const name = id === ORG ? "Org" : byId(board, id)?.name || "Untitled";
    return name.length > 56 ? `${name.slice(0, 54)}…` : name;
  };

  const ordered = useMemo(
    () => [...scene.values()].sort((a, b) => Number(FORK_KINDS.includes(a.type)) - Number(FORK_KINDS.includes(b.type))),
    [scene],
  );
  const lines = useMemo(() => linesOf(scene, board), [scene, board]);
  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) boxes.current.set(id, el);
    else boxes.current.delete(id);
  }, []);
  /** A feature's pull requests, for its build panel. */
  const prsOf = useMemo(() => {
    const out = new Map<string, ArtifactRef[]>();
    for (const [ref, list] of Object.entries(artifactsByRef)) {
      const prs = list.filter((x) => x.kind === "pull_request");
      if (prs.length) out.set(ref, prs);
    }
    return out;
  }, [artifactsByRef]);
  /** The latest job on each card while it runs, and for a while after it settles. */
  const markersOf = useMemo(() => {
    const out = new Map<string, CanvasJob[]>();
    for (const [ref, js] of Object.entries(jobsByRef)) {
      const list = js.filter((j) => j.state === "running" || now - j.updatedAt < SETTLED_MS).slice(-1);
      if (list.length) out.set(ref, list);
    }
    return out;
  }, [jobsByRef, now]);
  const u = transU.current;
  const topBtn: CSSProperties = {
    pointerEvents: "auto",
    height: 34,
    borderRadius: 99,
    background: v("chrome"),
    border: `1px solid ${v("chromeBorder")}`,
    boxShadow: v("shadow"),
    fontFamily: TYPE,
    fontSize: 13.5,
    color: v("ink"),
  };
  const blank = !loading && !board.nodes.length;

  return (
    <OnPaper.Provider value>
      <div
        data-infinite-canvas
        // Hive's chat pieces drawn on the canvas (chips, rows, the full chat) wear its paper in either app theme.
        data-canvas-paper=""
        className="icb-root"
        style={{
          ...themeVars(CANVAS_THEME),
          position: "absolute",
          inset: 0,
          display: "flex",
          colorScheme: CANVAS_THEME.scheme,
          background: v("desk"),
        }}
      >
        <style>{KEYFRAMES + PAPER_CSS}</style>
        <aside
          data-canvas-chat
          data-chat-panel={mode === "full" ? "open" : "closed"}
          aria-hidden={mode !== "full"}
          inert={mode !== "full"}
          style={{
            width: mode === "full" ? CHAT_W : 0,
            flexShrink: 0,
            overflow: "hidden",
            transition: "width .42s cubic-bezier(.2,.8,.2,1)",
            borderRight: mode === "full" ? `1px solid ${v("chromeBorder")}` : "none",
          }}
        >
          <div
            style={{
              width: CHAT_W,
              height: "100%",
              transform: mode === "full" ? "none" : "translateX(-40px)",
              opacity: mode === "full" ? 1 : 0,
              transition: "transform .42s cubic-bezier(.2,.8,.2,1), opacity .3s",
            }}
          >
            {chatMounted ? renderChat(() => setMode("last")) : null}
          </div>
        </aside>
        <ResizablePanelGroup
          id="org-brainstorm-group"
          direction="horizontal"
          autoSaveId="org-brainstorm"
          className="min-w-0 flex-1"
        >
          <ResizablePanel id="org-brainstorm-canvas" order={1} minSize={30} className={artifact.transition}>
            <div style={{ display: "flex", height: "100%", width: "100%" }}>
              <div
                ref={rootRef}
                data-level={level}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                // The camera is the only way to move: undo any scroll the browser makes to bring a focused card into view.
                onScroll={(e) => e.currentTarget.scrollTo(0, 0)}
                style={{
                  position: "relative",
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  touchAction: "none",
                  userSelect: "none",
                  color: v("ink"),
                  // The texture follows the camera, set with it.
                  ...deskStyle(CANVAS_THEME, null, null),
                }}
              >
                {framedOnce && vp ? (
                  <Links lines={lines} blend={blend} u={u} camRef={camRef} vp={vp} drawRef={drawLinks} />
                ) : null}
                {/* The world: every card at its place in world units, moved and scaled by the camera as one. */}
                <div
                  ref={worldRef}
                  data-world
                  onClick={onWorldClick}
                  style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, transformOrigin: "0 0" }}
                >
                  <SettledZoom.Provider value={settledZoom}>
                    {framedOnce && cull
                      ? ordered.map((n) => {
                          const container = CONTAINERS.includes(n.type);
                          const vis = blend.vis(n.id, u);
                          const open = container ? blend.open(n.id, u) : 0;
                          const q = n.type === "question" ? byId(board, n.id) : undefined;
                          return (
                            <SceneItem
                              key={n.id}
                              n={n}
                              c={ctx}
                              vis={vis}
                              open={open}
                              // Both while a flight blends between them.
                              frame={container && Math.max(open, blend.open(n.id, 1)) > 0}
                              face={container && Math.min(open, blend.open(n.id, 1)) < 1}
                              culled={!overlaps(n.rect, cull) || peak((x) => blend.vis(n.id, x), u) < 0.01}
                              here={n.id === level}
                              quiet={["milestone", "feature"].includes(scene.get(level)?.type ?? "") && n.id !== level}
                              desk={desk}
                              busy={turnRunning}
                              artifacts={
                                n.type === "artifacts"
                                  ? (artifactsAt[n.parent] ?? NO_ARTIFACTS)
                                  : n.type === "build"
                                    ? (prsOf.get(n.parent) ?? NO_ARTIFACTS)
                                    : undefined
                              }
                              folded={!!q?.about && !q.follows && openTree(board, q.about, openTrees) !== n.id}
                              jobs={markersOf.get(n.id)}
                              register={register}
                            />
                          );
                        })
                      : null}
                  </SettledZoom.Provider>
                </div>

                {/* Only once the reads have come back with nothing to show; while reading, the spinner by the crumbs says so. */}
                {!board.nodes.length && !loading && (blank || failed) ? (
                  <div
                    data-canvas-empty
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "grid",
                      placeItems: "center",
                      pointerEvents: "none",
                      fontFamily: TYPE,
                      fontSize: 18,
                      color: v("muted"),
                      fontStyle: "italic",
                      textAlign: "center",
                      padding: 24,
                    }}
                  >
                    {failed
                      ? "Couldn't read the plan from the graph. It will try again in a minute."
                      : "No initiatives yet. Tell Jamie what you want to build, and it starts one here."}
                  </div>
                ) : null}

                <div
                  data-canvas-chrome
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    left: 16,
                    top: 16,
                    right: 16,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    flexWrap: "wrap",
                    pointerEvents: "none",
                    zIndex: 20,
                  }}
                >
                  <button
                    type="button"
                    data-back
                    aria-label="Back out a level (Esc)"
                    title="Back out a level (Esc)"
                    onClick={up}
                    disabled={level === ORG}
                    style={{
                      ...topBtn,
                      width: 34,
                      cursor: level === ORG ? "default" : "pointer",
                      opacity: level === ORG ? 0.45 : 1,
                      fontSize: 16,
                    }}
                  >
                    ←
                  </button>
                  <nav
                    data-crumbs
                    style={{
                      ...topBtn,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "0 12px",
                      maxWidth: "100%",
                      overflow: "hidden",
                    }}
                  >
                    {[ORG, ...crumbs].map((id, i, all) => (
                      <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                        {i ? <span style={{ color: v("faint") }}>›</span> : null}
                        <button
                          type="button"
                          data-crumb={id}
                          onClick={() => go(id)}
                          style={{
                            border: "none",
                            background: "none",
                            padding: "0 2px",
                            cursor: "pointer",
                            fontFamily: TYPE,
                            fontSize: 13.5,
                            color: i === all.length - 1 ? v("ink") : v("muted"),
                            fontWeight: i === all.length - 1 ? 600 : 400,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: 240,
                          }}
                        >
                          {nameOf(id)}
                        </button>
                      </span>
                    ))}
                    {/* Reading: a quiet spinner here, never text over the cards. */}
                    {loading || reading || seek ? (
                      <span data-reading title="Reading the plan…" className="icb-spin" style={{ marginLeft: 6 }} />
                    ) : null}
                  </nav>
                  <button
                    type="button"
                    data-search
                    onClick={() => setPalette(true)}
                    style={{
                      ...topBtn,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "0 12px",
                      cursor: "pointer",
                      color: v("muted"),
                    }}
                  >
                    ⌕ Search
                    <kbd
                      style={{
                        fontFamily: TYPE,
                        fontSize: 11,
                        padding: "1px 6px",
                        borderRadius: 5,
                        border: `1px solid ${v("chromeBorder")}`,
                        background: v("field"),
                        color: v("muted"),
                      }}
                    >
                      ⌘K
                    </kbd>
                  </button>
                </div>

                <div
                  data-canvas-chrome
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    right: 16,
                    bottom: 24,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    zIndex: 20,
                  }}
                >
                  {[
                    {
                      label: "+",
                      title: "Zoom in",
                      go: () =>
                        camRef.current &&
                        vp &&
                        (dropPending(), flyTo(zoomAbout(camRef.current, 1.8, vp.w / 2, vp.h / 2, vp))),
                    },
                    {
                      label: "−",
                      title: "Zoom out",
                      go: () =>
                        camRef.current &&
                        vp &&
                        (dropPending(), flyTo(zoomAbout(camRef.current, 1 / 1.8, vp.w / 2, vp.h / 2, vp, minZ))),
                    },
                    { label: "⤢", title: "Frame this level", go: () => go(level) },
                  ].map((b) => (
                    <button
                      key={b.label}
                      type="button"
                      title={b.title}
                      aria-label={b.title}
                      onClick={() => {
                        userMoved.current = b.label !== "⤢";
                        b.go();
                      }}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        border: `1px solid ${v("chromeBorder")}`,
                        background: v("chrome"),
                        color: v("ink"),
                        fontSize: 17,
                        cursor: "pointer",
                        boxShadow: v("shadow"),
                      }}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>

                {mode === "full" ? null : <JamieBar mode={mode} setMode={setMode} send={talk} />}

                {palette ? (
                  <Palette
                    // Search finds what's in the plan, not what's proposed for it.
                    board={graphBoard}
                    left={16}
                    close={() => setPalette(false)}
                    pick={(id) => {
                      setPalette(false);
                      reach(id);
                    }}
                  />
                ) : null}

                {showAll && camRef.current && vp && scene.get(STACK) ? (
                  <AllInitiatives
                    board={board}
                    desk={desk}
                    anchor={toScreen(scene.get(STACK)!.rect, camRef.current, vp)}
                    vp={vp}
                    close={() => setShowAll(false)}
                    pick={(id) => {
                      setShowAll(false);
                      reach(id);
                    }}
                  />
                ) : null}

                {ask && byId(board, ask.id) ? (
                  <AskBox
                    node={byId(board, ask.id)!}
                    x={Math.min(ask.x, (vp?.w ?? 800) - 380)}
                    y={Math.min(ask.y, (vp?.h ?? 600) - 260)}
                    options={suggestions(board, ask.id)}
                    busy={turnRunning}
                    close={() => setAsk(null)}
                    send={(t) => void send(ask.id, t)}
                  />
                ) : null}
              </div>
            </div>
          </ResizablePanel>
          {/* An artifact opened from a card (or the full chat) opens on the right exactly as on the chats page:
          a resizable pane, the divider draggable and the width remembered. Its own close button and Esc close it. */}
          <ResizableHandle withHandle className={cn(!artifact.mounted && "hidden")} {...artifact.handleProps} />
          <ResizablePanel {...artifact.panelProps} id="org-brainstorm-artifact" order={2} defaultSize={40} minSize={25}>
            <div
              data-artifact-aside={artifactOpen ? "open" : "closed"}
              aria-hidden={!artifactOpen}
              inert={!artifactOpen}
              className="h-full bg-background text-foreground"
              style={{ borderLeft: `1px solid ${v("chromeBorder")}` }}
            >
              {artifact.mounted && <ArtifactPanel />}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </OnPaper.Provider>
  );
}

/**
 * One scene node at its place in the world: face or open frame, story, add slot, panel, artifact strip, or
 * brainstorm card. Drawn at its design width and scaled once to its rect; the camera moves it with the world.
 */
const SceneItem = memo(function SceneItem({
  n,
  c,
  vis,
  open,
  frame,
  face,
  culled,
  here,
  quiet,
  busy,
  artifacts,
  folded,
  desk,
  jobs,
  register,
}: {
  n: SceneNode;
  c: CardContext;
  vis: number;
  open: number;
  /** A container draws its open frame, its face, or both while a flight blends them. */
  frame: boolean;
  face: boolean;
  /** Out of view, or gone at this level for the rest of any flight. */
  culled: boolean;
  /** The level you're in: its frame gets the paper; the ones around it are just an outline. */
  here: boolean;
  /** Inside a milestone or feature the headers above it hide, and the frames around it go. */
  quiet: boolean;
  /** A Jamie turn is running: asks that start one wait. */
  busy: boolean;
  artifacts?: ArtifactRef[];
  /** A brainstorm question folded while another on its card is open. */
  folded?: boolean;
  /** The initiatives on the desk, for the stack. */
  desk: string[];
  /** A job on this card, running or just settled. */
  jobs?: CanvasJob[];
  register: (id: string, el: HTMLElement | null) => void;
}) {
  if (culled) return null;
  const board = c.board;
  const r = n.rect;
  const loose = ["add", "artifacts", "architecture", "build", "stories", "stack"].includes(n.type);
  const q = n.type === "option" ? byId(board, n.of!) : undefined;
  // A story inside a milestone is a copy: `story@milestone`, its own id in `of`.
  const node = loose ? undefined : n.type === "option" ? q : byId(board, n.id);
  if (!loose && !node) return null;
  const dh = (w: number) => (w * r.h) / r.w;
  const scaled = (designW: number, opacity = 1, extra?: CSSProperties): CSSProperties => ({
    position: "absolute",
    left: 0,
    top: 0,
    width: designW,
    height: dh(designW),
    transform: `scale(${r.w / designW})`,
    transformOrigin: "0 0",
    opacity,
    pointerEvents: opacity > 0.5 ? "auto" : "none",
    ...extra,
  });

  let body: ReactNode;
  let extra: CSSProperties | undefined;
  let attrs: Record<string, string | undefined> = {};
  if (n.type === "artifacts") {
    const w = FRAME_W[byId(board, n.parent)?.type ?? "feature"] ?? 820;
    attrs = { "data-artifacts": n.parent };
    body = (
      <div
        data-wheel-scroll
        style={scaled(w, 1, { overflowY: "auto", overflowX: "hidden", colorScheme: CANVAS_THEME.scheme })}
        className="bg-transparent text-[var(--ic-ink)]"
      >
        <ChatArtifacts artifacts={artifacts ?? NO_ARTIFACTS} versions={NO_VERSIONS} />
      </div>
    );
  } else if (n.type === "architecture" || n.type === "build") {
    const f = byId(board, n.parent);
    if (!f) return null;
    const w = FACE_W[n.type]!;
    body = (
      <div style={scaled(w)}>
        {n.type === "architecture" ? (
          <ArchitectureCard f={f} w={w} h={dh(w)} />
        ) : (
          <BuildCard c={c} f={f} prs={artifacts ?? NO_ARTIFACTS} busy={busy} w={w} h={dh(w)} />
        )}
      </div>
    );
  } else if (n.type === "stack") {
    extra = { cursor: "pointer" };
    attrs = { "data-node": STACK, "data-hit": STACK };
    body = (
      <div style={scaled(FACE_W.stack!)}>
        <StackCard b={board} desk={desk} w={FACE_W.stack!} h={dh(FACE_W.stack!)} />
      </div>
    );
  } else if (n.type === "stories") {
    body = (
      <div style={scaled(FACE_W.stories!)}>
        <StoriesPanel c={c} initiative={n.parent} w={FACE_W.stories!} h={dh(FACE_W.stories!)} />
      </div>
    );
  } else if (n.type === "add") {
    const w = FACE_W.feature!;
    body = (
      <div style={scaled(w)}>
        <AddCard c={c} milestoneId={n.parent} w={w} h={dh(w)} />
      </div>
    );
  } else if (n.type === "question") {
    extra = { cursor: folded ? "pointer" : "zoom-in" };
    attrs = { "data-node": n.id, "data-hit": n.id, title: folded ? "Open this brainstorm" : "See the whole tree" };
    body = (
      <div style={scaled(QUESTION_W)}>
        <QuestionCard c={c} node={node!} w={QUESTION_W} h={dh(QUESTION_W)} busy={busy} folded={!!folded} />
      </div>
    );
  } else if (n.type === "option") {
    const o = q!.options!.find((x) => optionKey(q!.id, x.id) === n.id)!;
    attrs = { "data-node": n.id };
    body = (
      <div style={scaled(OPTION_W)}>
        <OptionCard c={c} q={q!} o={o} w={OPTION_W} h={dh(OPTION_W)} busy={busy} />
      </div>
    );
  } else {
    const faceW = FACE_W[n.type] ?? 300;
    const frameW = FRAME_W[n.type] ?? 820;
    const glowing = (c.jobs[n.id] ?? []).some((j) => j.state === "running");
    attrs = { "data-node": n.id, "data-open": open.toFixed(2) };
    body = (
      <>
        {frame ? (
          <div
            data-part="frame"
            className={glowing ? "icb-glow" : undefined}
            style={{
              position: "absolute",
              inset: 0,
              opacity: open,
              borderRadius: n.type === "initiative" ? 28 : 14,
              border: here
                ? `1.5px solid ${v("here")}`
                : quiet
                  ? "1.5px solid transparent"
                  : `1.5px solid ${a("frame", 16)}`,
              background: here ? (n.type === "initiative" ? v("frameFillInitiative") : v("frameFill")) : "transparent",
              pointerEvents: "none",
            }}
          >
            <div data-hit={n.id} style={scaled(frameW, quiet ? 0 : 1, { height: dh(frameW) * HEADER })}>
              <FrameHeader c={c} node={node!} w={frameW} h={dh(frameW) * HEADER} />
            </div>
            {/* Only once its plan has come back empty, never while it's being read. */}
            {n.type !== "feature" && !node!.unread && kids(board, n.id).length === 0 ? (
              <EmptyHint node={node!} rect={r} />
            ) : null}
          </div>
        ) : null}
        {face ? (
          <div data-part="face" data-hit={n.id} style={scaled(faceW, 1 - open)}>
            <Face c={c} node={node!} w={faceW} h={dh(faceW)} />
          </div>
        ) : null}
      </>
    );
  }

  // Part of the card, in its design units: it zooms with the card and sits on its top edge.
  const markerW = (open > 0.5 ? FRAME_W[n.type] : FACE_W[n.type]) ?? FACE_W.feature!;
  return (
    <div
      ref={(el) => {
        register(n.id, el);
      }}
      {...attrs}
      style={{
        position: "absolute",
        left: r.x,
        top: r.y,
        width: r.w,
        height: r.h,
        opacity: vis,
        transform: `scale(${grow(vis)})`,
        pointerEvents: vis > 0.3 ? "auto" : "none",
        ...extra,
      }}
    >
      {body}
      {jobs && vis >= 0.3 ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: markerW,
            transform: `scale(${r.w / markerW})`,
            transformOrigin: "0 0",
            zIndex: 5,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 4,
              padding: "0 10px",
              transform: "translateY(-50%)",
            }}
          >
            {jobs.map((j) => (
              <JobMarker key={j.jobId} job={j} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
});

/** In world units like its frame; its type is held between 11 and 22 px on screen (at the settled zoom). */
function EmptyHint({ node, rect }: { node: PlanNode; rect: Rect }) {
  const z = useContext(SettledZoom);
  const what = node.type === "initiative" ? "milestones" : "features";
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: rect.h * HEADER,
        bottom: 0,
        display: "grid",
        placeItems: "center",
        fontFamily: TYPE,
        fontSize: Math.max(11, Math.min(22, (rect.w * z) / 50)) / z,
        color: v("faint"),
        fontStyle: "italic",
      }}
    >
      No {what} yet. Ask Jamie, or say “add {what}”.
    </div>
  );
}

/** One road or branch, kept in world units; drawn on screen for the camera (strokes and arrows stay in pixels). */
interface Line {
  id: string;
  kind: "road" | "branch" | "made";
  from: Rect;
  to: Rect;
  /** Whose presence it fades with: the faintest of them. */
  of: string[];
  k: number;
  style: { stroke: string; width: number; dash?: string; arrow?: boolean };
}

/** Road arrows between an initiative's brief and milestones, and the branches of each brainstorm tree. */
function linesOf(scene: Scene, board: Board): Line[] {
  const lines: Line[] = [];
  const road = { stroke: v("road"), width: 1.5, arrow: true };
  for (const init of board.nodes.filter((n) => n.type === "initiative")) {
    const stops = [...kids(board, init.id, "brief"), ...kids(board, init.id, "milestone")];
    stops.slice(1).forEach((m, i) => {
      const a = scene.get(stops[i].id);
      const b = scene.get(m.id);
      // Both ends must be in view: a road from a neighbour that faded out goes with it.
      if (a && b)
        lines.push({
          id: `${a.id}>${b.id}`,
          kind: "road",
          from: a.rect,
          to: b.rect,
          of: [a.id, b.id],
          k: 0.55,
          style: { ...road, dash: stops[i].type === "brief" ? "4 5" : undefined },
        });
    });
  }
  // A brainstorm tree: feature → question, question → each option, an expanded option → the question it raised.
  const questionOf = new Map<string, PlanNode>();
  const madeBy = new Map<string, PlanNode[]>();
  for (const n of board.nodes) {
    for (const o of n.options ?? []) questionOf.set(o.id, n);
    for (const o of n.madeBy ?? []) madeBy.set(o, [...(madeBy.get(o) ?? []), n]);
  }
  const optionScene = (optionId: string) => {
    const owner = questionOf.get(optionId);
    return owner ? scene.get(optionKey(owner.id, optionId)) : undefined;
  };
  for (const q of board.nodes.filter((n) => n.type === "question")) {
    const sq = scene.get(q.id);
    const from = q.follows ? optionScene(q.follows) : q.about ? scene.get(q.about) : undefined;
    if (!sq || !from) continue;
    const fork = { stroke: v("fork"), width: 1.8, dash: "3 5" };
    lines.push({ id: `q-${q.id}`, kind: "branch", from: from.rect, to: sq.rect, of: [q.id], k: 1, style: fork });
    for (const opt of q.options ?? []) {
      const so = scene.get(optionKey(q.id, opt.id));
      if (!so) continue;
      lines.push({
        id: `o-${q.id}-${opt.id}`,
        kind: "branch",
        from: sq.rect,
        to: so.rect,
        of: [q.id],
        k: q.decided && !opt.chosen ? 0.5 : 1,
        style: opt.chosen ? { stroke: v("fork"), width: 3 } : fork,
      });
      // Option -RESULTED_IN-> what choosing it made: from the chosen answer back to each card it made.
      if (!opt.chosen) continue;
      for (const made of madeBy.get(opt.id) ?? []) {
        const sm = scene.get(made.id);
        if (sm)
          lines.push({
            id: `r-${opt.id}-${made.id}`,
            kind: "made",
            from: so.rect,
            to: sm.rect,
            of: [q.id, made.id],
            k: 0.8,
            style: { stroke: v("fork"), width: 2, dash: "8 5", arrow: true },
          });
      }
    }
  }
  return lines;
}

function pathOf(l: Line, cam: Camera, vp: Viewport): string {
  const a = toScreen(l.from, cam, vp);
  const b = toScreen(l.to, cam, vp);
  if (l.kind === "road") return `M${a.x + a.w + 4} ${a.y + a.h / 2} L${b.x - 6} ${b.y + b.h / 2}`;
  if (l.kind === "branch") {
    const [x1, y1, x2, y2] = [a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2];
    const k = (x2 - x1) * 0.5;
    return `M${x1} ${y1} C${x1 + k} ${y1} ${x2 - k} ${y2} ${x2} ${y2}`;
  }
  const [x1, y1, x2, y2] = [a.x, a.y + a.h * 0.7, b.x + b.w, b.y + b.h / 2];
  return `M${x1} ${y1} C${x1 - 80} ${y1 + 40} ${x2 + 80} ${y2} ${x2 + 4} ${y2}`;
}

/**
 * The links, on screen over the desk and under the cards. They render when the scene or the level changes;
 * the camera and a flight's blend redraw them through `drawRef`.
 */
const Links = memo(function Links({
  lines,
  blend,
  u,
  camRef,
  vp,
  drawRef,
}: {
  lines: Line[];
  blend: Blend;
  u: number;
  camRef: RefObject<Camera | null>;
  vp: Viewport;
  drawRef: RefObject<((cam: Camera, vp: Viewport, u: number) => void) | null>;
}) {
  const els = useRef(new Map<string, SVGPathElement>());
  const seen = useCallback((l: Line, x: number) => Math.min(...l.of.map((id) => blend.vis(id, x))) * l.k, [blend]);
  const shown = useMemo(() => lines.filter((l) => peak((x) => seen(l, x), u) > 0.02), [lines, seen, u]);
  useLayoutEffect(() => {
    drawRef.current = (cam, view, x) => {
      for (const l of shown) {
        const el = els.current.get(l.id);
        el?.setAttribute("d", pathOf(l, cam, view));
        el?.setAttribute("stroke-opacity", String(seen(l, x)));
      }
    };
  }, [shown, seen, drawRef]);
  const cam = camRef.current;
  if (!cam) return null;
  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      <defs>
        <marker id="icb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 1 L9 5 L0 9" fill="none" stroke={v("road")} strokeWidth="1.6" />
        </marker>
        <marker id="icb-fork" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill={v("fork")} />
        </marker>
      </defs>
      {shown.map((l) => (
        <path
          key={l.id}
          ref={(el) => {
            if (el) els.current.set(l.id, el);
            else els.current.delete(l.id);
          }}
          d={pathOf(l, cam, vp)}
          fill="none"
          stroke={l.style.stroke}
          strokeOpacity={seen(l, u)}
          strokeWidth={l.style.width}
          strokeDasharray={l.style.dash}
          markerEnd={l.style.arrow ? (l.style.stroke === v("fork") ? "url(#icb-fork)" : "url(#icb-arrow)") : undefined}
        />
      ))}
    </svg>
  );
});

/** Ask Jamie about one card: opens next to the card's chip, with suggestions for that card. */
function AskBox({
  node,
  x,
  y,
  options,
  busy,
  close,
  send,
}: {
  node: PlanNode;
  x: number;
  y: number;
  options: string[];
  busy: boolean;
  close: () => void;
  send: (t: string) => void;
}) {
  const [text, setText] = useState(options[0] ?? "");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Grow with the text (Shift+Enter adds lines) up to the cap, then scroll.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    if (text) el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    else el.style.height = "";
  }, [text]);
  return (
    <div
      data-askbox
      data-canvas-chrome
      onPointerDown={(e) => e.stopPropagation()}
      className="icb-bloom"
      style={{
        position: "absolute",
        left: Math.max(16, x),
        top: Math.max(16, y),
        width: 380,
        padding: 14,
        borderRadius: 14,
        background: v("sheet"),
        border: `1px solid ${v("chromeBorder")}`,
        boxShadow: v("shadowPop"),
        fontFamily: TYPE,
        color: v("ink"),
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 30,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: 13,
            color: v("muted"),
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          Ask Jamie about <b style={{ color: v("ink") }}>{node.name}</b>
        </span>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          style={{ border: "none", background: "none", cursor: "pointer", color: v("muted"), fontSize: 16 }}
        >
          ×
        </button>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <textarea
          ref={inputRef}
          rows={1}
          autoFocus
          data-ask-input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              if (text.trim() && !busy) send(text.trim());
            }
            if (e.key === "Escape") close();
          }}
          placeholder="What should Jamie do here?"
          style={{
            flex: 1,
            minWidth: 0,
            border: `1px solid ${v("chromeBorder")}`,
            borderRadius: 8,
            background: v("field"),
            color: v("fieldInk"),
            padding: "8px 10px",
            fontFamily: TYPE,
            fontSize: 14,
            outline: "none",
            resize: "none",
            maxHeight: 200,
            overflowY: "auto",
          }}
        />
        <button
          type="button"
          data-ask-send
          disabled={busy}
          title={busy ? "Jamie is still answering" : undefined}
          onClick={() => text.trim() && send(text.trim())}
          style={{
            border: "none",
            borderRadius: 8,
            background: v("ink"),
            color: v("onInk"),
            padding: "0 12px",
            fontFamily: TYPE,
            fontSize: 13.5,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.5 : 1,
          }}
        >
          Ask
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            data-suggestion={o}
            onClick={() => setText(o)}
            style={{
              textAlign: "left",
              border: `1px solid ${v("border")}`,
              borderRadius: 8,
              background: o === text ? v("field") : a("field", 60),
              padding: "6px 10px",
              fontFamily: TYPE,
              fontSize: 13,
              color: v("ink"),
              cursor: "pointer",
            }}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
