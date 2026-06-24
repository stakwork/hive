"use client";

import React from "react";
import { CrosshairIcon } from "lucide-react";
import { useCanvasChatStore } from "../_state/canvasChatStore";

interface CanvasDeeplinkChipProps {
  nodeId: string;
  /** Empty string = root canvas. */
  canvasRef: string;
  label: string;
  x?: number;
  y?: number;
}

/**
 * A clickable pill chip rendered in chat when the canvas agent emits a
 * markdown link with `?canvas=<ref>&node=<nodeId>` params. Clicking it
 * writes a `pendingDeeplink` command to `canvasChatStore`; the
 * `OrgCanvasBackground` effect consumes it to navigate the canvas.
 */
export function CanvasDeeplinkChip({
  nodeId,
  canvasRef,
  label,
  x,
  y,
}: CanvasDeeplinkChipProps) {
  const handleClick = () => {
    useCanvasChatStore
      .getState()
      .triggerDeeplink({ nodeId, canvasRef, label, x, y });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-600 hover:bg-sky-100 cursor-pointer select-none transition-colors"
      data-testid="canvas-deeplink-chip"
    >
      <CrosshairIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
