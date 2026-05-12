/**
 * Pure utility functions for managing Excalidraw whiteboard elements.
 * This file must remain free of server-only imports so it can be used in client components.
 */

/**
 * Creates a visually distinct link object (rectangle + bound text) at the given
 * canvas coordinates. The rectangle carries the native Excalidraw `link` property
 * so the built-in link tooltip and `onLinkOpen` callback work without extra code.
 */
export function createLinkElement(
  url: string,
  label: string,
  centerX: number,
  centerY: number
): unknown[] {
  const rectId = Math.random().toString(36).substring(2, 15);
  const textId = Math.random().toString(36).substring(2, 15);
  const groupId = Math.random().toString(36).substring(2, 15);
  const timestamp = Date.now();
  const width = 240;
  const height = 64;

  const rect = {
    id: rectId,
    type: "rectangle",
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
    angle: 0,
    strokeColor: "#3b82f6",
    backgroundColor: "#eff6ff",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [groupId],
    frameId: null,
    roundness: { type: 3 },
    seed: Math.floor(Math.random() * 1000000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 1000000),
    isDeleted: false,
    boundElements: [{ id: textId, type: "text" }],
    updated: timestamp,
    link: url,
    locked: false,
    customData: { isLinkObject: true },
  };

  const text = {
    id: textId,
    type: "text",
    x: centerX - width / 2 + 8,
    y: centerY - 10,
    width: width - 16,
    height: 20,
    angle: 0,
    strokeColor: "#1e40af",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [groupId],
    frameId: null,
    roundness: null,
    seed: Math.floor(Math.random() * 1000000),
    version: 1,
    versionNonce: Math.floor(Math.random() * 1000000),
    isDeleted: false,
    boundElements: null,
    updated: timestamp,
    link: null,
    locked: false,
    text: label,
    fontSize: 16,
    fontFamily: 2,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: rectId,
    originalText: label,
    autoResize: true,
    lineHeight: 1.25,
    customData: { isLinkObject: true },
  };

  return [rect, text];
}

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
