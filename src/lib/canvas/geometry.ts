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

/** Compact card width (repositories, notes, decisions). */
export const SMALL_W = 220;

/**
 * Initiative card. Wider than the container card so the gradient
 * "vision-style" title rendered in the body slot has room to breathe.
 */
export const INITIATIVE_W = 300;
export const INITIATIVE_H = 116;

/**
 * Milestone card on the initiative timeline. Same width as the
 * Initiative card so milestones read as "as substantial as the
 * strategic frame they belong to" rather than as small repo-style
 * chips. Distinguishes them from Feature cards (260) at a glance
 * without relying on color alone. Height is deliberately compact
 * (kicker + title + progress bar; no on-card footer) so a row of
 * milestones reads as a horizontal timeline strip rather than a
 * grid of equally-weighted cards.
 */
export const MILESTONE_W = INITIATIVE_W;
export const MILESTONE_H = 74;

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

// ---------------------------------------------------------------------------
// Feature card sizing — used by the renderer (`canvas-theme.ts`) for
// default width/height regardless of which canvas the feature sits on.
//
// Features render as cards on the workspace sub-canvas (loose) and on
// the initiative sub-canvas (initiative-anchored, with or without a
// milestone). There is no separate milestone sub-canvas — milestone
// membership is shown via projector-emitted synthetic edges.
// ---------------------------------------------------------------------------

/** Feature card width — wider than the small/repo card so the title
 *  has room to breathe alongside its task counter. */
export const FEATURE_W = 260;
export const FEATURE_H = 100;

/** Task card sizing — kept as defaults in case a future surface
 *  surfaces tasks visually, even though tasks no longer project on the
 *  org canvas. The renderer's category registry references these
 *  constants directly. */
export const TASK_W = 180;
export const TASK_H = 64;

// ---------------------------------------------------------------------------
// Feature placement — features render on workspace or initiative
// canvases. On workspace they sit in a row under the repo row; on
// initiative they sit in a row under the milestone timeline. Sits
// well below the scope's primary band so the default first-render
// lands in empty space rather than colliding with the primaries.
//
// The user can drag freely after creation (position overlay survives);
// these defaults only matter for the very first render before the user
// has interacted with the card.
// ---------------------------------------------------------------------------

/** Feature row on a workspace's sub-canvas — under the repo row. */
export const LOOSE_FEATURE_WS_ROW_Y = REPO_ROW_Y + CARD_H + 80;
export const LOOSE_FEATURE_WS_ROW_X0 = 40;
export const LOOSE_FEATURE_WS_ROW_STEP = FEATURE_W + ROW_GAP;

/** Feature row on an initiative's sub-canvas — under the milestone timeline. */
export const LOOSE_FEATURE_INIT_ROW_Y = MILESTONE_ROW_Y + MILESTONE_H + 80;
export const LOOSE_FEATURE_INIT_ROW_X0 = 40;
export const LOOSE_FEATURE_INIT_ROW_STEP = FEATURE_W + ROW_GAP;

// ---------------------------------------------------------------------------
// Research card sizing + default placement.
//
// Research cards sit on the root canvas (org-wide research) or on an
// initiative's sub-canvas (initiative-scoped research). The card size
// matches the loose-feature card (260\u00d7100) so a research node and a
// loose feature read as visually equivalent floating cards \u2014 same
// spatial weight, distinguished only by the emerald accent + book icon
// kicker.
//
// Default-render rows: research nodes that don't have a saved position
// land in their own row underneath whatever else is on the canvas. On
// root that's underneath the initiative row; on an initiative canvas
// that's underneath the loose-feature row.
// ---------------------------------------------------------------------------

export const RESEARCH_W = FEATURE_W;
export const RESEARCH_H = FEATURE_H;

/** Research row on the root canvas \u2014 under the initiative row. */
export const RESEARCH_ROOT_ROW_Y = INITIATIVE_ROW_Y + INITIATIVE_H + 80;
export const RESEARCH_ROOT_ROW_X0 = 40;
export const RESEARCH_ROOT_ROW_STEP = RESEARCH_W + ROW_GAP;

/** Research row on an initiative's sub-canvas \u2014 under the loose-feature row. */
export const RESEARCH_INIT_ROW_Y = LOOSE_FEATURE_INIT_ROW_Y + FEATURE_H + 60;
export const RESEARCH_INIT_ROW_X0 = 40;
export const RESEARCH_INIT_ROW_STEP = RESEARCH_W + ROW_GAP;
