/**
 * Pure utility functions for managing Excalidraw whiteboard elements.
 * This file must remain free of server-only imports so it can be used in client components.
 */

/**
 * Merges user-created and AI-generated elements, removing previously AI-generated elements
 * so the new set replaces them while preserving user content.
 *
 * When `pasteId` is provided (client paste path), only elements whose `customData.pasteId`
 * matches are removed — leaving elements from other paste sessions intact.
 * When `pasteId` is omitted (server path), all `source === "ai"` elements are removed.
 */
export function mergeWhiteboardElements(
  existing: unknown[],
  aiGenerated: unknown[],
  pasteId?: string
): unknown[] {
  const userElements = existing.filter((el) => {
    const cd = (el as { customData?: { source?: string; pasteId?: string } }).customData;
    if (cd?.source !== "ai") return true;           // always keep user elements
    if (pasteId) return cd?.pasteId !== pasteId;    // scoped: keep other sessions' AI
    return false;                                   // unscoped: remove all AI (server path)
  });
  return [...userElements, ...aiGenerated];
}

/**
 * Stamp customData.source = "ai" on every element so mergeWhiteboardElements
 * correctly identifies them as AI-generated. Returns a new array; input is not mutated.
 *
 * When `pasteId` is provided, it is also stamped into `customData.pasteId` so that
 * scoped merging can identify which paste session produced each element.
 */
export function tagElementsAsAi(elements: unknown[], pasteId?: string): unknown[] {
  return elements.map((el) => {
    const e = el as Record<string, unknown>;
    return {
      ...e,
      customData: {
        ...((e.customData as Record<string, unknown>) ?? {}),
        source: "ai",
        ...(pasteId ? { pasteId } : {}),
      },
    };
  });
}
