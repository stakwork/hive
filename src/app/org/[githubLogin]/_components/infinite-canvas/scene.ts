/**
 * The scene, in world units, with no rendering: where every card sits, which
 * cards show at the level you've clicked into, and the camera moves.
 * Containers nest (org ⊃ initiative ⊃ milestone ⊃ feature), so a level is a
 * place: clicking a card opens it and flies there; zooming only moves the
 * camera, it never changes the level. An initiative holds the why and every
 * user journey; a milestone holds its features; a feature holds the build. Brainstorms grow as trees off the
 * right of whichever card they're about.
 */

import { type Board, type NodeType, type PlanNode, brainstormsOn, byId, followUpTo, kids, upOf } from "./board";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * "add": the "+ Add user story" / "+ Add feature" slot after a milestone's
 * stories or features. "option": one answer of a brainstorm question.
 * "artifacts": what jobs returned for a container, in a strip under it.
 * "architecture", "build": a feature's panels. "stories": an initiative's
 * journeys and requirements. "stack": the initiatives not on the desk.
 */
export type SceneKind = NodeType | "option" | "add" | "artifacts" | "architecture" | "build" | "stories" | "stack";

export interface SceneNode {
  id: string;
  type: SceneKind;
  rect: Rect;
  /** The node plus its brainstorm trees and artifacts: what a dive frames. */
  group: Rect;
  /** Scene parent: the container whose level shows this node ("org" at the top). */
  parent: string;
  /** Answers: their question. Add slots: what they add ("feature"). */
  of?: string;
}

export interface Camera {
  /** World point at the centre of the view. */
  cx: number;
  cy: number;
  /** Screen px per world unit. */
  z: number;
}

export interface Viewport {
  w: number;
  h: number;
}

export type Scene = Map<string, SceneNode>;

export const ORG = "org";
export const STACK = "stack";
export const CONTAINERS: SceneKind[] = ["initiative", "milestone", "feature"];

const ASPECT: Partial<Record<SceneKind, number>> = {
  initiative: 2.4,
  milestone: 1.6,
  brief: 1.6,
  feature: 1.6,
  story: 0.9,
  add: 0.9,
};
/** Header band of an open container, as a share of its height. */
export const HEADER = 0.2;
const GAP = 0.04;
const ISLAND_W = 2400;
/** Width the user stories panel is laid out at before it is scaled to its place on the card. */
export const STORIES_W = 1500;

/**
 * The height (at `STORIES_W`) an initiative's user stories panel needs: its chrome, then each story's wrapped lines
 * and each requirement's. Generous on characters per line, so the card's frame is never shorter than the panel.
 */
function storiesHeight(b: Board, initiative: string): number {
  const LINE = 18;
  const lines = (text: string, perLine: number) => Math.max(1, Math.ceil(text.length / perLine));
  let h = 24 + 16 + 8 + 4 + 22 + 8; // padding, header, gaps, the "add user story" row
  for (const st of kids(b, initiative, "story")) {
    h += lines(st.name, 160) * LINE + 4 + 22 + 2 + 12; // text, gap, the "add requirement" row, list gap
    for (const r of kids(b, st.id, "requirement")) h += lines(r.name, 135) * LINE + 6 + 2;
  }
  return h;
}

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/** The scene id of an answer card: answers are only unique within their question. */
export const optionKey = (questionId: string, optionId: string) => `${questionId}/${optionId}`;
/** A story shown inside a milestone: a story can be in scope for several, so each milestone has its own copy. */
export const addKey = (what: "feature", milestoneId: string) => `add:${what}:${milestoneId}`;
export const panelKey = (kind: "architecture" | "build" | "stories" | "artifacts", id: string) => `${kind}:${id}`;

/**
 * Which brainstorm on each card is open, by card id. A card with several
 * shows one tree at a time; the rest fold to their question. Unset means the
 * newest.
 */
export type OpenTrees = Record<string, string>;

/** The brainstorm open on a card: the one picked, else the newest. */
export function openTree(b: Board, id: string, open: OpenTrees): string | undefined {
  const roots = brainstormsOn(b, id);
  return roots.find((q) => q.id === open[id])?.id ?? roots[roots.length - 1]?.id;
}

/** What laying out the scene reads besides the board. */
interface Ctx {
  b: Board;
  out: Scene;
  /** How many artifacts jobs returned on a container. */
  artifacts: (id: string) => number;
  open: OpenTrees;
}

/**
 * A card's brainstorms as trees growing to its right: a question, its answers
 * in a column beyond it, and the question an expanded answer raised beyond
 * that. Only the open tree shows its branches. An initiative is so wide that
 * its trees use a smaller unit (`scale`).
 */
function brainstorms(ctx: Ctx, f: Rect, id: string, scale: number): Rect {
  const { b, out } = ctx;
  const roots = brainstormsOn(b, id);
  if (!roots.length) return f;
  const openId = openTree(b, id, ctx.open);
  const u = { w: f.w * scale, h: (f.w * scale) / 1.6 };
  const qw = u.w * 0.28;
  const qh = u.h * 0.28;
  const ow = u.w * 0.34;
  const oh = u.h * 0.3;
  const og = u.h * 0.04;
  const gx = u.w * 0.08;
  // A root keeps room for three answers and a follow-up for two, so answers arriving one by one don't move the tree.
  const treeH = (q: PlanNode, min: number): number => {
    const os = q.options ?? [];
    const sum = os.reduce((acc, o) => acc + optH(o.id) + og, 0) - og;
    return Math.max(qh, sum, min * (oh + og) - og);
  };
  const optH = (optionId: string): number => {
    const fu = followUpTo(b, optionId);
    return Math.max(oh, fu ? treeH(fu, 2) : 0);
  };
  // What entering the card frames: the card and the first column of each tree. Deeper branches run off to the
  // right; clicking a question frames its whole tree.
  let group = f;
  let tree: Rect = f;
  const place = (q: PlanNode, x: number, top: number, min: number, depth: number) => {
    const h = treeH(q, min);
    // Top-aligned: a card is placed from its parent's top, so answers arriving or a branch opening never move it.
    const qr = { x, y: top, w: qw, h: qh };
    out.set(q.id, { id: q.id, type: "question", rect: qr, group: qr, parent: id });
    if (depth === 0) group = union(group, qr);
    tree = union(tree, qr);
    let y = top;
    for (const o of q.options ?? []) {
      const band = optH(o.id);
      const r = { x: x + qw + gx, y, w: ow, h: oh };
      const key = optionKey(q.id, o.id);
      out.set(key, { id: key, type: "option", rect: r, group: r, parent: id, of: q.id });
      if (depth === 0) group = union(group, r);
      tree = union(tree, r);
      const fu = followUpTo(b, o.id);
      if (fu) place(fu, x + qw + gx + ow + gx, y, 2, depth + 1);
      y += band + og;
    }
    if (depth === 0) group = union(group, { x, y: top, w: 1, h });
  };
  const gap = u.h * 0.08;
  const height = (q: PlanNode) => (q.id === openId ? treeH(q, 3) : qh);
  // The first tree starts at a fixed place (centred on room for three answers), whatever is open or answered.
  let y = f.y + f.h / 2 - (3 * (oh + og) - og) / 2;
  for (const q of roots) {
    tree = { x: f.x + f.w + gx, y, w: 1, h: 1 };
    if (q.id === openId) place(q, f.x + f.w + gx, y, 3, 0);
    else {
      // Folded: just the question card, which says how many answers it has and what was decided.
      const qr = { x: f.x + f.w + gx, y, w: qw, h: qh };
      out.set(q.id, { id: q.id, type: "question", rect: qr, group: qr, parent: id });
      group = union(group, qr);
      tree = qr;
    }
    const root = out.get(q.id)!;
    out.set(q.id, { ...root, group: tree });
    y += height(q) + gap;
  }
  return group;
}

/** What jobs returned for a container, in a strip just under it. */
function strip(out: Scene, f: Rect, id: string, artifacts: number): Rect {
  if (!artifacts) return f;
  // Grows with the artifacts (about two to a screenful) so none is cut off; it scrolls past that.
  const r = { x: f.x, y: f.y + f.h + f.h * 0.04, w: f.w, h: f.h * 0.22 * Math.max(1, artifacts / 2) };
  const key = panelKey("artifacts", id);
  out.set(key, { id: key, type: "artifacts", rect: r, group: r, parent: id });
  return union(f, r);
}

/**
 * Lay children left to right in `content`. At least `minSlots` slots, so the
 * first few children never move when another is added. A container is laid
 * out inside itself.
 */
function row(
  ctx: Ctx,
  parent: string,
  content: Rect,
  children: { id: string; type: SceneKind; of?: string }[],
  minSlots: number,
) {
  const { b, out } = ctx;
  const slots = Math.max(minSlots, children.length);
  const slotW = content.w / slots;
  children.forEach((c, i) => {
    const aspect = c.of === "feature" ? 1.6 : (ASPECT[c.type] ?? 1.6);
    let w = slotW * (1 - GAP * 2);
    let h = w / aspect;
    if (h > content.h * 0.94) {
      h = content.h * 0.94;
      w = h * aspect;
    }
    const rect = { x: content.x + slotW * i + (slotW - w) / 2, y: content.y + (content.h - h) / 2, w, h };
    // Set first so a container is drawn before (under) what hangs off it.
    out.set(c.id, { id: c.id, type: c.type, rect, group: rect, parent, ...(c.of ? { of: c.of } : {}) });
    if (!CONTAINERS.includes(c.type)) return;
    const inner = { x: rect.x + w * 0.02, y: rect.y + h * HEADER, w: w * 0.96, h: h * (1 - HEADER) - h * 0.03 };
    // An initiative's frame grows down to hold its whole stories panel, however many stories and lines there are.
    const storiesRect =
      c.type === "initiative"
        ? {
            x: inner.x + inner.w * 0.01,
            y: inner.y + inner.h * 0.62,
            w: inner.w * 0.98,
            h: Math.max(inner.h * 0.36, (storiesHeight(b, c.id) * inner.w * 0.98) / STORIES_W),
          }
        : undefined;
    const frame = storiesRect ? { ...rect, h: Math.max(h, storiesRect.y + storiesRect.h + h * 0.03 - rect.y) } : rect;
    const trees = brainstorms(ctx, rect, c.id, c.type === "initiative" ? 0.3 : 1);
    const group = union(union(trees, frame), strip(out, frame, c.id, ctx.artifacts(c.id)));
    out.set(c.id, { id: c.id, type: c.type, rect: frame, group, parent });
    const panel = (kind: "architecture" | "build" | "stories", r: Rect) =>
      out.set(panelKey(kind, c.id), { id: panelKey(kind, c.id), type: kind, rect: r, group: r, parent: c.id });
    if (c.type === "initiative") {
      // The road across the top (brief, then milestones in order); every user journey and its requirements below.
      row(ctx, c.id, { ...inner, h: inner.h * 0.6 }, [...kids(b, c.id, "brief"), ...kids(b, c.id, "milestone")], 4);
      panel("stories", storiesRect!);
      return;
    }
    if (c.type === "milestone") {
      // Its features. The stories and requirements live on the initiative.
      row(
        ctx,
        c.id,
        { ...inner, y: inner.y + inner.h * 0.2, h: inner.h * 0.6 },
        [...kids(b, c.id, "feature"), { id: addKey("feature", c.id), type: "add", of: "feature" }],
        4,
      );
      return;
    }
    // A feature: how it's built across the top; its jobs and their pull requests below.
    const g = inner.w * 0.02;
    const top = { x: inner.x + g / 2, y: inner.y, w: inner.w - g, h: inner.h * 0.5 };
    panel("architecture", top);
    panel("build", { x: top.x, y: inner.y + inner.h * 0.53, w: top.w, h: inner.h * 0.47 });
  });
}

/**
 * Every card's place in the world, deterministic from the board. The desk
 * holds the initiatives in `desk` (the latest few, plus any pulled in), in a
 * row; the rest wait in a stack after them. `artifacts` counts what jobs
 * returned on a container (a strip under it); `open` says which brainstorm
 * each card shows unfolded.
 */
export function layoutScene(
  b: Board,
  desk: string[],
  opts: { artifacts?: (id: string) => number; open?: OpenTrees } = {},
): Scene {
  const ctx: Ctx = {
    b,
    out: new Map(),
    artifacts: opts.artifacts ?? (() => 0),
    open: opts.open ?? {},
  };
  const all = b.nodes.filter((n) => n.type === "initiative");
  const islands = desk.map((id) => all.find((n) => n.id === id)).filter((n): n is PlanNode => !!n);
  const slot = ISLAND_W * (1 + GAP * 2);
  const h = ISLAND_W / 2.4 / 0.94;
  row(ctx, ORG, { x: 0, y: 0, w: slot * Math.max(1, islands.length), h }, islands, 1);
  if (islands.length < all.length) {
    // The stack: a pile of the initiatives not on the desk, one tap from the full list.
    const r = {
      x: slot * Math.max(1, islands.length) + ISLAND_W * 0.04,
      y: h * 0.03,
      w: ISLAND_W * 0.5,
      h: (ISLAND_W / 2.4) * 0.94,
    };
    ctx.out.set(STACK, { id: STACK, type: "stack", rect: r, group: r, parent: ORG });
  }
  return ctx.out;
}

/** The whole org: everything on the desk and the stack. A blank board frames one initiative's worth of room. */
export function orgRect(scene: Scene): Rect {
  const tops = [...scene.values()].filter((n) => n.parent === ORG).map((n) => n.group);
  return tops.length ? tops.reduce(union) : { x: 0, y: 0, w: ISLAND_W, h: ISLAND_W / 2.4 };
}

/** Scene ancestors, outermost first, ending with `id`. */
export function chain(scene: Scene, id: string): string[] {
  const n = scene.get(id);
  if (!n) return [];
  return n.parent === ORG ? [id] : [...chain(scene, n.parent), id];
}

/** The containers open at a level: the level and everything above it. */
export const openAt = (scene: Scene, level: string) => (level === ORG ? [] : chain(scene, level));

/** How open each container is, 0–1; the canvas blends two levels while it flies between them. */
export type Openness = (id: string) => number;

/** How present a node is: every scene parent must be open. */
export function visibility(scene: Scene, id: string, open: Openness): number {
  const n = scene.get(id);
  if (!n) return 0;
  if (n.parent === ORG) return 1;
  return visibility(scene, n.parent, open) * open(n.parent);
}

/** Outside the level you're in, things vanish, so its brainstorms have room to branch over the neighbours. */
export function focusWeight(scene: Scene, id: string, level: string): number {
  if (level === ORG) return 1;
  if (chain(scene, id).includes(level) || openAt(scene, level).includes(id)) return 1;
  return 0;
}

/**
 * Where a card lives as a level: it walks up to its container (a story,
 * requirement or brief opens its initiative, a brainstorm the card it's about).
 */
export function levelFor(scene: Scene, b: Board, id: string): string {
  let cur: string | undefined = id;
  for (let i = 0; cur && i < 20; i++) {
    const s = scene.get(cur);
    if (s && CONTAINERS.includes(s.type)) return cur;
    const n = byId(b, cur);
    cur = (n && upOf(b, n)) ?? s?.parent;
  }
  return ORG;
}

export const toScreen = (r: Rect, cam: Camera, vp: Viewport): Rect => ({
  x: (r.x - cam.cx) * cam.z + vp.w / 2,
  y: (r.y - cam.cy) * cam.z + vp.h / 2,
  w: r.w * cam.z,
  h: r.h * cam.z,
});

export const toWorld = (sx: number, sy: number, cam: Camera, vp: Viewport) => ({
  x: (sx - vp.w / 2) / cam.z + cam.cx,
  y: (sy - vp.h / 2) / cam.z + cam.cy,
});

/** Screen space the canvas chrome covers (breadcrumb on top, Jamie below). */
export interface Insets {
  top: number;
  bottom: number;
}
const NONE: Insets = { top: 0, bottom: 0 };

/** Frame a rect with a margin, in the part of the view the chrome leaves free. */
export function fit(r: Rect, vp: Viewport, margin = 0.9, inset: Insets = NONE): Camera {
  const z = Math.min((vp.w * margin) / r.w, ((vp.h - inset.top - inset.bottom) * margin) / r.h);
  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2 - (inset.top - inset.bottom) / 2 / z, z };
}

/** Fly to a level: frame it with its brainstorms and artifacts. */
export const diveTo = (n: SceneNode, vp: Viewport, inset: Insets = NONE) => fit(n.group, vp, 0.92, inset);

export const MIN_Z = 0.03;
export const MAX_Z = 30;

/** Zoom by `factor` keeping the world point under (sx, sy) still. */
export function zoomAbout(cam: Camera, factor: number, sx: number, sy: number, vp: Viewport, minZ = MIN_Z): Camera {
  const z = Math.min(MAX_Z, Math.max(minZ, cam.z * factor));
  const p = toWorld(sx, sy, cam, vp);
  return { cx: p.x - (p.x - cam.cx) * (cam.z / z), cy: p.y - (p.y - cam.cy) * (cam.z / z), z };
}

/**
 * Between two cameras: zoom geometrically about the one world point that
 * stays put on screen, so a dive reads as moving toward the thing, not
 * sliding past it.
 */
export function between(a: Camera, b: Camera, u: number): Camera {
  const z = Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * u);
  if (Math.abs(b.z - a.z) / a.z < 0.02) return { cx: a.cx + (b.cx - a.cx) * u, cy: a.cy + (b.cy - a.cy) * u, z };
  const px = (b.cx * b.z - a.cx * a.z) / (b.z - a.z);
  const py = (b.cy * b.z - a.cy * a.z) / (b.z - a.z);
  return { cx: px - (px - a.cx) * (a.z / z), cy: py - (py - a.cy) * (a.z / z), z };
}
