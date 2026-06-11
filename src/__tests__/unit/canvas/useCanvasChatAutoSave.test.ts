// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { create } from "zustand";

// Backend-driven canvas turns (docs/plans/backend-driven-canvas-turns.md):
// the SERVER is the single writer. This hook NO LONGER POSTs/PUTs — it only
// live-syncs server-appended rows on a Pusher nudge, filtering out rows for
// turns THIS tab authored (it's already showing them optimistically). These
// tests cover that contract.

// ── Store factory ──────────────────────────────────────────────────────────

type ConvContext = {
  workspaceSlug: string | null;
  workspaceSlugs: string[];
  orgId: string;
  githubLogin: string;
  currentCanvasRef: string;
  currentCanvasBreadcrumb: string;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
};

type Msg = { id: string; role: string; content: string };

type ConvState = {
  activeConversationId: string | null;
  conversations: Record<
    string,
    {
      messages: Msg[];
      isLoading: boolean;
      isStreaming: boolean;
      serverConversationId: string | null;
      context: ConvContext;
    }
  >;
  ephemeralSeedCounts: Record<string, number>;
  locallyAuthoredTurnIds: Set<string>;
  setServerConversationId: (conversationId: string, serverId: string) => void;
  setConversationMessages: (conversationId: string, messages: Msg[]) => void;
};

function makeStore(initial?: Partial<ConvState>) {
  return create<ConvState>((set) => ({
    activeConversationId: null,
    conversations: {},
    ephemeralSeedCounts: {},
    locallyAuthoredTurnIds: new Set<string>(),
    setServerConversationId: (conversationId, serverId) =>
      set((s) => ({
        conversations: {
          ...s.conversations,
          [conversationId]: {
            ...s.conversations[conversationId],
            serverConversationId: serverId,
          },
        },
      })),
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

// ── Pusher mock (live-sync) ────────────────────────────────────────────────
// Captures the bound `CANVAS_CONVERSATION_UPDATED` handler so tests can
// simulate a server-side nudge.
const { fakePusher } = vi.hoisted(() => {
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const channel = {
    bind: (ev: string, h: (...a: unknown[]) => void) => {
      handlers[ev] = h;
    },
    unbind_all: () => {},
  };
  const client = { subscribe: () => channel, unsubscribe: () => {} };
  return {
    fakePusher: {
      client,
      fire: (ev: string) => handlers[ev]?.(),
    },
  };
});

vi.mock("@/lib/pusher", () => ({
  getPusherClient: () => fakePusher.client,
  getCanvasConversationChannelName: (id: string) => `canvas-conversation-${id}`,
  PUSHER_EVENTS: { CANVAS_CONVERSATION_UPDATED: "canvas-conversation-updated" },
}));

// The hook imports `useCanvasChatStore` directly; we replace the module with
// a factory that returns a fresh store per test.
// Must be `var` (not `let`) because vi.mock factories are hoisted above
// variable declarations, and `let` would cause a TDZ error.
// eslint-disable-next-line no-var
var _store: ReturnType<typeof makeStore>;

vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => {
  // Will be overwritten in beforeEach
  _store = makeStore();
  const proxy: any = new Proxy(() => {}, {
    apply(_t, _this, args: [any]) {
      return _store(args[0]);
    },
    get(_t, prop) {
      if (prop === "getState") return () => _store.getState();
      if (prop === "subscribe") return _store.subscribe.bind(_store);
      return (_store as any)[prop];
    },
  });
  return { useCanvasChatStore: proxy };
});

import { useCanvasChatAutoSave } from "@/app/org/[githubLogin]/_state/useCanvasChatAutoSave";

// ── helpers ────────────────────────────────────────────────────────────────

function makeMsg(role: "user" | "assistant", id = "m1"): Msg {
  return { id, role, content: "Hello" };
}

const baseContext: ConvContext = {
  workspaceSlug: null,
  workspaceSlugs: [],
  orgId: "org-1",
  githubLogin: "my-org",
  currentCanvasRef: "",
  currentCanvasBreadcrumb: "",
  selectedNodeId: null,
  selectedNodeIds: [],
};

function makeConv(
  overrides: Partial<{
    messages: Msg[];
    isLoading: boolean;
    isStreaming: boolean;
    serverConversationId: string | null;
  }> = {},
) {
  return {
    messages: [],
    isLoading: false,
    isStreaming: false,
    serverConversationId: null,
    context: baseContext,
    ...overrides,
  };
}

function fetchReturning(messages: Msg[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ messages }),
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("useCanvasChatAutoSave (live-sync)", () => {
  beforeEach(() => {
    _store = makeStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when githubLogin is null/empty", () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    _store.setState({
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": makeConv({
          messages: [makeMsg("user")],
          serverConversationId: "server-1",
        }),
      },
    });

    renderHook(() => useCanvasChatAutoSave({ githubLogin: null }));

    act(() => {
      _store.setState((s) => ({ ...s }));
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never POSTs/PUTs — persistence is server-side now", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    _store.setState({
      activeConversationId: "conv-1",
      conversations: { "conv-1": makeConv() },
    });

    renderHook(() => useCanvasChatAutoSave({ githubLogin: "my-org" }));

    // A new user message + assistant reply appended locally — old hook would
    // POST then PUT. New hook writes nothing.
    await act(async () => {
      _store.setState({
        conversations: {
          "conv-1": makeConv({
            messages: [makeMsg("user", "m1"), makeMsg("assistant", "m2")],
          }),
        },
      });
      await Promise.resolve();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("on a nudge, refetches and merges server-appended rows when idle", async () => {
    _store.setState({
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": makeConv({
          messages: [makeMsg("user", "m1"), makeMsg("assistant", "a1")],
          serverConversationId: "server-1",
        }),
      },
    });

    const serverMessages: Msg[] = [
      { id: "m1", role: "user", content: "Hello" },
      { id: "a1", role: "assistant", content: "Hi" },
      {
        id: "planner-x",
        role: "assistant",
        content: "Plan ready",
        // @ts-expect-error extra field tolerated by hydration
        source: { kind: "planner", featureId: "f1", plannerMessageId: "x" },
      },
    ];
    const fetchSpy = fetchReturning(serverMessages);
    global.fetch = fetchSpy;

    renderHook(() => useCanvasChatAutoSave({ githubLogin: "my-org" }));

    // Trigger subscription, then fire the nudge.
    act(() => {
      _store.setState((s) => ({ ...s }));
    });
    await act(async () => {
      fakePusher.fire("canvas-conversation-updated");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/orgs/my-org/chat/conversations/server-1",
    );
    const msgs = _store.getState().conversations["conv-1"].messages;
    expect(msgs).toHaveLength(3);
    expect(msgs[2].id).toBe("planner-x");
  });

  it("filters out server rows for turns THIS tab authored (no double-render)", async () => {
    // The tab authored `turn-1` (it's showing its own optimistic stream
    // under `local-*` ids). The server persisted that turn as `turn-1-u` /
    // `turn-1-a0`, and separately fanned out a planner row.
    _store.setState({
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": makeConv({
          messages: [
            { id: "local-u", role: "user", content: "Q" },
            { id: "local-a", role: "assistant", content: "A (streamed)" },
          ],
          serverConversationId: "server-1",
        }),
      },
      locallyAuthoredTurnIds: new Set(["turn-1"]),
    });

    const serverMessages: Msg[] = [
      { id: "turn-1-u", role: "user", content: "Q" },
      { id: "turn-1-a0", role: "assistant", content: "A (server)" },
      { id: "planner-x", role: "assistant", content: "Plan ready" },
    ];
    global.fetch = fetchReturning(serverMessages);

    renderHook(() => useCanvasChatAutoSave({ githubLogin: "my-org" }));
    act(() => {
      _store.setState((s) => ({ ...s }));
    });
    await act(async () => {
      fakePusher.fire("canvas-conversation-updated");
      await Promise.resolve();
      await Promise.resolve();
    });

    const msgs = _store.getState().conversations["conv-1"].messages;
    const ids = msgs.map((m) => m.id);
    // Local optimistic rows kept; the planner row (not authored) merged in;
    // the authored turn's server rows filtered out.
    expect(ids).toEqual(["local-u", "local-a", "planner-x"]);
    expect(ids).not.toContain("turn-1-u");
    expect(ids).not.toContain("turn-1-a0");
  });

  it("defers a mid-stream nudge and syncs once the stream settles", async () => {
    _store.setState({
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": makeConv({
          messages: [makeMsg("user", "m1")],
          serverConversationId: "server-1",
          isStreaming: true,
        }),
      },
    });

    global.fetch = fetchReturning([
      { id: "m1", role: "user", content: "Hello" },
      { id: "planner-y", role: "assistant", content: "Update" },
    ]);

    renderHook(() => useCanvasChatAutoSave({ githubLogin: "my-org" }));
    act(() => {
      _store.setState((s) => ({ ...s }));
    });

    // Nudge arrives mid-stream → must NOT fetch/merge yet.
    await act(async () => {
      fakePusher.fire("canvas-conversation-updated");
      await Promise.resolve();
    });
    expect(global.fetch).not.toHaveBeenCalled();

    // Stream settles → deferred sync runs.
    await act(async () => {
      _store.setState({
        conversations: {
          "conv-1": makeConv({
            messages: [makeMsg("user", "m1")],
            serverConversationId: "server-1",
            isStreaming: false,
          }),
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/orgs/my-org/chat/conversations/server-1",
    );
    const msgs = _store.getState().conversations["conv-1"].messages;
    expect(msgs.map((m) => m.id)).toContain("planner-y");
  });
});
