"use client";

import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stageLine } from "@/lib/initiative-plan";
import { useCanvasChatStore, type InitiativeFocus } from "../../_state/canvasChatStore";
import type { ArtifactRef, ArtifactVersion } from "../../_state/canvasChatArtifacts";
import { type CanvasJob, useCanvasJobs } from "../../_state/useCanvasJobs";
import { ArtifactPanel } from "../artifacts/ArtifactPanel";
import { ChatArtifacts } from "../artifacts/ChatArtifacts";
import { OnPaper } from "../artifacts/onPaper";
import { useArtifactPanelOpen } from "../artifacts/useArtifactPanel";
import { expandDraft } from "../brainstorm-board/actions";
import {
  type Board,
  type PlanNode,
  DESK_SIZE,
  GRAPH_LABEL,
  IMPLEMENT,
  NAVIGATE,
  bestMatch,
  byId,
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
  diveTo,
  fit,
  focusWeight,
  layoutScene,
  levelFor,
  openAt,
  openTree,
  type OpenTrees,
  optionKey,
  orgRect,
  toScreen,
  visibility,
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
/** The artifact panel on the right. */
const ARTIFACT_W = 560;
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
const onScreen = (r: Rect, vp: Viewport) =>
  r.x < vp.w + 200 && r.y < vp.h + 200 && r.x + r.w > -200 && r.y + r.h > -200;
const FORK_KINDS = ["question", "option"];
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
function writeAt(id: string) {
  const params = new URLSearchParams(window.location.search);
  if (id === ORG) params.delete("at");
  else params.set("at", id);
  window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
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
  const [cam, setCam] = useState<Camera | null>(null);
  const [level, setLevel] = useState(ORG);
  const [trans, setTrans] = useState<Trans>({ from: [], fromLevel: ORG, u: 1 });
  const transU = useRef(1);
  transU.current = trans.u;
  const [ask, setAsk] = useState<{ id: string; x: number; y: number } | null>(null);
  const [mode, setMode] = useState<JamieMode>("input");
  const artifactOpen = useArtifactPanelOpen();
  const artifactOpenRef = useRef(artifactOpen);
  artifactOpenRef.current = artifactOpen;
  const [chatMounted, setChatMounted] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
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
  camRef.current = cam;
  vpRef.current = vp;
  levelRef.current = level;

  useEffect(() => {
    const el = rootRef.current!;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stop = () => {
    if (anim.current) cancelAnimationFrame(anim.current);
    anim.current = null;
  };
  useEffect(() => () => stop(), []);
  // An artifact open on the right belongs to the canvas: leaving it (another tab) closes it.
  useEffect(() => () => useCanvasChatStore.getState().closeArtifactPanel(), []);

  /**
   * Fly the camera; `withLevel` also blends the opened containers over the same flight. A flight that
   * replaces one still opening a level (new cards re-framing it) finishes opening it from where it was.
   */
  const flyTo = useCallback((to: Camera, withLevel = false) => {
    stop();
    const from = camRef.current;
    const u0 = withLevel ? 0 : transU.current;
    const blend = u0 < 1;
    if (!from || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setCam(to);
      if (blend) setTrans((s) => ({ ...s, u: 1 }));
      return;
    }
    const t0 = performance.now();
    const step = (t: number) => {
      const u = Math.min(1, (t - t0) / 750);
      setCam(between(from, to, ease(u)));
      if (blend) setTrans((s) => ({ ...s, u: u0 + (1 - u0) * ease(u) }));
      anim.current = u < 1 ? requestAnimationFrame(step) : null;
    };
    anim.current = requestAnimationFrame(step);
  }, []);

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
  const dropPending = useCallback(() => {
    setSeek(null);
    setPendingGo(null);
  }, []);

  /** Click into a level (or out to one): open it and fly there. Zooming never calls this. */
  const go = useCallback(
    (id: string, instant = false) => {
      if (!vp) return;
      if (id !== ORG && !scene.get(id)) return;
      dropPending();
      setTrans({ from: openAt(scene, levelRef.current), fromLevel: levelRef.current, u: instant ? 1 : 0 });
      setLevel(id);
      levelRef.current = id;
      setInitiative(id === ORG ? null : (initiativeOf(board, id)?.id ?? null));
      userMoved.current = false;
      framed.current = frameOf(id);
      writeAt(id);
      if (instant) setCam(cameraFor(id, vp));
      else flyTo(cameraFor(id, vp), true);
    },
    [scene, vp, board, flyTo, frameOf, cameraFor, dropPending],
  );

  // First frame (the org, even while a level from the URL is still being found), and new cards (a job
  // writing, a brainstorm read) re-framing the level — unless the person has moved the camera since.
  useEffect(() => {
    if (!vp) return;
    if (!camRef.current) {
      framed.current = frameOf(ORG);
      setCam(fit(orgRect(scene), vp, 0.88, INSETS));
      return;
    }
    const rect = frameOf(levelRef.current);
    if (userMoved.current || sameRect(rect, framed.current)) return;
    framed.current = rect;
    flyTo(cameraFor(levelRef.current, vp));
  }, [scene, vp, flyTo, frameOf, cameraFor]);
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

  const crumbs = openAt(scene, level);
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

  const open = (id: string) => {
    const a = trans.from.includes(id) ? 1 : 0;
    const b = crumbs.includes(id) ? 1 : 0;
    return a + (b - a) * trans.u;
  };
  const dim = (id: string) => {
    const a = focusWeight(scene, id, trans.fromLevel);
    const b = focusWeight(scene, id, level);
    return a + (b - a) * trans.u;
  };

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
      if (!vp || !camRef.current) return;
      stop();
      userMoved.current = true;
      dropPending();
      setTrans((s) => (s.u < 1 ? { ...s, u: 1 } : s));
      const r = el.getBoundingClientRect();
      const k = e.ctrlKey ? 0.012 : 0.0018;
      setCam(zoomAbout(camRef.current, Math.exp(-e.deltaY * k), e.clientX - r.left, e.clientY - r.top, vp, minZ));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [vp, minZ, dropPending]);

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
      setTrans((s) => (s.u < 1 ? { ...s, u: 1 } : s));
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      const c = camRef.current;
      setCam({ ...c, cx: c.cx - dx / c.z, cy: c.cy - dy / c.z });
    }
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  /** Clicking a container steps into it; clicking anything else never changes the level. */
  const clickNode = (n: SceneNode) => () => {
    if (moved.current > 4) return;
    if (n.type === "stack") return setShowAll(true);
    // A folded brainstorm opens (the level re-frames around it); an open one frames its whole tree. The level stays.
    if (n.type === "question" && vp) {
      const q = byId(board, n.id);
      if (q?.about && openTree(board, q.about, openTrees) !== q.id) {
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

  const nameOf = (id: string) => {
    const name = id === ORG ? "Org" : byId(board, id)?.name || "Untitled";
    return name.length > 56 ? `${name.slice(0, 54)}…` : name;
  };

  const deskLook: CSSProperties = deskStyle(CANVAS_THEME, cam, vp);
  const ordered = [...scene.values()].sort(
    (a, b) => Number(FORK_KINDS.includes(a.type)) - Number(FORK_KINDS.includes(b.type)),
  );
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
  const markers = (n: SceneNode): CanvasJob[] =>
    (jobsByRef[n.id] ?? []).filter((j) => j.state === "running" || now - j.updatedAt < SETTLED_MS).slice(-1);
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
        <div
          ref={rootRef}
          data-zoom={cam?.z.toFixed(3)}
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
            ...deskLook,
          }}
        >
          {cam && vp ? (
            <>
              <Links scene={scene} board={board} cam={cam} vp={vp} open={open} dim={dim} />
              {ordered.map((n) => (
                <SceneItem
                  key={n.id}
                  n={n}
                  c={ctx}
                  cam={cam}
                  vp={vp}
                  vis={visibility(scene, n.id, open) * dim(n.id)}
                  open={CONTAINERS.includes(n.type) ? open(n.id) : 0}
                  here={n.id === level}
                  quiet={["milestone", "feature"].includes(scene.get(level)?.type ?? "") && n.id !== level}
                  desk={desk}
                  busy={turnRunning}
                  artifacts={
                    n.type === "artifacts"
                      ? (artifactsAt[n.parent] ?? [])
                      : n.type === "build"
                        ? (artifactsByRef[n.parent] ?? []).filter((x) => x.kind === "pull_request")
                        : undefined
                  }
                  folded={
                    n.type === "question" &&
                    !!byId(board, n.id)?.about &&
                    openTree(board, byId(board, n.id)!.about!, openTrees) !== n.id
                  }
                  onClick={clickNode(n)}
                />
              ))}
              {ordered.map((n) => {
                const list = markers(n);
                if (!list.length) return null;
                const seen = visibility(scene, n.id, open) * dim(n.id);
                const sr = toScreen(n.rect, cam, vp);
                if (seen < 0.3 || !onScreen(sr, vp)) return null;
                // Part of the card, in its design units: it zooms with the card and sits on its top edge, inside it.
                const designW = (open(n.id) > 0.5 ? FRAME_W[n.type] : FACE_W[n.type]) ?? FACE_W.feature!;
                return (
                  <div
                    key={`job:${n.id}`}
                    style={{
                      position: "absolute",
                      left: sr.x,
                      top: sr.y,
                      width: designW,
                      transform: `scale(${sr.w / designW})`,
                      transformOrigin: "0 0",
                      opacity: seen,
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
                      {list.map((j) => (
                        <JobMarker key={j.jobId} job={j} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          ) : null}

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
                go: () => cam && vp && (dropPending(), flyTo(zoomAbout(cam, 1.8, vp.w / 2, vp.h / 2, vp))),
              },
              {
                label: "−",
                title: "Zoom out",
                go: () => cam && vp && (dropPending(), flyTo(zoomAbout(cam, 1 / 1.8, vp.w / 2, vp.h / 2, vp, minZ))),
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

          {mode === "full" ? null : (
            <JamieBar
              mode={mode}
              setMode={setMode}
              send={talk}
            />
          )}

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

          {showAll && cam && vp && scene.get(STACK) ? (
            <AllInitiatives
              board={board}
              desk={desk}
              anchor={toScreen(scene.get(STACK)!.rect, cam, vp)}
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
        {/* An artifact opened from a card (or the full chat) slides in on the right, as on the chats page; the
          canvas narrows. Its own close button and Esc close it. */}
        <aside
          data-artifact-aside={artifactOpen ? "open" : "closed"}
          aria-hidden={!artifactOpen}
          inert={!artifactOpen}
          style={{
            width: artifactOpen ? ARTIFACT_W : 0,
            flexShrink: 0,
            overflow: "hidden",
            transition: "width .42s cubic-bezier(.2,.8,.2,1)",
            borderLeft: artifactOpen ? `1px solid ${v("chromeBorder")}` : "none",
            background: v("panel"),
          }}
        >
          <div
            className="bg-background text-foreground"
            style={{
              width: ARTIFACT_W,
              height: "100%",
              transform: artifactOpen ? "none" : "translateX(40px)",
              opacity: artifactOpen ? 1 : 0,
              transition: "transform .42s cubic-bezier(.2,.8,.2,1), opacity .3s",
            }}
          >
            <ArtifactPanel />
          </div>
        </aside>
      </div>
    </OnPaper.Provider>
  );
}

/** One scene node at its screen size: face or open frame, story, add slot, panel, artifact strip, or brainstorm card. */
function SceneItem({
  n,
  c,
  cam,
  vp,
  vis,
  open,
  here,
  quiet,
  busy,
  artifacts,
  folded,
  desk,
  onClick,
}: {
  n: SceneNode;
  c: CardContext;
  cam: Camera;
  vp: Viewport;
  vis: number;
  open: number;
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
  onClick: () => void;
}) {
  const sr = toScreen(n.rect, cam, vp);
  if (vis < 0.01 || !onScreen(sr, vp)) return null;
  const board = c.board;
  const loose = ["add", "artifacts", "architecture", "build", "stories", "stack"].includes(n.type);
  const q = n.type === "option" ? byId(board, n.of!) : undefined;
  // A story inside a milestone is a copy: `story@milestone`, its own id in `of`.
  const node = loose ? undefined : n.type === "option" ? q : byId(board, n.id);
  if (!loose && !node) return null;
  const grow = 0.92 + 0.08 * Math.min(1, vis * 1.5);
  const box: CSSProperties = {
    position: "absolute",
    left: sr.x,
    top: sr.y,
    width: sr.w,
    height: sr.h,
    opacity: vis,
    transform: `scale(${grow})`,
    pointerEvents: vis > 0.3 ? "auto" : "none",
  };
  const scaled = (designW: number, opacity = 1, extra?: CSSProperties): CSSProperties => ({
    position: "absolute",
    left: 0,
    top: 0,
    width: designW,
    height: (designW * sr.h) / sr.w,
    transform: `scale(${sr.w / designW})`,
    transformOrigin: "0 0",
    opacity,
    pointerEvents: opacity > 0.5 ? "auto" : "none",
    ...extra,
  });
  const dh = (w: number) => (w * sr.h) / sr.w;

  if (n.type === "artifacts") {
    const w = FRAME_W[board.nodes.find((x) => x.id === n.parent)?.type ?? "feature"] ?? 820;
    return (
      <div style={box} data-artifacts={n.parent}>
        <div
          data-wheel-scroll
          style={scaled(w, 1, { overflowY: "auto", overflowX: "hidden", colorScheme: CANVAS_THEME.scheme })}
          className="bg-transparent text-[var(--ic-ink)]"
        >
          <ChatArtifacts artifacts={artifacts ?? []} versions={NO_VERSIONS} />
        </div>
      </div>
    );
  }
  if (n.type === "architecture" || n.type === "build") {
    const f = byId(board, n.parent);
    if (!f) return null;
    const w = FACE_W[n.type]!;
    return (
      <div style={box}>
        <div style={scaled(w)}>
          {n.type === "architecture" ? (
            <ArchitectureCard f={f} w={w} h={dh(w)} />
          ) : (
            <BuildCard c={c} f={f} prs={artifacts ?? []} busy={busy} w={w} h={dh(w)} />
          )}
        </div>
      </div>
    );
  }
  if (n.type === "stack")
    return (
      <div style={{ ...box, cursor: "pointer" }} data-node={STACK} onClick={onClick}>
        <div style={scaled(FACE_W.stack!)}>
          <StackCard b={board} desk={desk} w={FACE_W.stack!} h={dh(FACE_W.stack!)} />
        </div>
      </div>
    );
  if (n.type === "stories")
    return (
      <div style={box}>
        <div style={scaled(FACE_W.stories!, 1, { height: "auto", minHeight: dh(FACE_W.stories!) })}>
          <StoriesPanel c={c} initiative={n.parent} w={FACE_W.stories!} h={dh(FACE_W.stories!)} />
        </div>
      </div>
    );
  if (n.type === "add") {
    const w = FACE_W.feature!;
    return (
      <div style={box}>
        <div style={scaled(w)}>
          <AddCard c={c} milestoneId={n.parent} w={w} h={dh(w)} />
        </div>
      </div>
    );
  }
  if (n.type === "question")
    return (
      <div
        style={{ ...box, cursor: folded ? "pointer" : "zoom-in" }}
        data-node={n.id}
        onClick={onClick}
        title={folded ? "Open this brainstorm" : "See the whole tree"}
      >
        <div style={scaled(QUESTION_W)}>
          <QuestionCard c={c} node={node!} w={QUESTION_W} h={dh(QUESTION_W)} busy={busy} folded={!!folded} />
        </div>
      </div>
    );
  if (n.type === "option") {
    const o = q!.options!.find((x) => optionKey(q!.id, x.id) === n.id)!;
    return (
      <div style={box} data-node={n.id}>
        <div style={scaled(OPTION_W)}>
          <OptionCard c={c} q={q!} o={o} w={OPTION_W} h={dh(OPTION_W)} busy={busy} />
        </div>
      </div>
    );
  }

  const faceW = FACE_W[n.type] ?? 300;
  const frameW = FRAME_W[n.type] ?? 820;
  const glowing = (c.jobs[n.id] ?? []).some((j) => j.state === "running");
  return (
    <div style={box} data-node={n.id} data-open={open.toFixed(2)}>
      <div style={{ position: "absolute", inset: 0 }}>
        {open > 0 ? (
          <div
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
            <div onClick={onClick} style={scaled(frameW, quiet ? 0 : 1, { height: (frameW * sr.h * HEADER) / sr.w })}>
              <FrameHeader c={c} node={node!} w={frameW} h={(frameW * sr.h * HEADER) / sr.w} />
            </div>
            {/* Only once its plan has come back empty, never while it's being read. */}
            {n.type !== "feature" && !node!.unread && kids(board, n.id).length === 0 ? (
              <EmptyHint node={node!} sr={sr} />
            ) : null}
          </div>
        ) : null}
        {open < 1 ? (
          <div onClick={onClick} style={scaled(faceW, 1 - open)}>
            <Face c={c} node={node!} w={faceW} h={dh(faceW)} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EmptyHint({ node, sr }: { node: PlanNode; sr: Rect }) {
  const what = node.type === "initiative" ? "milestones" : "features";
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: sr.h * HEADER,
        bottom: 0,
        display: "grid",
        placeItems: "center",
        fontFamily: TYPE,
        fontSize: Math.max(11, Math.min(22, sr.w / 50)),
        color: v("faint"),
        fontStyle: "italic",
      }}
    >
      No {what} yet. Ask Jamie, or say “add {what}”.
    </div>
  );
}

/** Road arrows between an initiative's brief and milestones, and the branches of each brainstorm tree. */
function Links({
  scene,
  board,
  cam,
  vp,
  open,
  dim,
}: {
  scene: Scene;
  board: Board;
  cam: Camera;
  vp: Viewport;
  open: (id: string) => number;
  dim: (id: string) => number;
}) {
  type Line = {
    id: string;
    d: string;
    o: number;
    style: { stroke: string; width: number; dash?: string; arrow?: boolean };
  };
  const lines: Line[] = [];
  const seen = (id: string) => visibility(scene, id, open) * dim(id);
  const road = { stroke: v("road"), width: 1.5, arrow: true };
  for (const init of board.nodes.filter((n) => n.type === "initiative")) {
    const stops = [...kids(board, init.id, "brief"), ...kids(board, init.id, "milestone")];
    stops.slice(1).forEach((m, i) => {
      const a = scene.get(stops[i].id);
      const b = scene.get(m.id);
      if (!a || !b) return;
      const ra = toScreen(a.rect, cam, vp);
      const rb = toScreen(b.rect, cam, vp);
      // Both ends must be in view: a road from a neighbour that faded out goes with it.
      const o = Math.min(seen(a.id), seen(b.id)) * 0.55;
      if (o > 0.02)
        lines.push({
          id: `${a.id}>${b.id}`,
          d: `M${ra.x + ra.w + 4} ${ra.y + ra.h / 2} L${rb.x - 6} ${rb.y + rb.h / 2}`,
          o,
          style: { ...road, dash: stops[i].type === "brief" ? "4 5" : undefined },
        });
    });
  }
  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    const k = (x2 - x1) * 0.5;
    return `M${x1} ${y1} C${x1 + k} ${y1} ${x2 - k} ${y2} ${x2} ${y2}`;
  };
  // A brainstorm tree: feature → question, question → each option, an expanded option → the question it raised.
  const optionScene = (optionId: string) => {
    const owner = board.nodes.find((n) => n.options?.some((o) => o.id === optionId));
    return owner ? scene.get(optionKey(owner.id, optionId)) : undefined;
  };
  for (const q of board.nodes.filter((n) => n.type === "question")) {
    const sq = scene.get(q.id);
    const from = q.follows ? optionScene(q.follows) : q.about ? scene.get(q.about) : undefined;
    if (!sq || !from) continue;
    const o = seen(q.id);
    if (o < 0.02) continue;
    const rq = toScreen(sq.rect, cam, vp);
    const rf = toScreen(from.rect, cam, vp);
    lines.push({
      id: `q-${q.id}`,
      d: curve(rf.x + rf.w, rf.y + rf.h / 2, rq.x, rq.y + rq.h / 2),
      o,
      style: { stroke: v("fork"), width: 1.8, dash: "3 5" },
    });
    for (const opt of q.options ?? []) {
      const so = scene.get(optionKey(q.id, opt.id));
      if (!so) continue;
      const ro = toScreen(so.rect, cam, vp);
      lines.push({
        id: `o-${q.id}-${opt.id}`,
        d: curve(rq.x + rq.w, rq.y + rq.h / 2, ro.x, ro.y + ro.h / 2),
        o: o * (q.decided && !opt.chosen ? 0.5 : 1),
        style: opt.chosen ? { stroke: v("fork"), width: 3 } : { stroke: v("fork"), width: 1.8, dash: "3 5" },
      });
      // Option -RESULTED_IN-> what choosing it made: from the chosen answer back to each card it made.
      if (!opt.chosen) continue;
      for (const made of board.nodes.filter((x) => x.madeBy?.includes(opt.id))) {
        const sm = scene.get(made.id);
        if (!sm || seen(made.id) < 0.02) continue;
        const rm = toScreen(sm.rect, cam, vp);
        const x1 = ro.x;
        const y1 = ro.y + ro.h * 0.7;
        const x2 = rm.x + rm.w;
        const y2 = rm.y + rm.h / 2;
        lines.push({
          id: `r-${opt.id}-${made.id}`,
          d: `M${x1} ${y1} C${x1 - 80} ${y1 + 40} ${x2 + 80} ${y2} ${x2 + 4} ${y2}`,
          o: Math.min(o, seen(made.id)) * 0.8,
          style: { stroke: v("fork"), width: 2, dash: "8 5", arrow: true },
        });
      }
    }
  }
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
      {lines.map((l) => (
        <path
          key={l.id}
          d={l.d}
          fill="none"
          stroke={l.style.stroke}
          strokeOpacity={l.o}
          strokeWidth={l.style.width}
          strokeDasharray={l.style.dash}
          markerEnd={l.style.arrow ? (l.style.stroke === v("fork") ? "url(#icb-fork)" : "url(#icb-arrow)") : undefined}
        />
      ))}
    </svg>
  );
}

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
