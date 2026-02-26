import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useControlKeyHold } from "@/hooks/useControlKeyHold";

function fireKeydown(
  key: string,
  modifiers: Partial<KeyboardEventInit> = {},
) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, ...modifiers }),
  );
}

function fireKeyup(key: string) {
  window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
}

describe("useControlKeyHold", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts onStart after holdDuration when Control pressed alone", () => {
    const onStart = vi.fn();
    const onStop = vi.fn();

    renderHook(() =>
      useControlKeyHold({
        onStart,
        onStop,
        holdDuration: 500,
      }),
    );

    // Press Control without any modifiers
    fireKeydown("Control");

    // onStart should not be called immediately
    expect(onStart).not.toHaveBeenCalled();

    // Advance timers to just before holdDuration
    vi.advanceTimersByTime(499);
    expect(onStart).not.toHaveBeenCalled();

    // Advance to holdDuration
    vi.advanceTimersByTime(1);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });

  it("does NOT start onStart when Shift+Control pressed", () => {
    const onStart = vi.fn();
    const onStop = vi.fn();

    renderHook(() =>
      useControlKeyHold({
        onStart,
        onStop,
        holdDuration: 500,
      }),
    );

    // Press Control with Shift modifier
    fireKeydown("Control", { shiftKey: true });

    // Advance past holdDuration
    vi.advanceTimersByTime(600);

    // onStart should NOT be called
    expect(onStart).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });

  it("does NOT start onStart when Alt+Control pressed", () => {
    const onStart = vi.fn();
    const onStop = vi.fn();

    renderHook(() =>
      useControlKeyHold({
        onStart,
        onStop,
        holdDuration: 500,
      }),
    );

    // Press Control with Alt modifier
    fireKeydown("Control", { altKey: true });

    // Advance past holdDuration
    vi.advanceTimersByTime(600);

    // onStart should NOT be called
    expect(onStart).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });

  it("does NOT start onStart when Meta+Control pressed", () => {
    const onStart = vi.fn();
    const onStop = vi.fn();

    renderHook(() =>
      useControlKeyHold({
        onStart,
        onStop,
        holdDuration: 500,
      }),
    );

    // Press Control with Meta (Cmd) modifier
    fireKeydown("Control", { metaKey: true });

    // Advance past holdDuration
    vi.advanceTimersByTime(600);

    // onStart should NOT be called
    expect(onStart).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });

  it("does NOT start onStart when Control released before holdDuration", () => {
    const onStart = vi.fn();
    const onStop = vi.fn();

    renderHook(() =>
      useControlKeyHold({
        onStart,
        onStop,
        holdDuration: 500,
      }),
    );

    // Press Control
    fireKeydown("Control");

    // Advance partway through holdDuration
    vi.advanceTimersByTime(300);
    expect(onStart).not.toHaveBeenCalled();

    // Release Control before holdDuration completes
    fireKeyup("Control");

    // Advance past when holdDuration would have completed
    vi.advanceTimersByTime(300);

    // onStart should NOT be called
    expect(onStart).not.toHaveBeenCalled();
    // onStop should NOT be called because hold never started
    expect(onStop).not.toHaveBeenCalled();
  });

  it("calls onStop when Control is released after hold", () => {
    const onStart = vi.fn();
    const onStop = vi.fn();

    renderHook(() =>
      useControlKeyHold({
        onStart,
        onStop,
        holdDuration: 500,
      }),
    );

    // Press Control
    fireKeydown("Control");

    // Advance past holdDuration to trigger onStart
    vi.advanceTimersByTime(500);
    expect(onStart).toHaveBeenCalledTimes(1);

    // Release Control
    fireKeyup("Control");

    // onStop should now be called
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("does nothing when enabled is false", () => {
    const onStart = vi.fn();
    const onStop = vi.fn();

    renderHook(() =>
      useControlKeyHold({
        onStart,
        onStop,
        holdDuration: 500,
        enabled: false,
      }),
    );

    // Press Control
    fireKeydown("Control");

    // Advance past holdDuration
    vi.advanceTimersByTime(600);

    // Neither callback should be called
    expect(onStart).not.toHaveBeenCalled();

    // Release Control
    fireKeyup("Control");
    expect(onStop).not.toHaveBeenCalled();
  });

  it("does NOT trigger on repeat keydown events", () => {
    const onStart = vi.fn();
    const onStop = vi.fn();

    renderHook(() =>
      useControlKeyHold({
        onStart,
        onStop,
        holdDuration: 500,
      }),
    );

    // Initial Control press
    fireKeydown("Control");

    // Advance past holdDuration
    vi.advanceTimersByTime(500);
    expect(onStart).toHaveBeenCalledTimes(1);

    // Fire repeat keydown (what happens when key is held)
    fireKeydown("Control", { repeat: true });
    fireKeydown("Control", { repeat: true });

    // Advance more time
    vi.advanceTimersByTime(500);

    // onStart should still only be called once
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("allows custom key configuration", () => {
    const onStart = vi.fn();
    const onStop = vi.fn();

    renderHook(() =>
      useControlKeyHold({
        onStart,
        onStop,
        holdDuration: 500,
        key: "Shift", // Use Shift instead of Control
      }),
    );

    // Press Shift (our custom key)
    fireKeydown("Shift");

    // Advance past holdDuration
    vi.advanceTimersByTime(500);
    expect(onStart).toHaveBeenCalledTimes(1);

    // Release Shift
    fireKeyup("Shift");
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("allows custom holdDuration configuration", () => {
    const onStart = vi.fn();
    const onStop = vi.fn();

    renderHook(() =>
      useControlKeyHold({
        onStart,
        onStop,
        holdDuration: 1000, // Custom 1 second hold
      }),
    );

    // Press Control
    fireKeydown("Control");

    // Advance to just before custom holdDuration
    vi.advanceTimersByTime(999);
    expect(onStart).not.toHaveBeenCalled();

    // Advance to custom holdDuration
    vi.advanceTimersByTime(1);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("updates callbacks when they change", () => {
    const onStart1 = vi.fn();
    const onStop1 = vi.fn();
    const onStart2 = vi.fn();
    const onStop2 = vi.fn();

    const { rerender } = renderHook(
      ({ onStart, onStop }) =>
        useControlKeyHold({
          onStart,
          onStop,
          holdDuration: 500,
        }),
      {
        initialProps: { onStart: onStart1, onStop: onStop1 },
      },
    );

    // Press Control with first callbacks
    fireKeydown("Control");
    vi.advanceTimersByTime(500);
    expect(onStart1).toHaveBeenCalledTimes(1);

    // Release
    fireKeyup("Control");
    expect(onStop1).toHaveBeenCalledTimes(1);

    // Update to new callbacks
    rerender({ onStart: onStart2, onStop: onStop2 });

    // Press Control again with new callbacks
    fireKeydown("Control");
    vi.advanceTimersByTime(500);
    expect(onStart2).toHaveBeenCalledTimes(1);
    expect(onStart1).toHaveBeenCalledTimes(1); // Should not be called again

    // Release
    fireKeyup("Control");
    expect(onStop2).toHaveBeenCalledTimes(1);
    expect(onStop1).toHaveBeenCalledTimes(1); // Should not be called again
  });
});
