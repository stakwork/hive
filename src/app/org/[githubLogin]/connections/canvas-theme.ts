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
  objective: "#a78bfa",
  note: "#f59e0b",
  decision: "#a78bfa",
  // Teal/cyan reads as "infrastructure / container" — distinct from the
  // purple objective, amber note, and status greens/ambers/reds.
  workspace: "#22d3ee",
} as const;

// Blue -> violet gradient used for the objective title.
const OBJECTIVE_GRADIENT = {
  from: "#60a5fa", // sky-400
  to: "#818cf8", // indigo-400
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
const OBJECTIVE_W = 340;
const OBJECTIVE_H = 116;

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

const statusToolbar = [
  {
    id: "status",
    label: "Status",
    kind: "swatches" as const,
    actions: [
      {
        id: "status-ok",
        label: "OK",
        swatch: STATUS.ok,
        patch: { category: "status-ok" },
        isActive: (n: CanvasNode) => n.category === "status-ok",
      },
      {
        id: "status-attn",
        label: "Attention",
        swatch: STATUS.attn,
        patch: { category: "status-attn" },
        isActive: (n: CanvasNode) => n.category === "status-attn",
      },
      {
        id: "status-risk",
        label: "Risk",
        swatch: STATUS.risk,
        patch: { category: "status-risk" },
        isActive: (n: CanvasNode) => n.category === "status-risk",
      },
    ],
  },
];

function statusCategory(
  status: keyof typeof STATUS,
  label: string,
): CategoryDefinition {
  const color = STATUS[status];
  return {
    ...baseCard,
    // The category's stroke IS the status color — slots inherit from it.
    stroke: color,
    defaultWidth: CARD_W,
    defaultHeight: CARD_H,
    type: "text",
    toolbar: statusToolbar,
    slots: {
      topEdge: { kind: "color", extent: "full" },
      bodyTop: {
        kind: "progress",
        value: (ctx: SlotContext) =>
          parsePercent(ctx.node.customData?.primary),
      },
      topRight: { kind: "pill", value: label },
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
}

// ---------------------------------------------------------------------------
// Objective (gradient title) card
// ---------------------------------------------------------------------------

function renderObjectiveBody(ctx: SlotContext): React.ReactNode {
  const { region, node, theme } = ctx;
  const raw = node.text ?? "";
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length === 0) return null;

  const fs = Math.round(theme.node.fontSize * 1.35);
  const lineHeight = fs + 4;
  const font = theme.node.labelFont ?? theme.node.fontFamily;
  const baseY = region.y + fs;
  const gradId = `sc-objective-grad-${node.id}`;

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
          stopColor: OBJECTIVE_GRADIENT.from,
        }),
        createElement("stop", {
          offset: "100%",
          stopColor: OBJECTIVE_GRADIENT.to,
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

const objectiveCategory: CategoryDefinition = {
  ...baseCard,
  defaultWidth: OBJECTIVE_W,
  defaultHeight: OBJECTIVE_H,
  stroke: "rgba(167, 139, 250, 0.35)",
  fill: "rgba(167, 139, 250, 0.05)",
  type: "text",
  slots: {
    header: {
      kind: "text",
      value: "OBJECTIVE",
      color: ACCENT.objective,
    },
    body: {
      kind: "custom",
      render: (ctx: SlotContext) => renderObjectiveBody(ctx),
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
  "status-ok": statusCategory("ok", "OK"),
  "status-attn": statusCategory("attn", "ATTN"),
  "status-risk": statusCategory("risk", "RISK"),
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
