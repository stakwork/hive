// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock wouter before importing the hook
const mockNavigate = vi.fn();
let mockSearch = "";
let mockLocation = "/canvas";

vi.mock("wouter", () => ({
  useSearch: () => mockSearch,
  useLocation: () => [mockLocation, mockNavigate],
}));

import { useTimelineRange, VALID_RANGES } from "@/hooks/useTimelineRange";

describe("useTimelineRange", () => {
  beforeEach(() => {
    mockSearch = "";
    mockLocation = "/canvas";
    mockNavigate.mockClear();
  });

  it("returns '24h' when no range param is present", () => {
    mockSearch = "";
    const { result } = renderHook(() => useTimelineRange());
    expect(result.current[0]).toBe("24h");
  });

  it("returns '24h' for an invalid range param", () => {
    mockSearch = "range=invalid";
    const { result } = renderHook(() => useTimelineRange());
    expect(result.current[0]).toBe("24h");
  });

  it("returns '24h' for an empty range param", () => {
    mockSearch = "range=";
    const { result } = renderHook(() => useTimelineRange());
    expect(result.current[0]).toBe("24h");
  });

  it.each(VALID_RANGES)("returns '%s' when range=%s is in the URL", (range) => {
    mockSearch = `range=${range}`;
    const { result } = renderHook(() => useTimelineRange());
    expect(result.current[0]).toBe(range);
  });

  it("setRange navigates with replace: true, preserving the current path", () => {
    mockSearch = "range=24h";
    mockLocation = "/people";
    const { result } = renderHook(() => useTimelineRange());

    act(() => {
      result.current[1]("7d");
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/people?range=7d", { replace: true });
  });

  it("setRange preserves other existing query params", () => {
    mockSearch = "range=24h&foo=bar";
    mockLocation = "/dashboard";
    const { result } = renderHook(() => useTimelineRange());

    act(() => {
      result.current[1]("30d");
    });

    const [calledUrl] = mockNavigate.mock.calls[0];
    const url = new URL(calledUrl, "http://localhost");
    expect(url.searchParams.get("range")).toBe("30d");
    expect(url.searchParams.get("foo")).toBe("bar");
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining("range=30d"),
      { replace: true },
    );
  });

  it("setRange updates range when previously absent from URL", () => {
    mockSearch = "";
    mockLocation = "/agents";
    const { result } = renderHook(() => useTimelineRange());

    act(() => {
      result.current[1]("1h");
    });

    expect(mockNavigate).toHaveBeenCalledWith("/agents?range=1h", { replace: true });
  });

  it("range survives a simulated tab navigation (re-read from same search)", () => {
    // Simulate: user selects 7d on /canvas, then navigates to /people
    // Both calls read from the same mockSearch (URL-driven state)
    mockSearch = "range=7d";
    mockLocation = "/canvas";

    const { result: canvasResult } = renderHook(() => useTimelineRange());
    expect(canvasResult.current[0]).toBe("7d");

    // Navigate to /people — range still "7d" in URL
    mockLocation = "/people";
    const { result: peopleResult } = renderHook(() => useTimelineRange());
    expect(peopleResult.current[0]).toBe("7d");
  });
});
