import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  usePusherChannel,
  __resetUsePusherChannelForTests,
  __getRefCountForTests,
} from "@/hooks/usePusherChannel";

// Mock the Pusher client BEFORE the hook module imports it. We never
// touch real Pusher here — we just want to assert that subscribe and
// unsubscribe pair up correctly across multiple consumers.
const mockChannelA = { name: "test-a", bind: vi.fn(), unbind: vi.fn() };
const mockChannelB = { name: "test-b", bind: vi.fn(), unbind: vi.fn() };
const mockSubscribe = vi.fn((name: string) => {
  if (name === "test-b") return mockChannelB;
  return mockChannelA;
});
const mockUnsubscribe = vi.fn();

vi.mock("@/lib/pusher", () => ({
  getPusherClient: vi.fn(() => ({
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
  })),
}));

// The hook reads NEXT_PUBLIC_PUSHER_KEY off process.env at call time,
// so set it before any test runs and keep it pinned.
beforeEach(() => {
  process.env.NEXT_PUBLIC_PUSHER_KEY = "test-key";
  mockSubscribe.mockClear();
  mockUnsubscribe.mockClear();
  __resetUsePusherChannelForTests();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("usePusherChannel", () => {
  test("returns null when no channel name is provided", () => {
    const { result } = renderHook(() => usePusherChannel(null));
    expect(result.current).toBeNull();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  test("subscribes once on mount and unsubscribes on unmount", async () => {
    const { result, unmount } = renderHook(() => usePusherChannel("test-a"));

    await waitFor(() => {
      expect(result.current).toBe(mockChannelA);
    });
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledWith("test-a");
    expect(__getRefCountForTests("test-a")).toBe(1);

    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribe).toHaveBeenCalledWith("test-a");
    expect(__getRefCountForTests("test-a")).toBe(0);
  });

  test("two consumers share one subscription", async () => {
    const a = renderHook(() => usePusherChannel("test-a"));
    const b = renderHook(() => usePusherChannel("test-a"));

    await waitFor(() => {
      expect(a.result.current).toBe(mockChannelA);
      expect(b.result.current).toBe(mockChannelA);
    });

    // Only one underlying subscribe call across both consumers.
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(__getRefCountForTests("test-a")).toBe(2);

    // First unmount: still subscribed.
    a.unmount();
    expect(mockUnsubscribe).not.toHaveBeenCalled();
    expect(__getRefCountForTests("test-a")).toBe(1);

    // Second unmount: now we tear down.
    b.unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribe).toHaveBeenCalledWith("test-a");
    expect(__getRefCountForTests("test-a")).toBe(0);
  });

  test("different channel names get independent subscriptions", async () => {
    const a = renderHook(() => usePusherChannel("test-a"));
    const b = renderHook(() => usePusherChannel("test-b"));

    await waitFor(() => {
      expect(a.result.current).toBe(mockChannelA);
      expect(b.result.current).toBe(mockChannelB);
    });

    expect(mockSubscribe).toHaveBeenCalledTimes(2);
    expect(__getRefCountForTests("test-a")).toBe(1);
    expect(__getRefCountForTests("test-b")).toBe(1);

    a.unmount();
    expect(mockUnsubscribe).toHaveBeenCalledWith("test-a");
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);

    b.unmount();
    expect(mockUnsubscribe).toHaveBeenCalledWith("test-b");
    expect(mockUnsubscribe).toHaveBeenCalledTimes(2);
  });

  test("returns null when NEXT_PUBLIC_PUSHER_KEY is unset", () => {
    delete process.env.NEXT_PUBLIC_PUSHER_KEY;
    const { result } = renderHook(() => usePusherChannel("test-a"));
    expect(result.current).toBeNull();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  test("re-subscribes when channelName changes", async () => {
    const { result, rerender } = renderHook(
      ({ name }: { name: string }) => usePusherChannel(name),
      { initialProps: { name: "test-a" } },
    );

    await waitFor(() => expect(result.current).toBe(mockChannelA));
    expect(mockSubscribe).toHaveBeenCalledWith("test-a");

    rerender({ name: "test-b" });

    await waitFor(() => expect(result.current).toBe(mockChannelB));
    expect(mockSubscribe).toHaveBeenCalledWith("test-b");
    expect(mockUnsubscribe).toHaveBeenCalledWith("test-a");
    expect(__getRefCountForTests("test-a")).toBe(0);
    expect(__getRefCountForTests("test-b")).toBe(1);
  });
});
