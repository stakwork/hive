import { createElement } from "react";
import type {
  CanvasNode,
  CanvasTheme,
  CategoryDefinition,
  SlotContext,
} from "system-canvas";
import { darkTheme, resolveTheme } from "system-canvas";
import { CATEGORY_REGISTRY } from "./canvas-categories";

/**
 * Theme for the Connections-page background canvas.
 *
 * Adapted from the system-canvas showcase: keeps the inky surface, the
 * status-card pattern (OK / ATTN / RISK), and the amber-note / purple-decision
 * accent cards. Removes showcase-specific team/customer/revenue categories.
 * Renames `vision` to `objective` so this reads as a project/workstream
 * canvas rather than a company-level OKR board.
 */

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const BG = "#15171c";
const SURFACE = "rgba(255, 255, 255, 0.03)";
const STROKE = "#363945";
const TEXT = "rgba(255, 255, 255, 0.92)";
const MUTED = "rgba(255, 255, 255, 0.45)";

const STATUS = {
  ok: "#22c55e",
  attn: "#f59e0b",
  risk: "#ef4444",
} as const;

const ACCENT = {
  note: "#f59e0b",
  decision: "#a78bfa",
  // Teal/cyan reads as "infrastructure / container" — distinct from the
  // purple objective, amber note, and status greens/ambers/reds.
  workspace: "#22d3ee",
} as const;

const LABEL_FONT =
  "'Inter', 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif";
const MONO_FONT =
  "'JetBrains Mono', 'SF Mono', ui-monospace, monospace";

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const CARD_W = 240;
const CARD_H = 104;
const SMALL_W = 220;

const baseCard = {
  fill: SURFACE,
  stroke: STROKE,
  cornerRadius: 10,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Accepts "38%", 0.38, and 38 — all coerce to 0.38. Returns 0 otherwise. */
function parsePercent(raw: unknown): number {
  if (typeof raw === "number") return raw > 1 ? raw / 100 : raw;
  if (typeof raw === "string") {
    const m = raw.match(/(-?\d+(?:\.\d+)?)/);
    if (!m) return 0;
    const n = Number(m[1]);
    if (Number.isNaN(n)) return 0;
    return n > 1 ? n / 100 : n;
  }
  return 0;
}

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
// Status-card slot renderers
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
// Status (as customData on objective)
// ---------------------------------------------------------------------------
//
// "Status" is a *property of an objective*, not a node type. It lives in
// `customData.status` on an `objective` node and drives the pill label,
// pill color, progress-bar tint, and top-edge accent. The toolbar on the
// objective category lets the user flip between OK / ATTN / RISK without
// changing the node's category.

type StatusKey = keyof typeof STATUS;
const STATUS_LABELS: Record<StatusKey, string> = {
  ok: "OK",
  attn: "ATTN",
  risk: "RISK",
};

/** Read `customData.status`, falling back to `ok`. Unknown values also clamp to `ok`. */
function getStatus(node: CanvasNode): StatusKey {
  const raw = node.customData?.status;
  if (raw === "ok" || raw === "attn" || raw === "risk") return raw;
  return "ok";
}

function statusColor(node: CanvasNode): string {
  return STATUS[getStatus(node)];
}

function statusLabel(node: CanvasNode): string {
  return STATUS_LABELS[getStatus(node)];
}

/**
 * Toolbar group for the objective node: a three-swatch picker that
 * writes BOTH `customData.status` (the semantic keyword the agent
 * reads/writes) AND `node.color` (the hex that drives the library's
 * resolver, which colors the border + derived fill).
 *
 * `patch` is a function so we can shallow-merge into the existing
 * customData — the library's `updateNode` replaces `customData`
 * wholesale if you hand it a static object.
 */
const objectiveStatusToolbar = [
  {
    id: "status",
    label: "Status",
    kind: "swatches" as const,
    actions: (["ok", "attn", "risk"] as const).map((s) => ({
      id: `status-${s}`,
      label: STATUS_LABELS[s],
      swatch: STATUS[s],
      patch: (n: CanvasNode) => ({
        color: STATUS[s],
        customData: { ...(n.customData ?? {}), status: s },
      }),
      isActive: (n: CanvasNode) => getStatus(n) === s,
    })),
  },
];

// ---------------------------------------------------------------------------
// Objective card
// ---------------------------------------------------------------------------

/**
 * The one initiative card. An objective carries:
 *   - `text` — the card title, rendered by the library's default label
 *     renderer (no custom body).
 *   - `customData.status` → pill label (OK/ATTN/RISK). The toolbar that
 *     sets status ALSO sets `node.color` to the matching hex, so the
 *     resolver colors the border + derived fill automatically — every
 *     slot that defaults to `node.resolvedStroke` (topEdge, pill,
 *     progress, count) follows along for free.
 *   - `customData.primary`   → progress bar + first footer metric.
 *   - `customData.secondary` → second footer metric (e.g. "4 blockers").
 *   - `customData.count`     → blocker-count badge (top-right notch).
 *
 * Default category `stroke` is the "ok" green so a brand-new objective
 * (before any status has been set) reads as on-track and the node still
 * has a visible border.
 */
const objectiveCategory: CategoryDefinition = {
  ...baseCard,
  defaultWidth: CARD_W,
  defaultHeight: CARD_H,
  stroke: STATUS.ok,
  type: "text",
  toolbar: objectiveStatusToolbar,
  // Seed new objectives so they start life in a coherent "OK / on
  // track" state that lines up with the default category stroke above.
  defaultCustomData: { status: "ok" },
  slots: {
    // All slots below omit `color` on purpose — they inherit
    // `node.resolvedStroke`, which is driven by `node.color` (set by
    // the status toolbar). Change the status once → everything recolors.
    topEdge: { kind: "color", extent: "full" },
    bodyTop: {
      kind: "progress",
      value: (ctx: SlotContext) =>
        parsePercent(ctx.node.customData?.primary),
    },
    topRight: {
      kind: "pill",
      value: (ctx: SlotContext) => statusLabel(ctx.node),
    },
    topRightOuter: {
      kind: "count",
      value: (ctx: SlotContext) =>
        (ctx.node.customData?.count as number | undefined) ?? 0,
    },
    footer: {
      kind: "custom",
      render: (ctx: SlotContext) =>
        renderMetricsFooter(ctx, ctx.node.resolvedStroke),
    },
  },
} as CategoryDefinition;

// ---------------------------------------------------------------------------
// Note / decision accent cards
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
// Workspace card — a "container" category sitting above objectives. Same
// footprint as a status card so layers line up, but no progress / pill /
// blocker slots: it's purely an identity label for the workspace.
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
  objective: objectiveCategory,
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
