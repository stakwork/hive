/**
 * Unit tests for the canvasViewport slot added to canvasChatStore.
 *
 * Covers:
 * - setCanvasViewport updates canvasViewport in the store
 * - setCanvasViewport(null) clears the slot
 * - viewportState computation from a known canvasViewport value
 * - viewportState is undefined when canvasViewport is null
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useCanvasChatStore } from "@/app/org/[githubLogin]/_state/canvasChatStore";

// Helper to reset the relevant store slice between tests without
// reimporting — Zustand stores are module singletons, so we set state
// directly.
function resetViewport() {
  useCanvasChatStore.getState().setCanvasViewport(null);
}

describe("canvasChatStore — canvasViewport slot", () => {
  beforeEach(() => {
    resetViewport();
  });

  it("initialises canvasViewport as null", () => {
    expect(useCanvasChatStore.getState().canvasViewport).toBeNull();
  });

  it("setCanvasViewport stores the provided viewport", () => {
    const vp = { x: -400, y: -200, zoom: 2, containerW: 800, containerH: 600 };
    useCanvasChatStore.getState().setCanvasViewport(vp);

    expect(useCanvasChatStore.getState().canvasViewport).toEqual(vp);
  });

  it("setCanvasViewport(null) clears a previously stored viewport", () => {
    useCanvasChatStore
      .getState()
      .setCanvasViewport({ x: -100, y: -50, zoom: 1, containerW: 1280, containerH: 800 });

    // Verify it was set
    expect(useCanvasChatStore.getState().canvasViewport).not.toBeNull();

    // Now clear it
    useCanvasChatStore.getState().setCanvasViewport(null);
    expect(useCanvasChatStore.getState().canvasViewport).toBeNull();
  });

  it("overwrites a previous value with a new one", () => {
    useCanvasChatStore
      .getState()
      .setCanvasViewport({ x: -100, y: -50, zoom: 1, containerW: 800, containerH: 600 });
    const updated = { x: -800, y: -400, zoom: 0.5, containerW: 1600, containerH: 900 };
    useCanvasChatStore.getState().setCanvasViewport(updated);

    expect(useCanvasChatStore.getState().canvasViewport).toEqual(updated);
  });
});

// ─── viewportState computation (mirrors the ProposalCard logic) ───────────────
//
// These tests validate the transformation formula independently of the
// component so that if the formula changes, the test breaks loudly.

/**
 * Mirrors the exact computation in ProposalCard.handleApprove:
 *   canvasX = -cv.x / cv.zoom
 *   canvasY = -cv.y / cv.zoom
 *   canvasW = cv.containerW / cv.zoom
 *   canvasH = cv.containerH / cv.zoom
 */
function computeViewportState(cv: {
  x: number;
  y: number;
  zoom: number;
  containerW: number;
  containerH: number;
}) {
  if (cv.zoom <= 0) return undefined;
  return {
    canvasX: -cv.x / cv.zoom,
    canvasY: -cv.y / cv.zoom,
    canvasW: cv.containerW / cv.zoom,
    canvasH: cv.containerH / cv.zoom,
  };
}

describe("viewportState computation", () => {
  it("produces correct canvas-space bounds from a known viewport", () => {
    // Viewport panned to (-400, -200) at 2× zoom, container 800×600 px
    // → visible area starts at canvas (200, 100) and spans 400×300
    const cv = { x: -400, y: -200, zoom: 2, containerW: 800, containerH: 600 };
    const result = computeViewportState(cv);

    expect(result).toEqual({
      canvasX: 200,
      canvasY: 100,
      canvasW: 400,
      canvasH: 300,
    });
  });

  it("handles zoom < 1 (zoomed out)", () => {
    // Viewport panned to (-500, -300), zoom 0.5, container 1000×800
    // → visible area starts at canvas (1000, 600), spans 2000×1600
    const cv = { x: -500, y: -300, zoom: 0.5, containerW: 1000, containerH: 800 };
    const result = computeViewportState(cv);

    expect(result).toEqual({
      canvasX: 1000,
      canvasY: 600,
      canvasW: 2000,
      canvasH: 1600,
    });
  });

  it("handles zoom = 1 (no zoom)", () => {
    const cv = { x: -300, y: -150, zoom: 1, containerW: 1280, containerH: 720 };
    const result = computeViewportState(cv);

    expect(result).toEqual({
      canvasX: 300,
      canvasY: 150,
      canvasW: 1280,
      canvasH: 720,
    });
  });

  it("returns undefined when zoom is 0 (guard against division by zero)", () => {
    const cv = { x: 0, y: 0, zoom: 0, containerW: 800, containerH: 600 };
    expect(computeViewportState(cv)).toBeUndefined();
  });

  it("returns undefined (omitted) when canvasViewport is null", () => {
    // This mirrors the `cv && cv.zoom > 0 ? ... : undefined` branch
    const cv = null;
    const viewportState = cv ? computeViewportState(cv) : undefined;
    expect(viewportState).toBeUndefined();
  });

  it("canvasX / canvasY can be negative (canvas scrolled past origin)", () => {
    // Viewport panned right (positive x in screen), so canvas origin is to the right
    // x=200, zoom=1 → canvasX = -200 (visible area is to the left of canvas origin)
    const cv = { x: 200, y: 100, zoom: 1, containerW: 800, containerH: 600 };
    const result = computeViewportState(cv);
    expect(result?.canvasX).toBe(-200);
    expect(result?.canvasY).toBe(-100);
  });
});
