/**
 * Unit tests for useUnresolvedErrorCount hook
 *
 * Covers:
 * - Initial fetch sets count from API total
 * - ERROR_ISSUE_UPDATED event triggers refetch and updates count
 * - No Pusher subscription when slug or NEXT_PUBLIC_PUSHER_KEY is absent
 * - Cleanup unbinds and unsubscribes on unmount
 * - count defaults to 0 when workspaceId is absent or fetch fails
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// ── Pusher mock ───────────────────────────────────────────────────────────────
const mockBind = vi.fn();
const mockUnbind = vi.fn();
const mockChannel = { bind: mockBind, unbind: mockUnbind };
const mockPusherClient = {
  subscribe: vi.fn(() => mockChannel),
  unsubscribe: vi.fn(),
};

vi.mock("@/lib/pusher", () => ({
  getPusherClient: vi.fn(() => mockPusherClient),
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    ERROR_ISSUE_UPDATED: "error-issue-updated",
  },
}));

// ── fetch mock ────────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// ── hook under test ───────────────────────────────────────────────────────────
import { useUnresolvedErrorCount } from "@/hooks/useUnresolvedErrorCount";

function makeCountResponse(total: number) {
  return {
    ok: true,
    json: async () => ({ issues: [], total, hasMore: false }),
  };
}

const DEFAULT_PARAMS = { workspaceId: "ws-1", slug: "my-workspace" };

describe("useUnresolvedErrorCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_PUSHER_KEY = "test-pusher-key";
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_PUSHER_KEY;
  });

  // ── Initial fetch ──────────────────────────────────────────────────────────

  it("fetches count on mount and exposes it", async () => {
    mockFetch.mockResolvedValueOnce(makeCountResponse(7));

    const { result } = renderHook(() => useUnresolvedErrorCount(DEFAULT_PARAMS));

    await waitFor(() => expect(result.current.count).toBe(7));

    // Verify correct URL was called
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("workspace_id=ws-1"),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("status=UNRESOLVED"),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("limit=1"),
    );
  });

  it("defaults count to 0 while loading", () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useUnresolvedErrorCount(DEFAULT_PARAMS));

    expect(result.current.count).toBe(0);
  });

  it("defaults count to 0 when workspaceId is absent", async () => {
    const { result } = renderHook(() =>
      useUnresolvedErrorCount({ workspaceId: null, slug: "my-workspace" }),
    );

    // No fetch should be triggered
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.count).toBe(0);
  });

  it("defaults count to 0 when workspaceId is undefined", async () => {
    const { result } = renderHook(() =>
      useUnresolvedErrorCount({ workspaceId: undefined, slug: "my-workspace" }),
    );

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.count).toBe(0);
  });

  it("defaults count to 0 when fetch fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useUnresolvedErrorCount(DEFAULT_PARAMS));

    await waitFor(() => {
      // After failed fetch, count should stay at 0
      expect(result.current.count).toBe(0);
    });
  });

  it("defaults count to 0 when response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });

    const { result } = renderHook(() => useUnresolvedErrorCount(DEFAULT_PARAMS));

    await waitFor(() => {
      expect(result.current.count).toBe(0);
    });
  });

  // ── Pusher subscription ────────────────────────────────────────────────────

  it("subscribes to the workspace Pusher channel on mount", async () => {
    mockFetch.mockResolvedValueOnce(makeCountResponse(3));

    renderHook(() => useUnresolvedErrorCount(DEFAULT_PARAMS));

    await waitFor(() => {
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith("workspace-my-workspace");
    });
    expect(mockBind).toHaveBeenCalledWith(
      "error-issue-updated",
      expect.any(Function),
    );
  });

  it("does NOT subscribe when slug is absent", async () => {
    mockFetch.mockResolvedValueOnce(makeCountResponse(3));

    renderHook(() =>
      useUnresolvedErrorCount({ workspaceId: "ws-1", slug: null }),
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled(); // fetch still runs
    });

    expect(mockPusherClient.subscribe).not.toHaveBeenCalled();
    expect(mockBind).not.toHaveBeenCalled();
  });

  it("does NOT subscribe when NEXT_PUBLIC_PUSHER_KEY is absent", async () => {
    delete process.env.NEXT_PUBLIC_PUSHER_KEY;
    mockFetch.mockResolvedValueOnce(makeCountResponse(5));

    renderHook(() => useUnresolvedErrorCount(DEFAULT_PARAMS));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    expect(mockPusherClient.subscribe).not.toHaveBeenCalled();
  });

  it("refetches count when ERROR_ISSUE_UPDATED event fires", async () => {
    mockFetch
      .mockResolvedValueOnce(makeCountResponse(3))  // initial fetch
      .mockResolvedValueOnce(makeCountResponse(4));  // after Pusher event

    const { result } = renderHook(() => useUnresolvedErrorCount(DEFAULT_PARAMS));

    await waitFor(() => expect(result.current.count).toBe(3));

    // Simulate Pusher event
    const handler = mockBind.mock.calls.find(
      ([event]) => event === "error-issue-updated",
    )?.[1];
    expect(handler).toBeDefined();

    act(() => {
      handler!({});
    });

    await waitFor(() => expect(result.current.count).toBe(4));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // ── Cleanup ────────────────────────────────────────────────────────────────

  it("unbinds handler and unsubscribes on unmount", async () => {
    mockFetch.mockResolvedValueOnce(makeCountResponse(2));

    const { unmount } = renderHook(() => useUnresolvedErrorCount(DEFAULT_PARAMS));

    await waitFor(() => {
      expect(mockBind).toHaveBeenCalled();
    });

    unmount();

    expect(mockUnbind).toHaveBeenCalledWith(
      "error-issue-updated",
      expect.any(Function),
    );
    expect(mockPusherClient.unsubscribe).toHaveBeenCalledWith(
      "workspace-my-workspace",
    );
  });

  it("re-subscribes to the new channel when slug changes", async () => {
    mockFetch.mockResolvedValue(makeCountResponse(1));

    const { rerender } = renderHook(
      ({ slug }) => useUnresolvedErrorCount({ workspaceId: "ws-1", slug }),
      { initialProps: { slug: "slug-a" } },
    );

    await waitFor(() => {
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith("workspace-slug-a");
    });

    rerender({ slug: "slug-b" });

    await waitFor(() => {
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith("workspace-slug-b");
    });
  });
});
