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

vi.mock("@/lib/streaming", () => ({
  useStreamProcessor: () => ({
    processStream: vi.fn(
      (_response: unknown, _messageId: unknown, onUpdate: (msg: unknown) => void) => {
        // Immediately call onUpdate once to simulate a first chunk
        onUpdate({ timeline: mockTimeline });
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

describe("useSendCanvasChatMessage — attachments forwarding", () => {
  beforeEach(() => {
    mockState = makeTrackedState();
    mockTimeline = [];
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
