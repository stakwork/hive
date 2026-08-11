import { useState, useRef, useEffect, DragEvent } from "react";

export interface UseFileDropOptions<T extends HTMLElement = HTMLElement> {
  disabled?: boolean;
  onDrop?: (files: FileList, event: DragEvent<T>) => void;
}

export interface UseFileDropResult<T extends HTMLElement = HTMLElement> {
  isDragging: boolean;
  dragProps: {
    onDragEnter: (e: DragEvent<T>) => void;
    onDragOver: (e: DragEvent<T>) => void;
    onDragLeave: (e: DragEvent<T>) => void;
    onDrop: (e: DragEvent<T>) => void;
  };
}

/**
 * Payload-agnostic, element-generic drag-state hook with:
 * - Clamped depth counter to fix nested-markup flicker
 * - Window-level self-heal listeners (non-cancelling, capture phase)
 * - Watchdog timer for ESC-cancel coverage
 * - Fully inert when disabled (no preventDefault, no window listeners)
 */
export function useFileDrop<T extends HTMLElement = HTMLElement>({
  disabled = false,
  onDrop,
}: UseFileDropOptions<T> = {}): UseFileDropResult<T> {
  const [isDragging, setIsDragging] = useState(false);
  const depthRef = useRef(0);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stabilise the onDrop callback so window listeners don't tear down on
  // every render (pattern from useControlKeyHold.ts)
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  const forceReset = () => {
    depthRef.current = 0;
    setIsDragging(false);
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  };

  const refreshWatchdog = () => {
    if (watchdogRef.current !== null) clearTimeout(watchdogRef.current);
    watchdogRef.current = setTimeout(forceReset, 1200);
  };

  // Window-level self-heal — registered only when enabled
  useEffect(() => {
    if (disabled) return;

    const onWindowDrop = () => forceReset();
    const onWindowDragEnd = () => forceReset();

    const onWindowDragLeave = (e: globalThis.DragEvent) => {
      // Only reset when the pointer actually left the viewport
      if (
        e.relatedTarget === null &&
        (e.clientX <= 0 ||
          e.clientY <= 0 ||
          e.clientX >= window.innerWidth ||
          e.clientY >= window.innerHeight)
      ) {
        forceReset();
      }
    };

    const onWindowDragOver = () => {
      refreshWatchdog();
    };

    // Capture phase so future stopPropagation at any site can't blind the reset.
    // NEVER call preventDefault/stopPropagation here — these listeners observe
    // every drag in the app (kanban, node-type reorder, etc).
    window.addEventListener("drop", onWindowDrop, true);
    window.addEventListener("dragend", onWindowDragEnd, true);
    window.addEventListener("dragleave", onWindowDragLeave, true);
    window.addEventListener("dragover", onWindowDragOver, true);

    return () => {
      window.removeEventListener("drop", onWindowDrop, true);
      window.removeEventListener("dragend", onWindowDragEnd, true);
      window.removeEventListener("dragleave", onWindowDragLeave, true);
      window.removeEventListener("dragover", onWindowDragOver, true);
      // Force-zero depth so an unmounting target can't leave the hook armed
      depthRef.current = 0;
      if (watchdogRef.current !== null) {
        clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  // ── Inert handlers when disabled ──────────────────────────────────
  if (disabled) {
    return {
      isDragging: false,
      dragProps: {
        onDragEnter: () => {},
        onDragOver: () => {},
        onDragLeave: () => {},
        onDrop: () => {},
      },
    };
  }

  // ── Active handlers ───────────────────────────────────────────────

  // Permissive: default to true when dataTransfer or types is absent/empty
  // so fixtures built without a full DataTransfer still work.
  const isFileDrag = (e: DragEvent<T>): boolean => {
    const types = e.dataTransfer?.types;
    if (!types || types.length === 0) return true;
    return types.includes("Files");
  };

  const onDragEnter = (e: DragEvent<T>) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depthRef.current += 1;
    if (depthRef.current > 0) setIsDragging(true);
  };

  const onDragOver = (e: DragEvent<T>) => {
    e.preventDefault();
    // Re-arm drag state in case a window-level reset fired prematurely
    if (isFileDrag(e)) {
      if (depthRef.current < 1) depthRef.current = 1;
      setIsDragging(true);
    }
  };

  const onDragLeave = (e: DragEvent<T>) => {
    e.preventDefault();
    // Clamp at zero — a window-level force-reset may have already zeroed it;
    // without the clamp we'd go to -1 and pin the overlay permanently off.
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setIsDragging(false);
  };

  const onDropHandler = (e: DragEvent<T>) => {
    e.preventDefault();
    forceReset();

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      onDropRef.current?.(files, e);
    }
  };

  return {
    isDragging,
    dragProps: {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop: onDropHandler,
    },
  };
}
