// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mock useStreamProcessor ────────────────────────────────────────────────

// We need to control when processStream resolves (and whether it throws)
// so we can assert isStreaming mid-flight.
let resolveStream: () => void = () => {};
let rejectStream: (err: Error) => void = () => {};
let streamPromise: Promise<void>;

function resetStreamPromise() {
  streamPromise = new Promise<void>((res, rej) => {
    resolveStream = res;
    rejectStream = rej;
  });
}

vi.mock("@/lib/streaming", () => ({
  useStreamProcessor: () => ({
    processStream: vi.fn(
      (_response: unknown, _messageId: unknown, onUpdate: (msg: unknown) => void) => {
        // Immediately call onUpdate once to simulate a first chunk
        onUpdate({ timeline: [] });
        return streamPromise;
      },
    ),
  }),
}));

// ── Mock canvasChatStore ───────────────────────────────────────────────────

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

interface MockConv {
  messages: Array<{ id: string; role: string; content: string }>;
  isLoading: boolean;
  isStreaming: boolean;
  activeToolCalls: unknown[];
  context: ConvContext;
}

interface MockStoreState {
  conversations: Record<string, MockConv>;
  appendUserMessage: ReturnType<typeof vi.fn>;
  replaceAssistantStream: ReturnType<typeof vi.fn>;
  setActiveToolCalls: ReturnType<typeof vi.fn>;
  setIsLoading: ReturnType<typeof vi.fn>;
  setIsStreaming: ReturnType<typeof vi.fn>;
  appendAssistantError: ReturnType<typeof vi.fn>;
  markTurnAuthored: ReturnType<typeof vi.fn>;
  setServerConversationId: ReturnType<typeof vi.fn>;
}

const baseContext: ConvContext = {
  workspaceSlug: "ws-1",
  workspaceSlugs: [],
  orgId: "org-1",
  githubLogin: "test-org",
  currentCanvasRef: "root",
  currentCanvasBreadcrumb: "",
  selectedNodeId: null,
  selectedNodeIds: [],
};

let mockState: MockStoreState;

function buildMockConv(overrides: Partial<MockConv> = {}): MockConv {
  return {
    messages: [],
    isLoading: false,
    isStreaming: false,
    activeToolCalls: [],
    context: baseContext,
    ...overrides,
  };
}

// Track the isStreaming state as the actions mutate it
function makeTrackedState(): MockStoreState {
  const state: MockStoreState = {
    conversations: {
      "conv-1": buildMockConv(),
    },
    appendUserMessage: vi.fn(),
    replaceAssistantStream: vi.fn(),
    setActiveToolCalls: vi.fn(),
    setIsLoading: vi.fn().mockImplementation((id: string, val: boolean) => {
      if (state.conversations[id]) {
        state.conversations[id] = { ...state.conversations[id], isLoading: val };
      }
    }),
    setIsStreaming: vi.fn().mockImplementation((id: string, val: boolean) => {
      if (state.conversations[id]) {
        state.conversations[id] = { ...state.conversations[id], isStreaming: val };
      }
    }),
    appendAssistantError: vi.fn(),
    markTurnAuthored: vi.fn(),
    setServerConversationId: vi.fn(),
  };
  return state;
}

vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => ({
  useCanvasChatStore: {
    getState: () => mockState,
  },
  toModelMessages: (msgs: unknown[]) => msgs,
}));

// ── Import after mocks ─────────────────────────────────────────────────────

import { useSendCanvasChatMessage } from "@/app/org/[githubLogin]/_state/useSendCanvasChatMessage";

// ── helpers ────────────────────────────────────────────────────────────────

function buildOkFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        releaseLock: vi.fn(),
      }),
    },
  });
}

function buildErrorFetch() {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 500,
    headers: { get: () => null },
    body: null,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("useSendCanvasChatMessage — isStreaming lifecycle", () => {
  beforeEach(() => {
    mockState = makeTrackedState();
    resetStreamPromise();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets isStreaming=true immediately when send starts", async () => {
    global.fetch = buildOkFetch();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    // Start the send — don't await yet
    let sendPromise: Promise<void>;
    act(() => {
      sendPromise = result.current({
        conversationId: "conv-1",
        content: "hello",
      });
    });

    // setIsStreaming(true) should have been called synchronously before the
    // await fetch completes
    expect(mockState.setIsStreaming).toHaveBeenCalledWith("conv-1", true);

    // Clean up by resolving the stream
    resolveStream();
    await act(async () => { await sendPromise!; });
  });

  it("sets isStreaming=false in finally on successful stream completion", async () => {
    global.fetch = buildOkFetch();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    resolveStream(); // stream completes immediately

    await act(async () => {
      await result.current({ conversationId: "conv-1", content: "hello" });
    });

    // Both setIsStreaming calls: true (start) then false (finally)
    const calls = (mockState.setIsStreaming as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toContainEqual(["conv-1", true]);
    expect(calls).toContainEqual(["conv-1", false]);

    // false must be the last call
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toEqual(["conv-1", false]);
  });

  it("sets isStreaming=false in finally even when fetch returns a non-OK status", async () => {
    global.fetch = buildErrorFetch();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    await act(async () => {
      await result.current({ conversationId: "conv-1", content: "hello" });
    });

    const calls = (mockState.setIsStreaming as ReturnType<typeof vi.fn>).mock.calls;
    // Must have been set to true at start
    expect(calls).toContainEqual(["conv-1", true]);
    // And cleared to false in finally
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toEqual(["conv-1", false]);
  });

  it("sets isStreaming=false in finally when the stream itself throws", async () => {
    global.fetch = buildOkFetch();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    // Make the stream reject
    rejectStream(new Error("stream broke"));

    await act(async () => {
      await result.current({ conversationId: "conv-1", content: "hello" });
    });

    const calls = (mockState.setIsStreaming as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toContainEqual(["conv-1", true]);
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toEqual(["conv-1", false]);
  });

  it("does NOT touch the first-chunk setIsLoading(false) call — UX is unchanged", async () => {
    global.fetch = buildOkFetch();
    resolveStream();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    await act(async () => {
      await result.current({ conversationId: "conv-1", content: "hello" });
    });

    const isLoadingCalls = (mockState.setIsLoading as ReturnType<typeof vi.fn>).mock.calls;

    // setIsLoading(true) called at start
    expect(isLoadingCalls).toContainEqual(["conv-1", true]);
    // setIsLoading(false) called in finally
    expect(isLoadingCalls).toContainEqual(["conv-1", false]);

    // isStreaming calls are separate and don't interfere
    const isStreamingCalls = (mockState.setIsStreaming as ReturnType<typeof vi.fn>).mock.calls;
    expect(isStreamingCalls).toContainEqual(["conv-1", true]);
    expect(isStreamingCalls).toContainEqual(["conv-1", false]);
  });
});
