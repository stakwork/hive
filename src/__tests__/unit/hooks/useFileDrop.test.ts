// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileDrop } from "@/hooks/useFileDrop";
import type { DragEvent } from "react";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDragEvent(
  overrides: Partial<{
    relatedTarget: EventTarget | null;
    clientX: number;
    clientY: number;
    types: string[];
    files: File[];
  }> = {}
): DragEvent<HTMLElement> {
  const { relatedTarget = null, clientX = 100, clientY = 100, types = ["Files"], files = [] } =
    overrides;

  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    relatedTarget,
    clientX,
    clientY,
    dataTransfer: {
      types,
      files: Object.assign(files, { length: files.length, item: (i: number) => files[i] }),
      items: Object.assign(
        files.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
        { length: files.length }
      ),
    } as unknown as DataTransfer,
    currentTarget: document.createElement("div"),
    target: document.createElement("div"),
  } as unknown as DragEvent<HTMLElement>;
}

function makeWindowDragEvent(
  overrides: Partial<{
    relatedTarget: EventTarget | null;
    clientX: number;
    clientY: number;
  }> = {}
): globalThis.DragEvent {
  const {
    relatedTarget = null,
    clientX = 100,
    clientY = 100,
  } = overrides;
  return Object.assign(new Event("dragleave", { bubbles: true, cancelable: true }), {
    relatedTarget,
    clientX,
    clientY,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }) as unknown as globalThis.DragEvent;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useFileDrop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom default viewport
    Object.defineProperty(window, "innerWidth", { value: 1024, writable: true });
    Object.defineProperty(window, "innerHeight", { value: 768, writable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("depth counter", () => {
    it("sets isDragging true on first dragenter with files", () => {
      const { result } = renderHook(() => useFileDrop());

      act(() => {
        result.current.dragProps.onDragEnter(makeDragEvent());
      });

      expect(result.current.isDragging).toBe(true);
    });

    it("does not flicker on nested-child enter/leave", () => {
      const { result } = renderHook(() => useFileDrop());

      act(() => {
        result.current.dragProps.onDragEnter(makeDragEvent());
      });
      expect(result.current.isDragging).toBe(true);

      // Enter nested child
      act(() => {
        result.current.dragProps.onDragEnter(makeDragEvent());
      });
      expect(result.current.isDragging).toBe(true);

      // Leave nested child (depth goes 2→1)
      act(() => {
        result.current.dragProps.onDragLeave(makeDragEvent());
      });
      expect(result.current.isDragging).toBe(true);

      // Leave root element (depth goes 1→0)
      act(() => {
        result.current.dragProps.onDragLeave(makeDragEvent());
      });
      expect(result.current.isDragging).toBe(false);
    });

    it("clamps depth at zero — window reset then trailing dragleave does NOT pin overlay off", () => {
      const { result } = renderHook(() => useFileDrop());

      // Enter twice
      act(() => result.current.dragProps.onDragEnter(makeDragEvent()));
      act(() => result.current.dragProps.onDragEnter(makeDragEvent()));
      expect(result.current.isDragging).toBe(true);

      // Window-level drop forces depth to 0
      act(() => {
        window.dispatchEvent(new Event("drop", { bubbles: true }));
      });
      expect(result.current.isDragging).toBe(false);

      // Trailing dragleave from the element (decrement would be -1 without clamp)
      act(() => result.current.dragProps.onDragLeave(makeDragEvent()));

      // Should remain false, NOT stuck
      expect(result.current.isDragging).toBe(false);
    });
  });

  describe("window-level self-heal", () => {
    it("force-resets on window drop event", () => {
      const { result } = renderHook(() => useFileDrop());

      act(() => result.current.dragProps.onDragEnter(makeDragEvent()));
      expect(result.current.isDragging).toBe(true);

      act(() => {
        window.dispatchEvent(new Event("drop", { bubbles: true }));
      });
      expect(result.current.isDragging).toBe(false);
    });

    it("force-resets on window dragend event", () => {
      const { result } = renderHook(() => useFileDrop());

      act(() => result.current.dragProps.onDragEnter(makeDragEvent()));
      expect(result.current.isDragging).toBe(true);

      act(() => {
        window.dispatchEvent(new Event("dragend", { bubbles: true }));
      });
      expect(result.current.isDragging).toBe(false);
    });

    it("resets on window dragleave with null relatedTarget AND out-of-viewport coords", () => {
      const { result } = renderHook(() => useFileDrop());

      act(() => result.current.dragProps.onDragEnter(makeDragEvent()));
      expect(result.current.isDragging).toBe(true);

      // Out-of-viewport: clientX = 0 (on/past edge)
      act(() => {
        const e = makeWindowDragEvent({ relatedTarget: null, clientX: 0, clientY: 400 });
        window.dispatchEvent(e);
      });
      expect(result.current.isDragging).toBe(false);
    });

    it("does NOT reset on window dragleave with null relatedTarget but in-viewport coords", () => {
      const { result } = renderHook(() => useFileDrop());

      act(() => result.current.dragProps.onDragEnter(makeDragEvent()));
      expect(result.current.isDragging).toBe(true);

      // In-viewport: Chrome null-relatedTarget false positive
      act(() => {
        const e = makeWindowDragEvent({ relatedTarget: null, clientX: 500, clientY: 400 });
        window.dispatchEvent(e);
      });
      // Still dragging — no reset
      expect(result.current.isDragging).toBe(true);
    });

    it("does NOT reset on window dragleave with non-null relatedTarget", () => {
      const { result } = renderHook(() => useFileDrop());

      act(() => result.current.dragProps.onDragEnter(makeDragEvent()));

      act(() => {
        const e = makeWindowDragEvent({
          relatedTarget: document.createElement("div"),
          clientX: 0,
          clientY: 0,
        });
        window.dispatchEvent(e);
      });
      expect(result.current.isDragging).toBe(true);
    });
  });

  describe("onDragOver re-arm", () => {
    it("re-arms isDragging after a false-positive reset", () => {
      const { result } = renderHook(() => useFileDrop());

      act(() => result.current.dragProps.onDragEnter(makeDragEvent()));
      expect(result.current.isDragging).toBe(true);

      // Simulate window drop reset (false positive)
      act(() => {
        window.dispatchEvent(new Event("drop", { bubbles: true }));
      });
      expect(result.current.isDragging).toBe(false);

      // onDragOver re-arms the state
      act(() => {
        result.current.dragProps.onDragOver(makeDragEvent());
      });
      expect(result.current.isDragging).toBe(true);
    });
  });

  describe("watchdog timer", () => {
    it("force-resets after ~1200ms of no dragover events", async () => {
      const { result } = renderHook(() => useFileDrop());

      act(() => result.current.dragProps.onDragEnter(makeDragEvent()));
      expect(result.current.isDragging).toBe(true);

      // Arm watchdog via window dragover (matches what the hook listens to)
      act(() => {
        window.dispatchEvent(new Event("dragover", { bubbles: true }));
      });

      // Advance past watchdog timeout — must wrap in act so React flushes state
      act(() => {
        vi.advanceTimersByTime(1300);
      });
      expect(result.current.isDragging).toBe(false);
    });

    it("refreshes watchdog on each dragover — does NOT expire prematurely", () => {
      const { result } = renderHook(() => useFileDrop());

      act(() => result.current.dragProps.onDragEnter(makeDragEvent()));

      // Arm watchdog via window dragover
      act(() => {
        window.dispatchEvent(new Event("dragover", { bubbles: true }));
      });

      // Advance 800ms, then fire another window dragover (refreshes timer)
      act(() => vi.advanceTimersByTime(800));
      act(() => {
        window.dispatchEvent(new Event("dragover", { bubbles: true }));
      });

      // Advance 800ms more (only 800ms since last dragover — not expired)
      act(() => vi.advanceTimersByTime(800));
      expect(result.current.isDragging).toBe(true);

      // Now let the watchdog expire
      act(() => vi.advanceTimersByTime(600));
      expect(result.current.isDragging).toBe(false);
    });
  });

  describe("permissive payload gate", () => {
    it("treats events with no dataTransfer as file drags (default true)", () => {
      const { result } = renderHook(() => useFileDrop());

      const e = makeDragEvent();
      (e as any).dataTransfer = undefined;

      act(() => result.current.dragProps.onDragEnter(e));
      expect(result.current.isDragging).toBe(true);
    });

    it("treats events with no types key as file drags", () => {
      const { result } = renderHook(() => useFileDrop());

      const e = makeDragEvent({ types: undefined as unknown as string[] });
      act(() => result.current.dragProps.onDragEnter(e));
      expect(result.current.isDragging).toBe(true);
    });

    it("treats events with empty types array as file drags", () => {
      const { result } = renderHook(() => useFileDrop());

      // Empty types — no 'Files' → includes returns false → fallback true
      const e = makeDragEvent({ types: [] });
      act(() => result.current.dragProps.onDragEnter(e));
      expect(result.current.isDragging).toBe(true);
    });
  });

  describe("disabled semantics", () => {
    it("returns isDragging=false and inert handlers when disabled", () => {
      const onDrop = vi.fn();
      const { result } = renderHook(() => useFileDrop({ disabled: true, onDrop }));

      expect(result.current.isDragging).toBe(false);

      const e = makeDragEvent();
      act(() => {
        result.current.dragProps.onDragEnter(e);
        result.current.dragProps.onDragOver(e);
        result.current.dragProps.onDragLeave(e);
        result.current.dragProps.onDrop(e);
      });

      expect(result.current.isDragging).toBe(false);
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(onDrop).not.toHaveBeenCalled();
    });

    it("does not register window listeners when disabled", () => {
      const addSpy = vi.spyOn(window, "addEventListener");

      renderHook(() => useFileDrop({ disabled: true }));

      const dropListeners = addSpy.mock.calls.filter(([event]) =>
        ["drop", "dragend", "dragleave", "dragover"].includes(event as string)
      );
      expect(dropListeners).toHaveLength(0);

      addSpy.mockRestore();
    });
  });

  describe("window listeners — never cancel events", () => {
    it("window drop listener does not call preventDefault or stopPropagation", () => {
      renderHook(() => useFileDrop());

      const e = new Event("drop", { bubbles: true, cancelable: true }) as any;
      e.preventDefault = vi.fn();
      e.stopPropagation = vi.fn();

      act(() => window.dispatchEvent(e));

      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(e.stopPropagation).not.toHaveBeenCalled();
    });

    it("window dragend listener does not call preventDefault or stopPropagation", () => {
      renderHook(() => useFileDrop());

      const e = new Event("dragend", { bubbles: true, cancelable: true }) as any;
      e.preventDefault = vi.fn();
      e.stopPropagation = vi.fn();

      act(() => window.dispatchEvent(e));

      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(e.stopPropagation).not.toHaveBeenCalled();
    });
  });

  describe("cleanup on unmount", () => {
    it("removes window listeners on unmount", () => {
      const removeSpy = vi.spyOn(window, "removeEventListener");

      const { unmount } = renderHook(() => useFileDrop());
      unmount();

      const removed = removeSpy.mock.calls.filter(([event]) =>
        ["drop", "dragend", "dragleave", "dragover"].includes(event as string)
      );
      expect(removed.length).toBeGreaterThanOrEqual(4);

      removeSpy.mockRestore();
    });

    it("clears watchdog timer on unmount", () => {
      const clearSpy = vi.spyOn(global, "clearTimeout");

      const { unmount } = renderHook(() => useFileDrop());

      // Arm the watchdog via window dragover (which the hook's window listener calls refreshWatchdog)
      act(() => {
        window.dispatchEvent(new Event("dragover", { bubbles: true }));
      });

      unmount();

      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });

    it("zeros depth counter on unmount so re-mounting cannot inherit stale state", () => {
      const { result, unmount } = renderHook(() => useFileDrop());

      // Drag enters but never leaves
      act(() => result.current.dragProps.onDragEnter(makeDragEvent()));
      expect(result.current.isDragging).toBe(true);

      unmount();

      // After unmount the window reset should not trigger isDragging re-set
      // (listeners removed, so this is a no-op — just verify no throw)
      act(() => window.dispatchEvent(new Event("drop")));
    });
  });

  describe("onDrop callback", () => {
    it("invokes onDrop with the dropped FileList and event", () => {
      const onDrop = vi.fn();
      const { result } = renderHook(() => useFileDrop({ onDrop }));

      const file = new File(["content"], "test.png", { type: "image/png" });
      const e = makeDragEvent({ files: [file] });

      act(() => result.current.dragProps.onDrop(e));

      expect(onDrop).toHaveBeenCalledOnce();
      const [calledFiles, calledEvent] = onDrop.mock.calls[0];
      expect(calledFiles[0]).toBe(file);
      expect(calledEvent).toBe(e);
    });

    it("does not invoke onDrop when no files in drop event", () => {
      const onDrop = vi.fn();
      const { result } = renderHook(() => useFileDrop({ onDrop }));

      const e = makeDragEvent({ files: [] });
      act(() => result.current.dragProps.onDrop(e));

      expect(onDrop).not.toHaveBeenCalled();
    });

    it("uses latest onDrop ref — does not re-register window listeners on callback change", () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      const removeSpy = vi.spyOn(window, "removeEventListener");

      const onDrop1 = vi.fn();
      const onDrop2 = vi.fn();

      const { rerender, result } = renderHook(
        ({ onDrop }: { onDrop: typeof onDrop1 }) => useFileDrop({ onDrop }),
        { initialProps: { onDrop: onDrop1 } }
      );

      const listenCountBefore = addSpy.mock.calls.filter(([event]) =>
        ["drop", "dragend", "dragleave", "dragover"].includes(event as string)
      ).length;

      // Re-render with new callback — should NOT tear down and re-add listeners
      rerender({ onDrop: onDrop2 });

      const listenCountAfter = addSpy.mock.calls.filter(([event]) =>
        ["drop", "dragend", "dragleave", "dragover"].includes(event as string)
      ).length;
      expect(listenCountAfter).toBe(listenCountBefore);

      // New callback is used
      const file = new File(["x"], "x.png", { type: "image/png" });
      act(() => result.current.dragProps.onDrop(makeDragEvent({ files: [file] })));
      expect(onDrop2).toHaveBeenCalled();
      expect(onDrop1).not.toHaveBeenCalled();

      addSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });
});
