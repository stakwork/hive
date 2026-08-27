/**
 * Render-agnostic attention signal type metadata.
 *
 * This is the single canonical mapping of `AttentionItem["type"]` to
 * color token and icon name. Two rendering contexts consume it:
 *
 *   1. **DOM / React** (`AttentionList.tsx`): resolves `iconName` to a
 *      `lucide-react` component via `getAttentionDOMIcon`.
 *   2. **Canvas SVG** (`AttentionBadge.tsx`): resolves `iconName` to a
 *      static inline SVG path via `getAttentionSVGPath`.
 *
 * Keeping the color/icon mapping here avoids duplication and ensures
 * that both contexts always agree on "which icon / color = which state."
 */
import type { AttentionItem } from "./topItems";

export interface AttentionTypeMeta {
  type: AttentionItem["type"];
  /**
   * Tailwind color class for icon rendering in DOM contexts.
   * Use `colorHex` for SVG/canvas contexts where Tailwind classes
   * aren't processed.
   */
  colorClass: string;
  /**
   * Hex color for SVG/canvas contexts.
   * Matches the visual intent of `colorClass` (amber-500 / emerald-500).
   */
  colorHex: string;
  /**
   * Logical icon name — resolved to a concrete icon by each rendering
   * adapter (DOM: lucide-react component; canvas: inline SVG path).
   */
  iconName: "alert-triangle" | "message-circle-question" | "check-circle-2";
  /** Human-readable label for the signal type. */
  label: string;
}

/**
 * Canonical type-bucket ordering: earlier buckets rank higher when
 * consumers sort attention items by type. This is the single source
 * of truth — `topItems.ts` imports it for its server-side ranking,
 * and client-side consumers (e.g. the org-canvas Live Now panel)
 * import it instead of re-declining a private copy that could drift.
 *
 * Kept here (rather than in `topItems.ts`, which imports `db` and
 * Prisma) so client bundles can consume the ordering without pulling
 * server-only modules into the client graph.
 */
export const ATTENTION_TYPE_ORDER: Record<AttentionItem["type"], number> = {
  halted: 0,
  "awaiting-reply": 1,
  "plan-question": 2,
  "ready-to-review": 3,
};

/**
 * Canonical per-type metadata. Key order matches `ATTENTION_TYPE_ORDER`
 * above (halted first, ready-to-review last) but ordering here has no
 * runtime effect — consumers key by `type`.
 */
export const ATTENTION_TYPE_META: Record<
  AttentionItem["type"],
  AttentionTypeMeta
> = {
  halted: {
    type: "halted",
    colorClass: "text-amber-500",
    colorHex: "#f59e0b",
    iconName: "alert-triangle",
    label: "Halted",
  },
  "awaiting-reply": {
    type: "awaiting-reply",
    colorClass: "text-amber-500",
    colorHex: "#f59e0b",
    iconName: "message-circle-question",
    label: "Awaiting your reply",
  },
  "plan-question": {
    type: "plan-question",
    colorClass: "text-amber-500",
    colorHex: "#f59e0b",
    iconName: "message-circle-question",
    label: "Question waiting",
  },
  "ready-to-review": {
    type: "ready-to-review",
    colorClass: "text-emerald-500",
    colorHex: "#10b981",
    iconName: "check-circle-2",
    label: "Ready to review",
  },
};

// ---------------------------------------------------------------------------
// SVG path adapter — canvas rendering context
// ---------------------------------------------------------------------------

/**
 * Static inline SVG paths for each icon name. These are equivalent to
 * the lucide-react glyphs but expressed as raw SVG `<path d>` strings
 * so they can be used inside the canvas SVG tree without importing
 * HTML-authored React components (which don't survive the canvas's
 * outer transform stack reliably).
 *
 * All paths assume a 24×24 viewBox (standard lucide convention).
 * `strokeLinecap: "round"` and `strokeLinejoin: "round"` are applied
 * by the renderer.
 */
export const SVG_PATHS: Record<
  AttentionTypeMeta["iconName"],
  { paths: string[]; viewBox: string }
> = {
  "alert-triangle": {
    viewBox: "0 0 24 24",
    paths: [
      // Lucide AlertTriangle: outer triangle + vertical bar + dot
      "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z",
      "M12 9v4",
      "M12 17h.01",
    ],
  },
  "message-circle-question": {
    viewBox: "0 0 24 24",
    paths: [
      // Lucide MessageCircleQuestion: speech bubble + question mark
      "M7.9 20A9 9 0 1 0 4 16.1L2 22Z",
      "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3",
      "M12 17h.01",
    ],
  },
  "check-circle-2": {
    viewBox: "0 0 24 24",
    paths: [
      // Lucide CheckCircle2: circle + check
      "M22 11.08V12a10 10 0 1 1-5.93-9.14",
      "m9 11 3 3L22 4",
    ],
  },
};

// ---------------------------------------------------------------------------
// DOM icon adapter — React / lucide-react rendering context
// ---------------------------------------------------------------------------

/**
 * Maps `iconName` → the corresponding lucide-react component.
 * Imported lazily by `AttentionList.tsx` so the canvas bundle never
 * pulls in lucide-react unnecessarily.
 *
 * Returns the component constructor; callers render it with
 * `createElement(icon, props)` or `<Icon {...props} />`.
 */
export async function getAttentionDOMIcon(
  iconName: AttentionTypeMeta["iconName"],
): Promise<React.ComponentType<React.SVGProps<SVGSVGElement>>> {
  const { AlertTriangle, MessageCircleQuestion, CheckCircle2 } = await import(
    "lucide-react"
  );
  const map = {
    "alert-triangle": AlertTriangle,
    "message-circle-question": MessageCircleQuestion,
    "check-circle-2": CheckCircle2,
  } as const;
  return map[iconName] as React.ComponentType<React.SVGProps<SVGSVGElement>>;
}
