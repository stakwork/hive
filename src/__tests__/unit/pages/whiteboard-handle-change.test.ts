import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for the snapshot guard in handleChange.
 *
 * handleChange fires on every Excalidraw onChange event, including scroll,
 * pan, and zoom (appState-only changes). The guard compares a snapshot of
 * current elements+files against lastSavedSnapshotRef before scheduling a
 * debounced save, so that pure appState changes never trigger a PATCH request.
 */

describe("Whiteboard handleChange — snapshot guard", () => {
  let saveToDatabase: ReturnType<typeof vi.fn>;
  let broadcastElements: ReturnType<typeof vi.fn>;
  let computeSnapshot: (elements: unknown[], files: Record<string, unknown>) => string;
  let lastSavedSnapshotRef: { current: string };
  let onChangeSaveTimeoutRef: { current: ReturnType<typeof setTimeout> | null };
  let programmaticUpdateCountRef: { current: number };

  // Replicate the handleChange logic from the whiteboard page
  const buildHandleChange = () => {
    return (
      elements: readonly unknown[],
      _appState: unknown,
      files: Record<string, unknown>
    ) => {
      if (programmaticUpdateCountRef.current > 0) {
        programmaticUpdateCountRef.current--;
        return;
      }

      broadcastElements(elements, _appState);

      // Skip save if only appState changed (scroll, pan, zoom)
      const snapshot = computeSnapshot(elements as unknown[], files);
      if (snapshot === lastSavedSnapshotRef.current) {
        if (onChangeSaveTimeoutRef.current) {
          clearTimeout(onChangeSaveTimeoutRef.current);
          onChangeSaveTimeoutRef.current = null;
        }
        return;
      }

      if (onChangeSaveTimeoutRef.current) {
        clearTimeout(onChangeSaveTimeoutRef.current);
      }
      onChangeSaveTimeoutRef.current = setTimeout(() => {
        saveToDatabase(elements, _appState, files);
      }, 2500);
    };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    saveToDatabase = vi.fn();
    broadcastElements = vi.fn();
    lastSavedSnapshotRef = { current: "snapshot-abc" };
    onChangeSaveTimeoutRef = { current: null };
    programmaticUpdateCountRef = { current: 0 };
    computeSnapshot = vi.fn();
  });

  afterEach(() => {
    if (onChangeSaveTimeoutRef.current) {
      clearTimeout(onChangeSaveTimeoutRef.current);
    }
    vi.useRealTimers();
  });

  it("does NOT schedule saveToDatabase when snapshot matches lastSavedSnapshotRef (scroll/pan/zoom)", () => {
    (computeSnapshot as ReturnType<typeof vi.fn>).mockReturnValue("snapshot-abc");

    const handleChange = buildHandleChange();
    handleChange([], {}, {});

    vi.advanceTimersByTime(3000);

    expect(saveToDatabase).not.toHaveBeenCalled();
    expect(onChangeSaveTimeoutRef.current).toBeNull();
  });

  it("clears a pending timeout when snapshot matches (no stale save fires)", () => {
    // Set up a pre-existing pending timeout
    const existingTimeout = setTimeout(() => {
      saveToDatabase([], {}, {});
    }, 2500);
    onChangeSaveTimeoutRef.current = existingTimeout;

    (computeSnapshot as ReturnType<typeof vi.fn>).mockReturnValue("snapshot-abc");

    const handleChange = buildHandleChange();
    handleChange([], {}, {});

    // The pending timeout should have been cleared
    expect(onChangeSaveTimeoutRef.current).toBeNull();

    vi.advanceTimersByTime(3000);
    expect(saveToDatabase).not.toHaveBeenCalled();
  });

  it("schedules saveToDatabase after 2500ms when snapshot differs (elements changed)", () => {
    (computeSnapshot as ReturnType<typeof vi.fn>).mockReturnValue("snapshot-xyz");

    const handleChange = buildHandleChange();
    const elements = [{ id: "el1", version: 1 }];
    const appState = { scrollX: 0, scrollY: 0 };
    const files = {};

    handleChange(elements, appState, files);

    // Not called yet — debounce pending
    expect(saveToDatabase).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2500);

    expect(saveToDatabase).toHaveBeenCalledTimes(1);
    expect(saveToDatabase).toHaveBeenCalledWith(elements, appState, files);
  });

  it("debounces: resets the 2500ms timer on rapid successive calls with changed snapshots", () => {
    let callCount = 0;
    (computeSnapshot as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      return `snapshot-${callCount}`;
    });

    const handleChange = buildHandleChange();

    handleChange([], {}, {});
    vi.advanceTimersByTime(1000);
    handleChange([], {}, {});
    vi.advanceTimersByTime(1000);
    handleChange([], {}, {});

    // saveToDatabase not yet called — timer reset each time
    expect(saveToDatabase).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2500);

    // Only one call after the final debounce settles
    expect(saveToDatabase).toHaveBeenCalledTimes(1);
  });

  it("returns early and skips broadcast for programmatic updates", () => {
    programmaticUpdateCountRef.current = 1;
    (computeSnapshot as ReturnType<typeof vi.fn>).mockReturnValue("snapshot-new");

    const handleChange = buildHandleChange();
    handleChange([], {}, {});

    expect(broadcastElements).not.toHaveBeenCalled();
    expect(saveToDatabase).not.toHaveBeenCalled();
    expect(programmaticUpdateCountRef.current).toBe(0);
  });

  it("broadcasts elements even when snapshot matches (collaboration still works during scroll)", () => {
    (computeSnapshot as ReturnType<typeof vi.fn>).mockReturnValue("snapshot-abc");

    const handleChange = buildHandleChange();
    handleChange([{ id: "el1" }], { scrollX: 100 }, {});

    expect(broadcastElements).toHaveBeenCalledTimes(1);
    expect(saveToDatabase).not.toHaveBeenCalled();
  });
});
