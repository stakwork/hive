import type { Board } from "./board";
import { isPendingId } from "./board";
import { optionKey, type Camera, type Rect, type Scene, type Viewport } from "./scene";

/**
 * Live arrivals: cards the realtime feed adds while you're looking at the canvas. Pure logic; the hook that
 * runs it and the CSS that plays it live beside it (`useLiveArrivals.ts`, `icb-arrive` in InfiniteCanvas).
 *
 * "New" is a diff of data ids (board cards and brainstorm answers) against what the last call saw, so a
 * refetch with the same ids is nothing, and opening a tree or scrolling never makes a card arrive.
 */

/** Most cards animating at once; the rest of a burst just appear. */
export const MAX_ARRIVALS = 12;
/** Each arrival starts this much after the one before it. */
export const STAGGER_MS = 60;
/** Fade-in (400ms) then the highlight fading out (2.2s, starting at 400ms). */
export const ARRIVE_MS = 2600;
const ORG_SCOPE = "org";

export interface ArrivalNode {
  id: string;
  type: string;
  /** What holds it, whose data is read as a whole (an initiative's plan, a brainstorm tree). */
  scope: string;
  /** Where it is in the world now; null when this level or an unopened tree doesn't draw it. */
  rect: Rect | null;
  /** Drawn at the current level (not faded out by a level blend). Default true. */
  shown?: boolean;
}

export interface ArrivalMemory {
  seen: ReadonlySet<string>;
  /** Scopes whose data hadn't been read yet at that call. */
  unloaded: ReadonlySet<string>;
  /** Optimistic cards that were on the canvas, by id. */
  pending: ReadonlyMap<string, { scope: string; type: string }>;
}

export interface ArrivalInput {
  prev: ArrivalMemory | null;
  nodes: ArrivalNode[];
  /** Scopes whose data isn't read yet: their first cards are a load, not an arrival. */
  unloaded?: ReadonlySet<string>;
  /** The board has finished its first load. */
  ready: boolean;
  /** The world rect on screen; null when the camera isn't known (everything counts as off view). */
  view: Rect | null;
  /** Ids the user's own saves created. */
  own?: ReadonlySet<string>;
  /** Animations still playing, which count against the cap. */
  active?: number;
}

export interface ArrivalResult {
  inView: Array<{ id: string; delayMs: number }>;
  offView: string[];
  /** Arrived in view past the cap: shown without animation. */
  overflow: string[];
  next: ArrivalMemory;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The world rect the camera shows. */
export const viewRect = (cam: Camera, vp: Viewport): Rect => ({
  x: cam.cx - vp.w / 2 / cam.z,
  y: cam.cy - vp.h / 2 / cam.z,
  w: vp.w / cam.z,
  h: vp.h / cam.z,
});

export function computeArrivals(input: ArrivalInput): ArrivalResult {
  const { prev, nodes, ready, view, own, active = 0 } = input;
  const unloaded = input.unloaded ?? new Set<string>();
  const seen = new Set<string>();
  const pending = new Map<string, { scope: string; type: string }>();
  for (const n of nodes) {
    if (isPendingId(n.id)) pending.set(n.id, { scope: n.scope, type: n.type });
    else seen.add(n.id);
  }
  const next: ArrivalMemory = { seen, unloaded, pending };
  const none: ArrivalResult = { inView: [], offView: [], overflow: [], next };
  // The first board with data is the baseline, whatever it holds.
  if (!ready || !prev) return none;

  // A saved card replaces the user's own optimistic one: a vanished pending card of the same kind and scope.
  const replaced = [...prev.pending].filter(([id]) => !pending.has(id));
  const fresh: ArrivalNode[] = [];
  for (const n of nodes) {
    if (isPendingId(n.id) || prev.seen.has(n.id) || own?.has(n.id)) continue;
    const at = replaced.findIndex(([, p]) => p.scope === n.scope && p.type === n.type);
    if (at >= 0) {
      replaced.splice(at, 1);
      continue;
    }
    // Its scope must already have been on the canvas and read: opening a plan or a tree is a load.
    const known = n.scope === ORG_SCOPE || prev.seen.has(n.scope) || prev.pending.has(n.scope);
    if (!known || unloaded.has(n.scope) || prev.unloaded.has(n.scope)) continue;
    fresh.push(n);
  }

  const seeable = (n: ArrivalNode) => !!view && !!n.rect && n.shown !== false && overlaps(n.rect, view);
  const inside = fresh
    .filter(seeable)
    .sort((a, b) => a.rect!.y - b.rect!.y || a.rect!.x - b.rect!.x || (a.id < b.id ? -1 : 1));
  const room = Math.max(0, MAX_ARRIVALS - active);
  return {
    inView: inside.slice(0, room).map((n, i) => ({ id: n.id, delayMs: i * STAGGER_MS })),
    offView: fresh.filter((n) => !seeable(n)).map((n) => n.id),
    overflow: inside.slice(room).map((n) => n.id),
    next,
  };
}

/** Every data card on the board (and answer of an open question) as an arrival candidate, placed by the scene. */
export function arrivalNodesOf(board: Board, scene: Scene, shown: (id: string) => boolean = () => true): ArrivalNode[] {
  const out: ArrivalNode[] = [];
  const add = (id: string, type: string, scope: string) => {
    const s = scene.get(id);
    out.push({ id, type, scope, rect: s?.rect ?? null, shown: s ? shown(id) : false });
  };
  for (const n of board.nodes) {
    // A brainstorm's questions all come from reading its tree, so they're scoped to it (the root's own scope is itself).
    add(n.id, n.type, n.type === "question" ? (n.root ?? n.id) : (n.parent ?? ORG_SCOPE));
    for (const o of n.options ?? []) add(optionKey(n.id, o.id), "option", n.root ?? n.id);
  }
  return out;
}

/** Scopes not read yet: initiatives with only their summary, brainstorm roots whose tree hasn't come back. */
export function unloadedScopes(board: Board, unreadRoots: Iterable<string> = []): Set<string> {
  const out = new Set<string>(unreadRoots);
  for (const n of board.nodes) if (n.unread) out.add(n.id);
  return out;
}
