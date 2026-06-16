/**
 * Unit tests for useCanvasAgentActivity hook
 *
 * Covers:
 * 1. Returns isActive: false when conversation is idle
 * 2. Returns isActive: true when isLoading is true
 * 3. Returns isActive: true when isStreaming is true
 * 4. Returns isActive: true after lastUpdated change, then false after 3s
 * 5. Race condition: does NOT clear prematurely when isLoading flips before timeout
 * 6. Debounce: new log event resets the 3s timer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCanvasAgentActivity } from "@/hooks/useCanvasAgentActivity";

// ── Mock canvasChatStore ───────────────────────────────────────────────────────

let mockIsLoading = false;
let mockIsStreaming = false;
let mockMessages: unknown[] = [];

vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => ({
  useCanvasChatStore: vi.fn((selector: (s: unknown) => unknown) => {
    const state = {
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": {
          isLoading: mockIsLoading,
          isStreaming: mockIsStreaming,
          messages: mockMessages,
        },
      },
    };
    return selector(state);
  }),
}));

// ── Mock SubAgentRunCard ───────────────────────────────────────────────────────

let mockSubAgentRuns: { featureId: string }[] = [];

vi.mock(
  "@/app/org/[githubLogin]/_components/SubAgentRunCard",
  () => ({
    getSubAgentRunsFromMessages: vi.fn(() => mockSubAgentRuns),
  }),
);

// ── Mock useAgentLogs ─────────────────────────────────────────────────────────

let mockLastUpdated: Record<string, number> = {};

vi.mock("@/hooks/useAgentLogs", () => ({
  useAgentLogs: vi.fn(() => ({
    agentLogs: [],
    lastUpdated: mockLastUpdated,
  })),
}));

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  mockIsLoading = false;
  mockIsStreaming = false;
  mockMessages = [];
  mockSubAgentRuns = [];
  mockLastUpdated = {};
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useCanvasAgentActivity", () => {
  it("returns isActive: false when conversation is idle", () => {
    const { result } = renderHook(() =>
      useCanvasAgentActivity("conv-1", "ws-1"),
    );
    expect(result.current.isActive).toBe(false);
  });

  it("returns isActive: true when isLoading is true", () => {
    mockIsLoading = true;
    const { result } = renderHook(() =>
      useCanvasAgentActivity("conv-1", "ws-1"),
    );
    expect(result.current.isActive).toBe(true);
  });

  it("returns isActive: true when isStreaming is true", () => {
    mockIsStreaming = true;
    const { result } = renderHook(() =>
      useCanvasAgentActivity("conv-1", "ws-1"),
    );
    expect(result.current.isActive).toBe(true);
  });

  it("returns isActive: true immediately after a lastUpdated change, then false after 3s", () => {
    const { result, rerender } = renderHook(() =>
      useCanvasAgentActivity("conv-1", "ws-1"),
    );
    expect(result.current.isActive).toBe(false);

    // Simulate a Pusher AGENT_LOG_UPDATED event by bumping lastUpdated
    act(() => {
      mockLastUpdated = { "log-1": Date.now() };
    });
    rerender();

    expect(result.current.isActive).toBe(true);

    // Advance 3 seconds — the timeout fires and clears hasRecentLog
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.isActive).toBe(false);
  });

  it("does NOT clear prematurely when isLoading flips to false before the 3s timeout", () => {
    mockIsLoading = true;
    const { result, rerender } = renderHook(() =>
      useCanvasAgentActivity("conv-1", "ws-1"),
    );

    // Bump lastUpdated to set hasRecentLog
    act(() => {
      mockLastUpdated = { "log-1": Date.now() };
    });
    rerender();
    expect(result.current.isActive).toBe(true);

    // Now flip isLoading off — hasRecentLog must still hold
    act(() => {
      mockIsLoading = false;
    });
    rerender();

    // Advance 1.5s (before the 3s timeout)
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.isActive).toBe(true);

    // Advance to 3001ms total — timeout fires
    act(() => {
      vi.advanceTimersByTime(1501);
    });
    expect(result.current.isActive).toBe(false);
  });

  it("debounce: a new log event resets the 3s timer", () => {
    const { result, rerender } = renderHook(() =>
      useCanvasAgentActivity("conv-1", "ws-1"),
    );

    // First bump at t=0
    act(() => {
      mockLastUpdated = { "log-1": Date.now() };
    });
    rerender();
    expect(result.current.isActive).toBe(true);

    // Advance 2s (before first 3s deadline)
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.isActive).toBe(true);

    // Second bump at t=2000 — resets the timer to t=5000
    act(() => {
      mockLastUpdated = { "log-1": Date.now(), "log-2": Date.now() };
    });
    rerender();
    expect(result.current.isActive).toBe(true);

    // Advance 2000ms more (t=4000) — still within the new 3s window
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.isActive).toBe(true);

    // Advance to t=5001ms (3s from the second bump)
    act(() => {
      vi.advanceTimersByTime(1001);
    });
    expect(result.current.isActive).toBe(false);
  });

  it("handles null conversationId gracefully", () => {
    const { result } = renderHook(() =>
      useCanvasAgentActivity(null, "ws-1"),
    );
    expect(result.current.isActive).toBe(false);
  });

  it("handles null workspaceId gracefully", () => {
    const { result } = renderHook(() =>
      useCanvasAgentActivity("conv-1", null),
    );
    expect(result.current.isActive).toBe(false);
  });
});
