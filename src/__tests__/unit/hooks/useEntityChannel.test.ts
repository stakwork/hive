/**
 * Unit tests for `useEntityChannel`.
 *
 * Verifies that:
 *   1. The hook correctly resolves `getFeatureChannelName` for "feature" kind.
 *   2. The hook correctly resolves `getTaskChannelName` for "task" kind.
 *   3. A null `entityId` returns null channel without subscribing.
 *   4. The hook delegates to `usePusherChannel` (no re-implementation of
 *      subscribe/unsubscribe lifecycle).
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockChannel = { name: "test-channel", bind: vi.fn(), unbind: vi.fn() };

vi.mock("@/hooks/usePusherChannel", () => ({
  usePusherChannel: vi.fn((channelName: string | null) =>
    channelName ? mockChannel : null,
  ),
}));

vi.mock("@/lib/pusher", () => ({
  getFeatureChannelName: (id: string) => `feature-${id}`,
  getTaskChannelName: (id: string) => `task-${id}`,
}));

import { useEntityChannel } from "@/hooks/useEntityChannel";
import { usePusherChannel } from "@/hooks/usePusherChannel";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usePusherChannel).mockImplementation((channelName) =>
    channelName ? mockChannel : null,
  );
});

describe("useEntityChannel", () => {
  test("resolves feature channel name and delegates to usePusherChannel", () => {
    const { result } = renderHook(() =>
      useEntityChannel("feature", "feat-abc"),
    );
    expect(usePusherChannel).toHaveBeenCalledWith("feature-feat-abc");
    expect(result.current).toBe(mockChannel);
  });

  test("resolves task channel name and delegates to usePusherChannel", () => {
    const { result } = renderHook(() => useEntityChannel("task", "task-xyz"));
    expect(usePusherChannel).toHaveBeenCalledWith("task-task-xyz");
    expect(result.current).toBe(mockChannel);
  });

  test("passes null to usePusherChannel when entityId is null", () => {
    const { result } = renderHook(() => useEntityChannel("feature", null));
    expect(usePusherChannel).toHaveBeenCalledWith(null);
    expect(result.current).toBeNull();
  });

  test("passes null to usePusherChannel when entityId is undefined", () => {
    const { result } = renderHook(() =>
      useEntityChannel("task", undefined),
    );
    expect(usePusherChannel).toHaveBeenCalledWith(null);
    expect(result.current).toBeNull();
  });

  test("returns null when Pusher is unconfigured (usePusherChannel returns null)", () => {
    vi.mocked(usePusherChannel).mockReturnValue(null);
    const { result } = renderHook(() =>
      useEntityChannel("feature", "some-id"),
    );
    expect(result.current).toBeNull();
  });

  test("re-subscribes when entityId changes", () => {
    const { rerender } = renderHook(
      ({ id }: { id: string }) => useEntityChannel("feature", id),
      { initialProps: { id: "id-1" } },
    );
    expect(usePusherChannel).toHaveBeenCalledWith("feature-id-1");

    rerender({ id: "id-2" });
    expect(usePusherChannel).toHaveBeenCalledWith("feature-id-2");
  });

  test("re-subscribes when entityKind changes", () => {
    const { rerender } = renderHook(
      ({ kind }: { kind: "feature" | "task" }) =>
        useEntityChannel(kind, "shared-id"),
      { initialProps: { kind: "feature" as const } },
    );
    expect(usePusherChannel).toHaveBeenCalledWith("feature-shared-id");

    rerender({ kind: "task" as const });
    expect(usePusherChannel).toHaveBeenCalledWith("task-shared-id");
  });
});
