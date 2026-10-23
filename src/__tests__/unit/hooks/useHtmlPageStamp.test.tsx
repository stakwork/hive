import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const handlers: Array<(p: Record<string, unknown>) => void> = [];
const mockChannel = {
  bind: vi.fn((_e: string, h: (p: Record<string, unknown>) => void) => handlers.push(h)),
  unbind: vi.fn(),
};

vi.mock("@/hooks/usePusherChannel", () => ({
  usePusherChannel: vi.fn((name: string | null) => (name ? mockChannel : null)),
}));
vi.mock("@/lib/pusher", () => ({
  getOrgChannelName: (l: string) => `org-${l}`,
  PUSHER_EVENTS: { CANVAS_UPDATED: "canvas-updated" },
}));

import { laterStamp, useHtmlPageStamp } from "@/app/org/[githubLogin]/_components/artifacts/useHtmlPageStamp";
import { usePusherChannel } from "@/hooks/usePusherChannel";

const T1 = "2024-01-01T00:00:00.000Z";
const T2 = "2024-02-01T00:00:00.000Z";
const emit = (p: Record<string, unknown>) => act(() => handlers.forEach((h) => h(p)));

beforeEach(() => {
  handlers.length = 0;
  vi.clearAllMocks();
});

describe("useHtmlPageStamp", () => {
  test("a matching html-updated event advances the stamp", () => {
    const { result } = renderHook(() => useHtmlPageStamp("acme", "p", T1));
    expect(usePusherChannel).toHaveBeenCalledWith("org-acme");
    expect(mockChannel.bind).toHaveBeenCalledWith("canvas-updated", expect.any(Function));
    emit({ action: "html-updated", slug: "p", updatedAt: T2 });
    expect(result.current).toBe(T2);
  });

  test("another slug or action is ignored", () => {
    const { result } = renderHook(() => useHtmlPageStamp("acme", "p", T1));
    emit({ action: "html-updated", slug: "other", updatedAt: T2 });
    emit({ action: "html-created", slug: "p", updatedAt: T2 });
    expect(result.current).toBe(T1);
  });

  test("a stale stamp cannot override a newer one", () => {
    const { result } = renderHook(() => useHtmlPageStamp("acme", "p", T2));
    emit({ action: "html-updated", slug: "p", updatedAt: T1 });
    expect(result.current).toBe(T2);
  });

  test("falls back to the event timestamp when no updatedAt", () => {
    const { result } = renderHook(() => useHtmlPageStamp("acme", "p", T1));
    emit({ action: "html-updated", slug: "p", timestamp: Date.parse(T2) });
    expect(Date.parse(result.current!)).toBe(Date.parse(T2));
  });

  test("no slug means no subscription; unbinds on unmount", () => {
    renderHook(() => useHtmlPageStamp("acme", null, undefined));
    expect(usePusherChannel).toHaveBeenCalledWith(null);
    const { unmount } = renderHook(() => useHtmlPageStamp("acme", "p", T1));
    unmount();
    expect(mockChannel.unbind).toHaveBeenCalled();
  });
});

describe("laterStamp", () => {
  test("keeps the max and tolerates missing values", () => {
    expect(laterStamp(undefined, T1)).toBe(T1);
    expect(laterStamp(T2, T1)).toBe(T2);
    expect(laterStamp(T1, undefined)).toBe(T1);
  });
});
