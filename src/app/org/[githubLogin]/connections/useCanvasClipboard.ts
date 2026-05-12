"use client";

import { useEffect, useRef } from "react";
import { addNode, removeNode, type CanvasData, type CanvasNode } from "system-canvas-react";
import { generateNodeId } from "system-canvas";
import { SMALL_W } from "@/lib/canvas/geometry";

// ---------------------------------------------------------------------------
// Live-id detection — mirrors `src/lib/canvas/scope.ts`'s `isLiveId`.
// NOT imported from there because that module is server-side (pulls Prisma).
// ---------------------------------------------------------------------------

const LIVE_ID_PREFIXES = [
  "ws:",
  "feature:",
  "repo:",
  "initiative:",
  "milestone:",
  "task:",
  "research:",
] as const;

function isLiveId(id: string): boolean {
  return LIVE_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PASTE_SIDE_GAP = 40;

// ---------------------------------------------------------------------------
// Exported pure helpers
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the node can be copied/cut/pasted.
 * Excludes only DB-backed (live-id) nodes — anything the user authored
 * locally on the canvas is fair game.
 */
export function isCopyableNode(node: CanvasNode): boolean {
  return !isLiveId(node.id);
}

type ViewportState = { x: number; y: number; zoom: number };

/**
 * Computes where a pasted node should land.
 *
 * - Same viewport (no significant pan/zoom since copy): offset to the right of
 *   the original so both are visible simultaneously.
 * - Moved viewport: center of the current viewport in canvas coordinates.
 */
export function computePastePosition(
  node: CanvasNode,
  viewportAtCopy: ViewportState,
  viewportNow: ViewportState,
  containerW: number,
  containerH: number,
): { x: number; y: number } {
  const sameViewport =
    Math.abs(viewportAtCopy.x - viewportNow.x) < 50 &&
    Math.abs(viewportAtCopy.y - viewportNow.y) < 50 &&
    Math.abs(viewportAtCopy.zoom - viewportNow.zoom) < 0.01;

  if (sameViewport) {
    return {
      x: node.x + (node.width ?? SMALL_W) + PASTE_SIDE_GAP,
      y: node.y,
    };
  }

  const centerX = (-viewportNow.x + containerW / 2) / viewportNow.zoom;
  const centerY = (-viewportNow.y + containerH / 2) / viewportNow.zoom;
  return {
    x: centerX - (node.width ?? SMALL_W) / 2,
    y: centerY - (node.height ?? 80) / 2,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseCanvasClipboardParams {
  /**
   * Ref to the currently selected node. Passed as a ref (not a value)
   * because the caller updates selection through a `useRef` and never
   * re-renders on selection change — reading `.current` at hook-call
   * time would always see `null`.
   */
  selectedNodeRef: React.RefObject<CanvasNode | null>;
  currentRefRef: React.MutableRefObject<string>;
  applyMutation: (ref: string | undefined, mutate: (data: CanvasData) => CanvasData) => void;
  currentViewportRef: React.MutableRefObject<ViewportState>;
  canvasContainerRef: React.RefObject<HTMLDivElement | null>;
}

export default function useCanvasClipboard({
  selectedNodeRef,
  currentRefRef,
  applyMutation,
  currentViewportRef,
  canvasContainerRef,
}: UseCanvasClipboardParams): void {
  const clipboardRef = useRef<{
    node: CanvasNode;
    viewportAtCopy: ViewportState;
    sourceCanvasRef: string | undefined;
  } | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;

      // Don't intercept shortcuts inside text inputs / rich-text editors
      const tag = (e.target as HTMLElement).tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement).isContentEditable
      )
        return;

      const node = selectedNodeRef.current;

      if (e.key === "c") {
        if (node && isCopyableNode(node)) {
          clipboardRef.current = {
            node,
            viewportAtCopy: { ...currentViewportRef.current },
            sourceCanvasRef: currentRefRef.current || undefined,
          };
        }
        return;
      }

      if (e.key === "x") {
        if (node && isCopyableNode(node)) {
          clipboardRef.current = {
            node,
            viewportAtCopy: { ...currentViewportRef.current },
            sourceCanvasRef: currentRefRef.current || undefined,
          };
          applyMutation(currentRefRef.current || undefined, (c) =>
            removeNode(c, node.id),
          );
          e.preventDefault();
        }
        return;
      }

      if (e.key === "v") {
        if (!clipboardRef.current) return;
        const { node: clipNode, viewportAtCopy } = clipboardRef.current;
        const rect = canvasContainerRef.current?.getBoundingClientRect();
        const containerW = rect?.width ?? 0;
        const containerH = rect?.height ?? 0;
        const pos = computePastePosition(
          clipNode,
          viewportAtCopy,
          currentViewportRef.current,
          containerW,
          containerH,
        );
        applyMutation(currentRefRef.current || undefined, (c) =>
          addNode(c, { ...clipNode, id: generateNodeId(), x: pos.x, y: pos.y }),
        );
        e.preventDefault();
        return;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [applyMutation, canvasContainerRef, currentRefRef, currentViewportRef, selectedNodeRef]);
}
