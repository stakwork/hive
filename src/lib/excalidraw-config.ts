/**
 * Default Excalidraw configuration for whiteboards
 *
 * Font families: 1 = Virgil (hand-drawn), 2 = Helvetica, 3 = Cascadia (code)
 * Roughness: 0 = architect (clean), 1 = artist (slight roughness), 2 = cartoonist (very rough)
 * Stroke style: "solid" | "dashed" | "dotted"
 */
export const EXCALIDRAW_DEFAULTS = {
  // Helvetica font - clean sans-serif
  currentItemFontFamily: 2,
  // Architect style - clean, sharp lines
  currentItemRoughness: 0,
  // Solid stroke
  currentItemStrokeStyle: "solid" as const,
} as const;

/**
 * Merge saved appState with defaults, ensuring our defaults take precedence
 * for new elements while preserving view settings from saved state
 */
export function getInitialAppState(
  savedAppState: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...EXCALIDRAW_DEFAULTS,
    ...savedAppState,
    // Always apply our defaults for new element creation
    currentItemFontFamily: EXCALIDRAW_DEFAULTS.currentItemFontFamily,
    currentItemRoughness: EXCALIDRAW_DEFAULTS.currentItemRoughness,
    currentItemStrokeStyle: EXCALIDRAW_DEFAULTS.currentItemStrokeStyle,
  };
}
