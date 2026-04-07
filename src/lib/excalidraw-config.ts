import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, NormalizedZoomValue } from "@excalidraw/excalidraw/types";

/**
 * Default Excalidraw configuration for whiteboards
 *
 * Font families: 1 = Virgil (hand-drawn), 2 = Helvetica, 3 = Cascadia (code)
 * Roughness: 0 = architect (clean), 1 = artist (slight roughness), 2 = cartoonist (very rough)
 * Stroke style: "solid" | "dashed" | "dotted"
 */
export const EXCALIDRAW_DEFAULTS: Partial<AppState> = {
  // Helvetica font - clean sans-serif
  currentItemFontFamily: 2,
  // Architect style - clean, sharp lines
  currentItemRoughness: 0,
  // Solid stroke
  currentItemStrokeStyle: "solid",
};

/** Element-level style defaults applied to pasted/generated elements */
export const ELEMENT_STYLE_DEFAULTS = {
  roughness: 0,
  fontFamily: 2,
  strokeStyle: "solid" as const,
};

/**
 * Normalize element styles to match our defaults.
 * Call on a set of element IDs (e.g. newly pasted) to enforce architect style.
 * Returns a new array only if changes were made; otherwise returns null.
 */
export function normalizeElementStyles(
  elements: readonly ExcalidrawElement[],
  targetIds: Set<string>
): readonly ExcalidrawElement[] | null {
  let changed = false;
  const result = elements.map((el) => {
    if (!targetIds.has(el.id)) return el;

    const updates: Record<string, unknown> = {};
    if (el.roughness !== ELEMENT_STYLE_DEFAULTS.roughness) {
      updates.roughness = ELEMENT_STYLE_DEFAULTS.roughness;
    }
    if (el.strokeStyle !== ELEMENT_STYLE_DEFAULTS.strokeStyle) {
      updates.strokeStyle = ELEMENT_STYLE_DEFAULTS.strokeStyle;
    }
    if (
      "fontFamily" in el &&
      el.fontFamily !== ELEMENT_STYLE_DEFAULTS.fontFamily
    ) {
      updates.fontFamily = ELEMENT_STYLE_DEFAULTS.fontFamily;
    }

    if (Object.keys(updates).length > 0) {
      changed = true;
      return { ...el, ...updates } as ExcalidrawElement;
    }
    return el;
  });

  return changed ? result : null;
}

/**
 * Merge saved appState with defaults, ensuring our defaults take precedence
 * for new elements while preserving view settings from saved state
 */
export function getInitialAppState(
  savedAppState: Partial<AppState> = {}
): Partial<AppState> {
  // Strip zoom so a persisted/internal zoom value never bleeds through
  const { zoom: _zoom, ...safeAppState } = savedAppState;
  return {
    ...EXCALIDRAW_DEFAULTS,
    ...safeAppState,
    // Always apply our defaults for new element creation
    currentItemFontFamily: EXCALIDRAW_DEFAULTS.currentItemFontFamily,
    currentItemRoughness: EXCALIDRAW_DEFAULTS.currentItemRoughness,
    currentItemStrokeStyle: EXCALIDRAW_DEFAULTS.currentItemStrokeStyle,
    // Always start at 100% zoom — never inherit a persisted/internal zoom value
    zoom: { value: 1 as NormalizedZoomValue },
  };
}
