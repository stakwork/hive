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
import { NodeProgressBar } from "system-canvas-react/primitives";
import {
  CARD_H,
  CARD_W,
  FEATURE_H,
  FEATURE_W,
  INITIATIVE_H,
  INITIATIVE_W,
  MILESTONE_H,
  MILESTONE_W,
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
 *   - **Initiatives** (sky-blue cards w/ progress bar, second row) —
 *     projected from `Initiative` rows. No status pill (initiatives can
 *     be long-running; a traffic-light would mislead).
 *   - **Milestones** (small cards on initiative sub-canvas) — projected
 *     from `Milestone` rows. Three discrete states: NOT_STARTED (muted
 *     gray), IN_PROGRESS (cool blue), COMPLETED (green).
 *   - **Repositories** (slate-indigo, on workspace sub-canvas) — projected.
 *   - **Notes / decisions** — authored amber/purple accent cards.
 *
 * Adapted from the system-canvas showcase + roadmap theme; trims away
 * the showcase team/customer/revenue categories and the old `objective`
 * status-pill model in favor of the new initiative/milestone split.
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
} as const;

/**
 * Sky-blue → indigo gradient painted across the initiative title text.
 * Pulled from the showcase's "12-month vision" card so the card reads
 * as "the big strategic frame" — the title is the visual centerpiece
 * of the card, not the kicker or the metric. Cooler on the left,
 * resolves into a violet that's close enough to the card's accent
 * color that the shift reads as subtle.
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

/** Rough monospace glyph-width estimate, good enough for relative placement. */
function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.62;
}

function hexAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ---------------------------------------------------------------------------
// Footer renderer — shared by initiative + workspace cards. Two-metric
// layout: `customData.primary` left, `customData.secondary` right of it.
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

  const primaryProps = {
    x: region.x,
    y,
    fill: MUTED,
    fontSize: fs,
    fontFamily: font,
    fontWeight: 500,
    pointerEvents: "none" as const,
  };
  const secondaryX = region.x + estimateTextWidth(primary, fs) + 8;
  const secondaryProps = {
    x: secondaryX,
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
// a wider/taller box, a faint purple chrome (border + fill), a small
// uppercase kicker ("INITIATIVE"), and a **gradient title** rendered
// at ~135% of base font in the body region. The title IS the card —
// not a metric or a status pill.
//
// `text` carries the initiative name (DB). `\n` in the name renders
// as a line break in the gradient title, so longer initiatives can
// wrap intentionally; we do not auto-wrap (auto-wrap would fight the
// projector's deterministic layout).
//
// `customData.primary` (percent) and `customData.secondary` (count)
// land in the footer via `renderMetricsFooter`, the same renderer
// used for the workspace card so the two layers read as one family.
//
// No status pill, no border-by-status, no progress bar. Initiatives
// can run for quarters or be open-ended; a traffic-light would lie,
// and a bodyTop progress bar collides with the title text.
//
// `ref` is set by the projector to `initiative:<id>`, which makes the
// card clickable (drill-in) — that wiring lives in the system-canvas
// library, not the theme.

/**
 * Render the initiative title in the `body` region with a sky-blue →
 * indigo gradient fill, sized up to ~135% of the theme's base font.
 * Reads from `node.text` so the projector populates it as the
 * Initiative.name. Honors `\n` as a line break.
 *
 * Each node gets its own `<linearGradient>` def keyed by node id —
 * cheap, and avoids the "all gradients share one rect" bug you'd hit
 * if we used a single shared id across the SVG.
 */
function renderInitiativeBody(ctx: SlotContext): React.ReactNode {
  const { region, node, theme } = ctx;
  const raw = node.text ?? "";
  if (!raw) return null;
  const fs = Math.round(theme.node.fontSize * 1.35);
  const lineHeight = fs + 4;
  const font = theme.node.labelFont ?? theme.node.fontFamily;
  const maxWidth = (region.width > 0 ? region.width : INITIATIVE_W) - 16;
  const gradId = `initiative-title-grad-${node.id}`;
  const clipId = `initiative-clip-${node.id}`;

  // Expand each \n-separated paragraph through word-wrap.
  const allLines: string[] = [];
  for (const para of raw.split("\n")) {
    allLines.push(...wrapWords(para || " ", maxWidth, fs));
  }
  if (allLines.length === 0) return null;

  const baseY = region.y + fs;
  return createElement(
    "g",
    { pointerEvents: "none" },
    createElement(
      "defs",
      null,
      createElement(
        "linearGradient",
        { id: gradId, x1: "0", y1: "0", x2: "1", y2: "0" },
        createElement("stop", {
          offset: "0%",
          stopColor: INITIATIVE_GRADIENT.from,
        }),
        createElement("stop", {
          offset: "100%",
          stopColor: INITIATIVE_GRADIENT.to,
        }),
      ),
      createElement(
        "clipPath",
        { id: clipId },
        createElement("rect", {
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
        }),
      ),
    ),
    createElement(
      "g",
      { clipPath: `url(#${clipId})`, pointerEvents: "none" },
      ...allLines.map((line, i) =>
        createElement(
          "text",
          {
            key: i,
            x: region.x,
            y: baseY + i * lineHeight,
            fill: `url(#${gradId})`,
            fontSize: fs,
            fontWeight: 600,
            fontFamily: font,
            pointerEvents: "none",
          },
          line,
        ),
      ),
    ),
  );
}

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
      kind: "custom",
      render: (ctx: SlotContext) => renderInitiativeBody(ctx),
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
// reflects the status word too, in case the band gets clipped.

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

function milestoneStatusLabel(node: CanvasNode): string {
  // Human-readable rendition for the header band. Keep terse —
  // the card is only ~200px wide.
  const map: Record<MilestoneStatus, string> = {
    NOT_STARTED: "NOT STARTED",
    IN_PROGRESS: "IN PROGRESS",
    COMPLETED: "COMPLETED",
  };
  return map[getMilestoneStatus(node)];
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

/**
 * Milestone progress bar. Sits in the native `bodyTop` slot — a thin
 * horizontal strip purpose-built for inline progress under the header
 * (see `system-canvas/dist/slots.js:84-95`). Reads two `customData`
 * fields populated by the projector:
 *
 *   - `progress`     — fraction in 0..1, % of linked features completed
 *   - `featureCount` — total linked features (denominator)
 *
 * **Why not the declarative `kind: "progress"` slot?** That would render
 * a 0% bar on a milestone with no features yet, which reads as "behind."
 * Returning `null` here when `featureCount === 0` keeps the card
 * honest: empty means empty.
 *
 * The bar's color tracks the milestone's status color, so a COMPLETED
 * milestone with 100% bar reads green-on-green and a NOT_STARTED
 * milestone shows a muted track even at 0%. We reuse the library's
 * `NodeProgressBar` primitive so the visual matches every other native
 * progress slot pixel-for-pixel.
 */
function renderMilestoneProgress(ctx: SlotContext): React.ReactNode {
  const { node } = ctx;
  const featureCount = Number(node.customData?.featureCount ?? 0);
  if (featureCount <= 0) return null;
  const raw = Number(node.customData?.progress ?? 0);
  const value = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
  return createElement(NodeProgressBar, {
    region: ctx.region,
    value,
    color: milestoneStatusColor(node),
    bgColor: hexAlpha("#FFFFFF", 0.08),
  });
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
    header: {
      kind: "text",
      value: (ctx: SlotContext) => milestoneStatusLabel(ctx.node),
      color: (ctx: SlotContext) => milestoneStatusColor(ctx.node),
    },
    // Progress bar between the status header and the title text. Lives
    // in `bodyTop` (NOT `body`) so it composes cleanly with the
    // text-wrapping body renderer applied by `withWrappedBody` below.
    bodyTop: {
      kind: "custom",
      render: renderMilestoneProgress,
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
    footer: {
      kind: "custom",
      render: (ctx: SlotContext) =>
        renderMetricsFooter(ctx, milestoneStatusColor(ctx.node)),
    },
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
    topEdge: {
      kind: "color",
      extent: "full",
      color: (ctx: SlotContext) => featureStatusColor(ctx.node),
    },
    header: {
      kind: "text",
      value: "FEATURE",
      color: (ctx: SlotContext) => featureStatusColor(ctx.node),
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
  },
} as CategoryDefinition;

// ---------------------------------------------------------------------------
// Note / decision accent cards (authored)
// ---------------------------------------------------------------------------

/**
 * Word-wrap a single paragraph string into lines that fit within `maxWidth`
 * pixels, using `estimateTextWidth` for glyph-width approximation.
 *
 * Exported for unit testing.
 */
export function wrapWords(text: string, maxWidth: number, fontSize: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (estimateTextWidth(candidate, fontSize) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Generic body renderer: word-wrap + SVG clip for any card type.
 *
 * - Reads `node.text`, splits on `\n` for explicit paragraphs.
 * - Word-wraps each paragraph to fit within `region.width`
 *   (falls back to `SMALL_W - 16` when region width is unavailable).
 * - Renders each line as an SVG `<text>` element.
 * - Clips the whole group to the region rect so no text bleeds past
 *   the card boundary, horizontally or vertically.
 *
 * Exported for unit testing.
 */
export function renderWrappedBody(ctx: SlotContext): React.ReactNode {
  const { region, node, theme } = ctx;
  const raw = node.text ?? "";
  if (!raw) return null;

  const fs = theme.node.fontSize;
  const lineHeight = fs + 3;
  const font = theme.node.fontFamily;
  const maxWidth = (region.width > 0 ? region.width : SMALL_W) - 16;
  const clipId = `note-clip-${node.id}`;

  // Expand each newline-separated paragraph through word-wrap.
  const paragraphs = raw.split("\n");
  const allLines: string[] = [];
  for (const para of paragraphs) {
    const wrapped = wrapWords(para || " ", maxWidth, fs);
    allLines.push(...wrapped);
  }

  const baseY = region.y + fs;

  return createElement(
    "g",
    { pointerEvents: "none" },
    // Define the clip rect keyed to this node so multiple cards
    // each have an independent clip region.
    createElement(
      "defs",
      null,
      createElement(
        "clipPath",
        { id: clipId },
        createElement("rect", {
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
        }),
      ),
    ),
    createElement(
      "g",
      { clipPath: `url(#${clipId})`, pointerEvents: "none" },
      ...allLines.map((line, i) =>
        createElement(
          "text",
          {
            key: i,
            x: region.x,
            y: baseY + i * lineHeight,
            fill: TEXT,
            fontSize: fs,
            fontFamily: font,
            pointerEvents: "none",
          },
          line,
        ),
      ),
    ),
  );
}

/** @deprecated Use `renderWrappedBody` instead. Kept for test back-compat. */
export const renderNoteBody = renderWrappedBody;

/**
 * Wraps a `CategoryDefinition` with a default word-wrap+clip body renderer.
 * If the definition already has a `body` slot, it is returned unchanged so
 * custom renderers (e.g. initiative gradient title) are never overridden.
 *
 * Apply this to every entry in `CATEGORY_DEFINITIONS` so any new category
 * that spreads `...baseCard` and omits `slots.body` automatically inherits
 * text wrapping without extra wiring.
 */
function withWrappedBody(def: CategoryDefinition): CategoryDefinition {
  if (def.slots?.body) return def; // already has a custom body — don't override
  return {
    ...def,
    slots: {
      ...def.slots,
      body: { kind: "custom", render: renderWrappedBody },
    },
  };
}

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
        kind: "custom",
        render: (ctx: SlotContext) => renderWrappedBody(ctx),
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
  workspace:  withWrappedBody(workspaceCategory),
  repository: withWrappedBody(repositoryCategory),
  initiative: withWrappedBody(initiativeCategory),
  milestone:  withWrappedBody(milestoneCategory),
  feature:    withWrappedBody(featureCategory),
  task:       withWrappedBody(taskCategory),
  note:       withWrappedBody(accentNote(ACCENT.note, "NOTE")),
  decision:   withWrappedBody(accentNote(ACCENT.decision, "DECISION")),
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
    },
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
