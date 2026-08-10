"use client";

/**
 * `AttentionBadge` — pure, stateless canvas slot renderer.
 *
 * Matches the `renderTeamStack` / `renderResearchingBadge` pattern in
 * `canvas-theme.ts`: a plain function of `SlotContext` with no own
 * `useState` / `useEffect`. Reads the entity's attention type from
 * `AttentionMapContext` and renders nothing when no signal is active.
 *
 * ## Rendering approach
 * We use a nested static `<svg>` (via `createElement`) containing the
 * icon path for the signal type. This is consistent with what
 * `renderResearchingBadge` does — SVG nesting is valid per the SVG
 * spec and works inside the canvas's SVG tree. CSS-driven animations
 * are avoided (they don't survive the canvas's outer transform stack),
 * but static paths are fine.
 *
 * ## Fallback
 * If cross-browser testing surfaces problems with the nested SVG icon,
 * the badge can fall back to the plain colored-dot pattern (see the
 * commented fallback at the bottom of this file) — trading exact icon
 * fidelity for reliability.
 *
 * ## Usage
 * Wire into `canvas-theme.ts` as a `topRightOuter` custom slot:
 *
 * ```ts
 * topRightOuter: {
 *   kind: "custom",
 *   render: (ctx) => renderAttentionBadge(ctx, "feature", entityId),
 * }
 * ```
 *
 * The `entityId` is parsed off the node's `feature:<id>` / `task:<id>`
 * prefix before the slot definition is constructed.
 */
import { createElement } from "react";
import type { SlotContext } from "system-canvas";
import { useAttentionType } from "./AttentionMapContext";
import { ATTENTION_TYPE_META, SVG_PATHS } from "@/services/attention/typeMeta";

// ---------------------------------------------------------------------------
// Badge geometry
// ---------------------------------------------------------------------------

/**
 * Badge dimensions — a small pill anchored to the top-right corner of
 * the slot region. Size is intentionally compact so it reads as a
 * "notification dot" rather than a primary UI element.
 */
const BADGE_SIZE = 16; // px, square bounding box for the badge circle
const ICON_SIZE = 10; // px, icon fits inside the badge circle

// ---------------------------------------------------------------------------
// Core renderer
// ---------------------------------------------------------------------------

/**
 * Renders the attention badge for a single entity inside the canvas
 * SVG tree. Pure function — no React hooks. Called by the thin React
 * wrapper below (`AttentionBadgeSlot`) that holds the hook call.
 */
function renderBadge(
  ctx: SlotContext,
  type: NonNullable<ReturnType<typeof useAttentionType>>,
): React.ReactNode {
  const { region } = ctx;
  const meta = ATTENTION_TYPE_META[type];
  const svgPaths = SVG_PATHS[meta.iconName];

  // Position: centered in the slot region (system-canvas sizes the
  // topRightOuter region to a small square at the top-right corner).
  const cx = region.x + region.width / 2;
  const cy = region.y + region.height / 2;
  const r = BADGE_SIZE / 2;

  // Icon: placed centered within the badge circle.
  const iconX = cx - ICON_SIZE / 2;
  const iconY = cy - ICON_SIZE / 2;

  return createElement(
    "g",
    { pointerEvents: "none" },
    // Badge background circle
    createElement("circle", {
      cx,
      cy,
      r,
      fill: "rgba(15, 17, 22, 0.85)",
      stroke: meta.colorHex,
      strokeWidth: 1.5,
    }),
    // Icon SVG — nested inside the badge circle
    createElement(
      "svg",
      {
        x: iconX,
        y: iconY,
        width: ICON_SIZE,
        height: ICON_SIZE,
        viewBox: svgPaths.viewBox,
        fill: "none",
        stroke: meta.colorHex,
        strokeWidth: 2,
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
        overflow: "visible",
      },
      ...svgPaths.paths.map((d, i) =>
        createElement("path", { key: i, d }),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// React wrapper — holds the hook call
// ---------------------------------------------------------------------------

/**
 * Thin React component that reads `useAttentionType` from context
 * and delegates to the pure `renderBadge` function. This keeps the
 * hook boundary explicit and separate from the SVG rendering logic.
 *
 * **Not exported directly** — consumers use `makeAttentionBadgeRenderer`
 * below to get a slot-compatible render function.
 */
function AttentionBadgeSlot({
  ctx,
  entityKind,
  entityId,
}: {
  ctx: SlotContext;
  entityKind: "feature" | "task";
  entityId: string;
}): React.ReactNode {
  const type = useAttentionType(entityKind, entityId);
  if (!type) return null;
  return renderBadge(ctx, type);
}

// ---------------------------------------------------------------------------
// Slot factory — used by canvas-theme.ts
// ---------------------------------------------------------------------------

/**
 * Returns a `kind: "custom"` slot render function for `canvas-theme.ts`.
 *
 * Usage in the theme:
 * ```ts
 * topRightOuter: {
 *   kind: "custom",
 *   render: makeAttentionBadgeRenderer("feature", featureId),
 * }
 * ```
 *
 * The render function is called by system-canvas on every canvas frame.
 * It delegates to `<AttentionBadgeSlot>` (which calls the context hook)
 * so the badge is driven by the shared, centralized attention map rather
 * than any per-card state or subscription.
 */
export function makeAttentionBadgeRenderer(
  entityKind: "feature" | "task",
  entityId: string,
): (ctx: SlotContext) => React.ReactNode {
  function AttentionBadgeRenderer(ctx: SlotContext): React.ReactNode {
    return createElement(AttentionBadgeSlot, { ctx, entityKind, entityId });
  }
  return AttentionBadgeRenderer;
}
