/**
 * Pure utility functions for managing Excalidraw whiteboard elements.
 * This file must remain free of server-only imports so it can be used in client components.
 */

/**
 * Merges user-created and AI-generated elements, removing any previously AI-generated
 * elements so the new set fully replaces them while preserving user content.
 */
export function mergeWhiteboardElements(
  existing: unknown[],
  aiGenerated: unknown[]
): unknown[] {
  const userElements = existing.filter(
    (el) =>
      (el as Record<string, unknown> & { customData?: { source?: string } })
        .customData?.source !== "ai"
  );
  return [...userElements, ...aiGenerated];
}

/**
 * Stamp customData.source = "ai" on every element so mergeWhiteboardElements
 * correctly identifies them as AI-generated. Returns a new array; input is not mutated.
 */
export function tagElementsAsAi(elements: unknown[]): unknown[] {
  return elements.map((el) => {
    const e = el as Record<string, unknown>;
    return {
      ...e,
      customData: { ...((e.customData as Record<string, unknown>) ?? {}), source: "ai" },
    };
  });
}
