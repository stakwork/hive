// @vitest-environment jsdom
/**
 * Unit tests for whiteboard fullscreen localStorage persistence.
 *
 * These tests cover the lazy initialisers and setter behaviour added to
 * src/app/w/[slug]/whiteboards/[id]/page.tsx without mounting the full page
 * component (which pulls in Excalidraw and heavy Next.js machinery).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Helpers that mirror the logic in the page component
// ---------------------------------------------------------------------------

function getInitialFullscreen(whiteboardId: string): boolean {
  if (typeof window !== "undefined") {
    return localStorage.getItem(`whiteboard-fullscreen-${whiteboardId}`) === "true";
  }
  return false;
}

function toggleFullscreen(
  prev: boolean,
  whiteboardId: string,
  setItem: (key: string, value: string) => void
): boolean {
  const next = !prev;
  setItem(`whiteboard-fullscreen-${whiteboardId}`, String(next));
  return next;
}

function escapeFullscreen(
  whiteboardId: string,
  setItem: (key: string, value: string) => void
): boolean {
  setItem(`whiteboard-fullscreen-${whiteboardId}`, "false");
  return false;
}

// ---------------------------------------------------------------------------

describe("Whiteboard fullscreen — localStorage persistence", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    global.localStorage = {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        store = {};
      }),
      length: 0,
      key: vi.fn(),
    } as Storage;
  });

  // -------------------------------------------------------------------------
  // Lazy initialiser
  // -------------------------------------------------------------------------

  it("initialises to false when no localStorage entry exists", () => {
    expect(getInitialFullscreen("wb-1")).toBe(false);
  });

  it("initialises to true when localStorage value is 'true'", () => {
    store["whiteboard-fullscreen-wb-1"] = "true";
    expect(getInitialFullscreen("wb-1")).toBe(true);
  });

  it("initialises to false when localStorage value is 'false'", () => {
    store["whiteboard-fullscreen-wb-1"] = "false";
    expect(getInitialFullscreen("wb-1")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // toggleFullscreen
  // -------------------------------------------------------------------------

  it("persists 'true' to localStorage when toggling from false", () => {
    const next = toggleFullscreen(false, "wb-1", localStorage.setItem.bind(localStorage));
    expect(next).toBe(true);
    expect(localStorage.setItem).toHaveBeenCalledWith("whiteboard-fullscreen-wb-1", "true");
  });

  it("persists 'false' to localStorage when toggling from true", () => {
    const next = toggleFullscreen(true, "wb-1", localStorage.setItem.bind(localStorage));
    expect(next).toBe(false);
    expect(localStorage.setItem).toHaveBeenCalledWith("whiteboard-fullscreen-wb-1", "false");
  });

  // -------------------------------------------------------------------------
  // Escape key handler
  // -------------------------------------------------------------------------

  it("persists 'false' to localStorage when Escape exits fullscreen", () => {
    const next = escapeFullscreen("wb-1", localStorage.setItem.bind(localStorage));
    expect(next).toBe(false);
    expect(localStorage.setItem).toHaveBeenCalledWith("whiteboard-fullscreen-wb-1", "false");
  });

  // -------------------------------------------------------------------------
  // Per-whiteboard independence
  // -------------------------------------------------------------------------

  it("uses independent keys for different whiteboard IDs", () => {
    store["whiteboard-fullscreen-wb-aaa"] = "true";
    store["whiteboard-fullscreen-wb-bbb"] = "false";

    expect(getInitialFullscreen("wb-aaa")).toBe(true);
    expect(getInitialFullscreen("wb-bbb")).toBe(false);
  });

  it("writing to one whiteboard key does not affect another", () => {
    toggleFullscreen(false, "wb-aaa", localStorage.setItem.bind(localStorage));

    // wb-bbb key should remain untouched
    expect(store["whiteboard-fullscreen-wb-bbb"]).toBeUndefined();
    expect(getInitialFullscreen("wb-bbb")).toBe(false);
  });
});
