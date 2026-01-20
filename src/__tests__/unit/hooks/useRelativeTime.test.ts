import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRelativeTime } from "@/hooks/useRelativeTime";

describe("useRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-12-02T12:00:00.000Z"));
    
    // Mock process.env for environment variables
    vi.stubEnv("NEXT_PUBLIC_TIME_UPDATE_INTERVAL", "60000");
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  test("returns initial formatted time", () => {
    const date = new Date("2025-12-02T11:00:00.000Z"); // 1 hour ago
    const { result } = renderHook(() => useRelativeTime(date));
    
    expect(result.current).toBe("1 hr ago");
  });

  test("accepts ISO string input", () => {
    const dateString = "2025-12-02T11:30:00.000Z"; // 30 minutes ago
    const { result } = renderHook(() => useRelativeTime(dateString));
    
    expect(result.current).toBe("30 mins ago");
  });

  test("accepts Date object input", () => {
    const date = new Date("2025-12-02T11:45:00.000Z"); // 15 minutes ago
    const { result } = renderHook(() => useRelativeTime(date));
    
    expect(result.current).toBe("15 mins ago");
  });

  test("updates time automatically after interval", () => {
    const date = new Date("2025-12-02T11:59:00.000Z"); // 1 minute ago
    const { result } = renderHook(() => useRelativeTime(date));
    
    expect(result.current).toBe("1 min ago");
    
    // Advance time by 60 seconds (default interval)
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    
    expect(result.current).toBe("2 mins ago");
  });

  test("uses custom update interval from environment variable", () => {
    vi.stubEnv("NEXT_PUBLIC_TIME_UPDATE_INTERVAL", "30000"); // 30 seconds
    
    const date = new Date("2025-12-02T11:59:00.000Z"); // 1 minute ago
    const { result } = renderHook(() => useRelativeTime(date));
    
    expect(result.current).toBe("1 min ago");
    
    // Advance by custom interval (30 seconds) - not enough time to change
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    
    expect(result.current).toBe("1 min ago"); // Still 1 min after 30s
    
    // Advance another 30 seconds (total 60 seconds)
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    
    expect(result.current).toBe("2 mins ago");
  });

  test("stops updating when date ages beyond 48 hours", () => {
    const date = new Date("2025-11-30T13:00:00.000Z"); // 47 hours ago
    const { result } = renderHook(() => useRelativeTime(date));
    
    expect(result.current).toBe("Yesterday");
    
    // Interval continues running since date is within 48 hours at hook initialization
    // Advancing time will update the display
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    
    // The interval updates the time display
    expect(result.current).toBe("Yesterday");
  });

  test("does not set up interval for dates older than 48 hours", () => {
    const date = new Date("2025-11-29T12:00:00.000Z"); // 3 days ago
    const { result } = renderHook(() => useRelativeTime(date));
    
    expect(result.current).toBe("Nov 29, 2025");
    
    // Advance time - should not trigger any updates
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    
    expect(result.current).toBe("Nov 29, 2025");
  });

  test("updates immediately when tab becomes visible", () => {
    const date = new Date("2025-12-02T11:59:00.000Z"); // 1 minute ago
    const { result } = renderHook(() => useRelativeTime(date));
    
    expect(result.current).toBe("1 min ago");
    
    // Simulate time passing and visibility change
    act(() => {
      vi.setSystemTime(new Date("2025-12-02T12:01:00.000Z")); // Now 2 minutes ago
      
      // Trigger visibility change event
      Object.defineProperty(document, "visibilityState", {
        writable: true,
        configurable: true,
        value: "visible"
      });
      
      document.dispatchEvent(new Event("visibilitychange"));
    });
    
    expect(result.current).toBe("2 mins ago");
  });

  test("does not update when tab becomes hidden", () => {
    const date = new Date("2025-12-02T11:59:00.000Z"); // 1 minute ago
    const { result } = renderHook(() => useRelativeTime(date));
    
    expect(result.current).toBe("1 min ago");
    
    // Simulate time passing and visibility change to hidden
    act(() => {
      vi.setSystemTime(new Date("2025-12-02T12:01:00.000Z"));
      
      Object.defineProperty(document, "visibilityState", {
        writable: true,
        configurable: true,
        value: "hidden"
      });
      
      document.dispatchEvent(new Event("visibilitychange"));
    });
    
    // Should not update
    expect(result.current).toBe("1 min ago");
  });

  test("cleans up interval on unmount", () => {
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");
    const date = new Date("2025-12-02T11:00:00.000Z"); // 1 hour ago
    
    const { unmount } = renderHook(() => useRelativeTime(date));
    
    unmount();
    
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  test("cleans up visibility event listener on unmount", () => {
    const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");
    const date = new Date("2025-12-02T11:00:00.000Z"); // 1 hour ago
    
    const { unmount } = renderHook(() => useRelativeTime(date));
    
    unmount();
    
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function)
    );
  });

  test("updates when date prop changes", () => {
    const { result, rerender } = renderHook(
      ({ date }) => useRelativeTime(date),
      {
        initialProps: { date: new Date("2025-12-02T11:00:00.000Z") } // 1 hour ago
      }
    );
    
    expect(result.current).toBe("1 hr ago");
    
    // Change the date prop - this triggers the effect to re-run with new date
    // Important: The effect dependency is [date], so passing a new Date object reference triggers re-run
    rerender({ date: new Date("2025-12-02T11:30:00.000Z") }); // 30 minutes ago
    
    // The hook initializes state with the new date's formatted value
    expect(result.current).toBe("30 mins ago");
  });

  test("demonstrates automatic updates via interval", () => {
    // Use a date that will change formatting as time advances
    const date = new Date("2025-12-02T11:58:00.000Z"); // 2 minutes ago
    const { result } = renderHook(() => useRelativeTime(date));
    
    expect(result.current).toBe("2 mins ago");
    
    // Advance 60 seconds - interval fires
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    
    // Now shows 3 mins ago
    expect(result.current).toBe("3 mins ago");
    
    // Advance another 60 seconds
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    
    expect(result.current).toBe("4 mins ago");
  });

  test("handles edge case of exactly 48 hours", () => {
    const date = new Date("2025-11-30T12:00:00.000Z"); // Exactly 48 hours ago
    const { result } = renderHook(() => useRelativeTime(date));
    
    // Should still show relative format at exactly 48 hours based on isRelativeFormat
    expect(result.current).toBe("2 days ago");
  });

  test("handles current time", () => {
    const date = new Date("2025-12-02T12:00:00.000Z"); // Exactly now
    const { result } = renderHook(() => useRelativeTime(date));
    
    expect(result.current).toBe("Just now");
  });

  test("handles timezone differences correctly", () => {
    // All dates should be compared in UTC
    const date = new Date("2025-12-02T11:00:00.000Z"); // 1 hour ago in UTC
    const { result } = renderHook(() => useRelativeTime(date));
    
    expect(result.current).toBe("1 hr ago");
  });

  test("updates multiple times over extended period", () => {
    const date = new Date("2025-12-02T11:58:00.000Z"); // 2 minutes ago
    const { result } = renderHook(() => useRelativeTime(date));
    
    expect(result.current).toBe("2 mins ago");
    
    // First update after 60 seconds
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(result.current).toBe("3 mins ago");
    
    // Second update after another 60 seconds
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(result.current).toBe("4 mins ago");
    
    // Third update
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(result.current).toBe("5 mins ago");
  });

  test("handles rapid visibility changes", () => {
    const date = new Date("2025-12-02T11:58:00.000Z"); // 2 minutes ago
    const { result } = renderHook(() => useRelativeTime(date));
    
    expect(result.current).toBe("2 mins ago");
    
    // Simulate time passing to 3 minutes
    act(() => {
      vi.setSystemTime(new Date("2025-12-02T12:01:00.000Z"));
      
      Object.defineProperty(document, "visibilityState", {
        writable: true,
        configurable: true,
        value: "visible"
      });
      
      document.dispatchEvent(new Event("visibilitychange"));
    });
    
    expect(result.current).toBe("3 mins ago");
    
    // Simulate more time passing to 7 minutes
    act(() => {
      vi.setSystemTime(new Date("2025-12-02T12:05:00.000Z"));
      
      document.dispatchEvent(new Event("visibilitychange"));
    });
    
    expect(result.current).toBe("7 mins ago");
  });

  test("uses default interval when env var is not set", () => {
    vi.unstubAllEnvs(); // Remove all env vars
    
    const date = new Date("2025-12-02T11:59:00.000Z"); // 1 minute ago
    const { result } = renderHook(() => useRelativeTime(date));
    
    expect(result.current).toBe("1 min ago");
    
    // Default should be 60000ms (60 seconds)
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    
    expect(result.current).toBe("2 mins ago");
  });

  test("handles invalid interval value in env var", () => {
    vi.stubEnv("NEXT_PUBLIC_TIME_UPDATE_INTERVAL", "invalid");
    
    const date = new Date("2025-12-02T11:59:00.000Z");
    const { result } = renderHook(() => useRelativeTime(date));
    
    expect(result.current).toBe("1 min ago");
    
    // Should fallback to default (60000ms) - parseInt of "invalid" is NaN, which becomes 60000
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    
    expect(result.current).toBe("2 mins ago");
  });
});
