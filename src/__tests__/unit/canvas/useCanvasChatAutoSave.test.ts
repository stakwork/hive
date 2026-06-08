// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { create } from "zustand";

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

type ConvState = {
  activeConversationId: string | null;
  conversations: Record<
    string,
    {
      messages: Array<{ id: string; role: string; content: string }>;
      isLoading: boolean;
      isStreaming: boolean;
      serverConversationId: string | null;
      context: ConvContext;
    }
  >;
  ephemeralSeedCounts: Record<string, number>;
  setServerConversationId: (conversationId: string, serverId: string) => void;
};

function makeStore(initial?: Partial<ConvState>) {
  return create<ConvState>((set) => ({
    activeConversationId: null,
    conversations: {},
    ephemeralSeedCounts: {},
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
    ...initial,
  }));
}

// The hook imports `useCanvasChatStore` directly; we replace the module with
// a factory that returns a fresh store per test.
// Must be `var` (not `let`) because vi.mock factories are hoisted above
// variable declarations, and `let` would cause a TDZ error.
// eslint-disable-next-line no-var
var _store: ReturnType<typeof makeStore>;

vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => {
  const zustand = require("zustand");
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

function makeMsg(role: "user" | "assistant", id = "m1") {
  return { id, role, content: "Hello" };
}

const baseContext = {
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
    messages: ReturnType<typeof makeMsg>[];
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

function buildFetch(responseId: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ id: responseId }),
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("useCanvasChatAutoSave", () => {
  beforeEach(() => {
    _store = makeStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not fetch when githubLogin is null/empty", () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    // Set up a conversation with a message
    _store.setState({
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": makeConv({ messages: [makeMsg("user")] }),
      },
    });

    renderHook(() => useCanvasChatAutoSave({ githubLogin: null }));

    // Trigger the subscription by updating the store
    act(() => {
      _store.setState((s) => ({ ...s })); // no-op update
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs to org endpoint on first message (no serverConversationId)", async () => {
    const fetchSpy = buildFetch("server-id-1");
    global.fetch = fetchSpy;

    _store.setState({
      activeConversationId: "conv-1",
      conversations: { "conv-1": makeConv() },
      ephemeralSeedCounts: {},
    });

    renderHook(() => useCanvasChatAutoSave({ githubLogin: "my-org" }));

    // Simulate: message added, not loading
    await act(async () => {
      _store.setState({
        conversations: {
          "conv-1": makeConv({ messages: [makeMsg("user", "m1")] }),
        },
      });
      // Let microtasks settle
      await Promise.resolve();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/orgs/my-org/chat/conversations",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("PUTs to org endpoint on subsequent messages (serverConversationId set)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    global.fetch = fetchSpy;

    _store.setState({
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": makeConv({ messages: [makeMsg("user", "m1")], serverConversationId: "already-saved" }),
      },
      ephemeralSeedCounts: { "conv-1": 1 }, // m1 already saved
    });

    renderHook(() => useCanvasChatAutoSave({ githubLogin: "my-org" }));

    // Simulate: assistant reply added
    await act(async () => {
      _store.setState({
        conversations: {
          "conv-1": makeConv({
            messages: [makeMsg("user", "m1"), makeMsg("assistant", "m2")],
            serverConversationId: "already-saved",
          }),
        },
      });
      await Promise.resolve();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/orgs/my-org/chat/conversations/already-saved",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("does not save while isStreaming=true (stream in progress)", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    _store.setState({
      activeConversationId: "conv-1",
      conversations: { "conv-1": makeConv() },
    });

    renderHook(() => useCanvasChatAutoSave({ githubLogin: "my-org" }));

    act(() => {
      _store.setState({
        conversations: {
          "conv-1": makeConv({ messages: [makeMsg("user", "m1")], isStreaming: true }),
        },
      });
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("saves even if isLoading=true as long as isStreaming=false", async () => {
    // isLoading flips to false on first chunk (UX) but isStreaming stays true
    // until the stream fully finishes. This test verifies the save gate only
    // cares about isStreaming, not isLoading.
    const fetchSpy = buildFetch("srv-x");
    global.fetch = fetchSpy;

    _store.setState({
      activeConversationId: "conv-1",
      conversations: { "conv-1": makeConv() },
    });

    renderHook(() => useCanvasChatAutoSave({ githubLogin: "my-org" }));

    await act(async () => {
      _store.setState({
        conversations: {
          "conv-1": makeConv({
            messages: [makeMsg("user", "m1")],
            isLoading: true,   // first-chunk UX flip — still "loading" visually
            isStreaming: false, // but stream is done
          }),
        },
      });
      await Promise.resolve();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/orgs/my-org/chat/conversations",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("does NOT save while isStreaming=true even if isLoading=false", async () => {
    // Guard against a regression where isLoading-false alone would let
    // mid-stream saves through.
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    _store.setState({
      activeConversationId: "conv-1",
      conversations: { "conv-1": makeConv() },
    });

    renderHook(() => useCanvasChatAutoSave({ githubLogin: "my-org" }));

    act(() => {
      _store.setState({
        conversations: {
          "conv-1": makeConv({
            messages: [makeMsg("user", "m1")],
            isLoading: false,  // first-chunk flip has happened
            isStreaming: true,  // but stream still in flight
          }),
        },
      });
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fires once isStreaming flips to false after being true", async () => {
    const fetchSpy = buildFetch("srv-y");
    global.fetch = fetchSpy;

    _store.setState({
      activeConversationId: "conv-1",
      conversations: { "conv-1": makeConv() },
    });

    renderHook(() => useCanvasChatAutoSave({ githubLogin: "my-org" }));

    // Stream in progress — should not save
    act(() => {
      _store.setState({
        conversations: {
          "conv-1": makeConv({
            messages: [makeMsg("user", "m1"), makeMsg("assistant", "m2")],
            isStreaming: true,
          }),
        },
      });
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    // Stream completes — should now save
    await act(async () => {
      _store.setState({
        conversations: {
          "conv-1": makeConv({
            messages: [makeMsg("user", "m1"), makeMsg("assistant", "m2")],
            isStreaming: false,
          }),
        },
      });
      await Promise.resolve();
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("calls the org endpoint (not the workspace endpoint)", async () => {
    const fetchSpy = buildFetch("srv-1");
    global.fetch = fetchSpy;

    _store.setState({
      activeConversationId: "conv-1",
      conversations: { "conv-1": makeConv() },
    });

    renderHook(() => useCanvasChatAutoSave({ githubLogin: "acme-corp" }));

    await act(async () => {
      _store.setState({
        conversations: {
          "conv-1": makeConv({ messages: [makeMsg("user", "m1")] }),
        },
      });
      await Promise.resolve();
    });

    const [url] = fetchSpy.mock.calls[0] as [string, ...unknown[]];
    expect(url).toMatch(/\/api\/orgs\/acme-corp\/chat\/conversations/);
    expect(url).not.toMatch(/\/api\/workspaces\//);
  });
});
