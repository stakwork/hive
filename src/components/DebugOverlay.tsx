"use client";

import { useState } from "react";

interface DebugOverlayProps {
  isActive: boolean;
  isSubmitting: boolean;
  onDebugSelection: (
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void;
}

export function DebugOverlay({
  isActive,
  isSubmitting,
  onDebugSelection,
}: DebugOverlayProps) {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [selectionCurrent, setSelectionCurrent] = useState<{
    x: number;
    y: number;
  } | null>(null);

  if (!isActive) return null;

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsSelecting(true);
    setSelectionStart({ x, y });
    setSelectionCurrent({ x, y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isSelecting || !selectionStart) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setSelectionCurrent({ x, y });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!selectionStart) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;

    // Calculate selection area (works for both clicks and drags)
    const x = Math.min(selectionStart.x, endX);
    const y = Math.min(selectionStart.y, endY);
    const width = Math.abs(endX - selectionStart.x);
    const height = Math.abs(endY - selectionStart.y);

    onDebugSelection(x, y, width, height);

    // Reset selection state
    setIsSelecting(false);
    setSelectionStart(null);
    setSelectionCurrent(null);
  };

  const getSelectionStyle = () => {
    if (!isSelecting || !selectionStart || !selectionCurrent) return {};

    const x = Math.min(selectionStart.x, selectionCurrent.x);
    const y = Math.min(selectionStart.y, selectionCurrent.y);
    const width = Math.abs(selectionCurrent.x - selectionStart.x);
    const height = Math.abs(selectionCurrent.y - selectionStart.y);

    return {
      left: x,
      top: y,
      width,
      height,
    };
  };

  return (
    <div
      className="absolute inset-0 z-10 cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{ backgroundColor: "rgba(59, 130, 246, 0.1)" }}
    >
      {/* Selection rectangle (only show if actively selecting and has some size) */}
      {isSelecting && selectionStart && selectionCurrent && (
        <div
          className="absolute border-2 border-blue-500 bg-blue-200/20"
          style={getSelectionStyle()}
        />
      )}

      {/* Debug mode indicator */}
      <div className="absolute top-2 left-2 bg-blue-600 text-white text-xs px-2 py-1 rounded">
        {isSubmitting ? (
          <>⏳ Sending debug info...</>
        ) : (
          <>🐛 Debug Mode: Click or drag to identify elements</>
        )}
      </div>
    </div>
  );
}