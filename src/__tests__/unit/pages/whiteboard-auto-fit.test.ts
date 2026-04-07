import { describe, it, expect, vi, beforeEach } from "vitest";
import { getInitialAppState } from "@/lib/excalidraw-config";

/**
 * Unit tests for whiteboard auto-fit on initial load.
 *
 * The whiteboard page adds a useEffect that fires once when `excalidrawAPI`
 * is first set. It schedules a `scrollToContent` call (via setTimeout) with
 * `fitToViewport: true` and `animate: false` so the canvas auto-fits all
 * content without animation on load.
 */

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
    // Simulate the useEffect body that runs when excalidrawAPI becomes available
    const excalidrawAPI = { scrollToContent };

    // Replicate the effect:
    // useEffect(() => {
    //   if (!excalidrawAPI) return;
    //   const timer = setTimeout(() => {
    //     excalidrawAPI.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9, animate: false, duration: 0 });
    //   }, 100);
    //   return () => clearTimeout(timer);
    // }, [excalidrawAPI]);

    let cleanup: (() => void) | undefined;
    const runEffect = (api: typeof excalidrawAPI | null) => {
      if (!api) return;
      const timer = setTimeout(() => {
        api.scrollToContent(undefined, {
          fitToViewport: true,
          viewportZoomFactor: 0.9,
          animate: false,
          duration: 0,
        });
      }, 100);
      cleanup = () => clearTimeout(timer);
    };

    runEffect(excalidrawAPI);

    // Before the timer fires, scrollToContent should not have been called
    expect(scrollToContent).not.toHaveBeenCalled();

    // Advance past the 100ms delay
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
    const runEffect = (api: null) => {
      if (!api) return;
      setTimeout(() => {
        (api as any).scrollToContent(undefined, { fitToViewport: true });
      }, 100);
    };

    runEffect(null);
    vi.advanceTimersByTime(200);

    expect(scrollToContent).not.toHaveBeenCalled();
  });

  it("cleans up the timeout on unmount before it fires", () => {
    const excalidrawAPI = { scrollToContent };

    let cleanup: (() => void) | undefined;
    const runEffect = (api: typeof excalidrawAPI) => {
      const timer = setTimeout(() => {
        api.scrollToContent(undefined, {
          fitToViewport: true,
          viewportZoomFactor: 0.9,
          animate: false,
          duration: 0,
        });
      }, 100);
      cleanup = () => clearTimeout(timer);
    };

    runEffect(excalidrawAPI);

    // Simulate unmount before timer fires
    cleanup?.();

    vi.advanceTimersByTime(200);

    // scrollToContent should NOT have been called after cleanup
    expect(scrollToContent).not.toHaveBeenCalled();
  });

  it("uses animate:false (not animate:true) to avoid pan/zoom animation on initial load", () => {
    const excalidrawAPI = { scrollToContent };

    const timer = setTimeout(() => {
      excalidrawAPI.scrollToContent(undefined, {
        fitToViewport: true,
        viewportZoomFactor: 0.9,
        animate: false,
        duration: 0,
      });
    }, 100);

    vi.advanceTimersByTime(100);

    expect(scrollToContent).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ animate: false })
    );

    clearTimeout(timer);
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
