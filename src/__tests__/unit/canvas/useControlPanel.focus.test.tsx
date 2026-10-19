// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockOpen = vi.hoisted(() => vi.fn());
const mockSetDraft = vi.hoisted(() => vi.fn());
const item = vi.hoisted(() => ({
  id: "c1",
  title: "One",
  lastActivityAt: new Date().toISOString(),
  working: false,
  jobs: [],
  pullRequests: [],
}));
const item2 = vi.hoisted(() => ({ ...item, id: "c2", title: "Two" }));

vi.mock("@/app/org/[githubLogin]/_state/openOrgConversation", () => ({
  openOrgConversation: mockOpen,
  startNewOrgConversation: vi.fn(),
}));
vi.mock("@/app/org/[githubLogin]/_components/control-panel/useControlPanelItems", () => ({
  useControlPanelItems: () => ({
    items: [item, item2],
    archivedItems: [],
    remaining: 0,
    loading: false,
    refetch: vi.fn(),
    showMore: vi.fn(),
    archiveConversation: vi.fn(),
    restoreConversation: vi.fn(),
  }),
}));
vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => {
  const state = {
    activeConversationId: null,
    conversations: {},
    setPendingInputDraft: mockSetDraft,
    openArtifactPanel: vi.fn(),
  };
  const useCanvasChatStore: any = (selector: (s: typeof state) => unknown) => selector(state);
  useCanvasChatStore.getState = () => state;
  return { useCanvasChatStore };
});

import { useControlPanel } from "@/app/org/[githubLogin]/_components/control-panel/useControlPanel";

describe("useControlPanel composer focus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockOpen.mockReset();
    mockSetDraft.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("row click requests composer focus once the chat opens", async () => {
    mockOpen.mockResolvedValue(true);
    const { result } = renderHook(() => useControlPanel("org"));
    await act(async () => {
      await result.current.onOpen(item as any);
    });
    expect(mockSetDraft).toHaveBeenCalledWith("");
  });

  it("row click does not request focus when the open fails", async () => {
    mockOpen.mockResolvedValue(false);
    const { result } = renderHook(() => useControlPanel("org"));
    await act(async () => {
      await result.current.onOpen(item as any);
    });
    expect(mockSetDraft).not.toHaveBeenCalled();
  });

  it("keyboard navigation keeps focus in the list", async () => {
    mockOpen.mockResolvedValue(true);
    renderHook(() => useControlPanel("org"));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(mockOpen).toHaveBeenCalled();
    expect(mockSetDraft).not.toHaveBeenCalled();
  });
});
