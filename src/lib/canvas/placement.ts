/**
 * Resolve an agent-supplied `Placement` string into an `{ x, y }`
 * overlay for `Canvas.data.positions[liveId]`.
 *
 * Why this module exists: agent-proposed initiatives, features, and
 * milestones can carry a layout hint like `right-of:feature:cmoti7…`
 * or `below:milestone:cmnxk2…`. We deliberately don't let the agent
 * emit raw pixel coordinates — LLMs are bad at picking non-overlapping
 * slots and the projector's geometry would drift behind any prompt
 * we wrote. Instead, the agent picks a verb plus a live anchor it
 * saw in `read_canvas`, and this module does the pixel math using
 * `geometry.ts` (the same source of truth the projector uses).
 *
 * **Forgiving by design.** Any failure mode — anchor missing on the
 * target canvas, anchor on the wrong canvas, slot collides with an
 * existing card, malformed verb — returns `null`, which the caller
 * (`handleApproval`) treats as "no overlay; let auto-layout decide."
 * We log the fallback so we can tune the prompt; we never fail an
 * approval over a layout hint.
 *
 * `near` is intentionally an alias for `right-of`. Both are the
 * friendly verbs the LLM reaches for first; we collapse them to a
 * deterministic direction so the result is predictable. If "find
 * the nearest free slot in any direction" becomes useful later, it
 * goes here without changing the agent surface.
 *
 * NOT exported: collision logic, geometry-derived gaps, or anything
 * else pixel-y. The single export is `resolvePlacement` — pixels
 * never leave this module.
 */
import { readCanvas } from "./io";
import {
  CARD_W,
  CARD_H,
  ROW_GAP,
  INITIATIVE_W,
  INITIATIVE_H,
  MILESTONE_W,
  MILESTONE_H,
  FEATURE_W,
  FEATURE_H,
  SMALL_W,
  RESEARCH_W,
  RESEARCH_H,
} from "./geometry";
import type { Placement } from "@/lib/proposals/types";
import type { CanvasNode } from "./types";

/**
 * Vertical gap between stacked rows. Larger than `ROW_GAP` because
 * a "new row beneath" implies a visual band break, not just inter-card
 * spacing within a row.
 */
const VERTICAL_GAP = 40;

interface Dims {
  w: number;
  h: number;
}

/**
 * Resolve a category to its rendered card dimensions. The default
 * (260×100, the feature-card size) is used for any authored category
 * we don't recognize — notes, decisions, etc. all currently render at
 * that size or smaller, and we'd rather over-estimate than under-
 * estimate when checking for collisions.
 *
 * Accepts `undefined` because `CanvasNode.category` is optional in
 * the system-canvas type — defaults to the fallback dimensions.
 */
function dimsForCategory(c: string | undefined): Dims {
  switch (c) {
    case "workspace":
      return { w: CARD_W, h: CARD_H };
    case "initiative":
      return { w: INITIATIVE_W, h: INITIATIVE_H };
    case "milestone":
      return { w: MILESTONE_W, h: MILESTONE_H };
    case "feature":
      return { w: FEATURE_W, h: FEATURE_H };
    case "repository":
      return { w: SMALL_W, h: CARD_H };
    case "research":
      return { w: RESEARCH_W, h: RESEARCH_H };
    default:
      return { w: FEATURE_W, h: FEATURE_H };
  }
}

export interface PlacementContext {
  orgId: string;
  /**
   * Canvas the new node will project on. Determined by the caller —
   * for initiatives that's `ROOT_REF`; for milestones it's their
   * parent initiative's canvas; for features it's the most-specific
   * canvas the feature renders on (initiative if anchored, else
   * workspace).
   */
  targetRef: string;
  /**
   * Category of the new node. Drives the candidate slot's own
   * dimensions for the offset math and collision check.
   */
  newCategory: "initiative" | "feature" | "milestone";
}

const PLACEMENT_RE = /^(near|above|below|left-of|right-of):(.+)$/;

/**
 * Resolve a placement hint to an `{ x, y }` overlay. Returns `null`
 * (with a logged warning) on any unresolvable input — caller falls
 * back to projector auto-layout.
 *
 * The function reads the target canvas once via `readCanvas`, which
 * is the same path the renderer uses, so the anchor's coordinates
 * include any user-saved overlay. That's what we want: "right-of the
 * auth feature" should mean "right of where the auth feature
 * actually sits today," not "right of where the projector would
 * default-place it."
 */
export async function resolvePlacement(
  placement: Placement | undefined,
  ctx: PlacementContext,
): Promise<{ x: number; y: number } | null> {
  if (!placement || placement === "auto") return null;

  const m = placement.match(PLACEMENT_RE);
  // The regex requires both groups to match, but TS narrows to
  // `string | undefined` either way — guard explicitly so the rest
  // of the function works with non-nullable strings.
  if (!m || !m[1] || !m[2]) {
    console.warn(
      "[placement] malformed placement:",
      placement,
      "→ falling back to auto",
    );
    return null;
  }

  const verb = m[1] as
    | "near"
    | "above"
    | "below"
    | "left-of"
    | "right-of";
  const anchorId = m[2];

  let canvas;
  try {
    canvas = await readCanvas(ctx.orgId, ctx.targetRef);
  } catch (e) {
    console.warn(
      "[placement] readCanvas failed for",
      ctx.targetRef,
      "→ falling back to auto:",
      e,
    );
    return null;
  }

  // `CanvasData.nodes` is optional in the system-canvas type. An
  // empty/undefined node list just means "no anchor candidates" —
  // bail to auto.
  const nodes = canvas.nodes ?? [];
  const anchor = nodes.find((n) => n.id === anchorId);
  if (!anchor) {
    console.warn(
      "[placement] anchor",
      anchorId,
      "not found on",
      ctx.targetRef || "<root>",
      "→ falling back to auto",
    );
    return null;
  }

  const newDims = dimsForCategory(ctx.newCategory);
  const anchorDims = dimsForCategory(anchor.category);

  const candidate = computeCandidate(verb, anchor, anchorDims, newDims);

  if (collides(candidate, newDims, nodes, anchorId)) {
    console.warn(
      "[placement] candidate slot collides with existing nodes on",
      ctx.targetRef || "<root>",
      "verb:",
      verb,
      "anchor:",
      anchorId,
      "→ falling back to auto",
    );
    return null;
  }

  return candidate;
}

function computeCandidate(
  verb: "near" | "above" | "below" | "left-of" | "right-of",
  anchor: CanvasNode,
  anchorDims: Dims,
  newDims: Dims,
): { x: number; y: number } {
  switch (verb) {
    // `near` is an alias of `right-of`: same row, to the right.
    // Picking a deterministic direction keeps the agent's output
    // predictable; "nearest free slot in any direction" can be a
    // later enrichment without changing the surface.
    case "near":
    case "right-of":
      return { x: anchor.x + anchorDims.w + ROW_GAP, y: anchor.y };
    case "left-of":
      return { x: anchor.x - newDims.w - ROW_GAP, y: anchor.y };
    case "below":
      return { x: anchor.x, y: anchor.y + anchorDims.h + VERTICAL_GAP };
    case "above":
      return { x: anchor.x, y: anchor.y - newDims.h - VERTICAL_GAP };
  }
}

/**
 * Axis-aligned bounding-box collision check between the candidate
 * slot and every existing node on the canvas. We exclude the anchor
 * itself from the check (it's allowed to "touch" — `right-of:X`
 * lands at `X.right + ROW_GAP`, which by construction doesn't
 * overlap, but the math is cleaner if we don't have to special-case
 * floating-point zero-area intersections).
 */
function collides(
  rect: { x: number; y: number },
  dims: Dims,
  nodes: CanvasNode[],
  anchorId: string,
): boolean {
  const a = {
    x1: rect.x,
    y1: rect.y,
    x2: rect.x + dims.w,
    y2: rect.y + dims.h,
  };
  for (const n of nodes) {
    if (n.id === anchorId) continue;
    const d = dimsForCategory(n.category);
    const b = {
      x1: n.x,
      y1: n.y,
      x2: n.x + d.w,
      y2: n.y + d.h,
    };
    const overlaps =
      a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
    if (overlaps) return true;
  }
  return false;
}
