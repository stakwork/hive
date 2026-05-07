import { createElement } from "react";
import type {
  CanvasNode,
  CanvasTheme,
  CategoryDefinition,
  NodeAction,
  NodeActionGroup,
  SlotContext,
} from "system-canvas";
import { darkTheme, resolveTheme } from "system-canvas";
import {
  CARD_H,
  CARD_W,
  FEATURE_H,
  FEATURE_W,
  INITIATIVE_H,
  INITIATIVE_W,
  MILESTONE_H,
  MILESTONE_W,
  RESEARCH_H,
  RESEARCH_W,
  SMALL_W,
  TASK_H,
  TASK_W,
} from "@/lib/canvas/geometry";
import { CATEGORY_REGISTRY } from "./canvas-categories";

/**
 * Theme for the Connections-page background canvas.
 *
 * Visual hierarchy:
 *   - **Workspaces** (teal containers, top row) — projected from DB.
 *   - **Initiatives** (sky-blue cards w/ gradient title, second row) —
 *     projected from `Initiative` rows. No status pill (initiatives can
 *     be long-running; a traffic-light would mislead).
 *   - **Milestones** (small cards on initiative sub-canvas) — projected
 *     from `Milestone` rows. Three discrete states: NOT_STARTED (muted
 *     gray), IN_PROGRESS (cool blue), COMPLETED (green).
 *   - **Repositories** (slate-indigo, on workspace sub-canvas) — projected.
 *   - **Notes / decisions** — authored amber/purple accent cards.
 *
 * **Implementation note (post system-canvas 0.1.3 / react 0.1.4):** body
 * text wrapping, gradient title fills, and `hideWhenZero` progress bars
 * are now declarative slot features in the library. This file used to
 * carry ~250 lines of custom React renderers (`renderWrappedBody`,
 * `renderInitiativeBody`, `renderTaskBody`, `renderMilestoneProgress`,
 * `wrapWords`, `withWrappedBody`) — all gone. The only remaining custom
 * renderers are `renderMetricsFooter` (two-cell layout reading
 * `customData.primary` / `secondary`) and `renderTeamStack` (avatar
 * stack), both genuinely domain-specific.
 */

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const BG = "#15171c";
const SURFACE = "rgba(255, 255, 255, 0.03)";
const STROKE = "#363945";
const TEXT = "rgba(255, 255, 255, 0.92)";
const MUTED = "rgba(255, 255, 255, 0.45)";

const ACCENT = {
  note: "#f59e0b",
  decision: "#a78bfa",
  // Teal/cyan reads as "infrastructure / container" — distinct from the
  // sky-blue initiative, amber note, and milestone state colors.
  workspace: "#22d3ee",
  // Slate/indigo — reads as "source control" and sits one visual step
  // below the teal workspace container so a repo on a workspace sub-
  // canvas is legibly "part of" its workspace without color-clashing.
  repository: "#818cf8",
  // Soft violet — reads as "strategic / aspirational." Borrows the
  // showcase "12-month vision" palette: a gradient blue→indigo title
  // sits inside a faint-purple-bordered card. Distinct from the
  // milestone IN_PROGRESS sky-blue and the workspace teal.
  initiative: "#a78bfa",
  // Warm amber — chosen for the "agent active" badge so it pops
  // against the cool blues/greens of milestone status colors. Reads
  // unambiguously as "attention-worthy now," matching the kanban's
  // `Loader2` spinner amber.
  agent: "#fbbf24",
  // Emerald — chosen for `research` cards. Distinct from the cool
  // milestone-IN_PROGRESS blue and from the violet initiative; reads
  // as "discovery / external knowledge" alongside the warmer note +
  // decision callouts. Matches the kanban's COMPLETED green only by
  // hue family, which is fine: research cards aren't projected onto
  // milestone canvases so the two never sit side-by-side.
  research: "#34d399",
} as const;

/**
 * Sky-blue → indigo gradient painted across the initiative title text.
 * Pulled from the showcase's "12-month vision" card so the card reads
 * as "the big strategic frame" — the title is the visual centerpiece
 * of the card, not the kicker or the metric. Cooler on the left,
 * resolves into a violet that's close enough to the card's accent
 * color that the shift reads as subtle.
 *
 * Now consumed declaratively by the library's `TextSlot.fill` field —
 * see `initiativeCategory.slots.body` below.
 */
const INITIATIVE_GRADIENT = {
  from: "#60a5fa", // sky-400
  to: "#818cf8", // indigo-400
} as const;

/**
 * Milestone colors. Three discrete states only — no `attn`/`risk`/`ok`
 * traffic-light. Mirrors the `MilestoneStatus` Prisma enum exactly.
 */
const MILESTONE_COLORS = {
  NOT_STARTED: MUTED,        // gray-on-gray; reads as "hasn't begun"
  IN_PROGRESS: "#7dd3fc",    // cool blue; reads as "in flight"
  COMPLETED: "#4ade80",      // green; reads as "done"
} as const;

type MilestoneStatus = keyof typeof MILESTONE_COLORS;

const LABEL_FONT =
  "'Inter', 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif";
const MONO_FONT =
  "'JetBrains Mono', 'SF Mono', ui-monospace, monospace";

// ---------------------------------------------------------------------------
// Geometry
//
// Card widths/heights live in `@/lib/canvas/geometry` as the single
// source of truth shared with the server-side projector pipeline.
// Edit them there — projector row-spacing tracks the same constants
// so cards never overlap on first render.
// ---------------------------------------------------------------------------

const baseCard = {
  fill: SURFACE,
  stroke: STROKE,
  cornerRadius: 10,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ---------------------------------------------------------------------------
// Footer renderer — shared by initiative + workspace + milestone +
// feature cards. Two-metric layout: `customData.primary` on the left,
// `customData.secondary` to its right. The right cell can render in
// the accent color when `customData.secondaryAccent` is true.
//
// Kept as `kind: 'custom'` because it's a genuine multi-cell layout —
// the library's single-`value` text slot would force us to merge both
// strings into one (and lose the per-cell color). If we ever generalize
// `kind: 'text'` to accept multi-segment value arrays this can fold in.
// ---------------------------------------------------------------------------

function renderMetricsFooter(
  ctx: SlotContext,
  accent: string,
): React.ReactNode {
  const { region, node, theme } = ctx;
  const primary = String(node.customData?.primary ?? "");
  const secondary = String(node.customData?.secondary ?? "");
  const secondaryAccent = Boolean(node.customData?.secondaryAccent);

  if (!primary && !secondary) return null;

  const fs = 11;
  const y = region.y + region.height / 2 + fs * 0.36;
  const font = theme.node.fontFamily;

  // Use the same rough glyph-width estimate the library uses internally
  // (0.62 ratio) — close enough at 11px for relative cell placement.
  const primaryWidth = primary.length * fs * 0.62;

  const primaryProps = {
    x: region.x,
    y,
    fill: MUTED,
    fontSize: fs,
    fontFamily: font,
    fontWeight: 500,
    pointerEvents: "none" as const,
  };
  const secondaryProps = {
    x: region.x + primaryWidth + 8,
    y,
    fill: secondaryAccent ? accent : MUTED,
    fontSize: fs,
    fontFamily: font,
    fontWeight: secondaryAccent ? 600 : 500,
    pointerEvents: "none" as const,
  };

  return createElement(
    "g",
    { pointerEvents: "none" },
    primary && createElement("text", primaryProps, primary),
    secondary && createElement("text", secondaryProps, secondary),
  );
}

// ---------------------------------------------------------------------------
// Initiative card — DB-projected, "vision"-style strategic frame
// ---------------------------------------------------------------------------
//
// Visual model borrowed from the showcase's "12-month vision" card:
// a wider/taller box, faint purple chrome (border + fill), a small
// uppercase kicker ("INITIATIVE"), and a **gradient title** rendered
// at ~135% of base font in the body region.
//
// `text` carries the initiative name (DB) and the library auto-wraps
// it to fit `region.width` and honors `\n` for explicit paragraph
// breaks. The gradient is declared via `TextSlot.fill` — the library
// generates a per-node `<linearGradient>` and paints the text with it.
//
// `customData.primary` (percent) and `customData.secondary` (count)
// land in the footer via `renderMetricsFooter`, the same renderer
// used for the workspace card so the two layers read as one family.
//
// `ref` is set by the projector to `initiative:<id>`, which makes the
// card clickable (drill-in) — that wiring lives in the system-canvas
// library, not the theme.

const initiativeCategory: CategoryDefinition = {
  ...baseCard,
  defaultWidth: INITIATIVE_W,
  defaultHeight: INITIATIVE_H,
  type: "text",
  stroke: hexAlpha(ACCENT.initiative, 0.35),
  fill: hexAlpha(ACCENT.initiative, 0.05),
  slots: {
    header: { kind: "text", value: "INITIATIVE", color: ACCENT.initiative },
    body: {
      kind: "text",
      value: (ctx: SlotContext) => ctx.node.text ?? "",
      // Per-node sky→indigo gradient. The library wires the
      // `<linearGradient>` def and `fill="url(#…)"` for us.
      fill: INITIATIVE_GRADIENT,
      // Slightly larger than the default body fontSize multiplier
      // (1.35×) — keeps the title visually dominant on the wider
      // initiative card.
      fontSize: (ctx: SlotContext) => Math.round(ctx.theme.node.fontSize * 1.35),
      fontWeight: 600,
    },
    footer: {
      kind: "custom",
      render: (ctx: SlotContext) =>
        renderMetricsFooter(ctx, ACCENT.initiative),
    },
  },
} as CategoryDefinition;

// ---------------------------------------------------------------------------
// Milestone card — DB-projected, three discrete states
// ---------------------------------------------------------------------------
//
// Compact card (smaller than initiative; sits on the timeline below).
// `customData.status` carries the raw `MilestoneStatus` enum value
// (`NOT_STARTED` | `IN_PROGRESS` | `COMPLETED`); we map it to one of
// three colors.
//
// Slot strategy: a thin top-edge band carries the status color so the
// card reads at a glance even when zoomed out. The header label
// reflects the status word too, in case the band gets clipped. A
// `bodyTop` progress slot sits between the header and the title;
// `hideWhenZero: true` makes it disappear when there are no linked
// features (an empty 0% bar would read as "behind" rather than "no data").

function getMilestoneStatus(node: CanvasNode): MilestoneStatus {
  const raw = node.customData?.status;
  if (raw === "NOT_STARTED" || raw === "IN_PROGRESS" || raw === "COMPLETED") {
    return raw;
  }
  // Defensive fallback for older blob data or unknown values: treat
  // as not started (the most muted color, least likely to mislead).
  return "NOT_STARTED";
}

function milestoneStatusColor(node: CanvasNode): string {
  return MILESTONE_COLORS[getMilestoneStatus(node)];
}

/**
 * Toolbar swatches for the milestone node. Three swatches mirror the
 * three `MilestoneStatus` Prisma enum values; clicking one writes the
 * new status into `customData.status` (which the slots read for color).
 *
 * Persistence: the canvas autosave path discards customData on live
 * ids (DB-owned), so the optimistic local change shown by the swatch
 * does NOT round-trip through the canvas blob. Instead,
 * `OrgCanvasBackground.handleNodeUpdate` intercepts updates on
 * `milestone:` ids and PATCHes the milestone REST endpoint, after
 * which the projector's CANVAS_UPDATED-driven re-projection becomes
 * the source of truth. See `handleNodeUpdate` for the wiring.
 *
 * `isActive` highlights the current status swatch in the toolbar so
 * the user can see what state the milestone is in at a glance.
 */
const milestoneStatusToolbar: NodeActionGroup[] = [
  {
    id: "status",
    label: "Status",
    kind: "swatches",
    actions: (
      ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"] as const
    ).map<NodeAction>((s) => ({
      id: `status-${s.toLowerCase()}`,
      label: {
        NOT_STARTED: "Not started",
        IN_PROGRESS: "In progress",
        COMPLETED: "Completed",
      }[s],
      swatch: MILESTONE_COLORS[s],
      patch: (n: CanvasNode) => ({
        customData: { ...(n.customData ?? {}), status: s },
      }),
      isActive: (n: CanvasNode) => getMilestoneStatus(n) === s,
    })),
  },
];

/**
 * Compact, two-letter initials from a user's display name. Falls back
 * to "?" when name is empty or null so we never render an empty pill.
 *
 * Examples:
 *   "Evan Feenstra"  → "EF"
 *   "evan"            → "EV"
 *   ""                → "?"
 *   null              → "?"
 */
function userInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

/**
 * Stable color for a user, derived from their id. Same user → same
 * background tone across the canvas; different users → enough variation
 * that small overlapping circles read as distinct people, not a
 * uniform blob. Pulls from a small palette tuned for dark backgrounds.
 */
const TEAM_AVATAR_PALETTE = [
  "#60a5fa", // sky
  "#34d399", // emerald
  "#f472b6", // pink
  "#fbbf24", // amber
  "#a78bfa", // violet
  "#22d3ee", // cyan
  "#fb7185", // rose
  "#a3e635", // lime
];

function teamAvatarColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return TEAM_AVATAR_PALETTE[Math.abs(hash) % TEAM_AVATAR_PALETTE.length];
}

interface TeamMember {
  id: string;
  name: string | null;
  image: string | null;
}

/**
 * Render an overlapping avatar stack for the milestone's team. Up to
 * `TEAM_VISIBLE` (3) circles followed by an optional "+N" pill when
 * `teamOverflow > 0`. Each circle is an SVG `<circle>` carrying either:
 *
 *   - the user's profile `<image>` clipped to a circle, or
 *   - a colored fill + initials when no image URL is available
 *
 * Positioning: hangs off the topRight corner slot but extends leftward
 * so the rightmost avatar aligns with the slot's right edge — that
 * way the stack reads as "anchored to the corner" without colliding
 * with the (separate) topRightOuter agent badge.
 *
 * Always-on by design (per the milestone-progress plan, Q7): zoomed
 * out the circles read as small accent dots; zoomed in they resolve
 * into recognizable initials/avatars. No library zoom hook needed.
 */
function renderTeamStack(ctx: SlotContext): React.ReactNode {
  const { region, node } = ctx;
  const team = (node.customData?.team as TeamMember[] | undefined) ?? [];
  const overflow = Number(node.customData?.teamOverflow ?? 0);
  if (team.length === 0 && overflow === 0) return null;

  // Circle geometry. Smaller than the corner slot (which is ~16-20px
  // square at default settings) so the stack feels tucked into the
  // corner rather than overflowing it. Overlap of 8px on a 16px
  // diameter (~50%) reads as "stacked" without circles disappearing
  // behind each other.
  const radius = 8;
  const overlapStep = 12;
  const overflowPadding = 4;
  const totalCircles = team.length;

  // Anchor: align the RIGHTMOST circle's right edge to the slot's
  // right edge. Each circle to its left moves by `overlapStep`.
  const rightEdgeX = region.x + region.width;
  const baseCx = rightEdgeX - radius;
  const cy = region.y + region.height / 2;

  const elements: React.ReactNode[] = [];

  // Draw left-to-right so the leftmost circle is rendered first and
  // the rightmost (top of the stack visually) is rendered last —
  // matches the natural z-order users expect from overlapping avatars.
  team.forEach((member, i) => {
    // Position from the right: index 0 is rightmost (front).
    const positionFromRight = i;
    const cx = baseCx - positionFromRight * overlapStep;
    const fill = teamAvatarColor(member.id);
    const clipId = `team-avatar-clip-${node.id}-${member.id}`;

    if (member.image) {
      // <clipPath> + <image> approach. Square image is fitted into the
      // circle bounding box; preserveAspectRatio defaults to xMidYMid
      // meet which centers within. Most user images are square-ish.
      elements.push(
        createElement(
          "g",
          { key: `${member.id}-img`, pointerEvents: "none" },
          createElement(
            "defs",
            null,
            createElement(
              "clipPath",
              { id: clipId },
              createElement("circle", { cx, cy, r: radius }),
            ),
          ),
          createElement("circle", {
            cx,
            cy,
            r: radius,
            fill,
            stroke: "rgba(0,0,0,0.4)",
            strokeWidth: 1,
          }),
          createElement("image", {
            href: member.image,
            x: cx - radius,
            y: cy - radius,
            width: radius * 2,
            height: radius * 2,
            clipPath: `url(#${clipId})`,
            preserveAspectRatio: "xMidYMid slice",
          }),
        ),
      );
    } else {
      elements.push(
        createElement(
          "g",
          { key: `${member.id}-init`, pointerEvents: "none" },
          createElement("circle", {
            cx,
            cy,
            r: radius,
            fill,
            stroke: "rgba(0,0,0,0.4)",
            strokeWidth: 1,
          }),
          createElement(
            "text",
            {
              x: cx,
              y: cy + 3, // visual baseline nudge for centering small text
              textAnchor: "middle",
              fontSize: 8,
              fontWeight: 700,
              fontFamily: LABEL_FONT,
              fill: "#0a0a0a",
              pointerEvents: "none",
            },
            userInitials(member.name),
          ),
        ),
      );
    }
  });

  // "+N" overflow pill, drawn to the LEFT of the leftmost circle.
  if (overflow > 0) {
    const overflowText = `+${overflow}`;
    const charWidth = 5;
    const pillWidth = Math.max(radius * 2, overflowText.length * charWidth + 6);
    const leftmostCx = baseCx - totalCircles * overlapStep;
    const pillCx = leftmostCx - overflowPadding - pillWidth / 2;
    const pillY = cy - radius;
    elements.push(
      createElement(
        "g",
        { key: "team-overflow", pointerEvents: "none" },
        createElement("rect", {
          x: pillCx - pillWidth / 2,
          y: pillY,
          width: pillWidth,
          height: radius * 2,
          rx: radius,
          fill: "rgba(255,255,255,0.12)",
          stroke: "rgba(255,255,255,0.2)",
          strokeWidth: 1,
        }),
        createElement(
          "text",
          {
            x: pillCx,
            y: cy + 3,
            textAnchor: "middle",
            fontSize: 8,
            fontWeight: 600,
            fontFamily: LABEL_FONT,
            fill: TEXT,
            pointerEvents: "none",
          },
          overflowText,
        ),
      ),
    );
  }

  return createElement("g", { pointerEvents: "none" }, ...elements);
}

const milestoneCategory: CategoryDefinition = {
  ...baseCard,
  defaultWidth: MILESTONE_W,
  defaultHeight: MILESTONE_H,
  type: "text",
  // Default stroke is the muted "not started" tone; the topEdge slot
  // below repaints with the live status color on every render, so this
  // only matters for the brief moment before customData is populated.
  stroke: STROKE,
  fill: SURFACE,
  toolbar: milestoneStatusToolbar,
  // Milestones are DB rows, not authored canvas content. Hide the
  // built-in trash button so users don't expect "delete from canvas"
  // to mean "delete the milestone." Real deletion happens in the
  // OrgInitiatives table UI.
  hideToolbarDelete: true,
  slots: {
    // Thin top-edge band tinted by status. Reads at a glance from
    // across the timeline.
    topEdge: {
      kind: "color",
      extent: "full",
      color: (ctx: SlotContext) => milestoneStatusColor(ctx.node),
    },
    // Kicker reads "MILESTONE" so the card type is named explicitly,
    // parallel to the INITIATIVE / WORKSPACE / REPO / FEATURE kickers
    // on neighboring cards. Color tracks the live status (gray /
    // sky / green) so the kicker doubles as the status signal — the
    // word `MILESTONE` rendered in green reads as "this milestone is
    // complete" without needing a second status label. The
    // top-edge color band carries the same signal at the silhouette
    // level for zoomed-out reads.
    header: {
      kind: "text",
      value: "MILESTONE",
      color: (ctx: SlotContext) => milestoneStatusColor(ctx.node),
    },
    // Progress bar between the status header and the title text. Lives
    // in `bodyTop` (NOT `body`) so it composes cleanly with the
    // library's auto-wrapping body text.
    //
    // `hideWhenZero: true` skips the empty track when no features are
    // linked yet — the empty bar would otherwise read as "0% complete"
    // rather than "no data yet."
    bodyTop: {
      kind: "progress",
      value: (ctx: SlotContext) => {
        const featureCount = Number(ctx.node.customData?.featureCount ?? 0);
        if (featureCount <= 0) return 0;
        const raw = Number(ctx.node.customData?.progress ?? 0);
        return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
      },
      color: (ctx: SlotContext) => milestoneStatusColor(ctx.node),
      bgColor: hexAlpha("#FFFFFF", 0.08),
      hideWhenZero: true,
    },
    // Library auto-wraps body text now — no custom React needed.
    body: {
      kind: "text",
      value: (ctx: SlotContext) => ctx.node.text ?? "",
    },
    // "Agent active" tab badge hanging off the top-right corner.
    // `topRightOuter` is system-canvas's purpose-built slot for
    // notification-style badges that clip into the node's stroke
    // (see `system-canvas/dist/slots.js:96-105`). The native `count`
    // slot's `hideWhenEmpty` does the right thing here — when no
    // agents are running, no badge renders. Color is amber so it
    // reads as "happening now" against the cool blue/green status
    // tones; we don't follow the milestone status color because the
    // signal is orthogonal (an agent can be running on any state).
    topRightOuter: {
      kind: "count",
      value: (ctx: SlotContext) => {
        const v = ctx.node.customData?.agentCount;
        return typeof v === "number" ? v : 0;
      },
      color: ACCENT.agent,
      hideWhenEmpty: true,
    },
    // Team avatar stack inside the top-right corner. Sits in the
    // INNER `topRight` slot so it doesn't collide with the agent tab
    // badge in the OUTER `topRightOuter` slot. Renders nothing when
    // no humans are involved with any linked feature.
    topRight: {
      kind: "custom",
      render: renderTeamStack,
    },
    // Footer intentionally omitted. The kicker, top-edge color band,
    // progress bar, agent badge, and team avatar stack already cover
    // the milestone's status / progress / activity / ownership story
    // — the `customData.secondary` "Due Mar 4 · 3/5 features" line was
    // duplicating signal and crowding the now-wider card. Keep the
    // raw data on the node (the right panel's Details tab still
    // renders it) but skip the on-card footer.
  },
} as CategoryDefinition;

// ---------------------------------------------------------------------------
// Feature card — DB-projected on a milestone sub-canvas
// ---------------------------------------------------------------------------
//
// One per linked Feature. Reads `Feature.status` from `customData.status`
// (the projector passes it through verbatim). The `topEdge` color
// band tracks status; the footer renderer picks up `customData.secondary`
// (the "X/Y tasks" line) and shows it in muted-on-accent treatment so
// it parallels the milestone card's footer.
//
// Color palette mirrors what the workspace plan page uses for its
// status badges: BACKLOG (muted), PLANNED (slate), IN_PROGRESS (blue),
// COMPLETED (green), CANCELLED (muted dashed), ERROR (red), BLOCKED
// (amber). Defensively maps unknown values to the muted "BACKLOG"
// tone so a Prisma schema addition doesn't crash the renderer.

const FEATURE_STATUS_COLORS: Record<string, string> = {
  BACKLOG: MUTED,
  PLANNED: "#94a3b8",      // slate-400
  IN_PROGRESS: "#7dd3fc",  // sky-300 (matches milestone IN_PROGRESS for visual rhyme)
  COMPLETED: "#4ade80",    // emerald-400 (matches milestone COMPLETED)
  CANCELLED: MUTED,
  ERROR: "#f87171",        // red-400
  BLOCKED: "#fbbf24",      // amber-400
};

function featureStatusColor(node: CanvasNode): string {
  const raw = node.customData?.status;
  if (typeof raw === "string" && raw in FEATURE_STATUS_COLORS) {
    return FEATURE_STATUS_COLORS[raw];
  }
  return MUTED;
}

const featureCategory: CategoryDefinition = {
  ...baseCard,
  defaultWidth: FEATURE_W,
  defaultHeight: FEATURE_H,
  type: "text",
  stroke: STROKE,
  fill: SURFACE,
  // Features are DB rows, not authored canvas content — same posture
  // as milestones. Hide the trash button so users don't expect
  // canvas delete to mean feature delete.
  hideToolbarDelete: true,
  slots: {
    // Status color rides on the LEFT edge (not the top edge). This
    // is the silhouette that distinguishes Feature from Milestone:
    // milestones carry a TOP-edge band (and a gold base accent), so
    // a feature with a left stripe never gets confused for a
    // milestone, even at low zoom where text is illegible. The left
    // stripe also visually echoes a kanban "swimlane" — appropriate
    // since features are kanban-tracked work items under a milestone.
    leftEdge: {
      kind: "color",
      extent: "full",
      color: (ctx: SlotContext) => featureStatusColor(ctx.node),
    },
    header: {
      kind: "text",
      value: "FEATURE",
      color: (ctx: SlotContext) => featureStatusColor(ctx.node),
    },
    body: {
      kind: "text",
      value: (ctx: SlotContext) => ctx.node.text ?? "",
    },
    footer: {
      kind: "custom",
      render: (ctx: SlotContext) =>
        renderMetricsFooter(ctx, featureStatusColor(ctx.node)),
    },
  },
} as CategoryDefinition;

// ---------------------------------------------------------------------------
// Task card — DB-projected on a milestone sub-canvas
// ---------------------------------------------------------------------------
//
// Compact card; stacked beneath its parent feature. Color band tracks
// `customData.workflowStatus` (the kanban-board signal: PENDING /
// IN_PROGRESS / COMPLETED / ERROR / HALTED / FAILED) since that's the
// "what's happening with this task right now" axis. The header text
// is the workflow word, in the same color, so users can read state
// even when the band is clipped or zoomed out to a single pixel.

const TASK_WORKFLOW_COLORS: Record<string, string> = {
  PENDING: "#7dd3fc",      // queued is treated as in-flight by the kanban (KanbanView.tsx:62)
  IN_PROGRESS: "#7dd3fc",
  COMPLETED: "#4ade80",
  ERROR: "#f87171",
  FAILED: "#f87171",        // collapses to ERROR per the kanban
  HALTED: "#fbbf24",
};

function taskWorkflowColor(node: CanvasNode): string {
  const raw = node.customData?.workflowStatus;
  if (typeof raw === "string" && raw in TASK_WORKFLOW_COLORS) {
    return TASK_WORKFLOW_COLORS[raw];
  }
  // Default to muted (no agent run yet) — same posture as the kanban
  // when workflowStatus is null.
  return MUTED;
}

function taskWorkflowLabel(node: CanvasNode): string {
  const raw = node.customData?.workflowStatus;
  if (typeof raw === "string") {
    return raw.replace(/_/g, " ");
  }
  // Fall back to TaskStatus when no workflow has been kicked off.
  const status = node.customData?.status;
  if (typeof status === "string") {
    return status.replace(/_/g, " ");
  }
  return "TASK";
}

const taskCategory: CategoryDefinition = {
  ...baseCard,
  defaultWidth: TASK_W,
  defaultHeight: TASK_H,
  type: "text",
  stroke: STROKE,
  fill: SURFACE,
  hideToolbarDelete: true,
  slots: {
    topEdge: {
      kind: "color",
      extent: "full",
      color: (ctx: SlotContext) => taskWorkflowColor(ctx.node),
    },
    header: {
      kind: "text",
      value: (ctx: SlotContext) => taskWorkflowLabel(ctx.node),
      color: (ctx: SlotContext) => taskWorkflowColor(ctx.node),
    },
    // Smaller body font (11px instead of the theme default 13px×1.35
    // multiplier) to fit within the compact 180×64 task card. The
    // library still wraps and clips — just at this smaller size.
    body: {
      kind: "text",
      value: (ctx: SlotContext) => ctx.node.text ?? "",
      fontSize: 11,
      fontWeight: 500,
    },
  },
} as CategoryDefinition;

// ---------------------------------------------------------------------------
// Note / decision accent cards (authored)
// ---------------------------------------------------------------------------

function accentNote(color: string, kicker: string): CategoryDefinition {
  return {
    ...baseCard,
    defaultWidth: SMALL_W,
    defaultHeight: 86,
    type: "text",
    stroke: hexAlpha(color, 0.35),
    fill: hexAlpha(color, 0.05),
    slots: {
      header: { kind: "text", value: kicker, color },
      body: {
        kind: "text",
        value: (ctx: SlotContext) => ctx.node.text ?? "",
        // Authored notes/decisions are scratchpad content — keep the
        // body text at normal weight + a touch smaller so it reads as
        // casual prose, not a bolded title. (Library defaults: weight
        // 600, fontSize = theme.node.fontSize × 1.35 = ~18px.)
        fontWeight: 400,
        fontSize: (ctx: SlotContext) => Math.round(ctx.theme.node.fontSize * 1.05),
      },
    },
  } as CategoryDefinition;
}

// ---------------------------------------------------------------------------
// Workspace card — projected from DB on root canvas. "Container"
// category sitting above initiatives. Same footprint as an initiative
// card so layers line up; pure identity label (no progress).
// ---------------------------------------------------------------------------

const workspaceCategory: CategoryDefinition = {
  ...baseCard,
  defaultWidth: CARD_W,
  defaultHeight: CARD_H,
  type: "text",
  stroke: hexAlpha(ACCENT.workspace, 0.45),
  fill: hexAlpha(ACCENT.workspace, 0.05),
  slots: {
    header: { kind: "text", value: "WORKSPACE", color: ACCENT.workspace },
    body: {
      kind: "text",
      value: (ctx: SlotContext) => ctx.node.text ?? "",
    },
    // Footer summary, e.g. "3 repos". Populated by the root projector
    // from `customData.secondary`; shares the initiative-card footer
    // renderer so workspace + initiative cards read as one family.
    footer: {
      kind: "custom",
      render: (ctx: SlotContext) =>
        renderMetricsFooter(ctx, ACCENT.workspace),
    },
  },
} as CategoryDefinition;

// ---------------------------------------------------------------------------
// Repository card — projected from DB on a workspace sub-canvas.
// Compact: repos are leaves (not containers), and a workspace often has
// several of them, so we want a row of small cards rather than a grid
// of full-width containers.
// ---------------------------------------------------------------------------

const repositoryCategory: CategoryDefinition = {
  ...baseCard,
  defaultWidth: SMALL_W,
  defaultHeight: 72,
  type: "text",
  stroke: hexAlpha(ACCENT.repository, 0.45),
  fill: hexAlpha(ACCENT.repository, 0.05),
  slots: {
    header: { kind: "text", value: "REPO", color: ACCENT.repository },
    body: {
      kind: "text",
      value: (ctx: SlotContext) => ctx.node.text ?? "",
    },
  },
} as CategoryDefinition;

// ---------------------------------------------------------------------------
// Research card — DB-projected on root or initiative canvases.
// ---------------------------------------------------------------------------
//
// Two visual states keyed off `customData.status`:
//   - `"researching"` (default while `Research.content` is null) — the
//     border + kicker + spinner badge all paint in emerald-with-pulse,
//     so the card unambiguously reads as "in flight" even with no
//     body text yet.
//   - `"ready"` (set by the projector once `content` is non-null) — the
//     pulse stops, the spinner badge goes away, the border settles to
//     the muted emerald accent, and the card reads as a finished
//     research doc the user can click into.
//
// On-card label is the user's original `topic` (carried verbatim in
// `node.text`), NOT the agent-polished `title`. This is deliberate:
// the user types a topic into an authored phase-1 node, then the
// projector takes over and emits the live phase-2 node \u2014 keeping the
// label identical means the swap has zero text flicker. The polished
// `title` lives in `customData.title` and is used as the right-panel
// viewer header; same for `customData.summary` (rendered above the
// markdown body in the viewer).
//
// We deliberately don't render the markdown body inline on the canvas:
// even truncated, a research summary sprawls and crowds the canvas.
// Click the card \u2192 the right-panel viewer renders the full doc.

function isResearchInFlight(node: CanvasNode): boolean {
  // Authored placeholders (the node the user is currently typing
  // into, before `save_research` has run) are NEVER in-flight. The
  // spinner is for live `research:<id>` rows where the agent is
  // actively researching; an authored node is just a text input.
  // The id-prefix check is the discriminator: live ids carry
  // `research:` (set by the projector); authored ids don't.
  if (!node.id.startsWith("research:")) return false;
  // For live rows: in-flight until `update_research` lands content.
  // The projector derives `customData.status` from `content !== null`
  // (`"researching"` vs `"ready"`); a brand-new row with no status
  // yet defaults to in-flight so the spinner is on by the time the
  // node first appears, no flash of empty chrome.
  return node.customData?.status !== "ready";
}

/**
 * Inline SVG spinner painted into the topRightOuter slot when a
 * research card is in flight. We can't import `Loader2` here \u2014 the
 * theme runs inside the SVG canvas and lucide-react ships HTML
 * components.
 *
 * Implementation: a 270\u00b0 arc rotated via SVG's native
 * `<animateTransform>`. CSS-based rotation (transform + transform-origin)
 * does NOT work reliably here \u2014 SVG `<g>`'s transform-origin is
 * computed in user-space pixels with `transform-box: fill-box` only
 * in some browsers, and the canvas's own viewport zoom/pan transforms
 * stack on top, so the spinner ends up orbiting some offscreen point.
 * `<animateTransform type="rotate">` takes the rotation center
 * directly in SVG coordinates as `from="0 cx cy" to="360 cx cy"`,
 * which is the only thing that survives an arbitrarily-transformed
 * parent.
 */
function renderResearchingBadge(ctx: SlotContext): React.ReactNode {
  const { region, node } = ctx;
  if (!isResearchInFlight(node)) return null;
  const cx = region.x + region.width / 2;
  const cy = region.y + region.height / 2;
  const r = Math.min(region.width, region.height) / 2 - 2;
  if (r <= 0) return null;
  const arcD = `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - r} ${cy}`;
  return createElement(
    "g",
    { pointerEvents: "none" },
    createElement("circle", {
      cx,
      cy,
      r,
      fill: hexAlpha(ACCENT.research, 0.12),
      stroke: hexAlpha(ACCENT.research, 0.35),
      strokeWidth: 1,
    }),
    createElement(
      "g",
      null,
      createElement("path", {
        d: arcD,
        fill: "none",
        stroke: ACCENT.research,
        strokeWidth: 1.5,
        strokeLinecap: "round",
      }),
      // SVG-native rotation animation. `from`/`to` carry the
      // rotation angle PLUS the rotation center in SVG coordinates
      // \u2014 immune to the canvas's outer transforms.
      createElement("animateTransform", {
        attributeName: "transform",
        attributeType: "XML",
        type: "rotate",
        from: `0 ${cx} ${cy}`,
        to: `360 ${cx} ${cy}`,
        dur: "1.1s",
        repeatCount: "indefinite",
      }),
    ),
  );
}

const researchCategory: CategoryDefinition = {
  ...baseCard,
  defaultWidth: RESEARCH_W,
  defaultHeight: RESEARCH_H,
  type: "text",
  // Research cards are DB rows once they exist (live ids are
  // `research:<cuid>`). We hide the canvas trash button so the user
  // doesn't expect "delete from canvas" to mean "delete from DB" \u2014
  // hidden lives are managed via the per-canvas hidden list, real
  // deletion goes through the REST endpoint.
  hideToolbarDelete: true,
  // Static stroke / fill in the muted emerald family. The "in flight"
  // signal rides on the topEdge color band + the spinner badge below
  // (both keyed off `customData.status`), keeping the silhouette of a
  // finished card clean and unambiguous.
  stroke: hexAlpha(ACCENT.research, 0.35),
  fill: hexAlpha(ACCENT.research, 0.05),
  slots: {
    // Top-edge band saturates to the full emerald accent while
    // researching, then drops to the muted accent once ready. This
    // is the silhouette-level "in flight" signal that reads from
    // across the canvas without needing to see the spinner badge.
    topEdge: {
      kind: "color",
      extent: "full",
      color: (ctx: SlotContext) =>
        isResearchInFlight(ctx.node)
          ? ACCENT.research
          : hexAlpha(ACCENT.research, 0.4),
    },
    header: { kind: "text", value: "RESEARCH", color: ACCENT.research },
    body: {
      kind: "text",
      value: (ctx: SlotContext) => ctx.node.text ?? "",
      // Slightly heavier weight so the user's topic (the on-card
      // label) reads as the headline of the card rather than as
      // body text.
      fontWeight: 600,
      fontSize: (ctx: SlotContext) => Math.round(ctx.theme.node.fontSize * 1.1),
    },
    // Spinner badge in the topRightOuter slot \u2014 same slot pattern
    // milestones use for the agent-active badge. Renders nothing when
    // status === "ready", so a finished research card has clean
    // chrome with just the kicker + label + muted top edge.
    topRightOuter: {
      kind: "custom",
      render: renderResearchingBadge,
    },
  },
} as CategoryDefinition;

// ---------------------------------------------------------------------------
// Definition lookup
// ---------------------------------------------------------------------------

/**
 * Map every registered category id to its renderer definition. Keys
 * here MUST match ids in `CATEGORY_REGISTRY` (canvas-categories.ts) —
 * the `resolveTheme` call below checks this and throws on mismatch.
 */
const CATEGORY_DEFINITIONS: Record<string, CategoryDefinition> = {
  workspace:  workspaceCategory,
  repository: repositoryCategory,
  initiative: initiativeCategory,
  milestone:  milestoneCategory,
  feature:    featureCategory,
  task:       taskCategory,
  note:       accentNote(ACCENT.note, "NOTE"),
  decision:   accentNote(ACCENT.decision, "DECISION"),
  research:   researchCategory,
};

// ---------------------------------------------------------------------------
// Theme build
// ---------------------------------------------------------------------------

export const connectionsTheme: CanvasTheme = resolveTheme(
  {
    name: "hive-connections",
    background: BG,
    node: {
      ...darkTheme.node,
      fill: SURFACE,
      stroke: STROKE,
      cornerRadius: 10,
      labelColor: TEXT,
      sublabelColor: MUTED,
      fontFamily: MONO_FONT,
      labelFont: LABEL_FONT,
      fontSize: 13,
      sublabelFontSize: 11,
      strokeWidth: 1,
      // Bigger drill-in affordance: the carved-corner chevron that
      // appears on cards with a `ref` (workspace, initiative,
      // milestone). Default is 18px; 28px makes it easier to spot
      // and tap, especially on dense root canvases. Glyph color is
      // a slightly cooler slate so it reads against the dark
      // surface without competing with the card's accent stroke.
      refIndicator: {
        ...darkTheme.node.refIndicator,
        icon: "chevron",
        color: "#cbd5e1",
        size: 28,
      },
    },
    // Anchor the floating node toolbar to the node's left edge
    // instead of the library default (centered). Our cards skew
    // wider than tall (initiatives, workspaces) and sit close to
    // the right-side connections sidebar — left-aligned keeps the
    // toolbar from drifting under the sidebar on a selected
    // initiative.
    toolbarAlign: "left",
    group: {
      ...darkTheme.group,
      fill: "rgba(255,255,255,0.02)",
      stroke: "rgba(255,255,255,0.08)",
      strokeDasharray: "4 4",
      labelColor: MUTED,
      labelFontSize: 11,
      cornerRadius: 10,
      strokeWidth: 1,
    },
    grid: {
      ...darkTheme.grid,
      color: "rgba(255, 255, 255, 0.03)",
    },
    // Subtle alternating background bands for projector-emitted
    // columns/rows (today: the milestone-timeline's quarterly columns).
    // Built on the dark theme's defaults but pulled even further down
    // in opacity so the bands read as "structure, not chrome" — they
    // help the user think in time, but never compete with the
    // milestone cards or with edges.
    lanes: {
      ...darkTheme.lanes,
      bandFillEven: "rgba(255, 255, 255, 0.018)",
      bandFillOdd: "rgba(255, 255, 255, 0.005)",
      dividerColor: "rgba(255, 255, 255, 0.06)",
      dividerWidth: 1,
      headerBackground: "rgba(15, 17, 22, 0.85)",
      headerTextColor: MUTED,
      headerFontFamily: LABEL_FONT,
      headerFontSize: 11,
      headerSize: 26,
    },
    // Build the renderer's category map by joining the category
    // registry (id + agent docs) with the local renderer definitions.
    // The registry is the single source of truth for which categories
    // exist — if a spec appears there without a definition below, we
    // throw at load so the mismatch is loud, not silent.
    categories: Object.fromEntries(
      CATEGORY_REGISTRY.map((spec) => {
        const def = CATEGORY_DEFINITIONS[spec.id];
        if (!def) {
          throw new Error(
            `[canvas-theme] missing CategoryDefinition for "${spec.id}". ` +
              `Add it to CATEGORY_DEFINITIONS.`,
          );
        }
        return [spec.id, def] as const;
      }),
    ),
  },
  darkTheme,
);
