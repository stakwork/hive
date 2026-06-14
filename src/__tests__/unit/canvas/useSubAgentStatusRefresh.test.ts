// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { create } from "zustand";

// ── Store factory ──────────────────────────────────────────────────────────

type PlannerSource = {
  kind: "planner";
  featureId?: string;
  workflowStatus?: string;
  hasLogs?: boolean;
};

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  source?: PlannerSource | { kind: string } | null;
};

type ConvState = {
  activeConversationId: string | null;
  conversations: Record<
    string,
    {
      messages: Msg[];
      isStreaming: boolean;
      serverConversationId: string | null;
    }
  >;
  setConversationMessages: (conversationId: string, messages: Msg[]) => void;
};

function makeStore(initial?: Partial<ConvState>) {
  return create<ConvState>((set) => ({
    activeConversationId: null,
    conversations: {},
    setConversationMessages: (conversationId, messages) =>
      set((s) => ({
        conversations: {
          ...s.conversations,
          [conversationId]: {
            ...s.conversations[conversationId],
            messages,
          },
        },
      })),
    ...initial,
  }));
}

// Must be `var` — vi.mock factories are hoisted, so `let` would be TDZ.
// eslint-disable-next-line no-var
var _store: ReturnType<typeof makeStore>;

vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => {
  _store = makeStore();
  const proxy: unknown = new Proxy(() => {}, {
    apply(_t, _this, args: [unknown]) {
      return (_store as (sel: unknown) => unknown)(args[0]);
    },
    get(_t, prop) {
      if (prop === "getState") return () => _store.getState();
      if (prop === "subscribe") return _store.subscribe.bind(_store);
      return (_store as Record<string, unknown>)[prop as string];
    },
  });
  return { useCanvasChatStore: proxy };
});

// ── Import after mocks ─────────────────────────────────────────────────────
import {
  useSubAgentStatusRefresh,
  SUBAGENT_POLL_INTERVAL_MS,
} from "@/app/org/[githubLogin]/_state/useSubAgentStatusRefresh";

// ── Helpers ────────────────────────────────────────────────────────────────

function plannerMsg(
  id: string,
  featureId: string,
  workflowStatus: string,
  hasLogs = false,
): Msg {
  return {
    id,
    role: "assistant",
    content: "Plan update",
    source: { kind: "planner", featureId, workflowStatus, hasLogs },
  };
}

function makeConv(messages: Msg[]) {
  return { messages, isStreaming: false, serverConversationId: "server-1" };
}

function firePlanStatusResponse(
  featureId: string,
  workflowStatus: string,
  hasLogs = false,
) {
  return {
    status: "fulfilled",
    value: {
      ok: true,
      json: async () => ({ workflowStatus, hasLogs }),
    },
  } as unknown;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("useSubAgentStatusRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _store = makeStore();
    vi.stubGlobal("fetch", vi.fn());
    // Default: tab is visible
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("calls fetch for each featureId when tab becomes visible", async () => {
    _store.setState({
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": makeConv([
          plannerMsg("m1", "feat-a", "IN_PROGRESS"),
          plannerMsg("m2", "feat-b", "PENDING"),
        ]),
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workflowStatus: "COMPLETED", hasLogs: true }),
    });
    vi.stubGlobal("fetch", mockFetch);

    renderHook(() => useSubAgentStatusRefresh({ githubLogin: "my-org" }));

    // Simulate tab hidden then visible
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/features/feat-a/plan-status");
    expect(mockFetch).toHaveBeenCalledWith("/api/features/feat-b/plan-status");
  });

  it("starts interval when in-flight rows exist and tab is visible", async () => {
    _store.setState({
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": makeConv([plannerMsg("m1", "feat-a", "IN_PROGRESS")]),
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workflowStatus: "IN_PROGRESS", hasLogs: false }),
    });
    vi.stubGlobal("fetch", mockFetch);

    renderHook(() => useSubAgentStatusRefresh({ githubLogin: "my-org" }));

    // Trigger subscription by updating store
    act(() => {
      _store.setState((s) => ({ ...s }));
    });

    // Advance timer by one interval
    await act(async () => {
      vi.advanceTimersByTime(SUBAGENT_POLL_INTERVAL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/features/feat-a/plan-status");
  });

  it("stops polling when all statuses become terminal", async () => {
    _store.setState({
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": makeConv([plannerMsg("m1", "feat-a", "IN_PROGRESS")]),
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workflowStatus: "COMPLETED", hasLogs: true }),
    });
    vi.stubGlobal("fetch", mockFetch);

    renderHook(() => useSubAgentStatusRefresh({ githubLogin: "my-org" }));

    act(() => {
      _store.setState((s) => ({ ...s }));
    });

    // Advance one interval — fetch fires and patches COMPLETED
    await act(async () => {
      vi.advanceTimersByTime(SUBAGENT_POLL_INTERVAL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    const callsAfterFirst = mockFetch.mock.calls.length;

    // Now simulate store update with COMPLETED status (as if patch applied)
    act(() => {
      _store.setState({
        conversations: {
          "conv-1": makeConv([plannerMsg("m1", "feat-a", "COMPLETED")]),
        },
      });
    });

    // Advance another interval — interval should have been cleared
    await act(async () => {
      vi.advanceTimersByTime(SUBAGENT_POLL_INTERVAL_MS);
      await Promise.resolve();
    });

    // No new fetches after terminal status
    expect(mockFetch.mock.calls.length).toBe(callsAfterFirst);
  });

  it("stops polling when tab is hidden", async () => {
    _store.setState({
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": makeConv([plannerMsg("m1", "feat-a", "IN_PROGRESS")]),
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workflowStatus: "IN_PROGRESS", hasLogs: false }),
    });
    vi.stubGlobal("fetch", mockFetch);

    renderHook(() => useSubAgentStatusRefresh({ githubLogin: "my-org" }));

    act(() => {
      _store.setState((s) => ({ ...s }));
    });

    // Hide tab
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Advance — interval should be cleared, no fetches
    await act(async () => {
      vi.advanceTimersByTime(SUBAGENT_POLL_INTERVAL_MS);
      await Promise.resolve();
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not call setConversationMessages when status is already current", async () => {
    _store.setState({
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": makeConv([
          plannerMsg("m1", "feat-a", "COMPLETED", true),
        ]),
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      // Returns the same values already in the message
      json: async () => ({ workflowStatus: "COMPLETED", hasLogs: true }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const setConvSpy = vi.spyOn(
      _store.getState(),
      "setConversationMessages",
    );

    renderHook(() => useSubAgentStatusRefresh({ githubLogin: "my-org" }));

    // Force tab visible trigger
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // setConversationMessages must not be called — nothing changed
    expect(setConvSpy).not.toHaveBeenCalled();
  });

  it("tolerates partial fetch failures — patches fulfilled features, no throw", async () => {
    _store.setState({
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": makeConv([
          plannerMsg("m1", "feat-a", "IN_PROGRESS"),
          plannerMsg("m2", "feat-b", "IN_PROGRESS"),
        ]),
      },
    });

    const mockFetch = vi
      .fn()
      .mockImplementation((url: string) => {
        if (url.includes("feat-a")) return Promise.reject(new Error("Network error"));
        return Promise.resolve({
          ok: true,
          json: async () => ({ workflowStatus: "COMPLETED", hasLogs: true }),
        });
      });
    vi.stubGlobal("fetch", mockFetch);

    renderHook(() => useSubAgentStatusRefresh({ githubLogin: "my-org" }));

    // Advance past polling interval to trigger refresh from the seeded interval
    await act(async () => {
      vi.advanceTimersByTime(SUBAGENT_POLL_INTERVAL_MS);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // feat-b should be patched despite feat-a failing
    const msgs = _store.getState().conversations["conv-1"].messages;
    const featBMsg = msgs.find(
      (m) => (m.source as PlannerSource)?.featureId === "feat-b",
    );
    expect((featBMsg?.source as PlannerSource).workflowStatus).toBe("COMPLETED");

    // feat-a remains unchanged (fetch failed)
    const featAMsg = msgs.find(
      (m) => (m.source as PlannerSource)?.featureId === "feat-a",
    );
    expect((featAMsg?.source as PlannerSource).workflowStatus).toBe("IN_PROGRESS");
  });

  it("guards against concurrent refreshes (inFlightRef)", async () => {
    _store.setState({
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": makeConv([plannerMsg("m1", "feat-a", "IN_PROGRESS")]),
      },
    });

    let resolveFirst!: (value: { ok: boolean; json: () => Promise<{ workflowStatus: string; hasLogs: boolean }> }) => void;
    const firstFetchPromise = new Promise<{ ok: boolean; json: () => Promise<{ workflowStatus: string; hasLogs: boolean }> }>((res) => {
      resolveFirst = res;
    });

    const mockFetch = vi
      .fn()
      .mockReturnValueOnce(firstFetchPromise)
      .mockResolvedValue({
        ok: true,
        json: async () => ({ workflowStatus: "COMPLETED", hasLogs: false }),
      });
    vi.stubGlobal("fetch", mockFetch);

    renderHook(() => useSubAgentStatusRefresh({ githubLogin: "my-org" }));

    // The hook seeds featureIds on mount and may start the interval.
    // Trigger two rapid visibilitychange events to exercise the guard.
    act(() => {
      // Simulate tab re-focus (already visible → hidden → visible)
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await Promise.resolve(); // let first refresh start

    // Trigger second visibility event — inFlightRef should guard
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Only one fetch for feat-a should have fired
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Resolve the pending fetch cleanly
    await act(async () => {
      resolveFirst({
        ok: true,
        json: async () => ({ workflowStatus: "COMPLETED", hasLogs: false }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("removes visibilitychange listener and clears interval on unmount", async () => {
    _store.setState({
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": makeConv([plannerMsg("m1", "feat-a", "IN_PROGRESS")]),
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workflowStatus: "IN_PROGRESS", hasLogs: false }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const removeListenerSpy = vi.spyOn(document, "removeEventListener");

    const { unmount } = renderHook(() =>
      useSubAgentStatusRefresh({ githubLogin: "my-org" }),
    );

    act(() => {
      _store.setState((s) => ({ ...s }));
    });

    unmount();

    // After unmount, advancing timer should not trigger any fetch
    await act(async () => {
      vi.advanceTimersByTime(SUBAGENT_POLL_INTERVAL_MS * 3);
      await Promise.resolve();
    });

    expect(removeListenerSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    // No fetches should happen after unmount
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does nothing when there are no planner rows with featureIds", async () => {
    _store.setState({
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": makeConv([
          { id: "m1", role: "user", content: "Hello" },
          { id: "m2", role: "assistant", content: "Hi", source: null },
        ]),
      },
    });

    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    renderHook(() => useSubAgentStatusRefresh({ githubLogin: "my-org" }));

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
