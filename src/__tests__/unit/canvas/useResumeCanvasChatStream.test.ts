// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

let resolveStream: () => void = () => {};
let streamPromise: Promise<void>;
let mockTimeline: unknown[] = [];
let processStreamCalls = 0;

function resetStreamPromise() {
  streamPromise = new Promise<void>((res) => {
    resolveStream = res;
  });
}

vi.mock("@/lib/streaming", () => ({
  useStreamProcessor: () => ({
    processStream: vi.fn(
      (_response: unknown, _messageId: unknown, onUpdate: (msg: unknown) => void) => {
        processStreamCalls += 1;
        onUpdate({ timeline: mockTimeline, isStreaming: true });
        return streamPromise.then(() => {
          onUpdate({ timeline: mockTimeline, isStreaming: false });
        });
      },
    ),
  }),
}));

interface MockConv {
  messages: Array<{ id: string; role: string; content: string }>;
  isLoading: boolean;
  isStreaming: boolean;
  agentTurnsInProgress: number;
}

const actions = {
  setIsLoading: vi.fn(),
  setIsStreaming: vi.fn(),
  bumpAgentTurns: vi.fn(),
  markTurnAuthored: vi.fn(),
  setActiveToolCalls: vi.fn(),
  setRunActive: vi.fn(),
  replaceAssistantStream: vi.fn(),
};

let conversations: Record<string, MockConv>;
let activeStreamFlag = false;

function resetStore() {
  conversations = {
    "slot-1": {
      messages: [{ id: "turn-9-u", role: "user", content: "hi" }],
      isLoading: false,
      isStreaming: false,
      agentTurnsInProgress: 0,
    },
  };
  activeStreamFlag = false;
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.setIsLoading.mockImplementation((_id: string, val: boolean) => {
    conversations["slot-1"].isLoading = val;
  });
  actions.setIsStreaming.mockImplementation((_id: string, val: boolean) => {
    conversations["slot-1"].isStreaming = val;
    activeStreamFlag = val;
  });
  actions.bumpAgentTurns.mockImplementation((_id: string, delta: number) => {
    conversations["slot-1"].agentTurnsInProgress = Math.max(
      0,
      conversations["slot-1"].agentTurnsInProgress + delta,
    );
  });
  actions.replaceAssistantStream.mockImplementation(
    (_id: string, prefix: string, next: Array<{ id: string }>) => {
      const kept = conversations["slot-1"].messages.filter(
        (m) => !m.id.startsWith(prefix),
      );
      conversations["slot-1"].messages = [
        ...kept,
        ...next.map((m) => ({ ...m, role: "assistant", content: "" })),
      ];
    },
  );
}

vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => ({
  useCanvasChatStore: Object.assign(
    (selector?: (s: { activeConversationId: string }) => unknown) =>
      selector ? selector({ activeConversationId: "slot-1" }) : undefined,
    {
      getState: () => ({
        conversations,
        ...actions,
      }),
    },
  ),
}));

import { useResumeCanvasChatStream } from "@/app/org/[githubLogin]/_state/useResumeCanvasChatStream";

const activeStream = { streamId: "turn-9", turnId: "turn-9" };

function sseResponse() {
  return {
    ok: true,
    status: 200,
    body: {},
    headers: { get: () => "text/event-stream" },
  };
}

function mount(overrides: Partial<Parameters<typeof useResumeCanvasChatStream>[0]> = {}) {
  return renderHook(() =>
    useResumeCanvasChatStream({
      conversationId: "slot-1",
      serverConversationId: "row-9",
      githubLogin: "acme",
      activeStream,
      seededMessages: [{ id: "turn-9-u", role: "user", content: "hi", timestamp: new Date() }],
      enabled: true,
      ...overrides,
    }),
  );
}

describe("useResumeCanvasChatStream", () => {
  beforeEach(() => {
    resetStore();
    mockTimeline = [];
    processStreamCalls = 0;
    resetStreamPromise();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("locks the composer before the relay GET and uses the ?chat= id", async () => {
    let sawLoading = false;
    vi.mocked(fetch).mockImplementation(async (input) => {
      sawLoading = conversations["slot-1"].isLoading && activeStreamFlag;
      expect(String(input)).toBe(
        "/api/orgs/acme/chat/conversations/row-9/stream",
      );
      expect(String(input)).not.toContain("slot-1");
      expect(String(input)).not.toContain("streamId");
      return sseResponse() as never;
    });

    mount();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(sawLoading).toBe(true);
    expect(conversations["slot-1"].agentTurnsInProgress).toBe(1);
  });

  it("does not markTurnAuthored on 204 and clears the streaming lock", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 204,
      body: null,
      headers: { get: () => null },
    } as never);

    mount();
    await waitFor(() => expect(actions.setIsStreaming).toHaveBeenCalledWith("slot-1", false));
    expect(actions.markTurnAuthored).not.toHaveBeenCalled();
    expect(conversations["slot-1"].isLoading).toBe(false);
    expect(conversations["slot-1"].agentTurnsInProgress).toBe(0);
    expect(processStreamCalls).toBe(0);
  });

  it("does not markTurnAuthored on a relay error", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      body: null,
      headers: { get: () => null },
    } as never);

    mount();
    await waitFor(() => expect(actions.bumpAgentTurns).toHaveBeenCalledWith("slot-1", -1));
    expect(actions.markTurnAuthored).not.toHaveBeenCalled();
  });

  it("replays tools and thinking without dropping the user row or duplicating persisted assistant rows", async () => {
    mockTimeline = [
      { type: "reasoning", id: "r1", data: { id: "r1", content: "thinking" } },
      {
        type: "toolCall",
        id: "tc-1",
        data: { id: "tc-1", toolName: "web_search", status: "output-available", output: { ok: true } },
      },
      { type: "text", id: "t1", data: { id: "t1", content: "answer" } },
    ];
    vi.mocked(fetch).mockResolvedValue(sseResponse() as never);

    mount();
    await waitFor(() => expect(actions.markTurnAuthored).toHaveBeenCalledWith("turn-9"));

    const prefix = actions.replaceAssistantStream.mock.calls[0][1] as string;
    expect(prefix).not.toBe("turn-9");
    expect(prefix.startsWith("turn-9")).toBe(false);

    resolveStream();
    await act(async () => {
      await streamPromise;
    });

    const ids = conversations["slot-1"].messages.map((m) => m.id);
    expect(ids).toContain("turn-9-u");
    expect(ids.filter((id) => id.startsWith("turn-9-a"))).toHaveLength(0);
    expect(ids.some((id) => id.startsWith(`${prefix}-`))).toBe(true);

    const rows = actions.replaceAssistantStream.mock.calls.at(-1)![2] as Array<{
      timeline?: Array<{ type: string }>;
      toolCalls?: Array<{ toolName: string }>;
      content: string;
    }>;
    expect(rows.some((r) => r.timeline?.[0]?.type === "reasoning")).toBe(true);
    expect(rows.some((r) => r.toolCalls?.[0]?.toolName === "web_search")).toBe(true);
  });

  it("marks the turn authored only after SSE starts so skip-prefix can drop server rows", async () => {
    vi.mocked(fetch).mockResolvedValue(sseResponse() as never);
    mount();
    await waitFor(() => expect(actions.markTurnAuthored).toHaveBeenCalledTimes(1));
    expect(actions.markTurnAuthored).toHaveBeenCalledWith("turn-9");
    // Skip-prefix is `${turnId}-`, which covers both the user and assistant rows.
    const turnId = actions.markTurnAuthored.mock.calls[0][0] as string;
    expect(`${turnId}-`).toBe("turn-9-");
  });

  it("skips resume when seeded messages already contain persisted assistant rows", async () => {
    mount({
      seededMessages: [
        { id: "turn-9-u", role: "user", content: "hi", timestamp: new Date() },
        { id: "turn-9-a0", role: "assistant", content: "done", timestamp: new Date() },
      ],
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(actions.markTurnAuthored).not.toHaveBeenCalled();
    expect(actions.setIsLoading).not.toHaveBeenCalled();
  });

  it("does not resume when the conversation is already streaming", async () => {
    conversations["slot-1"].isStreaming = true;
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
