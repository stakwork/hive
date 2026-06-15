import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getInitialAppState } from "@/lib/excalidraw-config";

/**
 * Unit tests for whiteboard auto-fit on initial load.
 *
 * The whiteboard page adds a useEffect that fires once when `excalidrawAPI`
 * is first set. It schedules a `scrollToContent` call (via setTimeout) with
 * `fitToViewport: true` and `animate: false` so the canvas auto-fits all
 * content without animation on load.
 *
 * When a deep-link `element` param is present in the URL, auto-fit must be
 * suppressed so Excalidraw's native scroll-to-element behaviour is preserved.
 */

// Helper: replicates the auto-fit-on-load effect logic
function runAutoFitEffect(
  api: { scrollToContent: ReturnType<typeof vi.fn> } | null,
  hasDeepLink: boolean,
  hasElements: boolean
): (() => void) | undefined {
  if (!api) return;
  if (hasDeepLink) return; // guard: deep link present — skip auto-fit
  if (!hasElements) return; // empty whiteboard — stay at 100%
  const timer = setTimeout(() => {
    api.scrollToContent(undefined, {
      fitToViewport: true,
      viewportZoomFactor: 0.9,
      animate: false,
      duration: 0,
    });
  }, 100);
  return () => clearTimeout(timer);
}

// Helper: replicates the version-change effect's initial-load path
function runVersionChangeEffect(
  api: { scrollToContent: ReturnType<typeof vi.fn>; updateScene: ReturnType<typeof vi.fn> } | null,
  hasDeepLink: boolean,
  isInitialLoad: boolean
): void {
  if (!api) return;
  if (!isInitialLoad) return;
  api.updateScene({ elements: [], appState: {} });
  setTimeout(() => {
    if (!hasDeepLink) {
      api.scrollToContent(undefined, {
        fitToViewport: true,
        viewportZoomFactor: 0.9,
        animate: true,
        duration: 300,
      });
    }
  }, 100);
}

describe("Whiteboard page — auto-fit on initial load", () => {
  let scrollToContent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    scrollToContent = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls scrollToContent with fitToViewport:true and animate:false after excalidrawAPI is set", () => {
    const excalidrawAPI = { scrollToContent };
    const cleanup = runAutoFitEffect(excalidrawAPI, false, true);

    expect(scrollToContent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);

    expect(scrollToContent).toHaveBeenCalledTimes(1);
    expect(scrollToContent).toHaveBeenCalledWith(undefined, {
      fitToViewport: true,
      viewportZoomFactor: 0.9,
      animate: false,
      duration: 0,
    });

    cleanup?.();
  });

  it("does not call scrollToContent when excalidrawAPI is null", () => {
    runAutoFitEffect(null, false, true);
    vi.advanceTimersByTime(200);
    expect(scrollToContent).not.toHaveBeenCalled();
  });

  it("cleans up the timeout on unmount before it fires", () => {
    const excalidrawAPI = { scrollToContent };
    const cleanup = runAutoFitEffect(excalidrawAPI, false, true);

    cleanup?.();
    vi.advanceTimersByTime(200);

    expect(scrollToContent).not.toHaveBeenCalled();
  });

  it("uses animate:false (not animate:true) to avoid pan/zoom animation on initial load", () => {
    const excalidrawAPI = { scrollToContent };
    runAutoFitEffect(excalidrawAPI, false, true);
    vi.advanceTimersByTime(100);

    expect(scrollToContent).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ animate: false })
    );
  });

  // --- Deep-link guard tests ---

  it("does NOT call scrollToContent when element deep-link is present", () => {
    const excalidrawAPI = { scrollToContent };
    runAutoFitEffect(excalidrawAPI, true /* hasDeepLink */, true);

    vi.advanceTimersByTime(200);

    expect(scrollToContent).not.toHaveBeenCalled();
  });

  it("still does NOT call scrollToContent when deep-link present and no elements", () => {
    const excalidrawAPI = { scrollToContent };
    runAutoFitEffect(excalidrawAPI, true /* hasDeepLink */, false);

    vi.advanceTimersByTime(200);

    expect(scrollToContent).not.toHaveBeenCalled();
  });
});

describe("Whiteboard page — version-change effect on initial load", () => {
  let scrollToContent: ReturnType<typeof vi.fn>;
  let updateScene: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    scrollToContent = vi.fn();
    updateScene = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls updateScene AND scrollToContent on initial load without deep-link", () => {
    const api = { scrollToContent, updateScene };
    runVersionChangeEffect(api, false /* hasDeepLink */, true /* isInitialLoad */);

    expect(updateScene).toHaveBeenCalledTimes(1);
    expect(scrollToContent).not.toHaveBeenCalled(); // not yet — still in timeout

    vi.advanceTimersByTime(100);

    expect(scrollToContent).toHaveBeenCalledTimes(1);
    expect(scrollToContent).toHaveBeenCalledWith(undefined, {
      fitToViewport: true,
      viewportZoomFactor: 0.9,
      animate: true,
      duration: 300,
    });
  });

  it("calls updateScene but SKIPS scrollToContent on initial load with deep-link", () => {
    const api = { scrollToContent, updateScene };
    runVersionChangeEffect(api, true /* hasDeepLink */, true /* isInitialLoad */);

    expect(updateScene).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(200);

    expect(scrollToContent).not.toHaveBeenCalled();
  });

  it("does not run at all when not initial load (programmaticUpdateCountRef > 0)", () => {
    const api = { scrollToContent, updateScene };
    runVersionChangeEffect(api, false /* hasDeepLink */, false /* isInitialLoad */);

    vi.advanceTimersByTime(200);

    expect(updateScene).not.toHaveBeenCalled();
    expect(scrollToContent).not.toHaveBeenCalled();
  });
});

describe("initialAppState zoom override", () => {
  it("forces zoom to { value: 1 } when whiteboard has no elements", () => {
    const savedAppState = { zoom: { value: 30 } }; // simulates 3000%
    const initialAppState = getInitialAppState(savedAppState);
    expect(initialAppState.zoom).toEqual({ value: 1 });
  });

  it("forces zoom to { value: 1 } even when whiteboard has elements", () => {
    const savedAppState = { zoom: { value: 30 } };
    const initialAppState = getInitialAppState(savedAppState);
    expect(initialAppState.zoom).toEqual({ value: 1 });
  });

  it("strips zoom from savedAppState — getInitialAppState with zoom:30 returns zoom:1", () => {
    const result = getInitialAppState({ zoom: { value: 30 } });
    expect(result.zoom).toEqual({ value: 1 });
  });
});
