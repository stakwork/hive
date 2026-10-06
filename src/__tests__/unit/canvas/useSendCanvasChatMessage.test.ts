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

// Mutable timeline that tests can override before each send.
let mockTimeline: unknown[] = [];

// Optional usage data to emit on the final (isStreaming=false) onUpdate call.
let mockFinalUsage: Record<string, number> | undefined = undefined;

vi.mock("@/lib/streaming", () => ({
  useStreamProcessor: () => ({
    processStream: vi.fn(
      (_response: unknown, _messageId: unknown, onUpdate: (msg: unknown) => void) => {
        // Immediately call onUpdate once to simulate a first (streaming) chunk
        onUpdate({ timeline: mockTimeline, isStreaming: true });
        // Resolve with a final non-streaming call after stream promise settles
        return streamPromise.then(() => {
          onUpdate({ timeline: mockTimeline, isStreaming: false, usage: mockFinalUsage });
        });
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
  agentTurnsInProgress: number;
  activeToolCalls: unknown[];
  activeTurn?: { turnId: string; controller: AbortController; canStop: boolean; stopping: boolean } | null;
  serverConversationId?: string | null;
  context: ConvContext;
}

interface MockStoreState {
  conversations: Record<string, MockConv>;
  appendUserMessage: ReturnType<typeof vi.fn>;
  replaceAssistantStream: ReturnType<typeof vi.fn>;
  setActiveToolCalls: ReturnType<typeof vi.fn>;
  setIsLoading: ReturnType<typeof vi.fn>;
  setIsStreaming: ReturnType<typeof vi.fn>;
  setRunActive: ReturnType<typeof vi.fn>;
  appendAssistantError: ReturnType<typeof vi.fn>;
  markTurnAuthored: ReturnType<typeof vi.fn>;
  setServerConversationId: ReturnType<typeof vi.fn>;
  bumpAgentTurns: ReturnType<typeof vi.fn>;
  setActiveTurn: ReturnType<typeof vi.fn>;
  finishStoppedTurn: ReturnType<typeof vi.fn>;
  removeTurn: ReturnType<typeof vi.fn>;
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
    agentTurnsInProgress: 0,
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
    setRunActive: vi.fn(),
    appendAssistantError: vi.fn(),
    markTurnAuthored: vi.fn(),
    setServerConversationId: vi.fn(),
    bumpAgentTurns: vi.fn().mockImplementation((id: string, delta: number) => {
      if (state.conversations[id]) {
        const next = Math.max(0, state.conversations[id].agentTurnsInProgress + delta);
        state.conversations[id] = { ...state.conversations[id], agentTurnsInProgress: next };
      }
    }),
    setActiveTurn: vi.fn().mockImplementation((id: string, activeTurn: MockConv["activeTurn"]) => {
      if (state.conversations[id]) {
        state.conversations[id] = { ...state.conversations[id], activeTurn };
      }
    }),
    finishStoppedTurn: vi.fn(),
    removeTurn: vi.fn(),
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

import {
  stopCanvasChatTurn,
  useSendCanvasChatMessage,
} from "@/app/org/[githubLogin]/_state/useSendCanvasChatMessage";

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

describe("useSendCanvasChatMessage — attachments forwarding", () => {
  beforeEach(() => {
    mockState = makeTrackedState();
    mockTimeline = [];
    mockFinalUsage = undefined;
    resetStreamPromise();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stamps attachments onto the user message", async () => {
    global.fetch = buildOkFetch();
    resolveStream();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    const attachments = [
      { path: "uploads/ws-1/canvas/img.jpg", filename: "img.jpg", mimeType: "image/jpeg", size: 1024 },
    ];

    await act(async () => {
      await result.current({ conversationId: "conv-1", content: "here is an image", attachments });
    });

    const appendCall = (mockState.appendUserMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    const userMsg = appendCall[1];
    expect(userMsg.attachments).toEqual(attachments);
  });

  it("does NOT stamp attachments when the array is empty", async () => {
    global.fetch = buildOkFetch();
    resolveStream();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    await act(async () => {
      await result.current({ conversationId: "conv-1", content: "no files", attachments: [] });
    });

    const appendCall = (mockState.appendUserMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    const userMsg = appendCall[1];
    expect(userMsg).not.toHaveProperty("attachments");
  });

  it("forwards attachments in the fetch body", async () => {
    const fakeFetch = buildOkFetch();
    global.fetch = fakeFetch;
    resolveStream();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    const attachments = [
      { path: "uploads/ws-1/canvas/doc.pdf", filename: "doc.pdf", mimeType: "application/pdf", size: 5000 },
    ];

    await act(async () => {
      await result.current({ conversationId: "conv-1", content: "see attachment", attachments });
    });

    const [, fetchInit] = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchInit.body);
    expect(body.attachments).toEqual(attachments);
  });

  it("does NOT include attachments key in fetch body when no attachments", async () => {
    const fakeFetch = buildOkFetch();
    global.fetch = fakeFetch;
    resolveStream();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    await act(async () => {
      await result.current({ conversationId: "conv-1", content: "just text" });
    });

    const [, fetchInit] = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchInit.body);
    expect(body).not.toHaveProperty("attachments");
  });
});

describe("useSendCanvasChatMessage — timeline ordering: interleaved text and tool calls", () => {
  beforeEach(() => {
    mockState = makeTrackedState();
    mockTimeline = [];
    mockFinalUsage = undefined;
    resetStreamPromise();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("interleaves text and tool-call messages in true arrival order", async () => {
    mockTimeline = [
      { type: "text", data: { content: "A" } },
      { type: "toolCall", data: { id: "tc-1", toolName: "tool_one", input: {}, output: { ok: true }, status: "output" } },
      { type: "text", data: { content: "B" } },
      { type: "toolCall", data: { id: "tc-2", toolName: "tool_two", input: {}, output: { ok: true }, status: "output" } },
      { type: "text", data: { content: "C" } },
    ];

    global.fetch = buildOkFetch();
    resolveStream();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    await act(async () => {
      await result.current({ conversationId: "conv-1", content: "hello" });
    });

    const calls = (mockState.replaceAssistantStream as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    const timelineMessages = lastCall[2] as Array<{ content: string; toolCalls?: Array<{ toolName: string }> }>;

    expect(timelineMessages).toHaveLength(5);
    // 1: text "A"
    expect(timelineMessages[0].content).toBe("A");
    expect(timelineMessages[0].toolCalls).toBeUndefined();
    // 2: tool call 1
    expect(timelineMessages[1].content).toBe("");
    expect(timelineMessages[1].toolCalls).toHaveLength(1);
    expect(timelineMessages[1].toolCalls![0].toolName).toBe("tool_one");
    // 3: text "B"
    expect(timelineMessages[2].content).toBe("B");
    expect(timelineMessages[2].toolCalls).toBeUndefined();
    // 4: tool call 2
    expect(timelineMessages[3].content).toBe("");
    expect(timelineMessages[3].toolCalls).toHaveLength(1);
    expect(timelineMessages[3].toolCalls![0].toolName).toBe("tool_two");
    // 5: text "C"
    expect(timelineMessages[4].content).toBe("C");
    expect(timelineMessages[4].toolCalls).toBeUndefined();
  });

  it("regression: does NOT batch all tool calls after all text segments", async () => {
    mockTimeline = [
      { type: "text", data: { content: "A" } },
      { type: "toolCall", data: { id: "tc-1", toolName: "tool_one", input: {}, output: {}, status: "output" } },
      { type: "text", data: { content: "B" } },
    ];

    global.fetch = buildOkFetch();
    resolveStream();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    await act(async () => {
      await result.current({ conversationId: "conv-1", content: "hello" });
    });

    const calls = (mockState.replaceAssistantStream as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    const timelineMessages = lastCall[2] as Array<{ content: string; toolCalls?: unknown[] }>;

    // With the fix: [text-A, toolCall-1, text-B] — 3 entries
    expect(timelineMessages).toHaveLength(3);

    // The broken behaviour was: text-A+B concatenated first, tool batched at end.
    // Confirm text-A is NOT merged with text-B.
    expect(timelineMessages[0].content).toBe("A");
    // Tool call appears at index 1 (between the two text segments), not last.
    expect(timelineMessages[1].toolCalls).toBeDefined();
    expect(timelineMessages[2].content).toBe("B");
  });
});

describe("useSendCanvasChatMessage — isStreaming lifecycle", () => {
  beforeEach(() => {
    mockState = makeTrackedState();
    mockTimeline = [];
    mockFinalUsage = undefined;
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

describe("useSendCanvasChatMessage — agentTurnsInProgress lifecycle", () => {
  beforeEach(() => {
    mockState = makeTrackedState();
    mockTimeline = [];
    mockFinalUsage = undefined;
    resetStreamPromise();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("bumps agentTurnsInProgress to 1 synchronously when send starts", async () => {
    global.fetch = buildOkFetch();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    let sendPromise: Promise<void>;
    act(() => {
      sendPromise = result.current({
        conversationId: "conv-1",
        content: "hello",
      });
    });

    // bumpAgentTurns(+1) should have been called synchronously before the
    // await fetch completes.
    expect(mockState.bumpAgentTurns).toHaveBeenCalledWith("conv-1", 1);
    expect(mockState.conversations["conv-1"].agentTurnsInProgress).toBe(1);

    resolveStream();
    await act(async () => { await sendPromise!; });
  });

  it("decrements agentTurnsInProgress to 0 in finally on successful stream completion", async () => {
    global.fetch = buildOkFetch();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    resolveStream();

    await act(async () => {
      await result.current({ conversationId: "conv-1", content: "hello" });
    });

    const calls = (mockState.bumpAgentTurns as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toContainEqual(["conv-1", 1]);
    expect(calls).toContainEqual(["conv-1", -1]);
    // The decrement must be the last bumpAgentTurns call (finally runs last).
    expect(calls[calls.length - 1]).toEqual(["conv-1", -1]);
    expect(mockState.conversations["conv-1"].agentTurnsInProgress).toBe(0);
  });

  it("decrements agentTurnsInProgress to 0 in finally when fetch returns a non-OK status", async () => {
    global.fetch = buildErrorFetch();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    await act(async () => {
      await result.current({ conversationId: "conv-1", content: "hello" });
    });

    const calls = (mockState.bumpAgentTurns as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toContainEqual(["conv-1", 1]);
    expect(calls[calls.length - 1]).toEqual(["conv-1", -1]);
    expect(mockState.conversations["conv-1"].agentTurnsInProgress).toBe(0);
  });

  it("decrements agentTurnsInProgress to 0 in finally when the stream itself throws", async () => {
    global.fetch = buildOkFetch();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    rejectStream(new Error("stream broke"));

    await act(async () => {
      await result.current({ conversationId: "conv-1", content: "hello" });
    });

    const calls = (mockState.bumpAgentTurns as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toContainEqual(["conv-1", 1]);
    expect(calls[calls.length - 1]).toEqual(["conv-1", -1]);
    expect(mockState.conversations["conv-1"].agentTurnsInProgress).toBe(0);
  });

  it("does NOT decrement agentTurnsInProgress on the first chunk", async () => {
    global.fetch = buildOkFetch();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    // Don't resolve the stream yet — only the first onUpdate chunk fires.
    let sendPromise: Promise<void>;
    act(() => {
      sendPromise = result.current({ conversationId: "conv-1", content: "hello" });
    });

    // First chunk clears isLoading but must NOT touch agentTurnsInProgress.
    expect(mockState.conversations["conv-1"].agentTurnsInProgress).toBe(1);
    const calls = (mockState.bumpAgentTurns as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toEqual([["conv-1", 1]]);

    resolveStream();
    await act(async () => { await sendPromise!; });
  });

  it("refuses a second send while a turn runs, and takes one again once it ends", async () => {
    global.fetch = buildOkFetch();
    const { result } = renderHook(() => useSendCanvasChatMessage());

    let first: Promise<void>;
    act(() => {
      first = result.current({ conversationId: "conv-1", content: "first turn" });
    });
    expect(mockState.conversations["conv-1"].activeTurn).toBeTruthy();

    await act(async () => {
      await result.current({ conversationId: "conv-1", content: "second turn" });
    });
    expect(mockState.appendUserMessage).toHaveBeenCalledTimes(1);
    expect(mockState.conversations["conv-1"].agentTurnsInProgress).toBe(1);

    resolveStream();
    await act(async () => { await first!; });
    expect(mockState.conversations["conv-1"].activeTurn).toBeNull();
    expect(mockState.conversations["conv-1"].agentTurnsInProgress).toBe(0);

    resetStreamPromise();
    resolveStream();
    await act(async () => {
      await result.current({ conversationId: "conv-1", content: "third turn" });
    });
    expect(mockState.appendUserMessage).toHaveBeenCalledTimes(2);
  });
});

describe("useSendCanvasChatMessage — Stop", () => {
  let abortResponse: { ok: boolean; status: number; json: () => Promise<unknown> };

  beforeEach(() => {
    const quickFetch = buildOkFetch();
    mockState = makeTrackedState();
    mockTimeline = [];
    mockFinalUsage = undefined;
    resetStreamPromise();
    vi.clearAllMocks();
    abortResponse = { ok: true, status: 202, json: async () => ({ accepted: true, conversationId: "row-9" }) };
    global.fetch = vi.fn((url: string, init: RequestInit) =>
      url === "/api/ask/abort" ? Promise.resolve(abortResponse) : quickFetch(url, init),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function startTurnWith(extra: Record<string, unknown> = {}) {
    const { result } = renderHook(() => useSendCanvasChatMessage());
    let send: Promise<void>;
    act(() => {
      send = result.current({ conversationId: "conv-1", content: "explain auth", ...extra });
    });
    return () => send!;
  }
  const startTurn = () => startTurnWith();

  it("asks the server to stop this turn, then ends it as stopped — not as an error", async () => {
    const send = startTurn();
    const turn = mockState.conversations["conv-1"].activeTurn!;

    let stopped: boolean;
    await act(async () => {
      stopped = await stopCanvasChatTurn("conv-1");
    });
    expect(stopped!).toBe(true);
    expect(turn.controller.signal.aborted).toBe(true);

    const abortCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url]) => url === "/api/ask/abort")!;
    expect(JSON.parse(abortCall[1].body)).toEqual({ turnId: turn.turnId, orgId: "org-1" });
    // A first turn stopped before its response named the row adopts it.
    expect(mockState.setServerConversationId).toHaveBeenCalledWith("conv-1", "row-9");

    // The aborted request rejects the stream read.
    rejectStream(new DOMException("The operation was aborted.", "AbortError") as unknown as Error);
    await act(async () => { await send(); });

    expect(mockState.finishStoppedTurn).toHaveBeenCalledWith("conv-1", turn.turnId);
    expect(mockState.appendAssistantError).not.toHaveBeenCalled();
    expect(mockState.conversations["conv-1"].activeTurn).toBeNull();
  });

  it("keeps the turn running when the server doesn't accept the Stop", async () => {
    abortResponse = { ok: false, status: 503, json: async () => ({}) };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const send = startTurn();
    const turn = mockState.conversations["conv-1"].activeTurn!;

    let stopped: boolean;
    await act(async () => {
      stopped = await stopCanvasChatTurn("conv-1");
    });
    expect(stopped!).toBe(false);
    expect(turn.controller.signal.aborted).toBe(false);
    expect(mockState.conversations["conv-1"].activeTurn).toMatchObject({ turnId: turn.turnId, stopping: false });

    resolveStream();
    await act(async () => { await send(); });
    expect(mockState.finishStoppedTurn).not.toHaveBeenCalled();
  });

  it("offers no Stop for an Approve / Reject turn — the server answers it without the model", async () => {
    const send = startTurnWith({ approval: { proposalId: "p-1" } as never });
    expect(mockState.conversations["conv-1"].activeTurn).toMatchObject({ canStop: false });

    expect(await stopCanvasChatTurn("conv-1")).toBe(true);
    expect(global.fetch).not.toHaveBeenCalledWith("/api/ask/abort", expect.anything());

    resolveStream();
    await act(async () => { await send(); });
  });

  it("an edited resend replaces the stopped turn here and on the server, keeping its attachments", async () => {
    const attachment = { path: "uploads/a.png", filename: "a.png", mimeType: "image/png", size: 1 };
    mockState.conversations["conv-1"].messages = [
      { id: "old-u", role: "user", content: "Explain auth", attachments: [attachment] },
      { id: "old-a-0", role: "assistant", content: "Auth starts" },
      { id: "old-astopped", role: "assistant", content: "Stopped by user." },
    ] as MockConv["messages"];

    const send = startTurnWith({ content: "Explain auth in one paragraph", replacesTurnId: "old" });
    resolveStream();
    await act(async () => { await send(); });

    expect(mockState.removeTurn).toHaveBeenCalledWith("conv-1", "old");
    const quickCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url]) => url === "/api/ask/quick")!;
    const body = JSON.parse(quickCall[1].body);
    expect(body.replacesTurnId).toBe("old");
    expect(body.attachments).toEqual([attachment]);
    // The history sent with the turn leaves the replaced turn out.
    expect(body.messages.map((m: { content: string }) => m.content)).toEqual(["Explain auth in one paragraph"]);
    const userMessage = mockState.appendUserMessage.mock.calls[0][1];
    expect(userMessage).toMatchObject({ id: `${body.turnId}-u`, attachments: [attachment] });
  });

  it("is a no-op when no turn is running", async () => {
    expect(await stopCanvasChatTurn("conv-1")).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("useSendCanvasChatMessage — usage stamping", () => {
  beforeEach(() => {
    mockState = makeTrackedState();
    mockTimeline = [];
    mockFinalUsage = undefined;
    resetStreamPromise();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stamps usage onto the last tool-call batch message when stream ends with usage", async () => {
    // Timeline: text A, then tool call (the last tool-call row should get usage)
    mockTimeline = [
      { type: "text", data: { content: "A" } },
      {
        type: "toolCall",
        data: { id: "tc-1", toolName: "web_search", input: {}, output: { result: "ok" }, status: "output-available" },
      },
    ];
    mockFinalUsage = { inputTokens: 100, outputTokens: 40 };

    global.fetch = buildOkFetch();
    resolveStream();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    await act(async () => {
      await result.current({ conversationId: "conv-1", content: "search for something" });
    });

    const calls = (mockState.replaceAssistantStream as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    const timelineMessages = lastCall[2] as Array<{
      content: string;
      toolCalls?: unknown[];
      timeline?: unknown[];
      usage?: { inputTokens?: number; outputTokens?: number };
    }>;

    // Find the last message that has a timeline (tool-call batch row)
    const lastToolCallMsg = [...timelineMessages].reverse().find((m) => !!m.timeline?.length);
    expect(lastToolCallMsg).toBeDefined();
    expect(lastToolCallMsg!.usage).toEqual({ inputTokens: 100, outputTokens: 40 });
  });

  it("does NOT stamp usage when there is no tool-call batch message (text-only turn)", async () => {
    mockTimeline = [{ type: "text", data: { content: "just a text answer" } }];
    mockFinalUsage = { inputTokens: 50, outputTokens: 20 };

    global.fetch = buildOkFetch();
    resolveStream();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    await act(async () => {
      await result.current({ conversationId: "conv-1", content: "hello" });
    });

    const calls = (mockState.replaceAssistantStream as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    const timelineMessages = lastCall[2] as Array<{ content: string; usage?: unknown }>;

    // No message should have usage
    for (const m of timelineMessages) {
      expect(m.usage).toBeUndefined();
    }
  });

  it("does NOT stamp usage when finish event carries no usage (undefined)", async () => {
    mockTimeline = [
      {
        type: "toolCall",
        data: { id: "tc-1", toolName: "analyze", input: {}, output: {}, status: "output-available" },
      },
    ];
    mockFinalUsage = undefined;

    global.fetch = buildOkFetch();
    resolveStream();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    await act(async () => {
      await result.current({ conversationId: "conv-1", content: "analyze this" });
    });

    const calls = (mockState.replaceAssistantStream as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    const timelineMessages = lastCall[2] as Array<{ usage?: unknown }>;

    for (const m of timelineMessages) {
      expect(m.usage).toBeUndefined();
    }
  });

  it("stamps usage on the LAST tool-call batch row when there are multiple", async () => {
    mockTimeline = [
      {
        type: "toolCall",
        data: { id: "tc-1", toolName: "tool_one", input: {}, output: {}, status: "output-available" },
      },
      { type: "text", data: { content: "intermediate" } },
      {
        type: "toolCall",
        data: { id: "tc-2", toolName: "tool_two", input: {}, output: {}, status: "output-available" },
      },
    ];
    mockFinalUsage = { inputTokens: 200, outputTokens: 80 };

    global.fetch = buildOkFetch();
    resolveStream();

    const { result } = renderHook(() => useSendCanvasChatMessage());

    await act(async () => {
      await result.current({ conversationId: "conv-1", content: "multi tool turn" });
    });

    const calls = (mockState.replaceAssistantStream as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    const timelineMessages = lastCall[2] as Array<{
      content: string;
      timeline?: unknown[];
      usage?: { inputTokens?: number };
    }>;

    // Only the LAST tool-call batch message should have usage
    const toolCallMessages = timelineMessages.filter((m) => !!m.timeline?.length);
    expect(toolCallMessages.length).toBeGreaterThanOrEqual(2);

    const lastToolMsg = toolCallMessages[toolCallMessages.length - 1];
    expect(lastToolMsg.usage?.inputTokens).toBe(200);

    // Earlier tool-call messages must NOT have usage
    for (let i = 0; i < toolCallMessages.length - 1; i++) {
      expect(toolCallMessages[i].usage).toBeUndefined();
    }
  });
});
