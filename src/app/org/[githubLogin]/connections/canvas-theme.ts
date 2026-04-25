import { createElement } from "react";
import type {
  CanvasNode,
  CanvasTheme,
  CategoryDefinition,
  SlotContext,
} from "system-canvas";
import { darkTheme, resolveTheme } from "system-canvas";
import {
  CARD_H,
  CARD_W,
  INITIATIVE_H,
  INITIATIVE_W,
  MILESTONE_H,
  MILESTONE_W,
  SMALL_W,
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
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length === 0) return null;
  const fs = Math.round(theme.node.fontSize * 1.35);
  const lineHeight = fs + 4;
  const font = theme.node.labelFont ?? theme.node.fontFamily;
  const baseY = region.y + fs;
  const gradId = `initiative-title-grad-${node.id}`;
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
    ),
    ...lines.map((line, i) =>
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
    footer: {
      kind: "custom",
      render: (ctx: SlotContext) =>
        renderMetricsFooter(ctx, milestoneStatusColor(ctx.node)),
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
  workspace: workspaceCategory,
  repository: repositoryCategory,
  initiative: initiativeCategory,
  milestone: milestoneCategory,
  note: accentNote(ACCENT.note, "NOTE"),
  decision: accentNote(ACCENT.decision, "DECISION"),
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
