/**
 * Unit tests for useCanvasAgentActivity hook
 *
 * Covers: idle, isLoading, isStreaming, and no active conversation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCanvasAgentActivity } from "@/hooks/useCanvasAgentActivity";

let mockIsLoading = false;
let mockIsStreaming = false;

vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => ({
  useCanvasChatStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      conversations: {
        "conv-1": { isLoading: mockIsLoading, isStreaming: mockIsStreaming },
      },
    }),
  ),
}));

beforeEach(() => {
  mockIsLoading = false;
  mockIsStreaming = false;
});

describe("useCanvasAgentActivity", () => {
  it("returns isActive: false when conversation is idle", () => {
    const { result } = renderHook(() => useCanvasAgentActivity("conv-1"));
    expect(result.current.isActive).toBe(false);
  });

  it("returns isActive: true when isLoading is true", () => {
    mockIsLoading = true;
    const { result } = renderHook(() => useCanvasAgentActivity("conv-1"));
    expect(result.current.isActive).toBe(true);
  });

  it("returns isActive: true when isStreaming is true", () => {
    mockIsStreaming = true;
    const { result } = renderHook(() => useCanvasAgentActivity("conv-1"));
    expect(result.current.isActive).toBe(true);
  });

  it("returns isActive: false with no active conversation", () => {
    mockIsLoading = true;
    const { result } = renderHook(() => useCanvasAgentActivity(null));
    expect(result.current.isActive).toBe(false);
  });
});
