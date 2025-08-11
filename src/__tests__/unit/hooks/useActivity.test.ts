/**
 * @vitest-environment jsdom
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useActivity } from "@/hooks/useActivity";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("useActivity Hook - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  test("should initialize with loading state", () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] })
    });

    // Act
    const { result } = renderHook(() => useActivity("test-workspace"));

    // Assert
    expect(result.current.loading).toBe(true);
    expect(result.current.activities).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  test("should fetch activities successfully", async () => {
    // Arrange
    const mockActivities = [
      {
        id: "activity-1",
        type: "episode",
        summary: "Test Episode 1",
        user: "System",
        timestamp: "2023-01-01T00:00:00.000Z",
        status: "active"
      },
      {
        id: "activity-2",
        type: "episode",
        summary: "Test Episode 2", 
        user: "System",
        timestamp: "2023-01-02T00:00:00.000Z",
        status: "active"
      }
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: mockActivities
      })
    });

    // Act
    const { result } = renderHook(() => useActivity("test-workspace"));

    // Assert
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.activities).toHaveLength(2);
    expect(result.current.activities[0]).toEqual({
      ...mockActivities[0],
      timestamp: new Date("2023-01-01T00:00:00.000Z")
    });
    expect(result.current.activities[1]).toEqual({
      ...mockActivities[1], 
      timestamp: new Date("2023-01-02T00:00:00.000Z")
    });
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/test-workspace/activity?limit=5");
  });

  test("should handle fetch errors", async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({
        error: "Access denied"
      })
    });

    // Act
    const { result } = renderHook(() => useActivity("test-workspace"));

    // Assert
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.activities).toEqual([]);
    expect(result.current.error).toBe("Access denied");
  });

  test("should handle network errors", async () => {
    // Arrange
    mockFetch.mockRejectedValue(new Error("Network error"));

    // Act
    const { result } = renderHook(() => useActivity("test-workspace"));

    // Assert
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.activities).toEqual([]);
    expect(result.current.error).toBe("Network error");
  });

  test("should use custom limit parameter", async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] })
    });

    // Act
    const { result } = renderHook(() => useActivity("test-workspace", 10));

    // Assert
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/test-workspace/activity?limit=10");
  });

  test("should not fetch when workspaceSlug is empty", () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] })
    });

    // Act
    const { result } = renderHook(() => useActivity(""));

    // Assert
    expect(result.current.loading).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("should refetch when refetch is called", async () => {
    // Arrange
    const mockActivities = [
      {
        id: "activity-1",
        type: "episode",
        summary: "Test Episode 1",
        user: "System",
        timestamp: "2023-01-01T00:00:00.000Z",
        status: "active"
      }
    ];

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: mockActivities })
      });

    // Act
    const { result } = renderHook(() => useActivity("test-workspace"));

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.activities).toEqual([]);

    // Call refetch
    await act(async () => {
      result.current.refetch();
    });

    // Wait for refetch to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Assert
    expect(result.current.activities).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test("should show loading state during refetch", async () => {
    // Arrange
    let resolveFirstCall: ((value: unknown) => void) | null = null;
    let resolveSecondCall: ((value: unknown) => void) | null = null;
    let callCount = 0;
    
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return new Promise((resolve) => {
          resolveFirstCall = resolve;
        });
      } else {
        return new Promise((resolve) => {
          resolveSecondCall = resolve;
        });
      }
    });

    // Act
    const { result } = renderHook(() => useActivity("test-workspace"));

    // Initially should be loading
    expect(result.current.loading).toBe(true);

    // Complete first call
    await act(async () => {
      resolveFirstCall!({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] })
      });
    });

    // Wait for initial load to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Call refetch - should set loading to true again
    await act(async () => {
      result.current.refetch();
    });

    // Should be loading during refetch
    expect(result.current.loading).toBe(true);

    // Complete second call
    await act(async () => {
      resolveSecondCall!({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] })
      });
    });

    // Wait for refetch to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  test("should handle unknown error gracefully", async () => {
    // Arrange
    mockFetch.mockRejectedValue("Unknown error");

    // Act
    const { result } = renderHook(() => useActivity("test-workspace"));

    // Assert
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.activities).toEqual([]);
    expect(result.current.error).toBe("Unknown error occurred");
  });

  test("should refetch when workspace slug changes", async () => {
    // Arrange
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] })
    });

    // Act
    const { result, rerender } = renderHook(
      ({ workspaceSlug }) => useActivity(workspaceSlug),
      { initialProps: { workspaceSlug: "workspace-1" } }
    );

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/workspace-1/activity?limit=5");

    // Change workspace slug
    rerender({ workspaceSlug: "workspace-2" });

    // Wait for new fetch
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Assert
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/workspace-2/activity?limit=5");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});