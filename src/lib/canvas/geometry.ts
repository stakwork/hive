/**
 * Shared canvas geometry — single source of truth for card dimensions
 * and row layout.
 *
 * Both the renderer (`canvas-theme.ts` on the client) and the
 * projectors (`projectors.ts` on the server) need to know how big each
 * category's card is — the renderer to set `defaultWidth` /
 * `defaultHeight`, the projectors to space cards out so they don't
 * overlap on first render. Keeping the values here means a width
 * tweak ripples through both layers automatically.
 *
 * Pure constants only. NO React, NO system-canvas runtime imports —
 * this module is loaded by the server-side projector pipeline.
 */

// ---------------------------------------------------------------------------
// Card sizes — keyed by category. Widths cascade into row steps below.
// ---------------------------------------------------------------------------

/** Standard "container" card width (workspaces). */
export const CARD_W = 240;
/** Standard "container" card height. */
export const CARD_H = 104;

/** Compact card width (repositories, milestones, notes, decisions). */
export const SMALL_W = 220;

/**
 * Initiative card. Wider than the container card so the gradient
 * "vision-style" title rendered in the body slot has room to breathe.
 */
export const INITIATIVE_W = 300;
export const INITIATIVE_H = 116;

/** Milestone card on the initiative timeline. */
export const MILESTONE_W = SMALL_W;
export const MILESTONE_H = 88;

// ---------------------------------------------------------------------------
// Row layout — each row's `STEP` derives from its card's width plus a
// fixed gap so cards never overlap regardless of width tweaks.
// ---------------------------------------------------------------------------

/**
 * Horizontal padding between adjacent cards in a default-projected
 * row. 20px reads as "comfortably grouped" without making the row
 * sprawl. Used everywhere; if you want a different gap somewhere,
 * add a named override rather than special-casing inline.
 */
export const ROW_GAP = 20;

/** Workspace row sits at the top of the org root canvas. */
export const WORKSPACE_ROW_Y = 40;
export const WORKSPACE_ROW_X0 = 40;
export const WORKSPACE_ROW_STEP = CARD_W + ROW_GAP;

/** Initiative row sits one band below workspaces on the root canvas. */
export const INITIATIVE_ROW_Y = 220;
export const INITIATIVE_ROW_X0 = 40;
export const INITIATIVE_ROW_STEP = INITIATIVE_W + ROW_GAP;

/** Repo row on a workspace's sub-canvas. */
export const REPO_ROW_Y = 40;
export const REPO_ROW_X0 = 40;
export const REPO_ROW_STEP = SMALL_W + ROW_GAP;

/** Milestone timeline on an initiative's sub-canvas. */
export const MILESTONE_ROW_Y = 80;
export const MILESTONE_ROW_X0 = 40;
export const MILESTONE_ROW_STEP = MILESTONE_W + ROW_GAP;

/**
 * Width of each column band on the milestone timeline (Past Due,
 * This Quarter, Next Quarter, Later). The bands are decorative
 * background chrome — milestone cards never snap to them. We pick a
 * width that comfortably fits 1-2 milestone cards side-by-side so a
 * busy column reads as "occupied" without forcing horizontal scroll
 * past 4 × 460 = 1840px (a typical laptop viewport at zoom 1.0).
 */
export const TIMELINE_COL_W = 460;
export const TIMELINE_COL_X0 = 0;
/** First-render y-band for the column header strip. */
export const TIMELINE_HEADER_Y = 0;
